import { expect, it } from 'vitest';
import { campaignApprovedVariableKeys, campaignConditionField, campaignFields, campaignVariableChoices, CampaignDraftSchema, getWorkflowMessageVariables, MarketingTemplateSchema, renderEmailVariables, workflowMessageVariableKeys } from '@leadcrm/shared';
import { CreateClientContactSchema, UpdateClientContactSchema } from '../contacts-v2.dto';
import { presentContactAccount } from '../contact-account-access';

const contact = { requestId:'00000000-0000-4000-8000-000000000001',firstName:'Nora',lastName:'Lim',email:'nora@example.test',companyName:'Ñ Company' };
it('accepts companyName on Contact create/edit and rejects company even alongside companyName', () => {
  expect(CreateClientContactSchema.parse(contact).companyName).toBe('Ñ Company');
  expect(UpdateClientContactSchema.parse({companyName:''})).toEqual({companyName:''});
  for (const legacy of [{company:'Old'}, {company:'Old',companyName:'New'}]) {
    expect(CreateClientContactSchema.safeParse({...contact,...legacy}).success).toBe(false);
    expect(UpdateClientContactSchema.safeParse(legacy).success).toBe(false);
  }
});
it.each(['LEADS','CONTACTS'] as const)('offers one companyName variable for %s and no company alias', source => {
  const fields = campaignFields(source), keys = campaignApprovedVariableKeys(fields,source);
  expect(keys.has('companyName')).toBe(true); expect(keys.has('company')).toBe(false);
  expect(keys.has('company_name')).toBe(true);
  expect(campaignConditionField('company',fields)).toBeUndefined();
  expect(campaignVariableChoices(fields,source,{forInsertion:true}).filter(choice=>choice.technicalKey==='companyName')).toHaveLength(1);
  const entity = source==='LEADS'?'lead':'contact';
  expect(workflowMessageVariableKeys(entity).has('company')).toBe(false);
  expect(getWorkflowMessageVariables(entity).some(variable=>variable.token==='companyName')).toBe(true);
});
it('deduplicates Lead and Contact Company in the shared Insert Variable picker', () => {
  const choices = campaignVariableChoices([...campaignFields('LEADS'),...campaignFields('CONTACTS')],undefined,{forInsertion:true});
  expect(choices.filter(choice=>choice.technicalKey==='companyName')).toHaveLength(1);
});
it('rejects old company tokens in saved Email/SMS templates and Campaign content', () => {
  for (const type of ['Email','SMS'] as const) {
    expect(MarketingTemplateSchema.safeParse({name:'Message',type,subject:'Hello',content:'{{ company }}'}).success).toBe(false);
    expect(MarketingTemplateSchema.safeParse({name:'Message',type,subject:'Hello',content:'{{companyName}} {{company_name}} {{customFieldValues.company}}'}).success).toBe(true);
  }
  expect(CampaignDraftSchema.safeParse({name:'Campaign',type:'EMAIL',subject:'{{company}}',body:'Hello'}).success).toBe(false);
  expect(CampaignDraftSchema.safeParse({name:'Campaign',type:'SMS',body:'{{company}}'}).success).toBe(false);
  expect(renderEmailVariables('{{companyName}}',{companyName:'Ñ & Company'},true)).toBe('Ñ &amp; Company');
});
it('preserves Account privacy for the renamed scalar and never exposes provenance', () => {
  const row = {companyName:'Account secret',companyFromAccount:true,account:{id:'account',name:'Account secret'}};
  expect(presentContactAccount(row,false)).toEqual({companyName:null,account:null});
  expect(presentContactAccount(row,true)).toEqual({companyName:'Account secret',account:row.account});
  expect(presentContactAccount({...row,companyFromAccount:false},false).companyName).toBe('Account secret');
});
