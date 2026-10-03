import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { replayCrmMigrations } from '../replay-crm-migrations';

const name = '20261021000000_remove_deal_fields_and_tenant_invitations';
const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql'), 'utf8');

it('drops only the retired objects and preserves populated records through the forward migration', async () => {
  const db = await PGlite.create();
  try {
    await replayCrmMigrations(db, name);
    await db.exec(`
      INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('tenant','Preserved','preserved',now());
      INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('user','tenant','fixture@camxian.com','Fixture','User','Client Admin',now());
      INSERT INTO "RoleDefinition" (id,"tenantId",name,"updatedAt") VALUES ('role','tenant','Sales',now());
      INSERT INTO "Pipeline" (id,"tenantId",name,"updatedAt") VALUES ('pipeline','tenant','Sales Pipeline',now());
      INSERT INTO "Stage" (id,"tenantId","pipelineId",name,"order") VALUES ('stage','tenant','pipeline','Lead',0);
      INSERT INTO "Deal" (id,"tenantId","pipelineId","stageId",title,value,description,tags,"productInterests","updatedAt") VALUES ('deal','tenant','pipeline','stage','Preserved Deal',25000,'Retired text',ARRAY['keep'],ARRAY['Camera'],now());
      INSERT INTO "Activity" (id,"tenantId","createdById","dealId",type,title) VALUES ('activity','tenant','user','deal','call','Historical call');
      INSERT INTO "TenantInvitation" (id,"tenantId","roleId","invitedById",email,"tokenHash","expiresAt") VALUES ('invite','tenant','role','user','invite@camxian.com','hash',now());
      ALTER TABLE "Deal" ADD COLUMN confidence integer DEFAULT 50;
    `);
    const tables = ['Deal', 'User', 'Tenant', 'RoleDefinition', 'Activity', 'Pipeline', 'Stage'];
    const snapshot = async () => Promise.all(tables.map(async table => (await db.query(`SELECT to_jsonb(t) - 'description' - 'confidence' AS row FROM "${table}" t ORDER BY id`)).rows));
    const before = await snapshot();
    await db.exec(sql);
    expect(await snapshot()).toEqual(before);
    expect((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Deal' AND column_name IN ('confidence','description')`)).rows).toEqual([]);
    expect((await db.query(`SELECT to_regclass('public."TenantInvitation"') AS name`)).rows).toEqual([{ name: null }]);
    expect((await db.query(`SELECT description FROM "Activity" WHERE id='activity'`)).rows).toEqual([{ description: null }]);
  } finally { await db.close(); }
}, 60000);
