// Isolated migration + HTTP verification. Never connects to a deployment database.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const migration = '20261105000000_module_custom_fields';
const deferred = await PGlite.create();
try {
  await replayCrmMigrations(deferred, { exclude: ['20261102000000_retire_relationship_compatibility'] });
  assert.equal((await deferred.query(`SELECT to_regclass('public."CustomFieldValue"') IS NOT NULL AS ready`)).rows[0].ready, true);
  console.log('Migration also verified with relationship compatibility retirement deferred.');
} finally { await deferred.close(); }
const db = await PGlite.create();
await replayCrmMigrations(db, { before: migration });
await db.exec(`
  INSERT INTO "Tenant" ("id","name","slug","updatedAt") VALUES ('custom-migration','Existing','custom-migration',now());
  INSERT INTO "Pipeline" ("id","tenantId","name","updatedAt") VALUES ('custom-pipeline','custom-migration','Sales Pipeline',now());
  INSERT INTO "Stage" ("id","tenantId","pipelineId","name","order","requiredFields") VALUES ('custom-stage','custom-migration','custom-pipeline','Qualified',0,'{}');
  INSERT INTO "ClosingFieldDefinition" ("tenantId","id","definition") VALUES ('custom-migration','legacy-reference','{"id":"legacy-reference","name":"Reference","type":"Text","required":true,"active":true,"options":[],"description":"Preserve","version":7}');
  INSERT INTO "Deal" ("id","tenantId","pipelineId","stageId","title","updatedAt","closingValues","closingSnapshot") VALUES
    ('custom-deal','custom-migration','custom-pipeline','custom-stage','History',now(),'{"legacy-reference":"REF-123","unknown-legacy":"keep"}','{"fields":[],"values":{"unknown-legacy":"keep"}}');
`);
const before = await db.query(`SELECT "closingValues", "closingSnapshot" FROM "Deal" WHERE "id"='custom-deal'`);
await replayCrmMigrations(db, { from: migration });
assert.deepEqual((await db.query(`SELECT "closingValues", "closingSnapshot" FROM "Deal" WHERE "id"='custom-deal'`)).rows, before.rows);
const definitions = await db.query(`SELECT "id", "definition" FROM "ClosingFieldDefinition" WHERE "tenantId"='custom-migration'`);
assert.equal(definitions.rows.length, 1); assert.equal(definitions.rows[0].id, 'legacy-reference');
assert.equal(definitions.rows[0].definition.version, 7); assert.equal(definitions.rows[0].definition.module, 'deals');
assert.equal(definitions.rows[0].definition.group, 'Closed Won Requirements'); assert.equal(definitions.rows[0].definition.visibleInForm, true);
assert.deepEqual((await db.query(`SELECT "fieldId", "value" FROM "CustomFieldValue" WHERE "tenantId"='custom-migration'`)).rows, [{ fieldId: 'legacy-reference', value: 'REF-123' }]);
console.log('Migration verified: definition count/IDs/version, normalized values and original closing JSON/snapshot preserved.');
// Test constraints before opening the wire server: PGlite's socket adapter can
// terminate after a deliberate protocol-level SQL error.
await assert.rejects(db.exec(`INSERT INTO "CustomFieldValue" ("id","tenantId","fieldId","module","dealId","value") VALUES ('bad-tenant','wrong-tenant','legacy-reference','deals','custom-deal','1')`), /foreign key/i);
await assert.rejects(db.exec(`INSERT INTO "CustomFieldValue" ("id","tenantId","fieldId","module","dealId","value") VALUES ('bad-module','custom-migration','legacy-reference','leads','custom-deal','1')`), /check constraint/i);
console.log('SQL tenant foreign keys and module/record association constraints verified.');
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
await socket.start();
try {
  const root = resolve(import.meta.dirname, '..');
  const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', 'src/modules/crm/closing-requirements/custom-fields.integration.test.ts', '--maxWorkers=1'], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_custom_fields_test?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') },
  });
  process.exitCode = await new Promise(done => child.on('exit', code => done(code ?? 1)));
} finally { await socket.stop(); await db.close(); }
