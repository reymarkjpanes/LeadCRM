import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import prisma from '../config/database.config';
import app from '../app';
import { hashPassword } from '../shared/helpers/crypto';
import { tenantContext } from '../core/tenant/tenant-context';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost','127.0.0.1'].includes(url.hostname) && /^\/leadcrm_smoke_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('single workspace CRM acceptance', () => {
  let server: Server, base: string, cookie: string, tenantId: string, foreignId: string;
  const ids: Record<string,string> = {};
  const email = `single-${randomUUID()}@camxian.com`;
  const password = 'SingleWorkspace2026!';
  const call = async (path: string, method = 'GET', body?: unknown, session = cookie) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type':'application/json', ...(session ? { Cookie: session } : {}) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
    return { status:response.status, headers:response.headers, body:await response.json().catch(() => null) };
  };
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data:{ name:'Camxian Technologies',slug:randomUUID(),status:'ACTIVE',onboardingStep:3,onboardingCompletedAt:new Date() } });
    tenantId = tenant.id;
    const user = await prisma.user.create({ data:{ tenantId,email,firstName:'CRM',lastName:'Admin',role:'Client Admin',mustChangePassword:false,onboardingCompletedAt:new Date(),emailVerified:new Date(),passwordHash:await hashPassword(password) } });
    await tenantContext.run({ tenantId }, async () => {
      ids.leads = (await prisma.lead.create({ data:{ tenantId,firstName:'Production',lastName:'Lead',email:'lead@example.com' } })).id;
      ids.contacts = (await prisma.contact.create({ data:{ tenantId,firstName:'Production',lastName:'Contact',email:'contact@example.com' } })).id;
      ids.accounts = (await prisma.account.create({ data:{ tenantId,name:'Production Account' } })).id;
      const pipeline = await prisma.pipeline.create({ data:{tenantId,name:'Sales',isDefault:true} });
      const stage = await prisma.stage.create({ data:{tenantId,pipelineId:pipeline.id,name:'New',order:0} });
      ids.deals = (await prisma.deal.create({ data:{tenantId,pipelineId:pipeline.id,stageId:stage.id,title:'Production Deal'} })).id;
      ids.tasks = (await prisma.task.create({ data:{tenantId,assignedUserId:user.id,title:'Production Task',dueDate:new Date()} })).id;
      ids.campaigns = (await prisma.campaign.create({ data:{tenantId,name:'Production Campaign',type:'EMAIL'} })).id;
      ids.workflows = (await prisma.workflow.create({ data:{tenantId,name:'Production Workflow',trigger:'lead.created',actions:[]} })).id;
      ids.forms = (await prisma.marketingForm.create({ data:{tenantId,createdById:user.id,name:'Production Form'} })).id;
      ids.products = (await prisma.productInterest.create({ data:{tenantId,name:'Production Product',dealValue:100} })).id;
    });
    const other = await prisma.tenant.create({ data:{name:'Other',slug:randomUUID()} });
    foreignId = (await prisma.lead.create({data:{tenantId:other.id,firstName:'Foreign',lastName:'Lead'}})).id;
    server = app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve => server.once('listening',resolve));
    base = `http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1`;
    const login = await call('/auth/login','POST',{email,password},'');
    expect(login.status,JSON.stringify(login.body)).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^leadcrm_token=/);
    expect(login.body.data.user).not.toHaveProperty('activeEnvironment');
  },30000);
  afterAll(async () => { if(server) await new Promise<void>(resolve=>server.close(()=>resolve())); await prisma.$disconnect(); });
  it.each([
    ['leads','/crm/leads'],['contacts','/crm/contacts'],['accounts','/crm/accounts'],['deals','/crm/deals'],
    ['tasks','/operations/tasks'],['campaigns','/marketing/campaigns'],['workflows','/automation/workflows'],
    ['forms','/marketing/forms'],['products','/administration/product-interests'],
  ])('loads %s directly after login',async (kind,path)=>{
    const result=await call(path);
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(JSON.stringify(result.body)).toContain(ids[kind]);
    expect(JSON.stringify(result.body)).not.toMatch(/"(?:activeEnvironment|environment|environmentId)":/);
  });
  it('loads profile, organization settings and permissions without a preference',async()=>{
    for(const path of ['/auth/me','/administration/organization-settings','/administration/roles']) {
      const result=await call(path); expect(result.status,JSON.stringify(result.body)).toBe(200);
      expect(JSON.stringify(result.body)).not.toMatch(/"(?:activeEnvironment|environment|environmentId)":/);
    }
  });
  it('removes the switching endpoint and preserves tenant and session isolation',async()=>{
    expect((await call('/auth/environment','PATCH',{environment:'SANDBOX'})).status).toBe(404);
    expect((await call(`/crm/leads/${foreignId}`)).status).toBe(404);
    expect((await call('/crm/leads','GET',undefined,'')).status).toBe(401);
    expect(JSON.stringify((await call('/crm/leads')).body)).not.toContain(foreignId);
  });
});
