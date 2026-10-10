import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
import rollout from './deploy-lead-fields.cjs';
import deployment from './deploy-crm-imports.cjs';
const expansion = '20261110000000_preserve_retired_lead_fields', retirement = '20261112000000_retire_lead_nonform_columns';
test('preserves exact historical Lead values, guards release and refuses incomplete preservation', async () => {
  const db = await PGlite.create();
  const sql = readFileSync(resolve(import.meta.dirname, '../prisma/migrations', retirement, 'migration.sql'), 'utf8');
  try {
    await replayCrmMigrations(db, { before: expansion });
    await db.exec(`INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('t','Test','test',now());
      INSERT INTO "User"(id,"tenantId","firstName","lastName",email,role,"updatedAt") VALUES ('u','t','Test','User','u@example.test','Client Admin',now());
      INSERT INTO "Lead"(id,"tenantId","firstName","lastName",description,website,"productInterestOther","createdAt","updatedAt") VALUES ('l','t','Test','Lead',E'Historical\nUnicode café','https://example.test','Historical other','2025-01-01','2025-01-01'),('e','t','Empty','Lead','','',NULL,'2025-01-01','2025-01-01');`);
    const originalUpdatedAt = (await db.query('SELECT "updatedAt" FROM "Lead" WHERE id=\'l\'')).rows[0].updatedAt.toISOString();
    await replayCrmMigrations(db, { from: expansion, before: retirement });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "CustomFieldValue"')).rows[0].n, 5);
    assert.ok((await db.query('SELECT definition FROM "ClosingFieldDefinition"')).rows.every(row => row.definition.active === false && row.definition.visibleInForm === false));
    await db.exec(`UPDATE "Lead" SET description='Bridge still preserves old writers' WHERE id='l'`);
    assert.equal((await db.query(`SELECT value FROM "CustomFieldValue" WHERE "leadId"='l' AND "fieldId"='retired-lead-description'`)).rows[0].value, 'Bridge still preserves old writers');
    await assert.rejects(db.exec(sql), /verify the serving/); await db.exec('ROLLBACK');
    await db.exec(`COMMENT ON TABLE "Lead" IS 'lead-form-contract-api-verified-v1'; UPDATE "CustomFieldValue" SET value='"incorrect"'::jsonb WHERE "leadId"='e'`);
    await assert.rejects(db.exec(sql), /preservation differs/); await db.exec('ROLLBACK');
    await db.exec(`UPDATE "Lead" SET description=description WHERE id='e'`);
    await db.exec(sql);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='Lead' AND column_name IN ('description','website','productInterestOther')`)).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "CustomFieldValue"')).rows[0].n, 5);
    assert.equal((await db.query(`SELECT "updatedAt" FROM "Lead" WHERE id='l'`)).rows[0].updatedAt.toISOString(), originalUpdatedAt);
  } finally { await db.close(); }
});
test('deployment excludes Lead retirement until explicit authenticated verification', async () => {
  const records = ['20261028000000_retire_legacy_crm_imports','20261102000000_retire_relationship_compatibility'].map(migration_name => ({ migration_name, finished_at: new Date() }));
  assert.ok(deployment.deploymentPlan(records, [expansion,retirement]).exclude.includes(retirement));
  const config = { api: 'https://crm.example/api/v1', commit: 'a'.repeat(40), token: 'test-token' };
  const request = (capability = true, unsafe = false) => async url => ({ ok: true, json: async () => url.endsWith('/health') ? { commit: config.commit, capabilities: capability ? ['lead-form-contract-v1'] : [] }
    : url.endsWith('/auth/me') ? { data: { id: 'u', tenantId: 't', role: 'Client Admin' } }
    : { data: url.includes('?') ? [{ id: 'l', productInterestIds: [], ...(unsafe ? { description: 'old' } : {}) }] : { id: 'l', productInterestIds: [] } } });
  await rollout.verifyLeadRelease(config, request());
  await assert.rejects(rollout.verifyLeadRelease(config, request(false)), /NOT_SERVING/);
  await assert.rejects(rollout.verifyLeadRelease(config, request(true,true)), /PUBLIC_CONTRACT/);
  await assert.rejects(rollout.verifyLeadRelease({ ...config, api: 'http://crm.example' }, request()), /HTTPS/);
});
