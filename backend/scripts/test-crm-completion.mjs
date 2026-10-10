// Disposable database only: migration replay and authenticated integration checks.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const db = await PGlite.create();
const migration = '20261020000000_conversion_fields_notifications';
await replayCrmMigrations(db, { before: migration });
await db.exec(`INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES ('migration-existing', 'Existing', 'migration-existing', now()), ('migration-disabled', 'Disabled', 'migration-disabled', now());
  INSERT INTO "TenantPreference" ("id", "tenantId", "module", "key", "value", "updatedAt") VALUES
  ('legacy-fields', 'migration-existing', 'closing-requirements', 'fields', '[{"id":"legacy-field","name":"Existing evidence","type":"Text","required":true,"active":true,"options":[],"description":"","appliesTo":"Closed Won Requirements","version":3}]', now()),
  ('existing-disabled', 'migration-disabled', 'deal-stage-automation', 'default', '{"enabled":false}', now());`);
await replayCrmMigrations(db, { from: migration });
const migrated = await db.query(`SELECT "definition" FROM "ClosingFieldDefinition" WHERE "tenantId"='migration-existing'`);
assert.equal(migrated.rows[0].definition.id, 'legacy-field');
assert.equal(migrated.rows[0].definition.version, 3);
const preferences = await db.query(`SELECT "tenantId", "value" FROM "TenantPreference" WHERE "module"='deal-stage-automation' ORDER BY "tenantId"`);
assert.deepEqual(preferences.rows, []);
assert.equal((await db.query(`SELECT count(*)::int AS count FROM "TenantPreference" WHERE "id"='legacy-fields'`)).rows[0].count, 1);
console.log('Migration preservation checks passed: fields, versions and unrelated preferences retained; retired automation settings removed.');
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
await socket.start();
const root = resolve(import.meta.dirname, '..');
try {
  const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', 'src/modules/crm/leads/crm-completion.integration.test.ts'], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env,
      DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_completion_test_1?connection_limit=1`,
      JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    },
  });
  process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
} finally { await socket.stop(); await db.close(); }
