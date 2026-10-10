// Full two-phase rehearsal on an isolated in-memory database, never deployment credentials.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from '../backend/scripts/replay-crm-migrations.mjs';
const expansion = '20261027000000_crm_import_integrity';
const retirement = '20261028000000_retire_legacy_crm_imports';
const db = await PGlite.create();
let socket;
try {
  await replayCrmMigrations(db, { before: expansion });
  await db.exec(`INSERT INTO "Tenant" (id,name,slug,"onboardingStep","onboardingCompletedAt","updatedAt") VALUES ('import-rollout-tenant','Rollout fixture','import-rollout',3,now(),now());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"mustChangePassword","updatedAt") VALUES ('import-rollout-actor','import-rollout-tenant','csv@camxian.com','Admin','CSV','Client Admin',false,now());`);
  for (const module of ['Lead', 'Contact', 'Account', 'Deal']) {
    const jobs = module === 'Lead' ? 2 : 1, rows = module === 'Lead' ? 4 : 2;
    for (let i = 0; i < jobs; i++) {
      const id = `${module}-history-${i}`;
      await db.query(`INSERT INTO "${module}Import" (id,"tenantId","createdById","fileName","totalRecords","successfulRecords",status,"createdAt","completedAt") VALUES ($1,'import-rollout-tenant','import-rollout-actor','history.csv',$2,$2,'completed','2026-09-01','2026-09-01')`, [id, rows]);
      for (let n = 0; n < rows; n++) await db.query(`INSERT INTO "${module}ImportResult" (id,"importId","rowNumber",status${module === 'Deal' ? ',data' : ''}) VALUES ($1,$2,$3,'imported'${module === 'Deal' ? ",'{}'" : ''})`, [`${id}-${n}`, id, n + 2]);
    }
  }
  await replayCrmMigrations(db, { from: expansion, before: retirement });
  const before = (await db.query('SELECT * FROM crm_verify_import_normalization()')).rows;
  socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
  const url = `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_forms_test_2?connection_limit=1&statement_cache_size=0`;
  const child = spawn(process.execPath, ['../node_modules/vitest/vitest.mjs', 'run', 'src/modules/crm/imports/imports.integration.test.ts'], {
    cwd: 'backend', stdio: 'inherit', windowsHide: true,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: 'disposable-rollout-only', CRM_IMPORT_ROLLOUT_TEST: 'true' },
  });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0, 'New imports and historical API verification must pass before retirement.');
  assert.deepEqual((await db.query('SELECT * FROM crm_verify_import_normalization()')).rows, before);
  await db.exec(readFileSync(`backend/prisma/migrations/${retirement}/migration.sql`, 'utf8'));
  const preserved = await db.query(`SELECT j.module,count(DISTINCT j.id)::int AS jobs,count(r.id)::int AS results FROM "CrmImportJob" j LEFT JOIN "CrmImportRowResult" r ON r."importJobId"=j.id WHERE j.id LIKE '%-history-%' GROUP BY j.module ORDER BY j.module`);
  assert.deepEqual(preserved.rows, before);
  console.log('Retirement after API verification passed. Historical counts preserved:', JSON.stringify(preserved.rows));
} finally { if (socket) await socket.stop(); await db.close(); }
