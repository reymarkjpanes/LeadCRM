// Disposable PostgreSQL-compatible database. Never reads the developer's database URL.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { replayCrmMigrations } from '../backend/scripts/replay-crm-migrations.mjs';
const db = await PGlite.create();
const upgrade = '20261010000000_public_forms';
await replayCrmMigrations(db, { before: upgrade });
await db.exec(`INSERT INTO "Tenant" (id, name, slug, "updatedAt") VALUES ('migration-tenant', 'Migration fixture', 'migration-fixture', now());
INSERT INTO "User" (id, "tenantId", email, "firstName", "lastName", role, "updatedAt") VALUES ('migration-user', 'migration-tenant', 'fixture@camxian.com', 'Migration', 'Test', 'Client Admin', now());
INSERT INTO "MarketingForm" (id, "tenantId", "createdById", name, environment, "updatedAt") VALUES ('migration-form', 'migration-tenant', 'migration-user', 'Existing draft', 'PRODUCTION', now());`);
await replayCrmMigrations(db, { from: upgrade });
const upgraded = (await db.query('SELECT "publicId", name, "publishedVersion" FROM "MarketingForm" WHERE id = $1', ['migration-form'])).rows[0];
if (!upgraded.publicId || upgraded.name !== 'Existing draft' || upgraded.publishedVersion !== 0) throw new Error('Existing form migration failed');
console.log('PASS: actual migration retains existing forms and backfills public IDs.');
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 55439 });
await server.start();
const organization = process.argv.includes('--organization');
const databaseName = organization ? 'leadcrm_account_test_1' : 'leadcrm_forms_test_1';
const url = `postgresql://postgres:postgres@127.0.0.1:55439/${databaseName}?connection_limit=1`;
const preview = process.argv.includes('--preview');
const suite = organization ? 'src/modules/administration/organization-settings/organization-settings.integration.test.ts' : 'src/modules/marketing/forms';
const args = preview ? ['-r', 'ts-node/register/transpile-only', 'src/modules/marketing/forms/forms.preview.ts'] : ['../node_modules/vitest/vitest.mjs', 'run', suite];
const child = spawn(process.execPath, args, {
  cwd: 'backend', stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: 'forms-test-secret-for-disposable-database-only' },
});
const code = await new Promise(resolve => child.once('exit', resolve));
await server.stop(); await db.close(); process.exitCode = code ?? 1;
