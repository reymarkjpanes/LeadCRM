import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { User } from '@prisma/client';
import { TaskOptionsQuerySchema, type WorkflowDraft } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { crmActor } from '../access/crm-record-access.service';
import { salesTransaction, createAssignedLead } from '../leads/lead-automation.service';
import { createAssignedContact } from '../contacts-v2/contact-creation';
import { classifyCustomerRecord, recordStaffOutreach, refreshDealClassification } from '../customer-classification.service';
import { weightedLeadScores } from '../leads/lead-workload';
import { convertLead } from '../leads/lead-conversion.service';
import * as deals from '../deals/deals.repository';
import { findAllContacts } from '../contacts/contacts.repository';
import { findFilteredDealOptions } from '../../operations/tasks/tasks.repository';
import { createTask } from '../../operations/tasks/tasks.service';
import * as workflows from '../../automation/workflows/workflows.service';
import { enqueueWorkflowTrigger, dispatchQueuedWorkflows } from '../../automation/workflows/workflow-queue';
import { cancelOpenDeals } from '../engagement.service';
import { sweepCustomerClassifications } from '../customer-classification.scheduler';
import { restoreDeal } from '../deals/deals.service';
import { processSmsReply } from '../../../integrations/sms/sms-replies';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_[a-z0-9_]+$/.test(url.pathname);
describe.skipIf(!disposable)('hybrid classification, selection and revisions on disposable SQL', () => {
  let tenantId: string, otherTenantId: string, admin: User, owner: User, second: User, pipelineId: string, initialId: string, qualifiedId: string, lostId: string;
  let server: Server, base: string, token: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, () => crmActor.run({ tenantId, userId: admin.id }, work));
  const person = (extra = {}) => ({ tenantId, firstName: 'Nora', lastName: 'Fixture', email: `${randomUUID()}@example.test`, assignedUserId: owner.id, ...extra });
  const lead = (extra = {}) => prisma.lead.create({ data: person(extra) });
  const contact = (extra = {}) => prisma.contact.create({ data: person(extra) });
  async function linkedDeal(leadId?: string, contactId?: string, extra = {}) {
    const result = await prisma.deal.create({ data: { tenantId, title: randomUUID(), pipelineId, stageId: initialId, assignedUserId: owner.id, ...extra } });
    if (leadId) await prisma.leadDeal.create({ data: { tenantId, leadId, dealId: result.id } });
    if (contactId) await prisma.contactDeal.create({ data: { tenantId, contactId, dealId: result.id } });
    return result;
  }
  const draft = (source: string): WorkflowDraft => ({ name: `Revision ${randomUUID()}`, trigger: 'lead.updated', isActive: true, actions: [{ type: 'update_field', config: { field: 'source', value: source } }] });
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: `leadcrm_token=${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    const stamp = randomUUID();
    tenantId = (await prisma.tenant.create({ data: { name: 'Classification fixture', slug: stamp, status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { name: 'Foreign fixture', slug: randomUUID(), status: 'ACTIVE' } })).id;
    const user = (role: string) => prisma.user.create({ data: { tenantId, role, firstName: role, lastName: 'Fixture', email: `${randomUUID()}@camxian.com`, status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date() } });
    admin = await user('Client Admin'); owner = await user('Sales'); second = await user('Sales');
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales' } });
    await prisma.rolePermission.createMany({ data: ['leads', 'contacts', 'deals', 'tasks', 'accounts', 'products'].map(module => ({ tenantId, roleId: role.id, module, canView: true, canCreate: true, canEdit: true, canAssign: true })) });
    await prisma.userRole.createMany({ data: [owner, second].map(user => ({ tenantId, roleId: role.id, userId: user.id })) });
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Sales fixture' } })).id;
    initialId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0 } })).id;
    qualifiedId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Qualified', order: 1 } })).id;
    lostId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Cancelled', order: 2, isLost: true } })).id;
    token = (await issueAuthSession(admin)).token;
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  }, 30000);
  beforeEach(async () => { await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } }); });
  afterAll(async () => { vi.unstubAllEnvs(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('creates Inquiry Leads and Contacts, retaining explicit statuses and retry identity', async () => {
    const key = randomUUID();
    const created = await scope(() => salesTransaction(tx => createAssignedLead(tx, { ...person({ assignedUserId: undefined }), creationKey: key }, admin.id)));
    const repeat = await scope(() => salesTransaction(tx => createAssignedLead(tx, { ...person(), creationKey: key }, admin.id)));
    expect(created.status).toBe('Inquiry'); expect(repeat.id).toBe(created.id);
    const first = await scope(() => salesTransaction(tx => createAssignedContact(tx, tenantId, { firstName: 'New', lastName: 'Contact', email: `${randomUUID()}@example.test` }, admin.id, randomUUID())));
    expect(first.contact.status).toBe('INQUIRY');
    const explicit = await scope(() => salesTransaction(tx => createAssignedLead(tx, person({ status: 'Warm' }), admin.id)));
    expect(explicit.status).toBe('Warm');
  });
  it('updates both linked records when a Deal is qualified', async () => {
    const a = await lead({ lastCustomerReplyAt: new Date(Date.now() - 60 * 86400000) }), b = await contact();
    const deal = await linkedDeal(a.id, b.id);
    await scope(() => deals.moveDealStage(deal.id, tenantId, qualifiedId, admin.id));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Hot');
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('HOT');
    await scope(() => salesTransaction(tx => classifyCustomerRecord(tx, tenantId, { leadId: a.id }, admin.id, { genuineReply: true })));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Hot');
  });
  it('uses the highest linked Deal status after stage changes and unlinking', async () => {
    const a = await lead({ status: 'Warm', lastCustomerReplyAt: new Date() });
    const first = await linkedDeal(a.id), secondDeal = await linkedDeal(a.id);
    await scope(() => deals.moveDealStage(first.id, tenantId, qualifiedId, admin.id));
    await scope(() => deals.moveDealStage(secondDeal.id, tenantId, qualifiedId, admin.id));
    await scope(() => deals.moveDealStage(first.id, tenantId, initialId, admin.id));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Hot');
    await scope(() => deals.syncLeadAssociations(secondDeal.id, tenantId, [], admin.id));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Inquiry');
  });
  it('updates only the linked status fields when Deal edits commit concurrently', async () => {
    const customer = await contact({ source: 'Direct Mail' });
    const a = await linkedDeal(undefined, customer.id), b = await linkedDeal(undefined, customer.id);
    const { updateDeal } = await import('../deals/deals.service');
    await Promise.all([
      scope(() => updateDeal(a.id, tenantId, admin.id, { engagementStatus: 'Hot' })),
      scope(() => updateDeal(b.id, tenantId, admin.id, { engagementStatus: 'Cold' })),
    ]);
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({
      status: 'HOT', source: 'Direct Mail', assignedUserId: customer.assignedUserId,
    });
    expect(await prisma.activity.count({ where: { tenantId, contactId: customer.id, type: 'stage_change' } })).toBe(1);
    const path = '/crm/contacts/' + customer.id;
    expect((await call(path, 'PUT', { source: 'Direct Mail' })).status).toBe(400);
    expect((await call(path, 'PUT', { notes: 'Keep historical source' })).status).toBe(200);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).source).toBe('Direct Mail');
    await scope(() => deals.syncContactAssociations(a.id, tenantId, [], admin.id));
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('COLD');
    await scope(() => deals.syncContactAssociations(b.id, tenantId, [], admin.id));
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('COLD');
  });
  it('derives cancellation and preserves status when the last open Deal is archived', async () => {
    for (const outcome of ['lost', 'archived']) {
      const a = await lead(); const deal = await linkedDeal(a.id);
      await scope(() => deals.moveDealStage(deal.id, tenantId, qualifiedId, admin.id));
      if (outcome === 'lost') await scope(() => deals.moveDealStage(deal.id, tenantId, lostId, admin.id, undefined, undefined, 'Customer declined.'));
      else await scope(() => deals.archiveDeal(deal.id, tenantId, 'Fixture', admin.id));
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(outcome === 'lost' ? 'Cancelled' : 'Hot');
    }
  });
  it('reconciles restored Deals and ages customer outreach evidence without a receiving device', async () => {
    const now = new Date(), a = await lead(), deal = await linkedDeal(a.id);
    await scope(() => deals.moveDealStage(deal.id, tenantId, qualifiedId, admin.id));
    await scope(() => deals.archiveDeal(deal.id, tenantId, 'Fixture', admin.id));
    await scope(() => restoreDeal(deal.id, tenantId, admin.id));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Hot');
    const old = new Date(+now - 31 * 86400000);
    const touched = await lead({ firstStaffOutreachAt: old });
    const untouched = await lead({ createdAt: old });
    const replied = await contact({ status: 'WARM', lastCustomerReplyAt: old });
    await sweepCustomerClassifications(now);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: touched.id } })).status).toBe('Cold');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: untouched.id } })).status).toBe('Inquiry');
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: replied.id } })).status).toBe('COLD');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Hot');
  });
  it('serializes concurrent weighted creation and retries without extra rotation', async () => {
    await prisma.lead.updateMany({ where: { tenantId }, data: { assignedUserId: null } });
    const inputs = Array.from({ length: 4 }, () => ({ ...person({ assignedUserId: undefined }), creationKey: randomUUID() }));
    const created = await Promise.all(inputs.map(input => scope(() => salesTransaction(tx => createAssignedLead(tx, input, admin.id)))));
    expect(created.filter(row => row.assignedUserId === owner.id)).toHaveLength(2);
    expect(created.filter(row => row.assignedUserId === second.id)).toHaveLength(2);
    const retry = await scope(() => salesTransaction(tx => createAssignedLead(tx, inputs[0], admin.id)));
    expect(retry.id).toBe(created[0].id);
    expect(await prisma.lead.count({ where: { tenantId, email: { in: inputs.map(row => row.email) } } })).toBe(4);
  });
  it('synchronizes every participant after cancelling their only shared Deal', async () => {
    const a = await lead(), b = await lead(), deal = await linkedDeal(a.id);
    await prisma.leadDeal.create({ data: { tenantId, leadId: b.id, dealId: deal.id } });
    await scope(() => deals.moveDealStage(deal.id, tenantId, qualifiedId, admin.id));
    await prisma.lead.update({ where: { id: a.id }, data: { status: 'Cancelled' } });
    await scope(() => salesTransaction(tx => cancelOpenDeals(tx, tenantId, admin.id, { leadId: a.id }, 'Cancelled by customer.')));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Cancelled');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('Cancelled');
  });
  it('preserves Inquiry during conversion with relationships and outreach evidence', async () => {
    const firstStaffOutreachAt = new Date(Date.now() - 86400000), a = await lead({ firstStaffOutreachAt });
    const deal = await linkedDeal(a.id);
    const converted = await scope(() => salesTransaction(tx => convertLead(tx, tenantId, a.id, admin.id)));
    expect(converted.contact.status).toBe('INQUIRY'); expect(converted.contact.firstStaffOutreachAt).toEqual(firstStaffOutreachAt);
    expect(await prisma.contactDeal.count({ where: { tenantId, contactId: converted.contact.id, dealId: deal.id } })).toBe(1);
  });
  it('uses actual weighted Leads without counting their Deals or closed records', async () => {
    await prisma.lead.updateMany({ where: { tenantId }, data: { assignedUserId: null } });
    await lead({ status: 'Hot' }); await lead({ status: 'Hot' });
    await lead({ assignedUserId: second.id, status: 'Warm' }); await lead({ assignedUserId: second.id, status: 'Cancelled' });
    const scores = await scope(() => salesTransaction(tx => weightedLeadScores(tx, tenantId, [owner.id, second.id])));
    expect(scores.get(owner.id)).toBe(6); expect(scores.get(second.id)).toBe(2);
    const chosen = await scope(() => salesTransaction(tx => createAssignedLead(tx, person({ assignedUserId: undefined }), admin.id)));
    expect(chosen.assignedUserId).toBe(second.id);
    const explicit = await scope(() => salesTransaction(tx => createAssignedLead(tx, person(), admin.id)));
    expect(explicit.assignedUserId).toBe(owner.id);
  });
  it('preserves Active and My Leads scopes, tenant isolation and explicit sorting before pagination', async () => {
    const firstName = randomUUID();
    const a = await lead({ firstName, createdAt: new Date('2001-01-01'), status: 'Inquiry' });
    const b = await lead({ firstName, createdAt: new Date('2000-01-01'), status: 'Hot', firstStaffOutreachAt: new Date(), assignedUserId: second.id });
    const cold = await lead({ firstName, createdAt: new Date('1999-01-01'), status: 'Cold' });
    await prisma.lead.create({ data: { tenantId: otherTenantId, firstName, lastName: 'Foreign', createdAt: new Date('1998-01-01') } });
    const query = { page: 1, limit: 1, search: firstName, sort: 'createdAt:asc' };
    const active = await scope(() => findAllContacts(tenantId, { ...query, 'filter[scope]': 'equals:active' }));
    expect(active.data.map(row => row.id)).toEqual([b.id]); expect(active.total).toBe(2);
    const next = await scope(() => findAllContacts(tenantId, { ...query, page: 2, 'filter[scope]': 'equals:active' }));
    expect(next.data.map(row => row.id)).toEqual([a.id]);
    const ownerRole = await prisma.userRole.findFirstOrThrow({ where: { tenantId, userId: second.id } });
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: ownerRole.roleId, module: 'leads' }, data: { canViewMy: true } });
    const mine = await tenantContext.run({ tenantId }, () => crmActor.run({ tenantId, userId: second.id }, () => findAllContacts(tenantId, { ...query, currentUserId: second.id, 'filter[scope]': 'equals:my' })));
    expect(mine.data.map(row => row.id)).toEqual([b.id]); expect(mine.total).toBe(1);
    const all = await scope(() => findAllContacts(tenantId, { ...query, 'filter[scope]': 'equals:all' }));
    expect(all.data.map(row => row.id)).toEqual([cold.id]); expect(all.total).toBe(3);
  });
  it('rejects the removed scope through existing API validation', async () => {
    const result = await call('/crm/leads?filter%5Bscope%5D=equals%3Awork_queue');
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('Choose a supported filter value.');
  });
  it('continues recording real staff outreach for customer classification', async () => {
    const a = await lead();
    await scope(() => salesTransaction(tx => recordStaffOutreach(tx, tenantId, { leadId: a.id }, new Date())));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).firstStaffOutreachAt).toBeTruthy();
  });
  it('selects all matching authorized deals across pages and rejects 51 matches', async () => {
    const account = await prisma.account.create({ data: { tenantId, name: randomUUID() } });
    const product = await prisma.productInterest.create({ data: { tenantId, name: randomUUID(), dealValue: 12345, category: 'Security' } });
    const title = `Filtered ${randomUUID()}`;
    await prisma.deal.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ tenantId, title: `${title} ${i}`, pipelineId, stageId: initialId, assignedUserId: owner.id, accountId: account.id, productInterestId: product.id, value: 12345 })) });
    const query = TaskOptionsQuerySchema.parse({ kind: 'deal', accountId: account.id, category: 'Security', productInterestId: product.id });
    const first = await scope(() => findFilteredDealOptions(tenantId, query)), secondPage = await scope(() => findFilteredDealOptions(tenantId, { ...query, page: 2 }));
    expect(first.data).toHaveLength(25); expect(secondPage.data).toHaveLength(25); expect(first.meta.total).toBe(50);
    const all = await scope(() => findFilteredDealOptions(tenantId, { ...query, selectAll: true })); expect(all.data).toHaveLength(50);
    const task = await scope(() => createTask(tenantId, admin.id, { title, assignedUserId: owner.id, dueDate: new Date(Date.now() + 86400000).toISOString(), dealIds: all.data.map(row => row.id) }));
    expect(await prisma.taskDeal.count({ where: { tenantId, taskId: task.id } })).toBe(50);
    expect(await prisma.task.count({ where: { tenantId, title } })).toBe(1);
    await linkedDeal(undefined, undefined, { title: `${title} 51`, accountId: account.id, productInterestId: product.id });
    await expect(scope(() => findFilteredDealOptions(tenantId, { ...query, selectAll: true }))).rejects.toThrow('More than 50');
    const empty = await scope(() => findFilteredDealOptions(tenantId, { ...query, category: 'Different' })); expect(empty.meta.total).toBe(0);
    expect((await prisma.productInterest.findUniqueOrThrow({ where: { id: product.id } })).dealValue.toNumber()).toBe(12345);
  });
  it('rejects clearing a category while preserving the Product and its Deal assignment', async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: randomUUID(), category: 'Security', description: 'Historical description', dealValue: 12345.67 } });
    const deal = await linkedDeal(undefined, undefined, { productInterestId: product.id });
    for (const category of [null, '', '   ']) {
      const response = await call(`/administration/product-interests/${product.id}`, 'PATCH', { category });
      expect(response.status).toBe(400);
    }
    const saved = await prisma.productInterest.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.category).toBe('Security'); expect(saved.description).toBe('Historical description'); expect(saved.dealValue.toNumber()).toBe(12345.67);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).productInterestId).toBe(product.id);
  });
  it('retains Uncategorized filtering for historical Products without a category', async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: randomUUID(), category: '', dealValue: 12345.67 } });
    const deal = await linkedDeal(undefined, undefined, { productInterestId: product.id });
    const query = TaskOptionsQuerySchema.parse({ kind: 'deal', category: '__uncategorized', productInterestId: product.id });
    const result = await scope(() => findFilteredDealOptions(tenantId, query));
    expect(result.data.map(row => row.id)).toEqual([deal.id]);
  });
  it('saves drafts while active, rejects stale writers, publishes revisions and restores into a draft', async () => {
    const original = draft('Referral'), current = await scope(() => workflows.createWorkflow(tenantId, admin.id, original));
    const changed = { ...original, actions: [{ type: 'update_field', config: { field: 'source', value: 'Website' } }] };
    const write = { draft: changed, expectedDraftRevision: 0, expectedVersion: current.version };
    const saved = await call(`/automation/workflows/${current.id}/draft`, 'PUT', write);
    expect(saved.status).toBe(200); expect(saved.body.data.isActive).toBe(true); expect(saved.body.data.version).toBe(current.version);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: current.id } })).actions).toEqual(original.actions);
    expect((await call(`/automation/workflows/${current.id}/draft`, 'PUT', write)).status).toBe(409);
    const published = await call(`/automation/workflows/${current.id}/publish`, 'POST', { ...write, expectedDraftRevision: 1 });
    expect(published.status).toBe(200); expect(published.body.data.version).toBe(current.version + 1);
    const history = await call(`/automation/workflows/${current.id}/versions`); expect(history.body.data.map((row: { version: number }) => row.version)).toEqual([2, 1]);
    const restored = await call(`/automation/workflows/${current.id}/versions/1/restore`, 'POST', { expectedDraftRevision: 2, expectedVersion: 2 });
    expect(restored.status).toBe(200); expect(restored.body.data.draftDefinition.actions).toEqual(original.actions);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: current.id } })).isActive).toBe(true);
    expect((await call(`/automation/workflows/${randomUUID()}/versions`)).status).toBe(404);
  });
  it('runs a queued event against its captured published revision after a new version is published', async () => {
    const a = await lead(), original = draft('Referral');
    const current = await scope(() => workflows.createWorkflow(tenantId, admin.id, original));
    await scope(() => salesTransaction(tx => enqueueWorkflowTrigger(tx, { tenantId, actorId: admin.id, triggerType: 'lead.updated', entityType: 'lead', entityId: a.id, eventId: randomUUID(), context: { 'event.changedFields': ['firstName'] } })));
    await scope(() => workflows.publishWorkflowDraft(current.id, tenantId, admin.id, { draft: { ...original, actions: [{ type: 'update_field', config: { field: 'source', value: 'Website' } }] }, expectedDraftRevision: 0, expectedVersion: 1 }));
    await dispatchQueuedWorkflows();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).source).toBe('Referral');
    const run = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { workflowId: current.id, entityId: a.id } }); expect(run.workflowVersion).toBe(1); expect(run.status).toBe('completed');
  });
  it('handles signed SMS replies exactly once, preserves terminal outcomes and routes review safely', async () => {
    const deviceId = 'a'.repeat(24), phone = '+639171234567';
    vi.stubEnv('TEXTBEE_WEBHOOK_SECRET', 'fixture-secret-at-least-twenty-characters');
    vi.stubEnv('TEXTBEE_RECEIVER_ROUTES', JSON.stringify([{ deviceId, tenantId, userId: admin.id }]));
    const a = await lead({ phone, status: 'Inquiry' });
    const event = { webhookEvent: 'MESSAGE_RECEIVED', deviceId, smsId: randomUUID(), sender: phone, message: 'Please send a quotation.', receivedAt: new Date().toISOString() };
    const body = JSON.stringify(event), signature = createHmac('sha256', process.env.TEXTBEE_WEBHOOK_SECRET!).update(body).digest('hex');
    const send = () => fetch(`${base}/webhooks/textbee`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': signature }, body });
    expect((await send()).status).toBe(200); expect((await send()).status).toBe(200);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Warm');
    expect(await prisma.activity.count({ where: { tenantId, leadId: a.id, type: 'sms' } })).toBe(1);
    await prisma.lead.update({ where: { id: a.id }, data: { status: 'Cancelled' } });
    await processSmsReply({ ...event, smsId: randomUUID() }); expect((await prisma.lead.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('Cancelled');
    const duplicate = await contact({ phone });
    const ambiguous = { ...event, smsId: randomUUID() }; await processSmsReply(ambiguous);
    const review = await prisma.smsInboundReceipt.findUniqueOrThrow({ where: { deviceId_smsId: { deviceId, smsId: ambiguous.smsId } } }); expect(review.status).toBe('review'); expect(review.message).toBe(event.message);
    await prisma.contact.update({ where: { id: duplicate.id }, data: { phone: null } });
    await processSmsReply(ambiguous, new Date(), true);
    expect((await prisma.smsInboundReceipt.findUniqueOrThrow({ where: { id: review.id } })).status).toBe('processed');
    const foreign = await prisma.lead.create({ data: { tenantId: otherTenantId, firstName: 'Foreign', lastName: 'Person', phone, status: 'Inquiry' } });
    await processSmsReply({ ...event, smsId: randomUUID() }); expect((await prisma.lead.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe('Inquiry');
    const rejected = await fetch(`${base}/webhooks/textbee`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': '0'.repeat(64) }, body }); expect(rejected.status).toBe(401);
  });
  it('rejects direct linked status overrides and leaves only one activity per effective Deal change', async () => {
    const customer = await contact(), deal = await linkedDeal(undefined, customer.id);
    await scope(() => deals.moveDealStage(deal.id, tenantId, qualifiedId, admin.id));
    const qualifiedAt = new Date(Date.now() - 7 * 86400000);
    await prisma.dealStageHistory.updateMany({ where: { tenantId, dealId: deal.id, newStageId: qualifiedId }, data: { movedAt: qualifiedAt } });
    const before = await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } });
    const path = '/crm/contacts/' + customer.id;
    const saved = await call(path, 'PUT', { status: 'Cold', expectedUpdatedAt: before.updatedAt.toISOString() });
    expect(saved.status).toBe(400);
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before);
    expect((await call(path, 'PUT', { notes: 'Unchanged engagement save' })).status).toBe(200);
    await scope(() => salesTransaction(tx => refreshDealClassification(tx, tenantId, deal.id, admin.id)));
    expect((await call(path)).body.data.status).toBe('Hot');
    const historyWhere = { tenantId, contactId: customer.id, type: 'stage_change' };
    const previousCount = await prisma.activity.count({ where: historyWhere });
    const boundary = new Date(+qualifiedAt + 8 * 86400000);
    await scope(() => salesTransaction(tx => refreshDealClassification(tx, tenantId, deal.id, admin.id, [], boundary, true, deal.id, 'scheduler')));
    expect((await call(path)).body.data.status).toBe('Hot');
    const history = await prisma.activity.findMany({ where: historyWhere, orderBy: { createdAt: 'desc' } });
    expect(history).toHaveLength(previousCount);
    await scope(() => salesTransaction(tx => refreshDealClassification(tx, tenantId, deal.id, admin.id, [], boundary)));
    expect(await prisma.activity.count({ where: historyWhere })).toBe(history.length);
  });
  it('reopens the single cancelled Deal through the governed Contact action', async () => {
    const customer = await contact(), deal = await linkedDeal(undefined, customer.id);
    await scope(() => deals.moveDealStage(deal.id, tenantId, lostId, admin.id, undefined, undefined, 'Customer declined'));
    const path = '/crm/contacts/' + customer.id;
    expect((await call(path)).body.data.status).toBe('Cancelled');
    expect((await call(path, 'PUT', { status: 'Cancelled' })).body.data.status).toBe('Cancelled');
    expect((await call(path, 'PUT', { status: 'Hot' })).status).toBe(400);
    const historyCount = await prisma.dealStageHistory.count({ where: { tenantId, dealId: deal.id } });
    expect((await call(path, 'PUT', { status: 'Inquiry' })).body.data.status).toBe('Inquiry');
    await scope(() => salesTransaction(tx => refreshDealClassification(tx, tenantId, deal.id, admin.id)));
    expect((await call(path)).body.data.status).toBe('Inquiry');
    expect((await call(path, 'PUT', { status: 'Hot' })).status).toBe(400);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId).toBe(initialId);
    expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: deal.id } })).toBe(historyCount + 1);
  });
  it('serializes versioned status writes and records only committed changes once', async () => {
    const customer = await contact(), path = '/crm/contacts/' + customer.id;
    const writes = await Promise.all(['Warm', 'Cold'].map(status => call(path, 'PUT', { status, expectedUpdatedAt: customer.updatedAt.toISOString() })));
    expect(writes.map(write => write.status).sort()).toEqual([200, 409]);
    const saved = await call(path);
    await call(path, 'PUT', { status: saved.body.data.status });
    expect(await prisma.activity.count({ where: { tenantId, contactId: customer.id, type: 'stage_change' } })).toBe(1);
    const before = await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } });
    await expect(scope(() => salesTransaction(async tx => {
      await tx.contact.update({ where: { id: customer.id, tenantId }, data: { lastCustomerReplyAt: new Date() } });
      await classifyCustomerRecord(tx, tenantId, { contactId: customer.id }, admin.id, { genuineReply: true });
      throw new Error('Rollback fixture');
    }))).rejects.toThrow('Rollback fixture');
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before);
    expect(await prisma.activity.count({ where: { tenantId, contactId: customer.id, type: 'stage_change' } })).toBe(1);
  });

  it('preserves a manually chosen Hot status despite older unlinked customer evidence', async () => {
    const replyAt = new Date(Date.now() - 7 * 86400000);
    const customer = await contact({ status: 'WARM', lastCustomerReplyAt: replyAt });
    expect((await call('/crm/contacts/' + customer.id, 'PUT', { status: 'Hot' })).body.data.status).toBe('Hot');
    await scope(() => salesTransaction(tx => classifyCustomerRecord(tx, tenantId, { contactId: customer.id }, admin.id, {}, new Date(+replyAt + 8 * 86400000))));
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe('HOT');
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).lastCustomerReplyAt).toEqual(replyAt);
  });

});
