import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayCrmMigrations } from '../replay-crm-migrations';

const name = '20261217000000_contact_company_name';
const sql = readFileSync(resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'), 'utf8');
let db: PGlite;
const rows = async (table: string) => (await db.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
const columns = async () => (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name='Contact' AND table_schema='public' ORDER BY column_name`)).rows.map(row => row.column_name);
async function rejects(reason: RegExp) {
  const before = await rows('Contact'), templates = await rows('Template');
  await expect(db.exec(sql)).rejects.toThrow(reason);
  await db.exec('ROLLBACK');
  expect(await columns()).toContain('company');
  expect(await rows('Contact')).toEqual(before);
  expect(await rows('Template')).toEqual(templates);
}

beforeAll(async () => {
  db = await PGlite.create();
  await replayCrmMigrations(db, name);
  await db.exec(`
    INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('rename-a','Rename A','rename-a',now()), ('rename-b','Rename B','rename-b',now());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('agent','rename-a','rename@example.test','One','Agent','Sales',now());
    INSERT INTO "Account" (id,"tenantId",name,"updatedAt") VALUES ('account','rename-a','Account Company',now());
    INSERT INTO "Contact" (id,"tenantId","firstName","lastName",company,"accountId","assignedUserId","companyFromAccount","isArchived","updatedAt") VALUES
      ('linked','rename-a','Linked','Contact','Stored different company','account','agent',true,false,now()),
      ('unicode','rename-a','Unicode','Contact','日本語 Ñ & <Company>',null,null,false,true,now()),
      ('empty','rename-b','Empty','Contact','',null,null,false,false,now()),
      ('null','rename-b','Null','Contact',null,null,null,false,false,now());
    INSERT INTO "ProductInterest" (id,"tenantId",name,"dealValue","updatedAt") VALUES ('product','rename-a','CCTV',1000,now());
    INSERT INTO "ContactProductInterest" ("tenantId","contactId","productInterestId",position,interested,"activeProduct") VALUES ('rename-a','linked','product',0,true,true);
    INSERT INTO "Pipeline" (id,"tenantId",name,"updatedAt") VALUES ('pipeline','rename-a','Sales',now());
    INSERT INTO "Stage" (id,"tenantId","pipelineId",name,"order","requiredFields") VALUES ('stage','rename-a','pipeline','Proposal',0,'{}');
    INSERT INTO "Deal" (id,"tenantId",title,value,"pipelineId","stageId","updatedAt") VALUES ('deal','rename-a','Preserved Deal',1000,'pipeline','stage',now());
    INSERT INTO "ContactDeal" (id,"tenantId","contactId","dealId") VALUES ('link','rename-a','linked','deal');
    INSERT INTO "Template" (id,"tenantId",name,type,subject,content,"isArchived","updatedAt") VALUES
      ('email','rename-a','Edited Email','Email','At {{ company }}','{{company}} / {{  company  }} / {{companyName}} / {{company_name}} / {{customFieldValues.company}} / company',false,now()),
      ('sms','rename-b','Archived SMS','SMS',null,'{{company}} {{first_name}}',true,now());
    INSERT INTO "Campaign" (id,"tenantId",name,type,status,subject,body,"scheduleConfig","emailTemplateId","updatedAt") VALUES
      ('campaign','rename-a','Scheduled','EMAIL','SCHEDULED','{{company}}','For {{ company }}',
       '{"source":"CONTACTS","timezone":"Asia/Manila","conditions":[{"field":"company","operator":"equals","value":"company"}]}','email',now());
    INSERT INTO "TargetAudience" (id,"tenantId",name,source,"updatedAt") VALUES ('audience','rename-a','Saved Audience','CONTACTS',now());
    INSERT INTO "TargetAudienceCondition" (id,"targetAudienceId",field,operator,value) VALUES ('condition','audience','company','equals','"company"');
    INSERT INTO "Workflow" (id,"tenantId",name,trigger,conditions,actions,"updatedAt") VALUES
      ('workflow','rename-a','Contact Workflow','contact.updated',
       '{"operator":"AND","conditions":[{"field":"contact.company","operator":"equals","value":"company"},{"field":"event.changedFields","operator":"contains","value":["company","email"]}]}',
       '[{"type":"update_field","config":{"field":"company","value":"company"}},{"type":"send_email","config":{"subject":"{{company}}","body":"{{ company }} {{customFieldValues.company}}"}}]',now()),
      ('lead-workflow','rename-b','Lead Workflow','lead.updated','{"field":"lead.companyName","value":"company"}',
       '[{"type":"send_sms","config":{"message":"{{company}} {{company_name}}"}}]',now());
    INSERT INTO "WorkflowTriggerRecord" (id,"tenantId","workflowId","triggerType","entityType","entityId") VALUES ('trigger','rename-a','workflow','contact.updated','contact','linked');
    INSERT INTO "WorkflowExecutionRun" (id,"tenantId","workflowId","triggerId","entityType","entityId",status,"definitionSnapshot","dispatchContext") VALUES
      ('history','rename-a','workflow','trigger','contact','linked','completed','{"field":"contact.company","body":"{{company}}"}','{"version":1,"context":{"contact.company":"Old value"}}');
    INSERT INTO "TenantPreference" (id,"tenantId",module,key,value,"updatedAt") VALUES
      ('layout','rename-a','contacts','field-layout','{"version":1,"revision":4,"module":"contacts","groups":[],"fields":{"company":{"label":"Custom Company","groupId":"custom","order":7,"visibleInForm":false,"visibleInDetails":true},"email":{"label":"Email"}}}',now());
  `);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe.sequential('Contact company rename', () => {
  it('refuses conflicting layouts and rolls back without touching data', async () => {
    await db.exec(`UPDATE "TenantPreference" SET value=jsonb_set(value,'{fields,companyName}','{"label":"Conflicting"}') WHERE id='layout'`);
    await rejects(/CONTACT_COMPANY_LAYOUT_CONFLICT/);
    await db.exec(`UPDATE "TenantPreference" SET value=value #- '{fields,companyName}' WHERE id='layout'`);
  });
  it('requires Campaign submissions to finish before the breaking cutover', async () => {
    await db.exec(`UPDATE "Campaign" SET status='SENDING'`);
    await rejects(/CONTACT_COMPANY_RENAME_REQUIRES_DRAIN/);
    await db.exec(`UPDATE "Campaign" SET status='SCHEDULED'`);
  });
  it('requires queued Workflows to drain without discarding them', async () => {
    await db.exec(`UPDATE "WorkflowExecutionRun" SET status='queued'`);
    await rejects(/CONTACT_COMPANY_RENAME_REQUIRES_DRAIN/);
    await db.exec(`UPDATE "WorkflowExecutionRun" SET status='completed'`);
  });
  it('rolls back the column rename if a later saved-reference write fails', async () => {
    await db.exec(`ALTER TABLE "Template" ADD CONSTRAINT qa_fail_rename CHECK (content NOT LIKE '%{{companyName}}%') NOT VALID`);
    await rejects(/qa_fail_rename/);
    await db.exec(`ALTER TABLE "Template" DROP CONSTRAINT qa_fail_rename`);
  });
  it('renames in place across tenants and preserves every Contact value and relationship', async () => {
    const before = await rows('Contact');
    const unchanged = ['Account','User','ContactDeal','ContactProductInterest','Deal','WorkflowExecutionRun','WorkflowTriggerRecord'];
    const snapshots = await Promise.all(unchanged.map(rows));
    await db.exec(sql);
    expect(await columns()).toContain('companyName');
    expect(await columns()).not.toContain('company');
    expect(await rows('Contact')).toEqual(before.map(({ company, ...rest }) => ({ ...rest, companyName: company })));
    expect(await Promise.all(unchanged.map(rows))).toEqual(snapshots);
  });
  it('migrates exact saved tokens without changing custom keys, other aliases, or plain text', async () => {
    expect((await rows('Template'))[0]).toMatchObject({ id:'email', subject:'At {{companyName}}', content:'{{companyName}} / {{companyName}} / {{companyName}} / {{company_name}} / {{customFieldValues.company}} / company' });
    expect((await rows('Template'))[1]).toMatchObject({ id:'sms', content:'{{companyName}} {{first_name}}', isArchived:true });
    const campaign = (await rows('Campaign'))[0] as any;
    expect(campaign).toMatchObject({ subject:'{{companyName}}', body:'For {{companyName}}', status:'SCHEDULED', emailTemplateId:'email', scheduleConfig:{ conditions:[{field:'companyName',value:'company'}] } });
    expect((await rows('TargetAudienceCondition'))[0]).toMatchObject({field:'companyName',value:'"company"'});
  });
  it('migrates Workflow selectors/actions while retaining literal values and execution history', async () => {
    const workflows = await rows('Workflow') as any[];
    const contact = workflows.find(row=>row.id==='workflow');
    expect(contact.conditions.conditions).toEqual([{field:'contact.companyName',operator:'equals',value:'company'},{field:'event.changedFields',operator:'contains',value:['companyName','email']}]);
    expect(contact.actions).toEqual([{type:'update_field',config:{field:'companyName',value:'company'}},{type:'send_email',config:{subject:'{{companyName}}',body:'{{companyName}} {{customFieldValues.company}}'}}]);
    expect(workflows.find(row=>row.id==='lead-workflow').actions[0].config.message).toBe('{{companyName}} {{company_name}}');
  });
  it('retains Contact layout customization under the new key', async () => {
    const value = (await rows('TenantPreference'))[0].value as any;
    expect(value).toMatchObject({revision:5,fields:{companyName:{label:'Custom Company',groupId:'custom',order:7,visibleInForm:false,visibleInDetails:true},email:{label:'Email'}}});
    expect(value.fields).not.toHaveProperty('company');
  });
});
