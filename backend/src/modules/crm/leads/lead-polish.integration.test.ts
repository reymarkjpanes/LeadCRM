import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../config/database.config';
import app from '../../../app';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { salesPipeline, salesTransaction } from './lead-automation.service';
import { deactivateUser } from '../../administration/users/user-deactivation.service';
import { execute as merge } from '../merge/merge.service';
import * as events from '../../automation/triggers/triggers.service';
import { resolveMailboxScope } from '../../../integrations/gmail/mailbox-scope';
import type { EmailAccount } from '@prisma/client';
import { createWorkflow } from '../../automation/workflows/workflows.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
describe.skipIf(url.hostname !== '127.0.0.1' || !['/leadcrm_forms_test_2','/leadcrm_leads_test_1'].includes(url.pathname))('Lead polish: real SQL and authenticated HTTP', () => {
  let tenantId: string, foreignTenant: string, adminId: string, agentId: string, otherId: string, deniedId: string, foreignId: string, token: string, deniedToken: string, pipelineId: string, stageId: string, productId: string, server: Server, base: string, roleId: string;
  const scope = <T>(run: () => T) => tenantContext.run({ tenantId }, run);
  async function call(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const input = (extra = {}) => ({ firstName: 'Lead', lastName: 'Acceptance', email: `${randomUUID()}@example.test`, status: 'Warm', ...extra });
  async function newAgent() {
    const user = await prisma.user.create({ data: { tenantId, firstName: 'Transfer', lastName: 'Agent', email: `${randomUUID()}@camxian.com`, role: 'Sales', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    await prisma.userRole.create({ data: { tenantId, roleId, userId: user.id } });
    return user;
  }
  async function owned(userId: string) {
    const lead = await prisma.lead.create({ data: { tenantId, ...input(), assignedUserId: userId, createdById: userId } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Contact', lastName: 'Transfer', assignedUserId: userId } });
    const account = await prisma.account.create({ data: { tenantId, name: 'Transfer Account', assignedUserId: userId } });
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Transfer Deal', pipelineId, stageId, assignedUserId: userId, ownerId: userId, value: 123.45 } });
    return { lead, contact, account, deal };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Lead Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    foreignTenant = (await prisma.tenant.create({ data: { name: 'Other', slug: randomUUID() } })).id;
    const admin = await prisma.user.create({ data: { tenantId, firstName: 'Test', lastName: 'Admin', role: 'Client Admin', email: 'admin@camxian.com', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    adminId = admin.id; token = (await issueAuthSession(admin)).token;
    roleId = (await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales' } })).id;
    await prisma.rolePermission.createMany({ data: ['leads','contacts','accounts','deals'].map(module => ({ tenantId, roleId, module, canView: true, canEdit: true, canCreate: true })) });
    agentId = (await newAgent()).id; otherId = (await newAgent()).id;
    const denied = await prisma.user.create({ data: { tenantId, firstName: 'Denied', lastName: 'Test', email: 'denied@camxian.com', role: 'Viewer', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    deniedId = denied.id; deniedToken = (await issueAuthSession(denied)).token;
    foreignId = (await prisma.user.create({ data: { tenantId: foreignTenant, firstName: 'Foreign', lastName: 'Agent', email: 'foreign@camxian.com', role: 'Client Admin' } })).id;
    const pipeline = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    pipelineId = pipeline.pipeline.id; stageId = pipeline.initial.id;
    productId = (await prisma.productInterest.create({ data: { tenantId, name: 'Canonical Product', dealValue: 456.78 } })).id;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });

  it('uses the exact form contract and rejects retired/unknown fields and invalid references', async () => {
    for (const extra of [{ description: 'obsolete' }, { website: 'https://example.test' }, { status: 'New' }, { phone: '123' }, { source: 'Organic' }, { assignedUserId: adminId }, { assignedUserId: foreignId }, { productInterest: [randomUUID()] }]) {
      const result = await call('/crm/leads', 'POST', input(extra)); expect(result.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await call('/crm/leads/not-an-id')).status).toBe(400);
    expect((await call('/crm/leads', 'POST', input(), deniedToken)).status).toBe(403);
  });
  it('creates once, snapshots product price, resolves canonical links and hides internal state', async () => {
    const leadEvent = vi.spyOn(events, 'fireLeadCreated'), dealEvent = vi.spyOn(events, 'fireDealCreated');
    const payload = input({ requestId: randomUUID(), productInterest: [productId], assignedUserId: agentId, address: 'First line\nSecond line' });
    const created = await call('/crm/leads', 'POST', payload); expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ assignedUserId: agentId, productInterestIds: [productId], productInterest: ['Canonical Product'] });
    for (const key of ['description','website','creationKey','productsNormalized','engagementEvaluatedAt']) expect(created.body.data).not.toHaveProperty(key);
    expect((await call('/crm/leads', 'POST', payload)).body.data.id).toBe(id);
    expect(leadEvent).toHaveBeenCalledTimes(1); expect(dealEvent).toHaveBeenCalledTimes(1);
    expect(leadEvent.mock.calls[0][0].lead.assignedUserId).toBe(agentId);
    leadEvent.mockRestore(); dealEvent.mockRestore();
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: id, action: 'lead.created' } })).toBe(1);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: id } } } })).toBe(1);
    await prisma.$executeRaw`UPDATE "Lead" SET "productInterest"=ARRAY[]::text[],"productInterestIds"=ARRAY[]::text[] WHERE id=${id}`;
    expect((await call(`/crm/leads/${id}`)).body.data.productInterestIds).toEqual([productId]);
    await prisma.productInterest.update({ where: { id: productId }, data: { dealValue: 999 } });
    await call(`/crm/leads/${id}`, 'PUT', { productInterest: [] });
    expect(Number((await prisma.deal.findFirstOrThrow({ where: { tenantId, leadDeals: { some: { leadId: id } } } })).value)).toBe(456.78);
  });
  it('clears optional form values, rejects archived edits and preserves archive/restore history', async () => {
    const created = await call('/crm/leads', 'POST', input({ companyName: 'Old', phone: '+639123456789', source: 'Website', address: 'Old', assignedUserId: agentId }));
    const id = created.body.data.id;
    expect((await call(`/crm/leads/${id}`, 'PUT', { companyName: '', phone: '', source: '', address: '', assignedUserId: null, accountId: null })).status).toBe(200);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id } })).toMatchObject({ companyName: '', phone: '', address: '', assignedUserId: null, accountId: null });
    expect((await call(`/crm/leads/${id}/archive`, 'PATCH')).status).toBe(200);
    expect((await call(`/crm/leads/${id}`, 'PUT', { firstName: 'Invalid' })).status).toBe(404);
    for (const path of [`/crm/leads/${id}`, `/crm/leads/${id}/relationships`, `/crm/leads/${id}/files`, `/crm/leads/${id}/custom-fields`, `/crm/activities?leadId=${id}`]) expect((await call(path)).status, path).toBe(404);
    expect((await call(`/crm/leads/${id}/restore`, 'PATCH')).status).toBe(200);
    expect((await call(`/crm/leads/${id}`)).status).toBe(200);
  });
  it('applies presence, touch and My Leads filters before pagination with global counts', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 4; i++) await prisma.lead.create({ data: { tenantId, ...input(), companyName: 'FacetProbe', assignedUserId: i === 0 ? adminId : agentId, phone: i < 2 ? '+639123456789' : null, createdAt: now, updatedAt: i === 3 ? new Date('2026-01-02T00:00:00Z') : now } });
    const page = await call('/crm/leads?search=FacetProbe&limit=1&filter[related]=in:has_phone');
    expect(page.body.meta.total).toBe(2); expect(page.body.data).toHaveLength(1); expect(page.body.facets.has_phone).toBe(2);
    expect((await call('/crm/leads?search=FacetProbe&filter[system]=in:untouched')).body.meta.total).toBe(3);
    expect((await call('/crm/leads?search=FacetProbe&filter[system]=in:touched')).body.meta.total).toBe(1);
    expect((await call(`/crm/leads?search=FacetProbe&filter[scope]=equals:my&currentUserId=${agentId}`)).body.data.map((row: { assignedUserId: string }) => row.assignedUserId)).toEqual([adminId]);
  });
  it('preflights without writing and rejects missing, self, foreign, admin and guest replacements', async () => {
    const target = await newAgent(); await owned(target.id);
    const impact = await call(`/administration/users/${target.id}/deactivation-impact`);
    expect(impact.body.data).toMatchObject({ total: 4, counts: { leads: 1, contacts: 1, accounts: 1, deals: 1 } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
    for (const replacementAgentId of [undefined, target.id, foreignId, adminId, deniedId]) {
      expect((await call(`/administration/users/${target.id}/deactivate`, 'POST', { replacementAgentId })).status).toBe(409);
    }
    expect((await call(`/administration/users/${target.id}/deactivate`, 'POST', { replacementAgentId: agentId }, deniedToken)).status).toBe(403);
    expect((await call(`/administration/users/${adminId}/deactivate`, 'POST', {})).status).toBe(403);
    expect((await call(`/administration/users/${foreignId}/deactivation-impact`)).status).toBe(404);
    expect((await call(`/administration/users/${target.id}`, 'PUT', { status: 'INACTIVE' })).status).toBe(409);
    expect((await call(`/administration/users/${target.id}/archive`, 'PATCH')).status).toBe(409);
    expect((await call('/administration/users/bulk-update', 'POST', { ids: [target.id], status: 'INACTIVE' })).status).toBe(409);
    const unavailable = await newAgent();
    expect((await call(`/administration/users/${unavailable.id}/deactivate`, 'POST', {})).status).toBe(200);
    expect((await call(`/administration/users/${target.id}/deactivate`, 'POST', { replacementAgentId: unavailable.id })).status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
  });
  it('atomically transfers all active modules, retains historic actors and revokes sessions', async () => {
    const target = await newAgent(), records = await owned(target.id);
    const sessionToken = (await issueAuthSession(target)).token;
    const archived = await prisma.lead.create({ data: { tenantId, ...input(), assignedUserId: target.id, isArchived: true } });
    const converted = await prisma.lead.create({ data: { tenantId, ...input(), assignedUserId: target.id, convertedAt: new Date(), convertedById: target.id } });
    const beforeWorkflow = await prisma.workflowExecutionRun.count({ where: { tenantId } });
    const workflow = await scope(() => createWorkflow(tenantId, adminId, { name: 'Transfer must not trigger normal updates', trigger: 'lead.updated', isActive: true,
      actions: [{ type: 'update_field', config: { field: 'companyName', value: 'Unwanted automation' } }] }));
    const permissions = { leadsView: true, contactsView: true, leadsEdit: true, contactsEdit: true, dealsView: true, dealsEdit: true };
    const mailbox = (userId: string) => ({ id: randomUUID(), tenantId, userId, email: 'mailbox@example.test' } as EmailAccount);
    expect((await resolveMailboxScope(mailbox(target.id), permissions)).leadIds).toContain(records.lead.id);
    const spies = (['fireLeadUpdated','fireContactUpdated','fireAccountUpdated','fireDealUpdated'] as const).map(key => vi.spyOn(events, key));
    const result = await call(`/administration/users/${target.id}/deactivate`, 'POST', { replacementAgentId: otherId });
    expect(result.status).toBe(200); expect(result.body.data.impact.total).toBe(4);
    for (const [kind, record] of Object.entries(records)) {
      const row = await (prisma[kind as 'lead'] as typeof prisma.lead).findUniqueOrThrow({ where: { id: record.id } });
      expect(row.assignedUserId).toBe(otherId);
      expect(await prisma.activity.count({ where: { tenantId, [`${kind}Id`]: record.id, metadata: { path: ['reason'], equals: 'user_deactivation' } } })).toBe(1);
    }
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: records.lead.id } })).createdById).toBe(target.id);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: records.deal.id } })).ownerId).toBe(otherId);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: archived.id } })).assignedUserId).toBe(target.id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: converted.id } })).convertedById).toBe(target.id);
    expect(await prisma.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    expect((await call('/crm/leads', 'GET', undefined, sessionToken)).status).toBe(401);
    expect(await prisma.workflowExecutionRun.count({ where: { tenantId } })).toBe(beforeWorkflow);
    expect((await resolveMailboxScope(mailbox(otherId), permissions)).leadIds).toContain(records.lead.id);
    expect((await resolveMailboxScope(mailbox(target.id), permissions)).leadIds).not.toContain(records.lead.id);
    await prisma.workflow.update({ where: { id: workflow.id }, data: { isActive: false } });
    for (const spy of spies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
    expect((await call(`/administration/users/${target.id}/deactivate`, 'POST', { replacementAgentId: otherId })).status).toBe(409);
  });
  it('rolls back every transfer and session revocation when any module fails', async () => {
    const target = await newAgent(), records = await owned(target.id); await issueAuthSession(target);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION acceptance_fail_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${records.account.id}' THEN RAISE EXCEPTION 'Acceptance rollback'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER acceptance_fail_transfer BEFORE UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION acceptance_fail_transfer()');
    try { await expect(scope(() => deactivateUser(target.id, tenantId, adminId, agentId))).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER acceptance_fail_transfer ON "Account"'); await prisma.$executeRawUnsafe('DROP FUNCTION acceptance_fail_transfer()'); }
    for (const [kind, record] of Object.entries(records)) expect((await (prisma[kind as 'lead'] as typeof prisma.lead).findUniqueOrThrow({ where: { id: record.id } })).assignedUserId).toBe(target.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
    expect(await prisma.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: target.id, action: 'user.deactivated_with_reassignment' } })).toBe(0);
  });
  it('guards direct deactivation and refuses assigning or restoring active records to inactive users', async () => {
    const target = await newAgent(); await owned(target.id);
    await expect(prisma.$transaction(tx => tx.user.update({ where: { id: target.id }, data: { status: 'INACTIVE' } }))).rejects.toThrow();
    const empty = await newAgent();
    expect((await call(`/administration/users/${empty.id}/deactivate`, 'POST', {})).status).toBe(200);
    await expect(prisma.$transaction(tx => tx.lead.create({ data: { tenantId, ...input(), assignedUserId: empty.id } }))).rejects.toThrow();
    const archived = await prisma.lead.create({ data: { tenantId, ...input(), assignedUserId: empty.id, isArchived: true } });
    await expect(prisma.$transaction(tx => tx.lead.update({ where: { id: archived.id }, data: { isArchived: false } }))).rejects.toThrow();
    expect((await call(`/crm/leads/${archived.id}/restore`, 'PATCH')).status).toBe(409);
  });
  it('serializes a simultaneous assignment and deactivation without orphaning a Lead', async () => {
    const target = await newAgent();
    const lead = await prisma.lead.create({ data: { tenantId, ...input() } });
    await Promise.allSettled([
      scope(() => deactivateUser(target.id, tenantId, adminId, otherId)),
      salesTransaction(async tx => { await tx.lead.update({ where: { id: lead.id }, data: { assignedUserId: target.id } }); }),
    ]);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const assigned = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(current.status === 'ACTIVE' || assigned.assignedUserId !== target.id).toBe(true);
  });
  it('transfers across multiple bounded batches without changing historical actors', async () => {
    const target = await newAgent();
    await prisma.lead.createMany({ data: Array.from({ length: 505 }, () => ({ tenantId, ...input(), assignedUserId: target.id, createdById: target.id })) });
    const result = await scope(() => deactivateUser(target.id, tenantId, adminId, otherId));
    expect(result.counts.leads).toBe(505);
    expect(await prisma.lead.count({ where: { tenantId, createdById: target.id, assignedUserId: otherId } })).toBe(505);
    expect(await prisma.activity.count({ where: { tenantId, lead: { createdById: target.id }, metadata: { path: ['reason'], equals: 'user_deactivation' } } })).toBe(505);
  }, 30000);
  it('merges without losing custom values or allowing repeated merges', async () => {
    const a = await prisma.lead.create({ data: { tenantId, ...input() } }), b = await prisma.lead.create({ data: { tenantId, ...input() } });
    const fieldId = randomUUID();
    await prisma.closingFieldDefinition.create({ data: { tenantId, id: fieldId, definition: { id: fieldId, module: 'leads', active: false } } });
    await prisma.customFieldValue.create({ data: { tenantId, leadId: b.id, fieldId, module: 'leads', value: 'Preserve exact history' } });
    const result = await scope(() => merge({ tenantId, userId: adminId, entityType: 'lead', primaryId: a.id, secondaryId: b.id, fieldResolutions: {} }));
    expect(result.mergedRecord).not.toHaveProperty('creationKey');
    expect(result.mergedRecord).not.toHaveProperty('productsNormalized');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: b.id } })).isArchived).toBe(true);
    expect(await prisma.customFieldValue.count({ where: { tenantId, fieldId, value: { equals: 'Preserve exact history' } } })).toBe(2);
    await expect(scope(() => merge({ tenantId, userId: adminId, entityType: 'lead', primaryId: a.id, secondaryId: b.id, fieldResolutions: {} }))).rejects.toThrow();
  });
  it('merges the selected Product IDs even when a catalog name is reused', async () => {
    const name = `Reused ${randomUUID()}`;
    const retired = await prisma.productInterest.create({ data: { tenantId, name, dealValue: 10, active: false } });
    const current = await prisma.productInterest.create({ data: { tenantId, name, dealValue: 20 } });
    const a = await prisma.lead.create({ data: { tenantId, ...input(), productsNormalized: true, productLinks: { create: { productInterestId: current.id } } } });
    const b = await prisma.lead.create({ data: { tenantId, ...input(), productsNormalized: true, productLinks: { create: { productInterestId: retired.id } } } });
    const result = await scope(() => merge({ tenantId, userId: adminId, entityType: 'lead', primaryId: a.id, secondaryId: b.id, fieldResolutions: { productInterest: 'secondary' } }));
    expect(result.mergedRecord.productInterestIds).toEqual([retired.id]);
    expect((await prisma.leadProductInterest.findMany({ where: { leadId: a.id } })).map(link => link.productInterestId)).toEqual([retired.id]);
  });
});
