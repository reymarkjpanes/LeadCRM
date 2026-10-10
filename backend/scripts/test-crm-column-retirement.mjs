// Disposable PostgreSQL only. Never loads environment credentials.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const migration = '20261110000000_retire_unused_crm_columns';
const sql = readFileSync(resolve(import.meta.dirname, '../prisma/migrations', migration, 'migration.sql'), 'utf8');
const db = await PGlite.create();
let checks = 0;
const columns = async () => (await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'retirement_dependency' ORDER BY 1,2`)).rows;
const snapshot = async () => (await db.query(`SELECT jsonb_build_object(
  'contact', (SELECT to_jsonb(c) - ARRAY['lastContactedAt','qualifiedAt','disqualifiedReason'] FROM "Contact" c WHERE id='retirement-contact'),
  'deal', (SELECT to_jsonb(d) - 'billingFrequency' FROM "Deal" d WHERE id='retirement-deal'),
  'workflows', (SELECT jsonb_agg(w ORDER BY id) FROM "Workflow" w),
  'values', (SELECT jsonb_agg(v ORDER BY id) FROM "CustomFieldValue" v),
  'links', (SELECT jsonb_agg(l ORDER BY "contactId") FROM "ContactDeal" l)
) AS state`)).rows;
const rejects = async (pattern) => {
  await assert.rejects(db.exec(sql), pattern);
  await db.exec('ROLLBACK');
  assert.deepEqual(await columns(), originalColumns, 'A rejected migration must leave the entire catalog intact');
  checks++;
};
let originalColumns;
try {
  await replayCrmMigrations(db, { before: migration });
  originalColumns = await columns();
  await db.exec(`
    INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('retirement','Retirement fixture','retirement',now());
    INSERT INTO "Pipeline" (id,"tenantId",name,"updatedAt") VALUES ('retirement-pipeline','retirement','Sales',now());
    INSERT INTO "Stage" (id,"tenantId","pipelineId",name,"order","requiredFields") VALUES ('retirement-stage','retirement','retirement-pipeline','Won',0,'{}');
    INSERT INTO "Contact" (id,"tenantId","firstName","lastName","updatedAt",notes,"isArchived") VALUES ('retirement-contact','retirement','Historic','Contact',now(),'Preserved conversion notes',true);
    INSERT INTO "Deal" (id,"tenantId","pipelineId","stageId",title,value,"updatedAt","closingSnapshot","closingValues","isArchived") VALUES ('retirement-deal','retirement','retirement-pipeline','retirement-stage','Historical Deal',25000.5,now(),'{"version":7,"values":{"reference":"keep"}}','{"reference":"keep"}',true);
    INSERT INTO "ContactDeal" (id,"contactId","dealId","tenantId") VALUES ('retirement-link','retirement-contact','retirement-deal','retirement');
    INSERT INTO "ClosingFieldDefinition" ("tenantId",id,definition) VALUES ('retirement','retirement-reference','{"id":"retirement-reference","name":"Reference","type":"Text","module":"deals","group":"Closed Won Requirements","version":7}');
    INSERT INTO "CustomFieldValue" (id,"tenantId","fieldId",module,"dealId",value) VALUES ('retirement-value','retirement','retirement-reference','deals','retirement-deal','"keep"');
    INSERT INTO "Workflow" (id,"tenantId",name,trigger,actions,conditions,"updatedAt") VALUES ('retirement-workflow','retirement','Legacy draft','deal.updated','[{"type":"update_field","config":{"field":"billingFrequency","value":"monthly"}}]','{"conditions":[{"field":"qualifiedAt","operator":"is_not_empty"}]}',now());
  `);
  for (const [table, column, value] of [
    ['Contact','lastContactedAt','2020-01-01'], ['Contact','qualifiedAt','2020-01-02'],
    ['Contact','disqualifiedReason','Retained reason'], ['Contact','disqualifiedReason',''],
    ['Deal','billingFrequency','monthly'], ['Deal','billingFrequency',''],
  ]) {
    await db.query(`UPDATE "${table}" SET "${column}"=$1`, [value]);
    await rejects(/retired columns contain data/);
    const preserved = (await db.query(`SELECT "${column}" AS value FROM "${table}"`)).rows[0].value;
    assert.ok(preserved !== null, 'Guard must preserve even archived or empty-string data');
    await db.exec(`UPDATE "${table}" SET "${column}"=NULL`);
  }
  for (const state of [`"isActive"=true, status='PAUSED'`, `"isActive"=false, status='ACTIVE'`]) {
    await db.exec(`UPDATE "Workflow" SET ${state}`);
    await rejects(/active Workflow references/);
  }
  // Exercise each selector and both condition/action trees without touching text.
  for (const field of ['lastContactedAt','qualifiedAt','disqualifiedReason','billingFrequency','contact.qualifiedAt','deal.billingFrequency']) {
    await db.query(`UPDATE "Workflow" SET actions='[]', conditions=$1::jsonb`, [JSON.stringify({ conditions: [{ field }] })]);
    await rejects(/active Workflow references/);
    await db.query(`UPDATE "Workflow" SET conditions=NULL, actions=$1::jsonb`, [JSON.stringify([{ type: 'update_field', config: { field } }])]);
    await rejects(/active Workflow references/);
  }
  await db.exec(`UPDATE "Workflow" SET status='PAUSED', "isActive"=false`);
  // Unexpected SQL dependencies must fail atomically, without CASCADE.
  await db.exec(`CREATE VIEW retirement_dependency AS SELECT "billingFrequency" FROM "Deal"`);
  await rejects(/depend/);
  await db.exec('DROP VIEW retirement_dependency');
  const before = await snapshot();
  await db.exec(sql);
  const dropped = new Set(['Contact.lastContactedAt','Contact.qualifiedAt','Contact.disqualifiedReason','Deal.billingFrequency']);
  assert.deepEqual(await columns(), originalColumns.filter(c => !dropped.has(`${c.table_name}.${c.column_name}`)));
  assert.deepEqual(await snapshot(), before, 'All retained record data, JSON history, custom values, relationships and paused configuration must survive');
  checks++;
  console.log(`CRM retirement: ${checks} checks passed; four columns removed, guards rollback atomically, retained data unchanged.`);
} finally { await db.close(); }

const fresh = await PGlite.create();
try {
  await replayCrmMigrations(fresh);
  assert.equal((await fresh.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND ((table_name='Contact' AND column_name IN ('lastContactedAt','qualifiedAt','disqualifiedReason')) OR (table_name='Deal' AND column_name='billingFrequency'))`)).rows[0].n, 0);
  console.log('Fresh complete migration chain passed.');
} finally { await fresh.close(); }
