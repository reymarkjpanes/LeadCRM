// Disposable database only: replay and verify the real migration, then exercise HTTP RBAC.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { replayCrmMigrations } from '../backend/scripts/replay-crm-migrations.mjs';
const require = createRequire(import.meta.url);
const { PERMISSION_MODULES, PERMISSION_ACTIONS } = require('../shared/src/constants/permission-modules.js');
const db = await PGlite.create();
const upgrade = '20261026000000_module_action_permissions';
await replayCrmMigrations(db, { before: upgrade });
await db.exec(`
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('migration-tenant','Permissions migration','permissions-migration',now());
INSERT INTO "RoleDefinition" (id,"tenantId",name,"isSystemRole","updatedAt") VALUES
 ('migration-role','migration-tenant','Sales Staff',false,now()), ('migration-admin','migration-tenant','Client Admin',true,now());
INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('migration-user','migration-tenant','migration@example.test','Migration','User','Sales Staff',now());
INSERT INTO "UserRole" (id,"tenantId","userId","roleId") VALUES ('migration-assignment','migration-tenant','migration-user','migration-role');
INSERT INTO "RolePermission" (id,"tenantId","roleId",module,"canView","canCreate","canEdit","canDelete") VALUES
 ('migration-contacts','migration-tenant','migration-role','contacts',true,true,true,true),
 ('migration-settings','migration-tenant','migration-role','settings',true,true,true,true),
 ('migration-reports','migration-tenant','migration-role','reports',true,false,false,false),
 ('migration-billing','migration-tenant','migration-role','billing',true,true,true,true);
`);
await replayCrmMigrations(db, { from: upgrade });
assert.equal((await db.query('SELECT * FROM "UserRole" WHERE id=$1', ['migration-assignment'])).rows[0].roleId, 'migration-role');
assert.equal((await db.query('SELECT count(*) FROM "User" WHERE id=$1', ['migration-user'])).rows[0].count, 1);
const permissions = (await db.query('SELECT * FROM "RolePermission" WHERE "roleId"=$1', ['migration-role'])).rows;
assert.ok(!permissions.some(p => ['reports','billing'].includes(p.module)));
assert.ok(permissions.find(p => p.module === 'leads').canArchive);
assert.ok(permissions.find(p => p.module === 'leads').canImport);
assert.equal(permissions.find(p => p.module === 'settings').canCreate, false);
assert.equal(permissions.find(p => p.module === 'contacts').canDelete, false);
const admin = (await db.query('SELECT * FROM "RolePermission" WHERE "roleId"=$1', ['migration-admin'])).rows;
for (const module of PERMISSION_MODULES) {
  const row = admin.find(p => p.module === module.key);
  for (const flag of PERMISSION_ACTIONS) assert.equal(row[flag], module.actions.includes(flag), `${module.key}.${flag}`);
}
console.log('Migration passed: assignments preserved, obsolete rows removed, archive/import migrated, Client Admin has all 75 actions.');
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 55446 });
await server.start();
const url = 'postgresql://postgres:postgres@127.0.0.1:55446/leadcrm_environment_test_26?connection_limit=1&statement_cache_size=0';
try {
  const suites = process.argv.slice(2);
  const child = spawn(process.execPath, ['../node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...(suites.length ? suites : [
    'src/modules/administration/roles/__tests__/roles.integration.test.ts',
    'src/core/permissions/permissions.integration.test.ts',
    'src/api/middleware/__tests__/role-authorization.test.ts',
  ])], { cwd: 'backend', stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: 'permissions-disposable-test-only' } });
  process.exitCode = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
} finally { await server.stop(); await db.close(); }
