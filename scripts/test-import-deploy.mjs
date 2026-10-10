// Reproduce Render's failed retirement and recover using the real Prisma engine
// on a disposable native PostgreSQL cluster. Never uses deployment credentials.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const bin = process.env.CRM_TEST_POSTGRES_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const output = join(root, 'data/outputs/import-deploy-test');
mkdirSync(output, { recursive: true });
const directory = mkdtempSync(join(output, 'cluster-'));
const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const run = (file, args) => new Promise((done, reject) => {
  const child = spawn(file, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
  child.once('error', reject); child.once('exit', code => done(code));
});
const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port; await new Promise(done => probe.close(done));
const url = `postgresql://postgres@127.0.0.1:${port}/leadcrm_import_deploy_test?sslmode=disable&connection_limit=5`;
process.env.DATABASE_URL = url; process.env.DIRECT_URL = url;
const { PrismaClient } = require('@prisma/client');
const { migrate, deploymentTarget, checksumMatches } = require('../backend/scripts/deploy-crm-imports.cjs');
const sha = source => createHash('sha256').update(source).digest('hex');
assert(checksumMatches('BEGIN;\r\nCOMMIT;\r\n', sha('BEGIN;\nCOMMIT;\n')));
assert(checksumMatches('BEGIN;\nCOMMIT;\n', sha('BEGIN;\r\nCOMMIT;\r\n')));
assert(!checksumMatches('BEGIN;\nDROP TABLE changed;\nCOMMIT;\n', sha('BEGIN;\nCOMMIT;\n')));
const expansion = '20261027000000_crm_import_integrity';
const retirement = '20261028000000_retire_legacy_crm_imports';
const rollout = mode => run(process.execPath, ['backend/scripts/deploy-crm-imports.cjs', mode]);
const db = new PrismaClient({ log: [], datasources: { db: { url } } });
let started = false;
try {
  assert.equal(await run(executable('initdb'), ['-D', directory, '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C']), 0);
  assert.equal(await run(executable('pg_ctl'), ['-D', directory, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']), 0);
  started = true;
  assert.equal(await run(executable('createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'leadcrm_import_deploy_test']), 0);
  migrate('20261026000000_module_action_permissions');
  await db.$executeRawUnsafe(`INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('fixture','Fixture','import-deploy',now())`);
  await db.$executeRawUnsafe(`INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('actor','fixture','fixture@example.test','Test','Actor','Client Admin',now())`);
  for (let i = 0; i < 2; i++) {
    await db.$executeRawUnsafe(`INSERT INTO "LeadImport" (id,"tenantId","createdById","fileName","totalRecords","successfulRecords",status) VALUES ($1,'fixture','actor','history.csv',4,4,'completed')`, `job-${i}`);
    for (let n = 0; n < 4; n++) await db.$executeRawUnsafe(`INSERT INTO "LeadImportResult" (id,"importId","rowNumber",status,"firstName") VALUES ($1,$2,$3,'imported','Original')`, `row-${i}-${n}`, `job-${i}`, n + 2);
  }
  assert.equal(await rollout('--deploy'), 0, 'Normal deploy must apply expansion and defer retirement');
  assert.equal(await db.crmImportJob.count(), 2); assert.equal(await db.crmImportRowResult.count(), 8);
  const jobs = await db.crmImportJob.findMany({ orderBy: { id: 'asc' } });
  const rows = await db.crmImportRowResult.findMany({ orderBy: { id: 'asc' } });
  assert.throws(() => migrate(retirement), /PRISMA_ROLLOUT_FAILED/, 'Bare migrate deploy reproduces the missing-approval failure');
  assert.equal(await rollout('--deploy'), 1, 'Unresolved failures must not be silently ignored');
  // Reject missing history before modifying Prisma bookkeeping.
  await db.$executeRawUnsafe(`UPDATE "CrmImportRowResult" SET data='{}' WHERE id='row-0-0'`);
  assert.equal(await rollout('--recover'), 1, 'Recovery must stop if historical payloads differ');
  await db.$executeRawUnsafe(`UPDATE "CrmImportRowResult" SET data=$1::jsonb WHERE id='row-0-0'`, JSON.stringify(rows[0].data));
  assert.equal(await rollout('--recover'), 0);
  assert.equal(await rollout('--recover'), 0, 'Recovery is repeatable');
  assert.equal(await rollout('--deploy'), 0);
  assert.equal(await rollout('--deploy'), 0, 'Repeated hosting deploys remain successful');
  const attempts = await db.$queryRawUnsafe(`SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1`, retirement);
  assert.equal(attempts.length, 1); assert.equal(attempts[0].finished_at, null); assert(attempts[0].rolled_back_at);
  assert.deepEqual(await db.crmImportJob.findMany({ orderBy: { id: 'asc' } }), jobs);
  assert.deepEqual(await db.crmImportRowResult.findMany({ orderBy: { id: 'asc' } }), rows);
  const [{ count }] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "LeadImportResult"'); assert.equal(count, 8);
  assert.throws(() => deploymentTarget([], [expansion, retirement, '20261029000000_future']), /RETIRE_IMPORT_TABLES/);
  assert.throws(() => deploymentTarget([{ migration_name: 'unrelated', finished_at: null, rolled_back_at: null }], []), /FAILED_MIGRATION/);
  // Only this disposable fixture simulates API approval; deployed API verification
  // is covered by test-import-normalization.mjs and required by --retire.
  await db.$executeRawUnsafe(`COMMENT ON TABLE "CrmImportJob" IS 'crm-import-normalization-api-verified-v1'`);
  migrate(retirement);
  assert.equal(await rollout('--deploy'), 0, 'Normal migrations continue once retirement has been verified/applied');
  const tables = await db.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('LeadImport','ContactImport','AccountImport','DealImport')`);
  assert.equal(tables.length, 0);
  assert.deepEqual(await db.crmImportJob.findMany({ orderBy: { id: 'asc' } }), jobs);
  assert.deepEqual(await db.crmImportRowResult.findMany({ orderBy: { id: 'asc' } }), rows);
  console.log('PASS: native Prisma deploy, failed retirement, guarded recovery, repeated deploys and verified retirement preserve 2 jobs / 8 results.');
} finally {
  await db.$disconnect();
  if (started) spawnSync(executable('pg_ctl'), ['-D', directory, '-m', 'fast', '-w', 'stop'], { stdio: 'inherit', windowsHide: true });
}
