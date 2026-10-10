import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { replayCrmMigrations } from '../replay-crm-migrations';

const name = '20261017000000_remove_crm_environments';
const migration = readFileSync(resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'), 'utf8');

async function legacy() {
  const db = await PGlite.create();
  await replayCrmMigrations(db, name);
  await db.exec(`
    INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('tenant','Workspace','workspace',now()), ('other','Other','other',now());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt","activeEnvironment") VALUES ('user','tenant','user@example.com','User','Test','Client Admin',now(),'SANDBOX');
    INSERT INTO "Environment" (id,"tenantId","envCode",type,"updatedAt") VALUES ('monitor','tenant','prod','production',now());
    INSERT INTO "Lead" (id,"tenantId","firstName","lastName",environment,"updatedAt") VALUES ('live','tenant','Keep','Me','PRODUCTION',now()),('test','tenant','Retire','Me','SANDBOX',now());
    INSERT INTO "Task" (id,"tenantId","assignedUserId",title,environment,"dueDate","updatedAt") VALUES ('live-task','tenant','user','Keep','PRODUCTION',now(),now()),('test-task','tenant','user','Retire','SANDBOX',now(),now());
    INSERT INTO "TaskLead" ("taskId","leadId","tenantId",environment) VALUES ('live-task','live','tenant','PRODUCTION'),('test-task','test','tenant','SANDBOX');
    INSERT INTO "LeadImport" (id,"tenantId","createdById","fileName",status,environment) VALUES ('live-import','tenant','user','keep.csv','COMPLETED','PRODUCTION'),('test-import','tenant','user','retire.csv','COMPLETED','SANDBOX');
    INSERT INTO "LeadImportResult" (id,"importId","rowNumber",status,"leadId") VALUES ('live-result','live-import',1,'CREATED','live'),('test-result','test-import',1,'CREATED','test');
    INSERT INTO "AuditLog" (id,"tenantId","userId",action,"entityType",category,environment) VALUES ('live-audit','tenant','user','lead.created','Lead','crm','PRODUCTION'),('test-audit','tenant','user','lead.created','Lead','crm','SANDBOX'),('shared-audit','tenant','user','login','User','auth',NULL);
    INSERT INTO "TenantPreference" (id,"tenantId",module,key,value,"updatedAt") VALUES ('cursor','tenant','lead-assignment','PRODUCTION','{"index":3}',now());
  `);
  return db;
}

it('preserves Live rows and links, retires only Sandbox rows, and retains tenant guards', async () => {
  const db = await legacy();
  try {
    const before = (await db.query(`SELECT to_jsonb(l) - 'environment' AS data FROM "Lead" l WHERE id='live'`)).rows;
    await db.exec(migration);
    expect((await db.query(`SELECT to_jsonb(l) AS data FROM "Lead" l`)).rows).toEqual(before);
    expect((await db.query(`SELECT "taskId","leadId","tenantId" FROM "TaskLead"`)).rows).toEqual([{taskId:'live-task',leadId:'live',tenantId:'tenant'}]);
    expect((await db.query(`SELECT id FROM "LeadImportResult"`)).rows).toEqual([{id:'live-result'}]);
    expect((await db.query(`SELECT id FROM "AuditLog" ORDER BY id`)).rows).toEqual([{id:'live-audit'},{id:'shared-audit'}]);
    expect((await db.query(`SELECT key,value FROM "TenantPreference" WHERE id='cursor'`)).rows).toEqual([{key:'default',value:{index:3}}]);
    expect((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('environment','activeEnvironment','environmentId')`)).rows).toEqual([]);
    expect((await db.query(`SELECT to_regclass('"Environment"') AS table_name, to_regtype('"CrmEnvironment"') AS enum_name`)).rows).toEqual([{table_name:null,enum_name:null}]);
    await expect(db.exec(`UPDATE "Lead" SET "tenantId"='other' WHERE id='live'`)).rejects.toThrow('cannot move between tenants');
    await db.exec(`INSERT INTO "Lead" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('foreign','other','Foreign','Lead',now());`);
    await expect(db.exec(`INSERT INTO "TaskLead" ("taskId","leadId","tenantId") VALUES ('live-task','foreign','tenant')`)).rejects.toThrow();
    await expect(db.exec(`UPDATE "Task" SET "leadId"='foreign' WHERE id='live-task'`)).rejects.toThrow('crosses tenant');
  } finally { await db.close(); }
}, 60000);

it('aborts before removing data when a retained dependency points into Sandbox', async () => {
  const db = await legacy();
  try {
    // Simulate an additional application table unknown to the original feature.
    await db.exec(`CREATE TABLE "RetainedExtension" (id text PRIMARY KEY, "leadId" text REFERENCES "Lead"(id) ON DELETE CASCADE); INSERT INTO "RetainedExtension" VALUES ('keep','test');`);
    await expect(db.exec(migration)).rejects.toThrow('Retained data references obsolete Sandbox data');
    await db.exec('ROLLBACK');
    expect((await db.query(`SELECT id FROM "Lead" ORDER BY id`)).rows).toEqual([{id:'live'},{id:'test'}]);
    expect((await db.query(`SELECT * FROM "RetainedExtension"`)).rows).toEqual([{id:'keep',leadId:'test'}]);
    expect((await db.query(`SELECT "activeEnvironment" FROM "User" WHERE id='user'`)).rows).toEqual([{activeEnvironment:'SANDBOX'}]);
  } finally { await db.close(); }
}, 60000);
