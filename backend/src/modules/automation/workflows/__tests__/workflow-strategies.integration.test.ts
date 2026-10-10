import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { WorkflowAssignmentTarget, WorkflowAvailability } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import * as workflows from '../workflows.service';
import { fireWorkflowTrigger } from '../workflow.engine';
import { completeWorkflowAssignment, resolveWorkflowAssignee } from '../../assignment/workflow-assignment.service';
import { assignmentWorkloads } from '../../assignment/workflow-assignment.repository';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('workflow assignment methods with real database and domain services', { timeout: 30000 }, () => {
  let tenantId: string, actorId: string, firstId: string, secondId: string, groupId: string, leadId: string, roleId: string, foreignUserId: string;
  const scope = <T>(run: () => T) => tenantContext.run({ tenantId }, run);
  const pool = (strategy: 'round_robin' | 'least_workload' | 'random' | 'availability' | 'capacity' | 'sticky', settings = {}): WorkflowAssignmentTarget => ({ type: 'group', id: groupId, strategy, ...settings });
  const create = (target: WorkflowAssignmentTarget, assignOwner = false) => scope(() => workflows.createWorkflow(tenantId, actorId, { name: `Method ${randomUUID()}`, trigger: 'lead.created', isActive: true, actions: [{ type: assignOwner ? 'assign_owner' : 'create_task', config: { ...(assignOwner ? {} : { title: 'Strategy follow-up' }), assignmentTarget: target } }] }));
  const fire = () => scope(() => fireWorkflowTrigger({ tenantId, actorId, eventId: randomUUID(), triggerType: 'lead.created', entityType: 'lead', entityId: leadId, context: {} }));
  const runs = (workflowId: string) => scope(() => workflows.getWorkflowExecutions(workflowId, tenantId));
  const openTask = (assignedUserId: string, status = 'pending', isArchived = false) => prisma.task.create({ data: { tenantId, assignedUserId, title: 'Existing workload', dueDate: new Date(), status, isArchived } });
  const request = (target: WorkflowAssignmentTarget) => ({ tenantId, workflowId: randomUUID(), actionIndex: 0, purpose: 'task_assignee' as const, target, entity: 'lead' as const, entityId: leadId, recordOwnerId: actorId });
  const onDuty = (): WorkflowAvailability => {
    const hour = new Date().getUTCHours();
    return { timeZone: 'UTC', schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: `${String((hour + 23) % 24).padStart(2, '0')}:00`, end: `${String((hour + 1) % 24).padStart(2, '0')}:00` }, members: [] };
  };
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Assignment method tests', slug: randomUUID() } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, firstName: 'Admin', lastName: 'Tester', email: `${randomUUID()}@camxian.com`, role: 'Client Admin' } })).id;
    const other = await prisma.tenant.create({ data: { name: 'Other tenant', slug: randomUUID() } });
    foreignUserId = (await prisma.user.create({ data: { tenantId: other.id, firstName: 'Foreign', lastName: 'User', role: 'Sales staff', email: `${randomUUID()}@camxian.com` } })).id;
    await scope(async () => {
      roleId = (await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales staff' } })).id;
      await prisma.rolePermission.createMany({ data: ['leads', 'deals', 'tasks'].map(module => ({ tenantId, roleId, module, canView: true, canCreate: true, canEdit: true })) });
      for (const name of ['Alex', 'Sam']) {
        const user = await prisma.user.create({ data: { tenantId, firstName: name, lastName: 'Member', role: 'Sales staff', email: `${randomUUID()}@camxian.com` } });
        await prisma.userRole.create({ data: { tenantId, userId: user.id, roleId } });
        if (name === 'Alex') firstId = user.id; else secondId = user.id;
      }
      groupId = (await prisma.tenantGroup.create({ data: { tenantId, name: 'Assignment team', members: { create: [firstId, secondId].map(userId => ({ userId })) } } })).id;
      leadId = (await prisma.lead.create({ data: { tenantId, firstName: 'Sample', lastName: 'Lead', assignedUserId: actorId } })).id;
    });
  });
  beforeEach(async () => {
    await scope(async () => {
      await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } });
      await prisma.task.updateMany({ where: { tenantId }, data: { status: 'completed' } });
      await prisma.tenantPreference.deleteMany({ where: { tenantId, module: { in: ['workflow-assignment-pending', 'workflow-assignment-sticky', 'workflow-assignment-sticky-pending'] } } });
      await prisma.user.updateMany({ where: { tenantId }, data: { status: 'ACTIVE' } });
      await prisma.lead.update({ where: { id: leadId, tenantId }, data: { assignedUserId: actorId } });
    });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('least workload ignores completed/cancelled/archived tasks, balances real work and retains history', async () => {
    await openTask(firstId); await openTask(secondId, 'completed'); await openTask(secondId, 'cancelled'); await openTask(secondId, 'pending', true);
    const workflow = await create(pool('least_workload'));
    const before = await prisma.tenantPreference.count({ where: { tenantId } });
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, leadId, actorId));
    expect(preview.actions[0].assignment).toMatchObject({ resolvedUserId: secondId, workload: 0, strategy: 'least_workload' });
    expect(await prisma.tenantPreference.count({ where: { tenantId } })).toBe(before);
    await fire();
    const run = (await runs(workflow.id))[0];
    expect(run).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: secondId, workload: 0, strategy: 'least_workload' } }] });
    const output = run.steps[0].output as Prisma.JsonObject;
    expect(await prisma.task.findUniqueOrThrow({ where: { id: output.taskId as string } })).toMatchObject({ assignedUserId: secondId });
    expect(output).not.toHaveProperty('reservation');
    const leases = await prisma.tenantPreference.findMany({ where: { tenantId, module: 'workflow-assignment-pending' } });
    expect(leases.every(row => Array.isArray(row.value) && row.value.length === 0)).toBe(true);
  });
  it('availability uses member overrides, and fails safely when all members are unavailable', async () => {
    const availability = { ...onDuty(), members: [{ userId: firstId, unavailable: true }] };
    const workflow = await create(pool('availability', { availability }));
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: secondId, strategy: 'availability' } }] });
    await scope(() => workflows.updateWorkflow(workflow.id, tenantId, actorId, { actions: [{ type: 'create_task', config: { title: 'Unavailable', assignmentTarget: pool('availability', { availability: { ...availability, members: [firstId, secondId].map(userId => ({ userId, unavailable: true })) } }) } }] }));
    await fire();
    expect((await runs(workflow.id)).some(run => run.status === 'failed' && run.errorMessage?.includes('configured shifts'))).toBe(true);
  });
  it('capacity respects per-member limits and stops assigning when the pool is full', async () => {
    await openTask(firstId);
    const workflow = await create(pool('capacity', { capacity: { maxPerMember: 2, members: [{ userId: firstId, limit: 1 }] } }));
    await fire(); await fire(); await fire();
    const history = await runs(workflow.id);
    expect(history.filter(run => run.status === 'completed')).toHaveLength(2);
    expect(history.find(run => run.status === 'failed')?.errorMessage).toContain('configured capacity');
    expect(await prisma.task.count({ where: { tenantId, assignedUserId: secondId, status: 'pending' } })).toBe(2);
  });
  it('reserves workload across concurrent workflows and releases failed reservations', async () => {
    const input = request(pool('capacity', { capacity: { maxPerMember: 1, members: [] } }));
    const attempts = await scope(() => Promise.allSettled(Array.from({ length: 3 }, () => resolveWorkflowAssignee({ ...input, workflowId: randomUUID() }))));
    const assigned = attempts.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    expect(assigned).toHaveLength(2); expect(new Set(assigned.map(row => row.resolvedUserId)).size).toBe(2);
    await scope(() => completeWorkflowAssignment(tenantId, assigned[0], false));
    expect((await scope(() => resolveWorkflowAssignee(input))).resolvedUserId).toBe(assigned[0].resolvedUserId);
  });
  it('random execution selects only eligible members and explains dry-run sampling', async () => {
    await prisma.user.update({ where: { id: firstId }, data: { status: 'INACTIVE' } });
    const workflow = await create(pool('random'));
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, leadId, actorId));
    expect(preview.actions[0].message).toContain('live execution draws again');
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: secondId, strategy: 'random' } }] });
  });
  it('previews sequential workload changes without creating tasks or consuming capacity', async () => {
    const target = pool('least_workload');
    const workflow = await scope(() => workflows.createWorkflow(tenantId, actorId, { name: 'Sequential preview', trigger: 'lead.created', isActive: true, actions: [0, 1].map(index => ({ type: 'create_task', config: { title: `Task ${index}`, assignmentTarget: target } })) }));
    const before = await prisma.task.count({ where: { tenantId } });
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, leadId, actorId));
    expect(new Set(preview.actions.map(action => action.assignment?.resolvedUserId)).size).toBe(2);
    expect(await prisma.task.count({ where: { tenantId } })).toBe(before);
    await fire();
    expect(new Set((await runs(workflow.id))[0].steps.map(step => (step.output as Prisma.JsonObject).resolvedUserId)).size).toBe(2);
  });
  it('sticky assignment persists across runs and reloads, then falls back if the assignee becomes ineligible', async () => {
    const workflow = await create(pool('sticky', { sticky: { fallback: 'least_workload', preferCurrentOwner: false } }));
    await fire();
    const original = (await runs(workflow.id))[0].steps[0].output as Prisma.JsonObject;
    await fire();
    expect((await runs(workflow.id)).every(run => (run.steps[0].output as Prisma.JsonObject).resolvedUserId === original.resolvedUserId)).toBe(true);
    await prisma.user.update({ where: { id: original.resolvedUserId as string }, data: { status: 'INACTIVE' } });
    await fire();
    expect((await runs(workflow.id)).some(run => (run.steps[0].output as Prisma.JsonObject).resolvedUserId !== original.resolvedUserId)).toBe(true);
  });
  it('sticky can start with the record agent and excludes a reassigned record from its capacity', async () => {
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: firstId } });
    const workflow = await create(pool('sticky', { capacity: { maxPerMember: 1, members: [] }, sticky: { fallback: 'round_robin', preferCurrentOwner: true } }), true);
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: firstId, workload: 0, capacityLimit: 1 } }] });
  });
  it('concurrent sticky executions agree on the initial assignee without remembering failures', async () => {
    const input = request(pool('sticky', { sticky: { fallback: 'round_robin', preferCurrentOwner: false } }));
    const assignments = await scope(() => Promise.all([resolveWorkflowAssignee(input), resolveWorkflowAssignee(input)]));
    expect(new Set(assignments.map(row => row.resolvedUserId)).size).toBe(1);
    await scope(() => Promise.all(assignments.map(row => completeWorkflowAssignment(tenantId, row, false))));
    expect(await prisma.tenantPreference.count({ where: { tenantId, module: 'workflow-assignment-sticky' } })).toBe(0);
  });
  it('rejects foreign override references and malformed settings, including inactive drafts', async () => {
    await expect(create(pool('random', { availability: { ...onDuty(), members: [{ userId: foreignUserId, unavailable: true }] } }))).rejects.toThrow('workspace user');
    await expect(create(pool('capacity', { capacity: { maxPerMember: -1, members: [] } }))).rejects.toThrow();
    await expect(create(pool('availability', { availability: { ...onDuty(), timeZone: 'Not/AZone' } }))).rejects.toThrow();
  });
  it('CRM workload counts active records and ignores the record being reassigned', async () => {
    const extra = await prisma.lead.create({ data: { tenantId, firstName: 'Owned', lastName: 'Lead', assignedUserId: firstId } });
    await prisma.lead.create({ data: { tenantId, firstName: 'Archived', lastName: 'Lead', assignedUserId: secondId, isArchived: true } });
    const counts = await scope(() => assignmentWorkloads(prisma, tenantId, [firstId, secondId], 'crm_owner', 'lead', leadId));
    expect(counts.get(firstId)).toBe(1); expect(counts.get(secondId) ?? 0).toBe(0);
    const workflow = await create(pool('least_workload'), true);
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: secondId } }] });
    await prisma.lead.update({ where: { id: extra.id }, data: { isArchived: true } });
  });
});
