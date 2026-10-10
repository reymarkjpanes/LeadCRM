import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const name='20261031000000_retire_obsolete_infrastructure';
const sql=readFileSync(resolve(import.meta.dirname,'../prisma/migrations',name,'migration.sql'),'utf8');
const db=await PGlite.create();
try {
  await replayCrmMigrations(db,{before:name});
  await db.exec(`
    INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('tenant','Preserved','preserved',now());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"passwordHash","updatedAt") VALUES ('user','tenant','preserved@example.test','Preserved','User','Client Admin','unchanged',now());
    INSERT INTO "Pipeline" (id,"tenantId",name,"updatedAt") VALUES ('pipeline','tenant','Sales',now());
    INSERT INTO "Stage" (id,"tenantId","pipelineId",name,"order") VALUES ('stage','tenant','pipeline','Open',0);
    INSERT INTO "Deal" (id,"tenantId","pipelineId","stageId",title,"updatedAt") VALUES ('deal','tenant','pipeline','stage','Retained',now());
    INSERT INTO "Task" (id,"tenantId","assignedUserId",title,"dueDate","updatedAt") VALUES ('task','tenant','user','Retained',now(),now());
    ALTER TABLE "Task" ADD COLUMN "organizationId" TEXT;
    INSERT INTO "Activity" (id,"tenantId","createdById",title,type) VALUES ('activity','tenant','user','Retained history','note');
    INSERT INTO "AuditLog" (id,"tenantId","userId",action,"entityType") VALUES ('audit','tenant','user','retained','User');
    INSERT INTO "PasswordResetToken" (id,"userId",email,token,expires) VALUES ('reset','user','preserved@example.test','preserved-reset',now());
  `);
  const candidates={
    DealAction:`INSERT INTO "DealAction" (id,"tenantId","dealId","performedById","actionType") VALUES ('guard','tenant','deal','user','ADD_NOTE')`,
    AutomationRule:`INSERT INTO "AutomationRule" (id,"tenantId",name,"triggerType",actions,"updatedAt") VALUES ('guard','tenant','Legacy','lead.created','[]',now())`,
    SMSQueue:`INSERT INTO "SMSQueue" (id,"tenantId","toNumber",message,"updatedAt") VALUES ('guard','tenant','+639000000000','Legacy',now())`,
    EmailVerificationToken:`INSERT INTO "EmailVerificationToken" (id,"userId",email,"tokenHash","expiresAt") VALUES ('guard','user','preserved@example.test','legacy',now())`,
  };
  const reject=async()=>{await assert.rejects(db.exec(sql),/Retirement blocked/);await db.exec('ROLLBACK');};
  for(const [table,insert] of Object.entries(candidates)) {
    await db.exec(insert); await reject();
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n,1);
    await db.exec(`DELETE FROM "${table}" WHERE id='guard'`);
  }
  await db.exec('CREATE TABLE retirement_guard (id text REFERENCES "AutomationRule"(id))');
  await reject(); await db.exec('DROP TABLE retirement_guard');
  await db.exec(`UPDATE "Task" SET "organizationId"='unreconciled'`); await reject();
  await db.exec('UPDATE "Task" SET "organizationId"=NULL');
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename).filter(table=>!(table in candidates));
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`SELECT ${table==='Task'?"to_jsonb(t)-'organizationId'":'to_jsonb(t)'} AS row FROM "${table}" t ORDER BY 1`)).rows])));
  const before=await snapshot(); await db.exec(sql); assert.deepEqual(await snapshot(),before);
  for(const table of Object.keys(candidates)) assert.equal((await db.query('SELECT to_regclass($1) AS name',[`"${table}"`])).rows[0].name,null);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='Task' AND column_name='organizationId'")).rows[0].n,0);
  const result={migration:name,removedTables:Object.keys(candidates),retainedTables:tables.length,allRetainedRowsEqual:true,nonemptyTableGuards:4,inboundForeignKeyGuard:true,unreconciledColumnGuard:true,rollbackVerified:true};
  const folder=resolve(import.meta.dirname,'../../data/outputs/database-audit');mkdirSync(folder,{recursive:true});
  writeFileSync(resolve(folder,'obsolete-retirement-test.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await db.close();}
