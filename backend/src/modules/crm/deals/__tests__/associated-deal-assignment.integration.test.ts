import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Prisma } from '@prisma/client';
import { EMPTY_PERMISSION_FLAGS, PERMISSION_MODULES } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import app from '../../../../app';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { runAuthorizedWorkflow } from '../../access/crm-record-access.service';
import { updateContact as updateLead } from '../../contacts/contacts.service';
import { updateContact } from '../../contacts-v2/contacts-v2.service';
import * as email from '../../../../shared/services/email.service';
import * as sms from '../../../../shared/services/sms.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = url.hostname === '127.0.0.1' && url.pathname === '/leadcrm_forms_test_2';
type Module = 'leads' | 'contacts';
type Actor = { id: string; roleId: string; token: string };

describe.skipIf(!disposable)('Associated Deal assignment through authenticated HTTP on disposable PostgreSQL', () => {
  let server: Server, base: string, tenantId: string, foreignTenant: string;
  let admin: Actor, old: Actor, next: Actor, other: Actor, head: Actor, limited: Actor, ineligible: Actor, inactive: Actor;
  let pipelineId: string, stageId: string, wonId: string, lostId: string, productId: string;
  const providers = [vi.spyOn(email, 'sendMail'), vi.spyOn(sms, 'sendSms')];
  const person = async (name: string, clientAdmin = false): Promise<Actor> => {
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: clientAdmin ? 'Client Admin' : `Custom ${name}`,
      isSystemRole: clientAdmin, permissions: { create: ['leads', 'contacts', 'deals', 'accounts', 'archived_data'].map(module => ({
        module, ...EMPTY_PERMISSION_FLAGS,
        ...Object.fromEntries(PERMISSION_MODULES.find(item => item.key === module)!.actions.map(action => [action, true])),
      })) } } });
    const user = await prisma.user.create({ data: { tenantId, role: role.name, firstName: name, lastName: 'Agent',
      email: randomUUID() + '@camxian.com', mustChangePassword: false, onboardingCompletedAt: new Date(),
      userRoles: { create: { roleId: role.id } } } });
    return { id: user.id, roleId: role.id, token: (await issueAuthSession(user)).token };
  };
  const call = async (path: string, method = 'GET', body?: unknown, actor = admin) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const record = async (module: Module, assignedUserId: string | null = old.id) => {
    const data = { tenantId, assignedUserId, firstName: 'Customer', lastName: randomUUID(), email: randomUUID() + '@example.test' };
    return module === 'leads' ? prisma.lead.create({ data }) : prisma.contact.create({ data });
  };
  const link = async (module: Module, id: string, dealId: string) => module === 'leads'
    ? prisma.leadDeal.create({ data: { tenantId, leadId: id, dealId } })
    : prisma.contactDeal.create({ data: { tenantId, contactId: id, dealId } });
  const deal = async (module: Module, id: string, overrides: Partial<Prisma.DealUncheckedCreateInput> = {}) => {
    const row = await prisma.deal.create({ data: { tenantId, assignedUserId: old.id, ownerId: old.id, title: 'Assignment Deal',
      pipelineId, stageId, productInterestId: productId, productsNormalized: true, value: 123.45, ...overrides } });
    await link(module, id, row.id);
    return row;
  };
  const assignmentEvents = (id: string) => prisma.notificationEvent.findMany({ where: { tenantId, entityId: id, eventKey: { startsWith: 'assignment:' } } });
  const snapshot = async () => ({
    leads: await prisma.lead.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    contacts: await prisma.contact.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    deals: await prisma.deal.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    activities: await prisma.activity.count({ where: { tenantId } }), audits: await prisma.auditLog.count({ where: { tenantId } }),
    events: await prisma.notificationEvent.count({ where: { tenantId } }), revisions: await prisma.dashboardRevision.findUnique({ where: { tenantId } }),
    workflows: await prisma.workflowTriggerRecord.count({ where: { tenantId } }),
  });
  const save = (module: Module, id: string, actor = admin, assignedUserId: string | null = next.id) =>
    call(`/crm/${module}/${id}`, 'PUT', { assignedUserId }, actor);

  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Associated assignment', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } })).id;
    foreignTenant = (await prisma.tenant.create({ data: { name: 'Other tenant', slug: randomUUID() } })).id;
    admin = await person('Admin', true); old = await person('Previous'); next = await person('Next'); other = await person('Outside');
    head = await person('Head'); limited = await person('Limited'); ineligible = await person('Ineligible'); inactive = await person('Inactive');
    await prisma.rolePermission.updateMany({ where: { roleId: ineligible.roleId, module: 'deals' }, data: { canEdit: false } });
    await prisma.rolePermission.updateMany({ where: { roleId: limited.roleId, module: 'deals' }, data: { canEdit: false } });
    await prisma.user.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });
    const group = await prisma.tenantGroup.create({ data: { tenantId, name: 'Assignment team' } });
    await prisma.tenantGroupMember.createMany({ data: [old, next, head].map(actor => ({ tenantId, groupId: group.id, userId: actor.id, isHead: actor === head })) });
    const limitedGroup = await prisma.tenantGroup.create({ data: { tenantId, name: 'Limited assignment team' } });
    await prisma.tenantGroupMember.createMany({ data: [old, next, limited].map(actor => ({ tenantId, groupId: limitedGroup.id, userId: actor.id, isHead: actor === limited })) });
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Assignment Pipeline' } })).id;
    stageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0 } })).id;
    wonId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Closed Deal', order: 1, isWon: true } })).id;
    lostId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Cancelled', order: 2, isLost: true } })).id;
    productId = (await prisma.productInterest.create({ data: { tenantId, name: 'Assignment Product', dealValue: 123.45 } })).id;
    for (const trigger of ['lead.updated', 'contact.updated', 'deal.updated', 'deal.stage_changed']) {
      await prisma.workflow.create({ data: { tenantId, name: trigger, trigger, isActive: true, status: 'ACTIVE', actions: [], activatedById: admin.id } });
    }
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(done => server.close(() => done()));
    try { for (const provider of providers) expect(provider).not.toHaveBeenCalled(); }
    finally { vi.restoreAllMocks(); await prisma.$disconnect(); }
  });

  it.each(['leads', 'contacts'] as const)('synchronizes multiple %s Deals, persists rereads and emits each side effect once', async module => {
    const source = await record(module), unrelatedSource = await record(module);
    const rows = await Promise.all([deal(module, source.id), deal(module, source.id)]);
    const unrelated = await deal(module, unrelatedSource.id);
    const foreignPipeline = await prisma.pipeline.create({ data: { tenantId: foreignTenant, name: 'Foreign' } });
    const foreignStage = await prisma.stage.create({ data: { tenantId: foreignTenant, pipelineId: foreignPipeline.id, name: 'Lead', order: 0 } });
    const foreign = await prisma.deal.create({ data: { tenantId: foreignTenant, title: 'Foreign', pipelineId: foreignPipeline.id, stageId: foreignStage.id } });
    const histories = await prisma.dealStageHistory.count({ where: { tenantId } });
    const response = await save(module, source.id, head);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.assignedUserId).toBe(next.id);
    const committed = [];
    for (const row of rows) {
      const saved = await prisma.deal.findUniqueOrThrow({ where: { id: row.id } }); committed.push(saved);
      expect(saved).toEqual({ ...row, assignedUserId: next.id, updatedAt: expect.any(Date) });
      const detail = await call(`/crm/deals/${row.id}`);
      expect(detail.status).toBe(200); expect(detail.body.data.assignedUserId).toBe(next.id);
      expect(detail.body.data.assignedUser.firstName).toBe('Next');
      expect(await assignmentEvents(row.id)).toMatchObject([{ actorId: head.id, ownerId: next.id, payload: {
        previousAssignedUserId: old.id, newAssignedUserId: next.id, previousAssignedName: 'Previous Agent', assignedName: 'Next Agent',
      } }]);
      expect(await prisma.auditLog.count({ where: { entityId: row.id, action: 'deal.updated' } })).toBe(1);
      expect(await prisma.activity.findMany({ where: { dealId: row.id, type: 'assignment' } })).toMatchObject([
        { createdById: head.id, metadata: { previousAssignedUserId: old.id, newAssignedUserId: next.id, sourceRecordId: source.id } },
      ]);
      expect(await prisma.workflowTriggerRecord.count({ where: { entityId: row.id } })).toBe(0);
    }
    expect(await prisma.deal.findUnique({ where: { id: unrelated.id } })).toEqual(unrelated);
    expect(await prisma.deal.findUnique({ where: { id: foreign.id } })).toEqual(foreign);
    expect(await prisma.dealStageHistory.count({ where: { tenantId } })).toBe(histories);
    expect((await call(`/crm/${module}/${source.id}`)).body.data.assignedUserId).toBe(next.id);
    expect((await call(`/crm/${module}/${source.id}/relationships`)).body.data.deals.map((row: { id: string }) => row.id).sort()).toEqual(rows.map(row => row.id).sort());
    const list = await call(`/crm/deals?assignedUserId=${next.id}&limit=100`);
    expect(rows.every(row => list.body.data.some((saved: { id: string }) => saved.id === row.id))).toBe(true);
    expect(await prisma.workflowTriggerRecord.count({ where: { entityId: source.id, triggerType: module === 'leads' ? 'lead.updated' : 'contact.updated' } })).toBe(1);
    expect((await save(module, source.id)).status).toBe(200);
    for (const row of committed) {
      expect(await prisma.deal.findUnique({ where: { id: row.id } })).toEqual(row);
      expect(await assignmentEvents(row.id)).toHaveLength(1);
      expect(await prisma.activity.count({ where: { dealId: row.id, type: 'assignment' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: row.id, action: 'deal.updated' } })).toBe(1);
    }
    expect(await prisma.workflowTriggerRecord.count({ where: { entityId: source.id } })).toBe(1);
  });

  it.each(['leads', 'contacts'] as const)('supports %s with zero Deals and an initially unassigned pair', async module => {
    const empty = await record(module);
    expect((await save(module, empty.id)).status).toBe(200);
    const source = await record(module, null), row = await deal(module, source.id, { assignedUserId: null });
    expect((await save(module, source.id)).status).toBe(200);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: row.id } })).assignedUserId).toBe(next.id);
  });

  it.each(['leads', 'contacts'] as const)('includes won/lost %s Deals and ignores archived/deleted Deals', async module => {
    const source = await record(module);
    const terminal = [await deal(module, source.id, { stageId: wonId, closedAt: new Date(), revenueOwnerId: old.id, revenueOwnerEligible: true }),
      await deal(module, source.id, { stageId: lostId, closedAt: new Date(), lostReason: 'Historical reason' })];
    const excluded = [await deal(module, source.id, { isArchived: true, deletedAt: new Date(), assignedUserId: other.id }),
      await deal(module, source.id, { deletedAt: new Date(), assignedUserId: other.id })];
    const result = await save(module, source.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    for (const row of terminal) expect(await prisma.deal.findUnique({ where: { id: row.id } })).toEqual({ ...row, assignedUserId: next.id, updatedAt: expect.any(Date) });
    for (const row of excluded) expect(await prisma.deal.findUnique({ where: { id: row.id } })).toEqual(row);
  });

  it.each((['leads', 'contacts'] as const).flatMap(module => ['leads', 'contacts', 'independent'].map(conflict => ({ module, conflict }))))('rejects $module with $conflict ownership before saving anything', async ({ module, conflict }) => {
    const source = await record(module);
    await deal(module, source.id);
    const row = await deal(module, source.id, conflict === 'independent' ? { assignedUserId: other.id } : {});
    if (conflict !== 'independent') await link(conflict as Module, (await record(conflict as Module)).id, row.id);
    const before = await snapshot();
    const result = await save(module, source.id);
    expect(result.status).toBe(409); expect(result.body.error).toContain('shared or independently assigned');
    expect(await snapshot()).toEqual(before);
  });

  it('collapses confirmed conversion links into one Contact customer and updates each Deal only once', async () => {
    const lead = await record('leads'), row = await deal('leads', lead.id);
    const result = await call(`/crm/leads/${lead.id}/convert`, 'POST', {});
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const converted = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const secondLead = await prisma.lead.create({ data: { tenantId, firstName: 'Historical', lastName: 'Conversion',
      contactId: converted.contactId, convertedAt: new Date(), assignedUserId: old.id } });
    await link('leads', secondLead.id, row.id);
    expect((await save('contacts', converted.contactId!)).status).toBe(200);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: row.id } })).assignedUserId).toBe(next.id);
    expect(await prisma.leadDeal.count({ where: { dealId: row.id } })).toBe(2);
    expect(await prisma.contactDeal.count({ where: { dealId: row.id } })).toBe(1);
    expect(await assignmentEvents(row.id)).toHaveLength(1);
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toEqual(converted);
  });

  it.each(['leads', 'contacts'] as const)('keeps unrelated %s edits and unchanged assignments working with conflicting Deals', async module => {
    const source = await record(module), row = await deal(module, source.id, { assignedUserId: other.id });
    await link(module, (await record(module)).id, row.id);
    expect((await call(`/crm/${module}/${source.id}`, 'PUT', { address: 'Updated address' })).status).toBe(200);
    expect((await save(module, source.id, admin, old.id)).status).toBe(200);
    expect(await prisma.deal.findUnique({ where: { id: row.id } })).toEqual(row);
    expect(await assignmentEvents(row.id)).toHaveLength(0);
  });

  it('rejects an unconfirmed conversion link even when contactId matches', async () => {
    const source = await record('contacts'), row = await deal('contacts', source.id);
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Unconfirmed', lastName: 'Conversion', contactId: source.id } });
    await link('leads', lead.id, row.id);
    const before = await snapshot();
    expect((await save('contacts', source.id)).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });

  it.each((['leads', 'contacts'] as const).flatMap(module => ['inactive', 'ineligible', 'foreign', 'missing'].map(target => ({ module, target }))))('rejects $target target for $module atomically', async ({ module, target }) => {
    const source = await record(module); await deal(module, source.id);
    const foreign = await prisma.user.create({ data: { tenantId: foreignTenant, role: 'Sales', email: randomUUID() + '@camxian.com', firstName: 'Foreign', lastName: 'Agent' } });
    const id = { inactive: inactive.id, ineligible: ineligible.id, foreign: foreign.id, missing: randomUUID() }[target]!;
    const before = await snapshot();
    expect([400, 404]).toContain((await save(module, source.id, admin, id)).status);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['leads', 'contacts'] as const)('rejects unauthorized %s actors, Deal permission loss and outside targets', async module => {
    const source = await record(module); await deal(module, source.id);
    const before = await snapshot();
    expect((await save(module, source.id, old)).status).toBe(403);
    expect((await save(module, source.id, limited)).status).toBe(403);
    expect((await save(module, source.id, head, other.id)).status).toBe(403);
    expect(await snapshot()).toEqual(before);
    await prisma.rolePermission.updateMany({ where: { roleId: limited.roleId, module: 'deals' }, data: { canView: false } });
    const revoked = await snapshot();
    try {
      expect([403, 404]).toContain((await save(module, source.id, limited)).status);
      expect(await snapshot()).toEqual(revoked);
    }
    finally { await prisma.rolePermission.updateMany({ where: { roleId: limited.roleId, module: 'deals' }, data: { canView: true } }); }
    const hidden = await deal(module, source.id, { assignedUserId: other.id, title: 'Do not disclose this Deal' });
    const hiddenBefore = await snapshot();
    const result = await save(module, source.id, head);
    expect(result.status).toBe(404); expect(JSON.stringify(result.body)).not.toContain(hidden.title);
    expect(await snapshot()).toEqual(hiddenBefore);
  });

  it.each(['leads', 'contacts'] as const)('rolls back %s, all Deals, revisions and outbox when the second Deal audit fails', async module => {
    const source = await record(module), rows = [await deal(module, source.id), await deal(module, source.id)].sort((a, b) => a.id.localeCompare(b.id));
    const constraint = 'fixture_assignment_' + randomUUID().replaceAll('-', '');
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "${constraint}" CHECK ("entityId" IS DISTINCT FROM '${rows[1].id}') NOT VALID`);
    const before = await snapshot();
    try { expect((await save(module, source.id)).status).toBe(500); expect(await snapshot()).toEqual(before); }
    finally { await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT "${constraint}"`); }
    expect((await save(module, source.id)).status).toBe(200);
  });

  it.each(['leads', 'contacts'] as const)('preserves %s clearing and authorized Workflow assignment behavior', async module => {
    const source = await record(module), row = await deal(module, source.id);
    expect((await save(module, source.id, admin, null)).status).toBe(200);
    expect(await prisma.deal.findUnique({ where: { id: row.id } })).toEqual(row);
    const workflowSource = await record(module), workflowDeal = await deal(module, workflowSource.id);
    await tenantContext.run({ tenantId }, () => runAuthorizedWorkflow(tenantId, randomUUID(), () => module === 'leads'
      ? updateLead(workflowSource.id, tenantId, admin.id, { assignedUserId: next.id })
      : updateContact(workflowSource.id, tenantId, { assignedUserId: next.id }, admin.id), admin.id));
    expect(await prisma.deal.findUnique({ where: { id: workflowDeal.id } })).toEqual(workflowDeal);
  });

  it.each(['leads', 'contacts'] as const)('serializes competing %s reassignments without duplicate assignment events', async module => {
    const source = await record(module), rows = [await deal(module, source.id), await deal(module, source.id)];
    const results = await Promise.all([save(module, source.id), save(module, source.id)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    for (const row of rows) {
      expect((await prisma.deal.findUniqueOrThrow({ where: { id: row.id } })).assignedUserId).toBe(next.id);
      expect(await assignmentEvents(row.id)).toHaveLength(1);
    }
  });

  it('serializes a concurrent association change and rejects subsequent shared ownership', async () => {
    const source = await record('leads'), extra = await record('contacts'), row = await deal('leads', source.id);
    const [assignment, association] = await Promise.all([
      save('leads', source.id), call(`/crm/deals/${row.id}`, 'PUT', { contactIds: [extra.id] }),
    ]);
    expect(association.status, JSON.stringify(association.body)).toBe(200);
    expect([200, 409]).toContain(assignment.status);
    const saved = await prisma.deal.findUniqueOrThrow({ where: { id: row.id } });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: source.id } })).assignedUserId).toBe(saved.assignedUserId);
    const before = await snapshot();
    expect((await save('leads', source.id, admin, saved.assignedUserId === next.id ? old.id : next.id)).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });
});
