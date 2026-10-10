import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
vi.mock('../../../shared/services/email.service', () => ({ sendMail: vi.fn().mockResolvedValue({ submitted: true }) }));
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { createAssignedLead, createProductDeals, salesTransaction, productConfiguration, salesPipeline } from './lead-automation.service';
import { moveDealStage } from '../deals/deals.repository';
import { updateContact } from '../contacts/contacts.repository';
import { defaultContactForm, ProductInterestConfigSchema, FORM_PRODUCT_INTERESTS } from '@leadcrm/shared';
import { submitPublicForm } from '../../marketing/forms/public-forms.service';
import { issueAuthSession } from '../../../core/auth/auth-session';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && (url.pathname === '/leadcrm_forms_test_2' || /^\/leadcrm_sales_test_\d+$/.test(url.pathname));
describe.skipIf(!disposable)('Sales automation database and HTTP', () => {
  let tenantId: string, otherTenant: string, adminId: string, agentIds: string[], inactiveId: string, deniedId: string, token: string, deniedToken: string, base: string, server: Server;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const productIds: Record<string, string> = {};
  const create = (products = ['Smart Lock'], extra: Record<string, unknown> = {}) => scope(() => salesTransaction(tx => createAssignedLead(tx, {
    tenantId, firstName: 'Sales', lastName: 'Customer', email: `${randomUUID()}@example.test`, productInterest: products, ...extra,
  }, adminId)));
  async function request(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function prepareToClose(deal: { id: string; pipelineId: string }, expectedStatus = 200) {
    const qualified = await prisma.stage.findFirstOrThrow({ where: { tenantId, pipelineId: deal.pipelineId, name: 'Qualified' } });
    await scope(() => moveDealStage(deal.id, tenantId, qualified.id, adminId));
    const saved = await request(`/crm/deals/${deal.id}/closing-requirements`, 'PATCH', {
      values: { 'confirmation-type': 'Approved Quotation', 'confirmation-date': new Date().toISOString().slice(0, 10) },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(expectedStatus);
    return saved;
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Sales automation test', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } })).id;
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other sales tenant', slug: randomUUID() } })).id;
    const admin = await prisma.user.create({ data: { tenantId, firstName: 'Admin', lastName: 'Test', email: 'admin@camxian.com', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    adminId = admin.id; token = (await issueAuthSession(admin)).token;
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Eligible custom sales role' } });
    await prisma.rolePermission.createMany({ data: ['leads', 'contacts', 'deals'].map(module => ({ tenantId, roleId: role.id, module, canView: true, canEdit: true, canCreate: true })) });
    agentIds = [];
    for (const index of [0, 1, 2]) {
      const agent = await prisma.user.create({ data: { tenantId, firstName: `Agent ${index}`, lastName: 'Sales', email: `agent${index}@camxian.com`, role: role.name, status: index === 2 ? 'INACTIVE' : 'ACTIVE', mustChangePassword: false } });
      await prisma.userRole.create({ data: { tenantId, roleId: role.id, userId: agent.id } });
      if (index === 2) inactiveId = agent.id; else agentIds.push(agent.id);
    }
    agentIds.sort();
    const denied = await prisma.user.create({ data: { tenantId, firstName: 'No', lastName: 'Permissions', email: 'denied@camxian.com', role: 'Viewer', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    deniedId = denied.id; deniedToken = (await issueAuthSession(denied)).token;
    await prisma.user.create({ data: { tenantId: otherTenant, firstName: 'Foreign', lastName: 'Agent', email: 'foreign@camxian.com', role: 'Client Admin' } });
    for (const name of FORM_PRODUCT_INTERESTS) {
      const product = await prisma.productInterest.create({ data: { tenantId, name, dealValue: name === 'Smart Lock' ? 1250.75 : 550 } });
      productIds[name] = product.id;
    }
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('rotates eligible tenant agents, persists one owner, values and one Deal per product', async () => {
    const leads = [];
    for (let i = 0; i < 4; i++) leads.push(await create(['Smart Lock', 'Biometrics', 'Smart Lock']));
    expect(leads.map(lead => lead.assignedUserId)).toEqual([agentIds[0], agentIds[1], agentIds[0], agentIds[1]]);
    for (const lead of leads) {
      const deals = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } }, include: { stage: true, pipeline: true } });
      expect(deals).toHaveLength(2);
      expect(deals.every(d => d.assignedUserId === lead.assignedUserId && d.ownerId === lead.assignedUserId && d.stage.name === 'Lead' && d.pipeline.name === 'Sales Pipeline')).toBe(true);
      expect(deals.find(d => d.productInterests[0] === 'Smart Lock')?.value).toBe(1250.75);
      expect(await prisma.activity.count({ where: { tenantId, leadId: lead.id, type: 'assignment' } })).toBe(1);
    }
    expect(await prisma.pipeline.count({ where: { tenantId, name: 'Sales Pipeline' } })).toBe(1);
  });
  it('deduplicates creation retries and repeated/concurrent product processing', async () => {
    const creationKey = randomUUID();
    const lead = await create(['Smart Lock'], { creationKey });
    const retry = await create(['Smart Lock'], { creationKey });
    expect(retry.id).toBe(lead.id);
    await Promise.all([0, 1, 2].map(() => scope(() => salesTransaction(tx => createProductDeals(tx, tenantId, lead.id, adminId)))));
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } })).toBe(1);
    expect(await prisma.activity.count({ where: { tenantId, leadId: lead.id, type: 'assignment' } })).toBe(1);
  });
  it('rejects invalid/inactive/foreign owners and unknown products with complete rollback', async () => {
    for (const assignedUserId of [inactiveId, deniedId, randomUUID()]) await expect(create([], { assignedUserId })).rejects.toThrow('active sales agent');
    const before = await prisma.lead.count({ where: { tenantId } });
    await expect(create(['Smart Lock', 'Unknown Product'])).rejects.toThrow('Unknown Product');
    expect(await prisma.lead.count({ where: { tenantId } })).toBe(before);
  });
  it('creates unassigned Deals when no agent is eligible and assigns them without duplicating', async () => {
    await prisma.rolePermission.updateMany({ where: { tenantId, module: 'leads' }, data: { canEdit: false } });
    const lead = await create(); expect(lead.assignedUserId).toBeNull();
    expect(await prisma.deal.count({ where: { leadDeals: { some: { leadId: lead.id } } } })).toBe(1);
    await prisma.rolePermission.updateMany({ where: { tenantId, module: 'leads' }, data: { canEdit: true } });
    await scope(() => updateContact(lead.id, tenantId, { assignedUserId: agentIds[0] }, adminId));
    expect((await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: lead.id } } } })).assignedUserId).toBe(agentIds[0]);
  });
  it('preserves both owners and sibling Deals while Won resolves one Contact and Account exactly once', async () => {
    const lead = await create(['Smart Lock', 'Biometrics'], { companyName: 'Example Company' });
    const deals = await prisma.deal.findMany({ where: { leadDeals: { some: { leadId: lead.id } } } });
    const won = await prisma.stage.findFirstOrThrow({ where: { tenantId, pipelineId: deals[0].pipelineId, isWon: true } });
    const initialHistoryCount = await prisma.dealStageHistory.count({ where: { tenantId, dealId: deals[0].id } });
    await prepareToClose(deals[0]);
    const first = await scope(() => moveDealStage(deals[0].id, tenantId, won.id, adminId, undefined, undefined, undefined, { type: 'Approved Quotation', date: new Date().toISOString().slice(0, 10) }));
    // Saving the final closing requirements already completed the Won transition.
    expect(first?.stageHistory).toBeNull();
    const repeat = await scope(() => moveDealStage(deals[0].id, tenantId, won.id, adminId, undefined, undefined, undefined, { type: 'Approved Quotation', date: new Date().toISOString().slice(0, 10) }));
    expect(repeat?.stageHistory).toBeNull();
    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updatedLead.assignedUserId).toBe(lead.assignedUserId); expect(updatedLead.contactId).toBeTruthy(); expect(updatedLead.accountId).toBeTruthy();
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[1].id } })).stageId).toBe(deals[1].stageId);
    await prepareToClose(deals[1]);
    await scope(() => moveDealStage(deals[1].id, tenantId, won.id, adminId, undefined, undefined, undefined, { type: 'Approved Quotation', date: new Date().toISOString().slice(0, 10) }));
    expect(await prisma.contact.count({ where: { tenantId, email: lead.email } })).toBe(1);
    expect(await prisma.account.count({ where: { tenantId, name: 'Example Company' } })).toBe(1);
    expect(await prisma.contactDeal.count({ where: { tenantId, contactId: updatedLead.contactId! } })).toBe(2);
    expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: deals[0].id } })).toBe(initialHistoryCount + 2);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[0].id } })).assignedUserId).toBe(lead.assignedUserId);
  });
  it('reuses normalized contact identity, preserves historical fields and rolls back ambiguous conversion', async () => {
    const email = `${randomUUID()}@example.test`;
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Historical', lastName: 'Name', email: email.toUpperCase(), phone: '09123456789', notes: 'Keep history', activeProducts: [], productInterests: [] } });
    const lead = await create(['Smart Lock'], { email, phone: '+639123456789' });
    const deal = await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: lead.id } } } });
    const won = await prisma.stage.findFirstOrThrow({ where: { tenantId, pipelineId: deal.pipelineId, isWon: true } });
    await prepareToClose(deal);
    await scope(() => moveDealStage(deal.id, tenantId, won.id, adminId, undefined, undefined, undefined, { type: 'Approved Quotation', date: new Date().toISOString().slice(0, 10) }));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).contactId).toBe(contact.id);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).notes).toBe('Keep history');
    const second = await create(['Smart Lock'], { email });
    await prisma.contact.create({ data: { tenantId, firstName: 'Conflicting', lastName: 'Identity', email, activeProducts: [], productInterests: [] } });
    const secondDeal = await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: second.id } } } });
    const secondInitialHistoryCount = await prisma.dealStageHistory.count({ where: { dealId: secondDeal.id } });
    const rejected = await prepareToClose(secondDeal, 409);
    expect(rejected.body.error).toContain('conflicting Contact/Account matches');
    const qualifiedId = (await prisma.deal.findUniqueOrThrow({ where: { id: secondDeal.id } })).stageId;
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: qualifiedId } })).name).toBe('Qualified');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: second.id } })).contactId).toBeNull();
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: secondDeal.id } })).stageId).toBe(qualifiedId);
    expect(await prisma.dealStageHistory.count({ where: { dealId: secondDeal.id } })).toBe(secondInitialHistoryCount + 1);
  });
  it('preserves an explicitly linked Contact and matches company whitespace without duplicating history', async () => {
    const company = `  Legacy   Company ${randomUUID()}  `;
    const account = await prisma.account.create({ data: { tenantId, name: company, tags: [], productInterests: [], activeProducts: [] } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Original', lastName: 'Person', phone: '+63 (927) 555-12-34', company, activeProducts: [], productInterests: [] } });
    const lead = await create(['Smart Lock'], { contactId: contact.id, email: null, phone: '09275551234', companyName: company.trim().replace(/\s+/g, ' ') });
    const deal = await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: lead.id } } } });
    const won = await prisma.stage.findFirstOrThrow({ where: { pipelineId: deal.pipelineId, isWon: true } });
    await prepareToClose(deal);
    await scope(() => moveDealStage(deal.id, tenantId, won.id, adminId, undefined, undefined, undefined, { type: 'Approved Quotation', date: new Date().toISOString().slice(0, 10) }));
    const result = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(result.contactId).toBe(contact.id); expect(result.accountId).toBe(account.id);
  });
  it('requires a lost reason, retains the owner, and rejects a foreign pipeline stage', async () => {
    const lead = await create();
    const deal = await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: lead.id } } } });
    const lost = await prisma.stage.findFirstOrThrow({ where: { pipelineId: deal.pipelineId, isLost: true } });
    expect((await request(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: lost.id })).status).toBe(400);
    expect((await request(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: lost.id, lostReason: 'Project postponed' })).status).toBe(200);
    const result = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(result.assignedUserId).toBe(lead.assignedUserId); expect(result.lostReason).toBe('Project postponed');
    const other = await prisma.pipeline.create({ data: { tenantId, name: 'Historical pipeline', type: 'Sales' } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: other.id, name: 'Lead', order: 0, requiredFields: [] } });
    expect((await request(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stage.id })).status).toBe(400);
  });
  it('public multi-product form creates owner and Deals atomically and retries once', async () => {
    const config = defaultContactForm();
    const form = await prisma.marketingForm.create({ data: { tenantId, createdById: adminId, name: 'Sales', status: 'published', fields: config.fields, design: config.design, settings: config.settings, publishedConfig: config, publishedVersion: 1 } });
    const input = { requestId: randomUUID(), version: 1, values: { firstName: 'Form', lastName: 'Customer', email: `${randomUUID()}@example.test`, productInterest: [productIds['Smart Lock'], productIds.Biometrics] } };
    await submitPublicForm(form.publicId, input); await submitPublicForm(form.publicId, input);
    const submissions = await prisma.formSubmission.findMany({ where: { formId: form.id } });
    expect(submissions).toHaveLength(1);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: submissions[0].leadId! } });
    expect(agentIds).toContain(lead.assignedUserId);
    expect(await prisma.deal.count({ where: { leadDeals: { some: { leadId: lead.id } }, assignedUserId: lead.assignedUserId } })).toBe(2);
  });
  it('settings API persists valid prices and rejects invalid input and unauthorized changes', async () => {
    const path = '/administration/product-interests/' + productIds['Smart Lock'];
    expect((await request(path, 'PATCH', { dealValue: 45.25 }, deniedToken)).status).toBe(403);
    expect((await request(path, 'PATCH', { dealValue: -1 })).status).toBe(400);
    expect((await request(path, 'PATCH', { dealValue: 45.25 })).status).toBe(200);
    expect((await request('/administration/product-interests')).body.data.find((p: { id: string }) => p.id === productIds['Smart Lock']).dealValue).toBe(45.25);
    for (const dealValue of [NaN, Infinity, -1, 1e15, '1', '1e2']) expect(ProductInterestConfigSchema.safeParse([{ name: 'A', dealValue }]).success).toBe(false);
    const lead = await create(); expect((await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: lead.id } } } })).value).toBe(45.25);
  });
  it('commits product edits and snapshots the database price for each manual Deal', async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: 'Manual price test', dealValue: 5000 } });
    const { pipeline, initial } = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    const body = { pipelineId: pipeline.id, stageId: initial.id, title: 'Manual snapshot', productInterestId: product.id, value: 1, currency: 'USD' };
    const first = await request('/crm/deals', 'POST', body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data).toMatchObject({ value: 5000, currency: 'PHP', productInterestId: product.id, productInterests: [product.name] });
    const saved = await request('/administration/product-interests/' + product.id, 'PATCH', { name: '  Updated manual product  ', dealValue: 7000.25 });
    expect(saved.status).toBe(200);
    expect(saved.body.data.find((p: { id: string }) => p.id === product.id)).toMatchObject({ name: 'Updated manual product', dealValue: 7000.25 });
    // Independent read of the actual decimal column after the HTTP request committed.
    const persisted = await prisma.productInterest.findUniqueOrThrow({ where: { id: product.id } });
    expect(Number(persisted.dealValue)).toBe(7000.25);
    expect(persisted.name).toBe('Updated manual product');
    const fresh = await request('/administration/product-interests');
    expect(fresh.body.data.find((p: { id: string }) => p.id === product.id).dealValue).toBe(7000.25);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: first.body.data.id } })).value).toBe(5000);
    const next = await request('/crm/deals', 'POST', body);
    expect(next.status).toBe(201);
    expect(next.body.data).toMatchObject({ value: 7000.25, productInterests: ['Updated manual product'] });
    expect((await request('/crm/deals/' + next.body.data.id, 'PUT', { value: 1 })).status).toBe(400);
    const foreign = await prisma.productInterest.create({ data: { tenantId: otherTenant, name: 'Foreign', dealValue: 9 } });
    for (const productInterestId of [undefined, 'invalid', randomUUID(), foreign.id]) {
      expect((await request('/crm/deals', 'POST', { ...body, productInterestId })).status).toBe(400);
    }
    expect((await request('/crm/deals', 'POST', { ...body, productInterests: [product.name, 'Other'] })).status).toBe(400);
    expect((await request('/administration/product-interests/' + foreign.id, 'PATCH', { dealValue: 1 })).status).toBe(404);
    await prisma.productInterest.update({ where: { id: product.id }, data: { active: false } });
    expect((await request('/crm/deals', 'POST', body)).status).toBe(400);
  });
  it('creates Accounts without retired fields and excludes unsupported archive types at the API boundary', async () => {
    const created = await request('/crm/accounts', 'POST', { name: 'Clean account', taxId: 'invalid', customerType: 'invalid', customerSince: 'invalid' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    for (const field of ['taxId', 'customerType', 'customerSince']) {
      expect(created.body.data).not.toHaveProperty(field);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: created.body.data.id } })).not.toHaveProperty(field);
    }
    await prisma.pipeline.create({ data: { tenantId, name: 'Hidden archived pipeline', type: 'Sales', isArchived: true } });
    const all = await request('/administration/archived-data');
    expect(all.status).toBe(200);
    expect(all.body.data.every((r: { type: string }) => ['Lead', 'Contact', 'Account', 'Deal', 'User', 'Task', 'Campaign', 'Workflow', 'Role'].includes(r.type))).toBe(true);
    for (const type of ['Pipeline', 'Template']) expect((await request('/administration/archived-data?type=' + type)).status).toBe(400);
    expect((await request('/administration/archived-data?type=Role')).status).toBe(200);
    expect(await prisma.pipeline.count({ where: { tenantId, name: 'Hidden archived pipeline', isArchived: true } })).toBe(1);
  });
  it('manual Lead HTTP retries preserve a single Lead and automatic Deal', async () => {
    const body = { requestId: randomUUID(), email: 'manual@example.test', firstName: 'Manual', lastName: 'Lead', productInterest: [productIds['Smart Lock']] };
    const first = await request('/crm/leads', 'POST', body); expect(first.status, JSON.stringify(first.body)).toBe(201);
    const retry = await request('/crm/leads', 'POST', body); expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await prisma.deal.count({ where: { leadDeals: { some: { leadId: first.body.data.id } } } })).toBe(1);
  });
  it('creates, renames and deletes catalog records without changing historical Deals', async () => {
    const endpoint = '/administration/product-interests';
    const response = await request(endpoint, 'POST', { name: '  New product  ', dealValue: 25000 });
    expect(response.status).toBe(200);
    const product = response.body.data.find((p: { name: string }) => p.name === 'New product');
    expect(product).toMatchObject({ active: true, dealValue: 25000 });
    expect(product.createdAt).toBeTruthy(); expect(product.updatedAt).toBeTruthy();
    expect((await request(endpoint, 'POST', { name: 'new PRODUCT', dealValue: 5 })).status).toBe(409);
    for (const body of [{ name: ' ', dealValue: 1 }, { name: 'Bad\u0000Name', dealValue: 1 }, { name: 'Bad', dealValue: '500' }, { name: 'Bad', dealValue: 1.001 }]) {
      expect((await request(endpoint, 'POST', body)).status).toBe(400);
    }
    expect((await request(endpoint + '/invalid', 'PATCH', { name: 'A' })).status).toBe(400);
    expect((await request(endpoint + '/' + randomUUID(), 'PATCH', { name: 'A' })).status).toBe(404);
    expect((await request('/crm/leads', 'POST', { email: 'fixture@example.test', firstName: 'Snapshot', lastName: 'Test', productInterest: [product.id], value: 1, dealValue: 2 })).status).toBe(400);
    const lead = (await request('/crm/leads', 'POST', { email: 'fixture@example.test', firstName: 'Snapshot', lastName: 'Test', productInterest: [product.id] })).body.data;
    const deal = await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: lead.id } } } });
    expect(deal.value).toBe(25000);
    expect((await request('/crm/deals/' + deal.id, 'PUT', { value: 1 })).status).toBe(400);
    expect((await request(endpoint + '/' + product.id, 'PATCH', { name: 'Renamed product', dealValue: 55000 })).status).toBe(200);
    await scope(() => salesTransaction(tx => createProductDeals(tx, tenantId, lead.id, adminId)));
    expect(await prisma.deal.count({ where: { leadDeals: { some: { leadId: lead.id } } } })).toBe(1);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).value).toBe(25000);
    const next = (await request('/crm/leads', 'POST', { email: 'fixture@example.test', firstName: 'Future', lastName: 'Test', productInterest: [product.id] })).body.data;
    expect((await prisma.deal.findFirstOrThrow({ where: { leadDeals: { some: { leadId: next.id } } } })).value).toBe(55000);
    expect((await request(endpoint + '/' + product.id, 'DELETE')).status).toBe(200);
    expect((await prisma.productInterest.findUniqueOrThrow({ where: { id: product.id } })).active).toBe(false);
    expect((await request('/crm/leads', 'POST', { email: 'fixture@example.test', firstName: 'Deleted', lastName: 'Test', productInterest: [product.id] })).status).toBe(400);
    expect(await prisma.deal.count({ where: { leadDeals: { some: { leadId: lead.id } } } })).toBe(1);
  });
  it('rejects public forged product IDs, product names and submitted amounts with no partial writes', async () => {
    const config = defaultContactForm();
    const form = await prisma.marketingForm.create({ data: { tenantId, createdById: adminId, name: 'Tampering', status: 'published', fields: config.fields, design: config.design, settings: config.settings, publishedConfig: config, publishedVersion: 1 } });
    const email = randomUUID() + '@example.test';
    for (const values of [
      { productInterest: [randomUUID()] }, { productInterest: ['Smart Lock'] },
      { productInterest: [productIds['Smart Lock']], dealValue: '1' },
    ]) {
      await expect(submitPublicForm(form.publicId, { version: 1, values: { firstName: 'Bad', lastName: 'Input', email, ...values } })).rejects.toThrow();
    }
    expect(await prisma.lead.count({ where: { tenantId, email } })).toBe(0);
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
  });
  it('filters calendar dates inclusively in Manila and keeps pagination counts consistent', async () => {
    for (const [index, createdAt] of ['2026-09-24T15:59:59.999Z', '2026-09-24T16:00:00.000Z', '2026-09-25T15:59:59.999Z', '2026-09-25T16:00:00.000Z'].entries()) {
      await prisma.lead.create({ data: { tenantId, firstName: 'DateBoundary', lastName: String(index), createdAt: new Date(createdAt), productInterest: [] } });
    }
    const list = (filter: string) => request('/crm/leads?search=DateBoundary&limit=1&filter[createdAt]=' + encodeURIComponent(filter));
    for (const [filter, total] of [['lte:2026-09-25', 3], ['gte:2026-09-25', 3], ['between:2026-09-25,2026-09-25', 2]] as const) {
      const result = await list(filter);
      expect(result.status).toBe(200); expect(result.body.meta.total).toBe(total); expect(result.body.data).toHaveLength(1);
    }
    expect((await request('/crm/leads?search=DateBoundary')).body.meta.total).toBe(4);
    for (const filter of ['equals:2026-09-25', 'lte:2026-02-30', 'gte:not-a-date', 'between:2026-09-26,2026-09-25', 'between:2026-09-25', 'gte:', '']) expect((await list(filter)).status).toBe(400);
  });
  it('looks up Closed Won deals by product IDs and winning stage, with tenant isolation and pagination', async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: 'Won lookup product', dealValue: 99.5 } });
    const { pipeline, initial: open } = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    const won = await prisma.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, isWon: true } });
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Actual', lastName: 'Customer', productInterest: [], status: 'Warm' } });
    const baseDeal = { tenantId, pipelineId: pipeline.id, stageId: won.id, title: 'Won lookup', value: 99.5, currency: 'PHP', leadDeals: { create: { leadId: lead.id, position: 0 } }, assignedUserId: adminId, closedAt: new Date('2026-09-29T00:00:00Z') };
    const singular = await prisma.deal.create({ data: { ...baseDeal, productInterestId: product.id, productInterestIds: [] } });
    const plural = await prisma.deal.create({ data: { ...baseDeal, productInterestIds: [product.id], isArchived: true } });
    await prisma.deal.create({ data: { ...baseDeal, stageId: open.id, productInterestIds: [product.id] } });
    await prisma.deal.create({ data: { ...baseDeal, productInterestIds: [], productInterests: [product.name] } });
    const path = '/administration/product-interests/' + product.id;
    expect((await request('/crm/deals/' + singular.id)).body.data.productInterestRecord).toEqual({ id: product.id, name: product.name });
    expect((await request(path)).body.data).toMatchObject({ id: product.id, dealValue: 99.5, active: true });
    const response = await request(path + '/closed-won');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.map((row: any) => row.id).sort()).toEqual([singular.id, plural.id].sort());
    expect(response.body.data[0]).toMatchObject({ customers: ['Actual Customer'], value: 99.5, assignedAgent: 'Admin Test', closedAt: '2026-09-29T00:00:00.000Z' });
    expect((await request(path + '/closed-won?limit=1&page=2')).body).toMatchObject({ meta: { total: 2, page: 2, hasMore: false } });
    expect((await request(path + '/closed-won?limit=100')).status).toBe(200);
    expect((await request(path + '/closed-won?limit=101')).status).toBe(400);
    expect((await request(path + '/closed-won?limit=-1')).status).toBe(400);
    expect((await request(path + '/closed-won', 'GET', undefined, deniedToken)).status).toBe(403);
    const foreign = await prisma.productInterest.create({ data: { tenantId: otherTenant, name: 'Foreign lookup product', dealValue: 0 } });
    expect((await request('/administration/product-interests/' + foreign.id + '/closed-won')).status).toBe(404);
    expect((await request('/administration/product-interests/not-a-uuid/closed-won')).status).toBe(400);
    expect((await request(path, 'DELETE')).status).toBe(200);
    expect((await request(path)).body.data.active).toBe(false);
    expect((await request(path + '/closed-won')).body.meta.total).toBe(2);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: singular.id } })).value).toBe(99.5);
    expect((await request('/crm/deals', 'POST', { title: 'Invalid archived product', pipelineId: pipeline.id, stageId: open.id, productInterestIds: [product.id] })).status).toBe(400);
  });
  it('deletes the field without destroying CRM history and explicitly recreates an empty field', async () => {
    const before = await prisma.deal.count({ where: { tenantId } });
    expect((await request('/administration/product-interests', 'DELETE', undefined, deniedToken)).status).toBe(403);
    expect((await request('/administration/product-interests', 'DELETE')).status).toBe(200);
    const deleted = await request('/administration/product-interests');
    expect(deleted.body.data).toEqual([]); expect(deleted.body.meta.enabled).toBe(false);
    expect(await prisma.deal.count({ where: { tenantId } })).toBe(before);
    expect((await request('/administration/product-interests/field', 'POST', {})).status).toBe(200);
    expect((await request('/administration/product-interests')).body.meta.enabled).toBe(true);
  });
  it.each(['Hot', 'Warm', 'Cold', 'Cancelled'])('creates and edits Leads and Contacts using %s at the HTTP boundary', async status => {
    const products = await Promise.all([1250.75, 550].map(dealValue => prisma.productInterest.create({ data: { tenantId, name: `Status ${status} ${dealValue}`, dealValue } })));
    const selectedIds = products.map(product => product.id);
    const lead = await request('/crm/leads', 'POST', { email: 'manual@example.test', firstName: 'Manual', lastName: status, status, productInterest: selectedIds });
    expect(lead.status).toBe(201);
    expect(lead.body.data.status).toBe(status);
    expect(lead.body.data.productInterestIds).toEqual(selectedIds);
    const deals = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: lead.body.data.id } } } });
    expect(deals).toHaveLength(2);
    expect(deals.map(deal => deal.value).sort()).toEqual([550, 1250.75].sort());
    const editedLead = await request(`/crm/leads/${lead.body.data.id}`, 'PUT', { status });
    expect(editedLead.status).toBe(200);
    expect(editedLead.body.data.status).toBe(status);
    const contact = await request('/crm/contacts', 'POST', { email: 'manual@example.test', firstName: 'Manual', lastName: status, status });
    expect(contact.status).toBe(201);
    expect(contact.body.data.status).toBe(status);
    const edited = await request(`/crm/contacts/${contact.body.data.id}`, 'PUT', { status: 'Cold' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe('Cold');
    const restored = await request(`/crm/contacts/${contact.body.data.id}`, 'PUT', { status });
    expect(restored.body.data.status).toBe(status);
    const unchanged = await request(`/crm/contacts/${contact.body.data.id}`, 'PUT', { firstName: 'Renamed' });
    expect(unchanged.body.data.status).toBe(status);
    const detail = await request(`/crm/contacts/${contact.body.data.id}`);
    expect(detail.body.data.status).toBe(status);
    const statusEvents = await prisma.activity.findMany({ where: { contactId: contact.body.data.id, type: 'stage_change' } });
    expect(statusEvents.every(event => !/\b(HOT|WARM|COLD|CLOSED|CANCELLED)\b/.test(event.title))).toBe(true);
    await prisma.activity.create({ data: { tenantId, contactId: contact.body.data.id, createdById: adminId, type: 'stage_change', title: 'Status changed from HOT to WARM' } });
    const relationships = await request(`/crm/contacts/${contact.body.data.id}/relationships`);
    expect(relationships.body.data.activities.some((event: { title: string }) => event.title === 'Status changed from Hot to Warm')).toBe(true);
    const filtered = await request(`/crm/contacts?status=${status}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.some((row: { id: string }) => row.id === contact.body.data.id)).toBe(true);
    expect(filtered.body.data.every((row: { status: string }) => row.status === status)).toBe(true);
  });

  it('defaults Contacts to Warm and rejects noncanonical statuses on both APIs', async () => {
    expect((await request('/crm/contacts', 'POST', { email: 'fixture@example.test', firstName: 'Default', lastName: 'Status' })).body.data.status).toBe('Warm');
    for (const module of ['leads', 'contacts']) {
      for (const status of ['WARM', 'HOT', 'COLD', 'CLOSED', 'CANCELLED', 'Unknown']) {
        const response = await request(`/crm/${module}`, 'POST', { firstName: 'Invalid', lastName: 'Status', status });
        expect(response.status).toBe(400);
      }
    }
  });


  it.each(['leads', 'contacts'])('%s requires a trimmed valid email on create and rejects clearing it on edit', async module => {
    for (const email of [undefined, '', '   ', 'invalid', 'a'.repeat(250) + '@example.test']) {
      expect((await request(`/crm/${module}`, 'POST', { firstName: 'Email', lastName: 'Validation', email })).status).toBe(400);
    }
    const created = await request(`/crm/${module}`, 'POST', { firstName: 'Email', lastName: 'Valid', email: '  email@example.test  ' });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('email@example.test');
    for (const email of ['', '  ', 'invalid', null]) expect((await request(`/crm/${module}/${created.body.data.id}`, 'PUT', { email })).status).toBe(400);
    expect((await request(`/crm/${module}/${created.body.data.id}`, 'PUT', { firstName: 'Changed' })).status).toBe(200);
    expect((await request(`/crm/${module}/${created.body.data.id}`)).body.data.email).toBe('email@example.test');
  });

  it('requires one Product for new Deals and preserves the original snapshot on every edit', async () => {
    const { pipeline, initial } = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    const products = await Promise.all([12.25, 9.5].map(dealValue => prisma.productInterest.create({ data: { tenantId, name: randomUUID(), dealValue } })));
    const input = { title: 'One product', pipelineId: pipeline.id, stageId: initial.id };
    expect((await request('/crm/deals', 'POST', { ...input, productInterestIds: products.map(p => p.id) })).status).toBe(400);
    expect((await request('/crm/deals', 'POST', { ...input, productInterestId: products[1].id, productInterestIds: [products[0].id] })).status).toBe(400);
    const result = await request('/crm/deals', 'POST', { ...input, productInterestIds: [products[0].id, products[0].id], value: 999 });
    expect(result.status).toBe(201);
    const id = result.body.data.id;
    expect(result.body.data).toMatchObject({ productInterestIds: [products[0].id], productInterests: [products[0].name], value: 12.25, currency: 'PHP' });
    await prisma.productInterest.update({ where: { id: products[0].id }, data: { dealValue: 500 } });
    const same = await request('/crm/deals/' + id, 'PUT', { title: 'Preserve snapshot', productInterestIds: [products[0].id], value: 999, currency: 'USD' });
    expect(same.status).toBe(200); expect(same.body.data.value).toBe(12.25);
    for (const patch of [{ value: 999 }, { currency: 'USD' }, { productInterestIds: [] }, { productInterestIds: [products[1].id] }]) expect((await request('/crm/deals/' + id, 'PUT', patch)).status).toBe(400);
    expect((await request('/crm/deals/' + id, 'PUT', { title: 'Denied' }, deniedToken)).status).toBe(403);
  });

  it('manages existing pipeline stages while protecting ownership, archived Deals and history', async () => {
    const official = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    expect((await request('/crm/stages', 'POST', { pipelineId: official.pipeline.id, name: 'Unsupported stage', order: 100 })).status).toBe(400);
    expect((await request(`/crm/stages/${official.initial.id}`, 'PUT', { color: '#123456' })).status).toBe(200);
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: official.initial.id } })).color).toBe('#123456');
    // Historical nonofficial pipelines retain their existing stage management contract.
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Legacy custom pipeline' } });
    const initial = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0, isDefault: true } });
    const created = await request('/crm/stages', 'POST', { pipelineId: pipeline.id, name: '  Proposal  ', order: 100 });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.name).toBe('Proposal');
    expect((await request(`/crm/stages/${id}`, 'PUT', { name: '  Review  ' })).body.data.name).toBe('Review');
    const stages = (await request(`/crm/pipelines/${pipeline.id}`)).body.data.stages;
    const ids = stages.map((stage: { id: string }) => stage.id).reverse();
    expect((await request(`/crm/pipelines/${pipeline.id}/stages/reorder`, 'PATCH', { stageIds: ids })).status).toBe(200);
    expect((await request(`/crm/pipelines/${pipeline.id}`)).body.data.stages.map((stage: { id: string }) => stage.id)).toEqual(ids);
    for (const stageIds of [[...ids, ids[0]], ids.slice(1), [...ids.slice(1), randomUUID()]]) expect((await request(`/crm/pipelines/${pipeline.id}/stages/reorder`, 'PATCH', { stageIds })).status).toBe(400);
    const foreign = await prisma.pipeline.create({ data: { tenantId: otherTenant, name: 'Foreign' } });
    expect((await request('/crm/stages', 'POST', { pipelineId: foreign.id, name: 'Intrusion', order: 1 })).status).toBe(404);
    expect((await request(`/crm/stages/${initial.id}`, 'DELETE')).status).toBe(400);
    const archived = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: id, title: 'Archived reference', isArchived: true } });
    expect((await request(`/crm/stages/${id}`, 'DELETE')).status).toBe(400);
    await prisma.deal.update({ where: { id: archived.id }, data: { stageId: initial.id } });
    await prisma.dealStageHistory.create({ data: { tenantId, dealId: archived.id, previousStageId: id, newStageId: initial.id, movedById: adminId } });
    expect((await request(`/crm/stages/${id}`, 'DELETE')).status).toBe(400);
    const unused = await request('/crm/stages', 'POST', { pipelineId: pipeline.id, name: 'Unused', order: 101 });
    expect((await request(`/crm/stages/${unused.body.data.id}`, 'DELETE')).status).toBe(200);
    expect(await prisma.stage.findUnique({ where: { id: unused.body.data.id } })).toBeNull();
    expect((await request(`/crm/stages/${id}`, 'PUT', { name: 'Denied' }, deniedToken)).status).toBe(403);
    expect((await request(`/crm/stages/${initial.id}`, 'PUT', { name: 'Initial renamed' })).status).toBe(400);
    const next = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    expect(next.initial.id).toBe(official.initial.id);
  });

  it('persists Deal file history through the shared file service with tenant and permission checks', async () => {
    const { createServer } = await import('node:http');
    const objects = new Map<string, Buffer>();
    const storage = createServer((req, res) => {
      const key = req.url!.replace('/authenticated/', '/');
      if (req.method === 'POST') { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { objects.set(key, Buffer.concat(chunks)); res.end('{}'); }); }
      else if (objects.has(key)) res.end(objects.get(key));
      else { res.statusCode = 404; res.end(); }
    });
    storage.listen(0, '127.0.0.1'); await new Promise<void>(resolve => storage.once('listening', resolve));
    const old = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_RECORD_FILES_BUCKET];
    process.env.SUPABASE_URL = `http://127.0.0.1:${(storage.address() as { port: number }).port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test'; process.env.SUPABASE_RECORD_FILES_BUCKET = 'files';
    try {
      const { pipeline, initial } = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
      const deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: initial.id, title: 'Files' } });
      const upload = await fetch(`${base}/crm/deals/${deal.id}/files?name=agreement.pdf&type=application%2Fpdf`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: '%PDF-1.7 file test' });
      expect(upload.status).toBe(201);
      const file = (await upload.json()).data;
      expect(await prisma.recordFile.findUnique({ where: { id: file.id } })).toMatchObject({ dealId: deal.id, tenantId, name: 'agreement.pdf' });
      expect((await request(`/crm/deals/${deal.id}/files`)).body.data.map((f: { id: string }) => f.id)).toEqual([file.id]);
      const downloaded = await fetch(`${base}/crm/deals/${deal.id}/files/${file.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
      expect(await downloaded.text()).toBe('%PDF-1.7 file test');
      expect((await request(`/crm/deals/${deal.id}/files`, 'GET', undefined, deniedToken)).status).toBe(403);
    } finally {
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_RECORD_FILES_BUCKET'].forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; });
      await new Promise<void>(resolve => storage.close(() => resolve()));
    }
  });

});
