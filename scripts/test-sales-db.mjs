// Isolated PostgreSQL-compatible database: never connects to the developer database.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { replayCrmMigrations } from '../backend/scripts/replay-crm-migrations.mjs';
import assert from 'node:assert/strict';
const db = await PGlite.create();
const upgrade = '20261013000000_record_files';
await replayCrmMigrations(db, { before: upgrade });
// Exercise the real data migration with a configured value and an existing Lead.
const migrationTenant = '11111111-1111-4111-8111-111111111111';
await db.query('INSERT INTO "Tenant" ("id","name","slug","updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)', [migrationTenant, 'Migration fixture', 'product-migration-fixture']);
await db.query('INSERT INTO "TenantPreference" ("id","tenantId","module","key","value","updatedAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)',
  ['22222222-2222-4222-8222-222222222222', migrationTenant, 'product-interests', 'values', JSON.stringify([{ name: 'Legacy Product', value: 25000.75 }])]);
await db.query('INSERT INTO "Lead" ("id","tenantId","firstName","lastName","productInterest",environment,"updatedAt") VALUES ($1,$2,$3,$4,$5,\'PRODUCTION\',CURRENT_TIMESTAMP)',
  ['33333333-3333-4333-8333-333333333333', migrationTenant, 'Legacy', 'Customer', ['Legacy Product']]);
await replayCrmMigrations(db, { from: upgrade });
const migrated = await db.query('SELECT p."id",p."dealValue",l."productInterestIds" FROM "ProductInterest" p JOIN "Lead" l ON l."tenantId"=p."tenantId" WHERE p."tenantId"=$1', [migrationTenant]);
assert.equal(Number(migrated.rows[0].dealValue), 25000.75);
assert.deepEqual(migrated.rows[0].productInterestIds, [migrated.rows[0].id]);
await db.query('DELETE FROM "Lead" WHERE "tenantId"=$1', [migrationTenant]);
await db.query('DELETE FROM "Tenant" WHERE "id"=$1', [migrationTenant]);
const port = process.argv.includes('--preview') ? 55441 : 55442;
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port });
await server.start();
const url = `postgresql://postgres:postgres@127.0.0.1:${port}/leadcrm_forms_test_2?connection_limit=1&statement_cache_size=0`;
const suites = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const args = process.argv.includes('--preview') ? ['-r', 'ts-node/register/transpile-only', 'src/modules/crm/leads/sales-automation.preview.ts'] : ['../node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...(suites.length ? suites : ['src/modules/crm/leads/sales-automation.integration.test.ts', 'src/modules/marketing/forms/forms.validation.test.ts', 'src/modules/marketing/forms/forms.integration.test.ts'])];
const child = spawn(process.execPath, args, {
  cwd: 'backend', stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: 'sales-test-secret-disposable-database-only' },
});
const code = await new Promise(resolve => child.once('exit', resolve));
await server.stop(); await db.close(); process.exitCode = code ?? 1;
