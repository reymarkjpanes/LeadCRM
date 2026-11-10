import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EMPTY_PERMISSION_FLAGS, type WorkflowAction } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { crmActor, runAuthorizedWorkflow, assertCrmRecordRead } from '../../../crm/access/crm-record-access.service';
import { assignmentCandidates, assignmentWorkloads } from '../../assignment/workflow-assignment.repository';
import { updateContact as updateLead } from '../../../crm/contacts/contacts.service';
import { fireWorkflowTrigger } from '../workflow.engine';
import * as workflows from '../workflows.service';
import * as dealTargets from '../../actions/action-deal-targets';

const provider = vi.hoisted(() => ({ beforeWrite: vi.fn(), submitted: vi.fn(), emailSubmitted: vi.fn() }));
vi.mock('../../../../shared/services/sms.service', async original => ({
  ...await original<object>(),
  sendSms: vi.fn(async (_phone: string, _message: string, options: { beforeProviderWrite?: () => Promise<void> }) => {
    await provider.beforeWrite();
    await options.beforeProviderWrite?.();
    provider.submitted();
    return { submitted: true, messageId: 'fixture-sms', status: 'pending' };
  }),
}));
vi.mock('../../../../integrations/gmail/gmail.service', async original => ({
  ...await original<object>(),
  sendEmail: vi.fn(async (...args: unknown[]) => {
    await provider.beforeWrite();
    await (args[8] as { beforeProviderWrite?: () => Promise<void> }).beforeProviderWrite?.();
    provider.emailSubmitted();
    return { messageId: 'fixture-email', threadId: 'fixture-thread' };
  }),
}));

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
if (process.env.LEADCRM_QA_RUN === '1' && !disposable) throw new Error('Workflow authority tests require disposable native PostgreSQL.');

