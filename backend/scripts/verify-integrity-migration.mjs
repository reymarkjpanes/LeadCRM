import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const migration='20261030000000_strengthen_relational_integrity';
const sql=readFileSync(resolve(import.meta.dirname,'../prisma/migrations',migration,'migration.sql'),'utf8');
const db=await PGlite.create();
try {
  await replayCrmMigrations(db,{before:migration});
  // Reproduce the missing live objects as well as the normal migration replay.
  await db.exec(`
    DROP INDEX "Activity_tenantId_leadId_createdAt_idx";
    DROP INDEX "CampaignContact_campaignId_leadId_key";
    DROP INDEX "EmailDeliveryLog_tenantId_leadId_idx";
    ALTER TABLE "SMSQueue" DROP CONSTRAINT "SMSQueue_leadId_fkey";
  `);
  await db.exec(`
    INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('a','A','a',now()),('b','B','b',now());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('user','a','user@camxian.com','Test','User','Client Admin',now());
    INSERT INTO "RoleDefinition" (id,"tenantId",name,"updatedAt") VALUES ('role','a','Sales',now());
    INSERT INTO "RolePermission" (id,"tenantId","roleId",module) VALUES ('perm','a','role','leads');
    INSERT INTO "UserRole" (id,"tenantId","userId","roleId") VALUES ('assignment','a','user','role');
    INSERT INTO "Session" (id,"tenantId","userId","tokenHash","expiresAt") VALUES ('session','a','user','test-hash',now());
    INSERT INTO "TenantGroup" (id,"tenantId",name,"updatedAt") VALUES ('group','a','Group',now());
    INSERT INTO "TenantGroupMember" (id,"tenantId","userId","groupId") VALUES ('member','a','user','group');
    INSERT INTO "Pipeline" (id,"tenantId",name,"updatedAt") VALUES ('pipe','a','Sales',now()),('pipe-2','a','Other',now());
    INSERT INTO "Stage" (id,"tenantId","pipelineId",name,"order") VALUES ('stage','a','pipe','Lead',0);
    INSERT INTO "Lead" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('lead','a','Lead','Test',now());
    INSERT INTO "Contact" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('contact','a','Contact','Test',now());
    INSERT INTO "Deal" (id,"tenantId","pipelineId","stageId",title,"updatedAt") VALUES ('deal','a','pipe','stage','Deal',now());
    INSERT INTO "LeadDeal" (id,"tenantId","leadId","dealId") VALUES ('ld','a','lead','deal');
    INSERT INTO "ContactDeal" (id,"tenantId","contactId","dealId") VALUES ('cd','a','contact','deal');
    INSERT INTO "Notification" (id,"tenantId","userId",type,title) VALUES ('notice','a','user','test','Test');
    INSERT INTO "MarketingForm" (id,"publicId","tenantId","createdById",name,"updatedAt") VALUES ('form','public','a','user','Form',now());
    INSERT INTO "FormSubmission" (id,"tenantId","formId","leadId","publishedVersion","publishedConfig",values) VALUES ('submission','a','form','lead',1,'{}','{}');
    INSERT INTO "Workflow" (id,"tenantId",name,trigger,actions,"updatedAt") VALUES ('wf','a','Workflow','lead.created','[]',now()),('wf-2','a','Other','lead.created','[]',now());
    INSERT INTO "WorkflowTriggerRecord" (id,"tenantId","workflowId","triggerType","entityType","entityId") VALUES ('trigger','a','wf','lead.created','lead','lead');
    INSERT INTO "WorkflowExecutionRun" (id,"tenantId","workflowId","triggerId","entityType","entityId") VALUES ('run','a','wf','trigger','lead','lead');
    INSERT INTO "WorkflowExecutionStep" (id,"tenantId","executionId","stepIndex","actionType",status) VALUES ('step','a','run',0,'create_task','success');
    INSERT INTO "EmailAccount" (id,"tenantId","userId",email,"accessToken","updatedAt") VALUES ('mail','a','user','user@camxian.com','encrypted-test',now());
    INSERT INTO "MailboxMessage" (id,"tenantId","accountId","providerMessageId","threadId",direction,"from",recipients,labels,subject,body,snippet,"sentAt") VALUES ('message','a','mail','provider','thread','inbound','test@example.test',ARRAY['user@camxian.com'],ARRAY['INBOX'],'Test','Body','Body',now());
  `);
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY 1::text`)).rows])));
  await db.exec('UPDATE "RolePermission" SET "tenantId"=\'b\'');
  await assert.rejects(db.exec(sql),/foreign key/i);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT "tenantId" FROM "RolePermission"')).rows[0].tenantId,'b');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='Session_tokenHash_idx'")).rows[0].n,1);
  await db.exec('UPDATE "RolePermission" SET "tenantId"=\'a\'');
  const before=await snapshot();await db.exec(sql);assert.deepEqual(await snapshot(),before);
  const guarded=['RolePermission','UserRole','Session','TenantGroupMember','Stage','Deal','LeadDeal','ContactDeal','Notification','FormSubmission','WorkflowTriggerRecord','WorkflowExecutionRun','WorkflowExecutionStep','MailboxMessage'];
  for(const table of guarded) await assert.rejects(db.exec(`UPDATE "${table}" SET "tenantId"='b'`),error=>['23503','23514'].includes(error.code),table);
  await assert.rejects(db.exec('UPDATE "Deal" SET "pipelineId"=\'pipe-2\''),/foreign key/i);
  await assert.rejects(db.exec('UPDATE "WorkflowExecutionRun" SET "workflowId"=\'wf-2\''),/foreign key/i);
  for(const name of ['Session_tokenHash_idx','EmailDeliveryLog_gmailMessageId_idx']) assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_indexes WHERE indexname=$1',[name])).rows[0].n,0);
  for(const name of ['Session_tokenHash_key','EmailDeliveryLog_gmailMessageId_key']) assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_indexes WHERE indexname=$1',[name])).rows[0].n,1);
  for(const name of ['Activity_tenantId_leadId_createdAt_idx','CampaignContact_campaignId_leadId_key','EmailDeliveryLog_tenantId_leadId_idx','Contact_tenantId_isArchived_idx','Contact_tenantId_lifecycleStage_idx']) assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_indexes WHERE indexname=$1',[name])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname='SMSQueue_leadId_fkey'")).rows[0].n,1);
  const result={migration,tablesPreserved:tables.length,allRowsPreserved:true,inconsistentDataAborts:true,rollbackVerified:true,tenantGuardsTested:guarded.length,pipelineMismatchRejected:true,workflowMismatchRejected:true,redundantIndexesRemoved:2,liveDriftRepaired:true};
  mkdirSync(resolve(import.meta.dirname,'../../data/outputs/database-audit'),{recursive:true});
  writeFileSync(resolve(import.meta.dirname,'../../data/outputs/database-audit/integrity-migration-test.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch(error) {console.error(JSON.stringify({code:error.code||error.name,message:String(error.message).slice(0,300),actualCode:error.actual?.code,actualMessage:error.actual?.message}));process.exitCode=1;}
finally {await db.close();}
