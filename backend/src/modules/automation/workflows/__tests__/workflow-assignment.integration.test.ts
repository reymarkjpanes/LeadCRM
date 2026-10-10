import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { WorkflowAction, WorkflowAssignmentTarget } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import * as workflows from '../workflows.service';
import { fireWorkflowTrigger } from '../workflow.engine';
import { resolveWorkflowAssignee } from '../../assignment/workflow-assignment.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('workflow assignment and history on disposable PostgreSQL', { timeout: 30000 }, () => {
  let tenantId: string, foreignTenant: string, actorId: string, leadId: string, taskUserId: string, salesUserId: string, secondSalesId: string;
  let groupId: string, salesRoleId: string, taskRoleId: string, foreignGroupId: string, foreignRoleId: string, foreignUserId: string, restrictedId: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const target = (type: 'role' | 'group', id: string): Extract<WorkflowAssignmentTarget, { type: 'role' | 'group' }> => ({ type, id, strategy: 'round_robin' });
  const task = (assignmentTarget?: WorkflowAssignmentTarget): WorkflowAction => ({ type: 'create_task', config: { title: 'Pool follow-up', ...(assignmentTarget ? { assignmentTarget } : {}) } });
  const create = (actions: WorkflowAction[]) => scope(() => workflows.createWorkflow(tenantId, actorId, { name: `Assignment ${randomUUID()}`, trigger: 'lead.created', isActive: true, actions }));
  const fire = (eventId = randomUUID()) => scope(() => fireWorkflowTrigger({ tenantId, actorId, eventId, entityType: 'lead', entityId: leadId, triggerType: 'lead.created', context: {} }));
  const runs = (id: string) => scope(() => workflows.getWorkflowExecutions(id, tenantId));
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow pools', slug: randomUUID() } })).id;
    foreignTenant = (await prisma.tenant.create({ data: { name: 'Other workspace', slug: randomUUID() } })).id;
    const user = (role: string, tenant = tenantId) => prisma.user.create({ data: { tenantId: tenant, role, firstName: role, lastName: 'Member', email: `${randomUUID()}@camxian.com` } });
    actorId = (await user('Client Admin')).id;
    taskUserId = (await user('Task staff')).id;
    salesUserId = (await user('Sales')).id;
    secondSalesId = (await user('Sales')).id;
    restrictedId = (await user('Workflow operator')).id;
    foreignUserId = (await user('Client Admin', foreignTenant)).id;
    await scope(async () => {
      const role = (name: string) => prisma.roleDefinition.create({ data: { tenantId, name } });
      salesRoleId = (await role('Sales')).id; taskRoleId = (await role('Task staff')).id;
      await prisma.rolePermission.createMany({ data: [
        ...['leads', 'deals', 'tasks'].map(module => ({ tenantId, roleId: salesRoleId, module, canView: true, canEdit: true })),
        { tenantId, roleId: taskRoleId, module: 'tasks', canView: true },
      ] });
      await prisma.userRole.createMany({ data: [
        { tenantId, userId: taskUserId, roleId: taskRoleId },
        { tenantId, userId: salesUserId, roleId: salesRoleId },
        { tenantId, userId: secondSalesId, roleId: salesRoleId },
      ] });
      const restricted = await role('Workflow operator');
      await prisma.userRole.create({ data: { tenantId, userId: restrictedId, roleId: restricted.id } });
      await prisma.rolePermission.createMany({ data: [
        { tenantId, roleId: restricted.id, module: 'workflows', canView: true, canActivate: true },
        { tenantId, roleId: restricted.id, module: 'leads', canView: true },
        { tenantId, roleId: restricted.id, module: 'tasks', canView: true, canCreate: true, canAssign: true },
      ] });
      groupId = (await prisma.tenantGroup.create({ data: { tenantId, name: 'Follow-up team' } })).id;
      await prisma.tenantGroupMember.createMany({ data: [actorId, taskUserId, salesUserId, secondSalesId].map(userId => ({ tenantId, groupId, userId })) });
      leadId = (await prisma.lead.create({ data: { tenantId, firstName: 'Workflow', lastName: 'Lead', assignedUserId: actorId, productInterest: [] } })).id;
    });
    foreignGroupId = (await prisma.tenantGroup.create({ data: { tenantId: foreignTenant, name: 'Foreign team' } })).id;
    foreignRoleId = (await prisma.roleDefinition.create({ data: { tenantId: foreignTenant, name: 'Foreign role' } })).id;
  });
  beforeEach(async () => {
    await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } });
    await prisma.user.updateMany({ where: { tenantId }, data: { status: 'ACTIVE' } });
    await prisma.roleDefinition.updateMany({ where: { tenantId }, data: { isArchived: false } });
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: actorId } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('returns separate eligibility counts and hides administration options without their permissions', async () => {
    const options = await scope(() => workflows.getOptions(tenantId, actorId));
    expect(options.users.map(user => user.id)).not.toContain(taskUserId);
    expect(options.taskAssignees.map(user => user.id)).toContain(taskUserId);
    expect(options.groups.find(group => group.id === groupId)).toMatchObject({ memberCount: 4, eligibleMemberCounts: { task_assignee: 3, crm_owner: 2 } });
    const hidden = await scope(() => workflows.getOptions(tenantId, restrictedId));
    expect([hidden.users, hidden.taskAssignees, hidden.groups, hidden.roles]).toEqual([[], [], [], []]);
  });
  it.each(['role', 'group'] as const)('rotates %s assignments, preserves one Task owner, deduplicates events, and previews without mutation', async type => {
    const pool = target(type, type === 'role' ? salesRoleId : groupId);
    const workflow = await create([task(pool)]);
    const beforeTasks = await prisma.task.count({ where: { tenantId } });
    const beforeCursor = await prisma.tenantPreference.count({ where: { tenantId, module: 'workflow-assignment' } });
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, leadId, actorId));
    expect(preview.valid).toBe(true);
    expect(preview.actions[0].assignment?.candidateCount).toBe(type === 'role' ? 2 : 3);
    expect(await prisma.task.count({ where: { tenantId } })).toBe(beforeTasks);
    expect(await prisma.tenantPreference.count({ where: { tenantId, module: 'workflow-assignment' } })).toBe(beforeCursor);
    const event = randomUUID(); await fire(event); await fire(event); await fire();
    const history = await runs(workflow.id);
    expect(history).toHaveLength(2);
    expect(history.every(run => run.status === 'completed')).toBe(true);
    const outputs = history.map(run => run.steps[0].output as Prisma.JsonObject);
    expect(new Set(outputs.map(output => output.resolvedUserId)).size).toBe(2);
    for (const output of outputs) {
      expect(output).toMatchObject({ assignmentTargetType: type, assignmentTargetId: pool.id, strategy: 'round_robin' });
      const created = await prisma.task.findUniqueOrThrow({ where: { id: output.taskId as string } });
      expect(created.assignedUserId).toBe(output.resolvedUserId); expect(created.assignedById).toBe(actorId);
      expect(created.assignedUserId).not.toBe(actorId);
    }
  });
  it('uses the current role pool for Assign Agent then resolves current owner for Create Task', async () => {
    const workflow = await create([{ type: 'assign_owner', config: { assignmentTarget: target('role', salesRoleId) } }, task()]);
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, leadId, actorId));
    expect(preview.actions[1].assignment?.resolvedUserId).toBe(preview.actions[0].assignment?.resolvedUserId);
    await fire();
    const history = (await runs(workflow.id))[0];
    expect(history.status).toBe('completed');
    const output = history.steps[0].output as Prisma.JsonObject;
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).assignedUserId).toBe(output.resolvedUserId);
    expect(history.steps[1].output).toMatchObject({ resolvedUserId: output.resolvedUserId });
  });
  it('keeps legacy user assignments working and saves the canonical target shape', async () => {
    const workflow = await create([{ type: 'assign_owner', config: { userId: salesUserId } }, { type: 'create_task', config: { title: 'Legacy', assignedUserId: taskUserId } }]);
    expect(workflow.actions).toMatchObject([{ config: { assignmentTarget: { type: 'user', id: salesUserId } } }, { config: { assignmentTarget: { type: 'user', id: taskUserId } } }]);
    // Simulate an unchanged pre-upgrade stored JSON definition.
    await prisma.workflow.update({ where: { id: workflow.id }, data: { actions: [{ type: 'assign_owner', config: { userId: salesUserId } }, { type: 'create_task', config: { title: 'Legacy', assignedUserId: taskUserId } }] } });
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: salesUserId } }, { output: { resolvedUserId: taskUserId } }] });
  });
  it('rejects inactive, foreign, unavailable and empty targets without owner fallback', async () => {
    await prisma.user.update({ where: { id: taskUserId }, data: { status: 'INACTIVE' } });
    for (const assignmentTarget of [{ type: 'user', id: taskUserId }, { type: 'user', id: foreignUserId }, target('group', foreignGroupId), target('role', foreignRoleId), target('group', randomUUID())] as WorkflowAssignmentTarget[]) {
      await expect(create([task(assignmentTarget)])).rejects.toThrow();
    }
    await prisma.roleDefinition.update({ where: { id: salesRoleId }, data: { isArchived: true } });
    await expect(create([task(target('role', salesRoleId))])).rejects.toThrow('no longer available');
    const empty = await prisma.tenantGroup.create({ data: { tenantId, name: 'Empty pool' } });
    await expect(create([task(target('group', empty.id))])).rejects.toThrow('no active members');
  });
  it('fails after membership loss, skips later actions, allows pausing, and leaves old Tasks unchanged', async () => {
    const group = await prisma.tenantGroup.create({ data: { tenantId, name: 'Changing team', members: { create: { userId: taskUserId } } } });
    const workflow = await create([task(target('group', group.id)), task()]);
    await fire();
    const first = (await runs(workflow.id))[0];
    const taskId = (first.steps[0].output as Prisma.JsonObject).taskId as string;
    await prisma.tenantGroupMember.deleteMany({ where: { tenantId, groupId: group.id } });
    await fire();
    const failed = (await runs(workflow.id)).find(run => run.status === 'failed')!;
    expect(failed.errorMessage).toContain('no active members');
    expect(failed.steps.filter(step => step.stepIndex >= 0).every(step => step.status === 'skipped')).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).assignedUserId).toBe(taskUserId);
    await expect(scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actorId, false))).resolves.toMatchObject({ isActive: false });
    await prisma.tenantGroupMember.create({ data: { tenantId, groupId: group.id, userId: salesUserId } });
    await scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actorId, true));
    await fire();
    expect((await runs(workflow.id))[0].steps[0].output).toMatchObject({ resolvedUserId: salesUserId });
  });
  it('does not grant Tasks access through group membership or bypass author permissions', async () => {
    const staff = await prisma.user.create({ data: { tenantId, role: 'Unprivileged staff', email: `${randomUUID()}@camxian.com`, firstName: 'Staff', lastName: 'Member' } });
    const group = await prisma.tenantGroup.create({ data: { tenantId, name: 'No Tasks access', members: { create: { userId: staff.id } } } });
    await expect(create([task(target('group', group.id))])).rejects.toThrow('no active members');
    await expect(scope(() => workflows.validateDraft(tenantId, restrictedId, { name: 'Forbidden pool', trigger: 'lead.created', actions: [task(target('group', groupId))] }))).rejects.toMatchObject({ statusCode: 403 });
  });
  it('reserves distinct concurrent turns and keeps each workflow/action rotation independent', async () => {
    const request = { tenantId, workflowId: randomUUID(), actionIndex: 0, purpose: 'crm_owner' as const, target: target('role', salesRoleId) };
    const assignments = await scope(() => Promise.all([resolveWorkflowAssignee(request), resolveWorkflowAssignee(request)]));
    expect(new Set(assignments.map(result => result.resolvedUserId)).size).toBe(2);
    const nextAction = await scope(() => resolveWorkflowAssignee({ ...request, actionIndex: 1 }));
    expect(nextAction.resolvedUserId).toBe([salesUserId, secondSalesId].sort()[0]);
    const nextWorkflow = await scope(() => resolveWorkflowAssignee({ ...request, workflowId: randomUUID() }));
    expect(nextWorkflow.resolvedUserId).toBe(nextAction.resolvedUserId);
  });
  it('versions execution changes, keeps old snapshots, and prevents archived workflows from reactivating', async () => {
    const workflow = await create([task()]);
    expect(workflow.version).toBe(1); await fire();
    const oldRun = (await runs(workflow.id))[0];
    const renamed = await scope(() => workflows.updateWorkflow(workflow.id, tenantId, actorId, { name: `Renamed ${randomUUID()}` }));
    expect(renamed.version).toBe(1);
    const edited = await scope(() => workflows.updateWorkflow(workflow.id, tenantId, actorId, { actions: [{ type: 'create_task', config: { title: 'New title' } }] }));
    expect(edited.version).toBe(2);
    const paused = await scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actorId, false)); expect(paused.version).toBe(2);
    const historical = await scope(() => workflows.getExecution(oldRun.id, workflow.id, tenantId));
    expect(historical.workflowVersion).toBe(1);
    expect(historical.definitionSnapshot).toMatchObject({ name: workflow.name, actions: [{ config: { title: 'Pool follow-up' } }] });
    await scope(() => workflows.archiveWorkflow(workflow.id, tenantId, actorId));
    await expect(scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actorId, true))).rejects.toThrow('Archived workflows');
  });
  it('allows an explicit repair of an unsupported historical action and versions the replacement', async () => {
    const workflow = await create([task()]);
    await prisma.workflow.update({ where: { id: workflow.id }, data: { isActive: false, status: 'PAUSED', actions: [{ type: 'legacy_removed_action', config: {} }] } });
    const repaired = await scope(() => workflows.updateWorkflow(workflow.id, tenantId, actorId, { actions: [task()] }));
    expect(repaired).toMatchObject({ version: 2, isActive: false, status: 'PAUSED' });
    expect(repaired.actions).toMatchObject([{ type: 'create_task', config: { assignmentTarget: { type: 'record_owner' } } }]);
  });
});