describe.skipIf(!disposable)('Workflow final authority, owner scope and assignment evidence', () => {
  type Person = { id: string; roleId: string };
  let tenantId: string, alice: Person, ana: Person, alex: Person, ben: Person, groupId: string, stageId: string, pipelineId: string;
  const scope = <T>(user: Person, work: () => PromiseLike<T>) => tenantContext.run({ tenantId },
    () => crmActor.run({ tenantId, userId: user.id, readRecords: true }, async () => await work()));
  const lead = (owner: Person) => prisma.lead.create({ data: { tenantId, assignedUserId: owner.id, firstName: 'Fixture', lastName: randomUUID(), email: `${randomUUID()}@recipient.test`, phone: '+639171234567' } });
  const create = (user: Person, trigger: string, actions: WorkflowAction[]) => scope(user, () => workflows.createWorkflow(tenantId, user.id, { name: randomUUID(), trigger, isActive: true, actions }));
  const fire = (user: Person, entity: 'lead' | 'deal', id: string) => scope(user, () => fireWorkflowTrigger({ tenantId, actorId: user.id,
    entityType: entity, entityId: id, triggerType: `${entity}.created`, eventId: randomUUID(), context: {} }));
  const history = (workflowId: string) => prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, workflowId }, include: { steps: { orderBy: { stepIndex: 'asc' } } } });
  const assign = (id: string): WorkflowAction => ({ type: 'assign_owner', config: { assignmentTarget: { type: 'user', id } } });
  const sms: WorkflowAction = { type: 'send_sms', config: { recipient: 'record', message: 'Fixture notification' } };
  async function person(name: string): Promise<Person> {
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: `Authority ${name}`, permissions: { create: [
      { module: 'workflows', ...EMPTY_PERMISSION_FLAGS, canView: true, canViewRuns: true, canCreate: true, canActivate: true, canExecute: true },
      ...['leads', 'deals'].map(module => ({ module, ...EMPTY_PERMISSION_FLAGS, canView: true, canViewAll: true, canEdit: true })),
      { module: 'tasks', ...EMPTY_PERMISSION_FLAGS, canView: true, canCreate: true, canAssign: true },
      { module: 'campaigns', ...EMPTY_PERMISSION_FLAGS, canView: true, canSend: true },
      ...['users', 'roles', 'groups'].map(module => ({ module, ...EMPTY_PERMISSION_FLAGS, canView: true })),
    ] } } });
    const user = await prisma.user.create({ data: { tenantId, role: role.name, firstName: name, lastName: 'Authority QA',
      email: `${randomUUID()}@camxian.com`, mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date(), userRoles: { create: { roleId: role.id } } } });
    return { id: user.id, roleId: role.id };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow authority fixture', slug: randomUUID(), status: 'ACTIVE', onboardingCompletedAt: new Date() } })).id;
    alice = await person('Alice'); ana = await person('Ana'); alex = await person('Alex'); ben = await person('Ben');
    for (const owner of [ana, alice]) {
      const sender = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      await prisma.emailAccount.create({ data: { tenantId, userId: owner.id, email: sender.email, accessToken: 'fixture-only', scopes: ['gmail.send'] } });
    }
    groupId = (await prisma.tenantGroup.create({ data: { tenantId, name: 'Authority Group A', members: { create: [
      { userId: alice.id, isHead: true }, { userId: ana.id }, { userId: alex.id },
    ] } } })).id;
    await prisma.tenantGroup.create({ data: { tenantId, name: 'Authority Group B', members: { create: { userId: ben.id, isHead: true } } } });
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Authority pipeline' } })).id;
    stageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0 } })).id;
  }, 60000);
  beforeEach(async () => {
    vi.clearAllMocks(); provider.beforeWrite.mockResolvedValue(undefined);
    vi.stubEnv('TEXTBEE_API_KEY', 'fixture-only'); vi.stubEnv('TEXTBEE_DEVICE_ID', '');
    await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false, status: 'PAUSED' } });
    await prisma.rolePermission.update({ where: { roleId_module: { roleId: ana.roleId, module: 'campaigns' } }, data: { canSend: true } });
    await prisma.rolePermission.update({ where: { roleId_module: { roleId: ana.roleId, module: 'workflows' } }, data: { canActivate: true } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('permits a Lead SMS publisher without unrelated Contact grants', async () => {
    const record = await lead(ana);
    const saved = await create(ana, 'lead.created', [sms]);
    await fire(ana, 'lead', record.id);
    expect(provider.submitted).toHaveBeenCalledOnce();
    expect(await history(saved.id)).toMatchObject({ status: 'completed', steps: [{ status: 'success' }] });
  });

  it.each(['campaigns', 'workflows'])('rechecks %s authority after message preparation and before provider submission', async module => {
    const record = await lead(ana);
    const saved = await create(ana, 'lead.created', [sms]);
    provider.beforeWrite.mockImplementationOnce(() => prisma.rolePermission.update({ where: { roleId_module: { roleId: ana.roleId, module } },
      data: module === 'campaigns' ? { canSend: false } : { canActivate: false } }));
    await fire(ana, 'lead', record.id);
    expect(provider.submitted).not.toHaveBeenCalled();
    expect(await history(saved.id)).toMatchObject({ status: 'failed', errorMessage: 'Access denied', steps: [{ status: 'failed' }] });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: record.id } })).toMatchObject({ assignedUserId: ana.id });
  });

  it('preserves the authorization failure when Gmail admission rejects a revoked publisher', async () => {
    const record = await lead(ana);
    const saved = await create(ana, 'lead.created', [{ type: 'send_email', config: { recipient: 'record', subject: 'Fixture', body: '<p>Fixture notification</p>' } }]);
    provider.beforeWrite.mockImplementationOnce(() => prisma.rolePermission.update({ where: { roleId_module: { roleId: ana.roleId, module: 'campaigns' } }, data: { canSend: false } }));
    await fire(ana, 'lead', record.id);
    expect(provider.emailSubmitted).not.toHaveBeenCalled();
    expect(await history(saved.id)).toMatchObject({ status: 'failed', errorMessage: 'Access denied' });
    expect(await prisma.emailDeliveryLog.findFirstOrThrow({ where: { tenantId, leadId: record.id } })).toMatchObject({ status: 'failed', errorMessage: 'Access denied' });
  });

  it.each(['send_email', 'send_sms'] as const)('rechecks the %s recipient after ownership or Head scope changes during preparation', async type => {
    // Gmail first requires a sender-owned recipient; CRM Head access alone is insufficient.
    const recipient = await lead(type === 'send_email' ? alice : alex);
    const record = await prisma.deal.create({ data: { tenantId, pipelineId, stageId, title: 'Publisher-owned source', assignedUserId: alice.id,
      leadDeals: { create: { leadId: recipient.id, position: 0 } } } });
    const action: WorkflowAction = { type, config: type === 'send_email'
      ? { recipient: 'primary_lead', subject: 'Fixture', body: '<p>Fixture notification</p>' }
      : { recipient: 'primary_lead', message: 'Fixture notification' } };
    const saved = await create(alice, 'deal.created', [action]);
    const membership = { groupId_userId: { groupId, userId: alice.id } };
    provider.beforeWrite.mockImplementationOnce(async () => {
      if (type === 'send_email') await prisma.lead.update({ where: { id: recipient.id }, data: { assignedUserId: alex.id } });
      await prisma.tenantGroupMember.update({ where: membership, data: { isHead: false } });
    });
    try {
      await fire(alice, 'deal', record.id);
      expect(provider.beforeWrite).toHaveBeenCalledOnce();
      expect(provider.submitted).not.toHaveBeenCalled();
      expect(provider.emailSubmitted).not.toHaveBeenCalled();
      expect(await history(saved.id)).toMatchObject({ status: 'skipped', errorMessage: expect.stringMatching(/The (?:record changed while preparing the action|selected recipient is no longer available)\./) });
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: recipient.id } })).toMatchObject({ assignedUserId: alex.id });
      await expect(scope(alice, () => assertCrmRecordRead(prisma, 'deals', record.id))).resolves.toBeUndefined();
      await expect(scope(alice, () => assertCrmRecordRead(prisma, 'leads', recipient.id))).rejects.toMatchObject({ statusCode: 404 });
    } finally { await prisma.tenantGroupMember.update({ where: membership, data: { isHead: true } }); }
  });

  it('keeps Associate owner candidates personal and Head candidates within supervised Groups', async () => {
    expect((await scope(ana, () => assignmentCandidates(prisma, tenantId, 'crm_owner', 'lead'))).map(user => user.id)).toEqual([ana.id]);
    expect((await scope(alice, () => assignmentCandidates(prisma, tenantId, 'crm_owner', 'lead'))).map(user => user.id).sort()).toEqual([alice.id, ana.id, alex.id].sort());
    await expect(create(ana, 'lead.created', [assign(alex.id)])).rejects.toThrow('active agent');
    await expect(create(alice, 'lead.created', [assign(ben.id)])).rejects.toThrow('active agent');
  });

  it('allows an authorized Head reassignment and preserves subsequent ordered writes', async () => {
    const record = await lead(ana);
    const saved = await create(alice, 'lead.created', [assign(alex.id), { type: 'update_field', config: { field: 'firstName', value: 'Assigned within Group A' } }]);
    await fire(alice, 'lead', record.id);
    expect(await history(saved.id)).toMatchObject({ status: 'completed', steps: [{ status: 'success' }, { status: 'success' }] });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: record.id } })).toMatchObject({ assignedUserId: alex.id, firstName: 'Assigned within Group A' });
  });

  it('takes current Head membership into account without relying on a cached role name', async () => {
    const membership = { groupId_userId: { groupId, userId: alice.id } };
    await prisma.tenantGroupMember.update({ where: membership, data: { isHead: false } });
    try {
      expect((await scope(alice, () => assignmentCandidates(prisma, tenantId, 'crm_owner', 'lead'))).map(user => user.id)).toEqual([alice.id]);
      await expect(create(alice, 'lead.created', [assign(alex.id)])).rejects.toThrow('active agent');
    } finally { await prisma.tenantGroupMember.update({ where: membership, data: { isHead: true } }); }
  });

  it('retains tenant-wide assignment authority for a Client Admin who also heads a Group', async () => {
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', firstName: 'Administrative', lastName: 'Head', email: `${randomUUID()}@camxian.com` } });
    await prisma.tenantGroup.create({ data: { tenantId, name: 'Administrative Group', members: { create: { userId: admin.id, isHead: true } } } });
    const ids = (await scope({ id: admin.id, roleId: '' }, () => assignmentCandidates(prisma, tenantId, 'crm_owner', 'lead'))).map(user => user.id);
    expect(ids).toContain(ben.id);
    expect(ids).toContain(alex.id);
    expect(ids).not.toContain(admin.id);
  });

  it('enforces canonical reassignment scope inside CRM transactions even in Workflow system context', async () => {
    const record = await lead(ana);
    await expect(tenantContext.run({ tenantId }, () => runAuthorizedWorkflow(tenantId, randomUUID(),
      () => updateLead(record.id, tenantId, alice.id, { assignedUserId: ben.id }), alice.id))).rejects.toMatchObject({ code: 'CRM_REASSIGNMENT_DENIED' });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: record.id } })).toMatchObject({ assignedUserId: ana.id });
  });

  it('rechecks a related Deal scope before moving it when Head membership changes during preparation', async () => {
    const source = await lead(alice);
    const targetStage = await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Contacted', order: 1 } });
    const target = await prisma.deal.create({ data: { tenantId, pipelineId, stageId, title: 'Subordinate-owned target', assignedUserId: alex.id,
      leadDeals: { create: { leadId: source.id, position: 0 } } } });
    const historiesBefore = await prisma.dealStageHistory.count({ where: { tenantId, dealId: target.id } });
    const saved = await create(alice, 'lead.created', [{ type: 'move_deal_stage', config: { stageId: targetStage.id, currentStageId: stageId, targetMode: 'single_match' } }]);
    const membership = { groupId_userId: { groupId, userId: alice.id } };
    const resolve = dealTargets.resolveDealTargets;
    const preparation = vi.spyOn(dealTargets, 'resolveDealTargets').mockImplementation(async (...args) => {
      const ids = await resolve(...args);
      await prisma.tenantGroupMember.update({ where: membership, data: { isHead: false } });
      return ids;
    });
    try {
      await fire(alice, 'lead', source.id);
      expect(await history(saved.id)).toMatchObject({ status: 'skipped', errorMessage: 'The target Deal is no longer available.' });
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ stageId });
      expect(await prisma.dealStageHistory.count({ where: { tenantId, dealId: target.id } })).toBe(historiesBefore);
      await expect(scope(alice, () => assertCrmRecordRead(prisma, 'leads', source.id))).resolves.toBeUndefined();
    } finally {
      preparation.mockRestore();
      await prisma.tenantGroupMember.update({ where: membership, data: { isHead: true } });
    }
  });

  it('counts hidden Task workload for eligible handoff candidates without granting Task visibility', async () => {
    const privateTask = await prisma.task.create({ data: { tenantId, assignedUserId: alex.id, createdById: alice.id, title: 'Private capacity fixture', dueDate: new Date(), status: 'pending' } });
    expect(await scope(ana, () => prisma.task.findFirst({ where: { id: privateTask.id, tenantId } }))).toBeNull();
    const counts = await tenantContext.run({ tenantId }, () => runAuthorizedWorkflow(tenantId, randomUUID(),
      () => assignmentWorkloads(prisma, tenantId, [alex.id], 'task_assignee'), ana.id));
    expect(counts.get(alex.id)).toBeGreaterThanOrEqual(1);
    expect(await scope(ana, () => prisma.task.findFirst({ where: { id: privateTask.id, tenantId } }))).toBeNull();
    const record = await prisma.deal.create({ data: { tenantId, pipelineId, stageId, title: 'Task handoff source', assignedUserId: ana.id } });
    const saved = await create(ana, 'deal.created', [{ type: 'create_task', config: { title: 'Authorized peer handoff', assignedUserId: alex.id } }]);
    await fire(ana, 'deal', record.id);
    const run = await history(saved.id);
    expect(run.status).toBe('completed');
    const output = run.steps[0].output as { taskId: string };
    expect(await prisma.task.findUniqueOrThrow({ where: { id: output.taskId } })).toMatchObject({ assignedUserId: alex.id, createdById: ana.id });
    await expect(scope(ana, () => assertCrmRecordRead(prisma, 'deals', record.id))).resolves.toBeUndefined();
    expect(await scope(ana, () => prisma.task.findFirst({ where: { id: output.taskId, tenantId } }))).toBeNull();
  });

  it('uses hidden candidate workloads in both capacity previews and execution', async () => {
    await prisma.task.createMany({ data: [ana, alex, alice].map(user => ({ tenantId, assignedUserId: user.id,
      createdById: alice.id, title: 'Capacity evidence fixture', dueDate: new Date(), status: 'pending' })) });
    const record = await prisma.deal.create({ data: { tenantId, pipelineId, stageId, title: 'Capacity source', assignedUserId: ana.id } });
    const saved = await create(ana, 'deal.created', [{ type: 'create_task', config: { title: 'Must respect capacity', assignmentTarget: {
      type: 'group', id: groupId, strategy: 'round_robin', capacity: { maxPerMember: 1, members: [] },
    } } }]);
    const before = await prisma.task.count({ where: { tenantId } });
    const preview = await scope(ana, () => workflows.testWorkflow(saved.id, tenantId, record.id, ana.id));
    expect(preview.valid).toBe(false);
    expect(preview.actions[0]).toMatchObject({ status: 'failed', message: expect.stringContaining('below their configured capacity') });
    await fire(ana, 'deal', record.id);
    expect(await history(saved.id)).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('below their configured capacity') });
    expect(await prisma.task.count({ where: { tenantId } })).toBe(before);
  });

  it('rejects cross-tenant candidates at the narrow workload boundary', async () => {
    const foreignTenant = await prisma.tenant.create({ data: { name: 'Foreign authority fixture', slug: randomUUID() } });
    const foreign = await prisma.user.create({ data: { tenantId: foreignTenant.id, role: 'Foreign staff', firstName: 'Foreign', lastName: 'Candidate', email: `${randomUUID()}@camxian.com` } });
    await expect(tenantContext.run({ tenantId }, () => runAuthorizedWorkflow(tenantId, randomUUID(),
      () => assignmentWorkloads(prisma, tenantId, [foreign.id], 'task_assignee'), ana.id))).rejects.toMatchObject({ statusCode: 403 });
  });
});
