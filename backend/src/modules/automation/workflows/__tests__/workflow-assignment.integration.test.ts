import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { WorkflowAction, WorkflowAssignmentTarget } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import * as workflows from '../workflows.service';
import { fireWorkflowTrigger } from '../workflow.engine';
import { resolveWorkflowAssignee } from '../../assignment/workflow-assignment.service';
import { addMember, removeMember } from '../../../administration/groups/groups.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('workflow assignment and history on disposable PostgreSQL', { timeout: 30000 }, () => {
  let tenantId: string, foreignTenant: string, actorId: string, leadId: string, dealId: string, taskUserId: string, salesUserId: string, secondSalesId: string;
  let groupId: string, salesRoleId: string, taskRoleId: string, adminRoleId: string, foreignGroupId: string, foreignRoleId: string, foreignUserId: string, restrictedId: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const target = (type: 'role' | 'group', id: string): Extract<WorkflowAssignmentTarget, { type: 'role' | 'group' }> => ({ type, id, strategy: 'round_robin' });
  const task = (assignmentTarget?: WorkflowAssignmentTarget): WorkflowAction => ({ type: 'create_task', config: { title: 'Pool follow-up', ...(assignmentTarget ? { assignmentTarget } : {}) } });
  const create = (actions: WorkflowAction[]) => scope(() => workflows.createWorkflow(tenantId, actorId, { name: `Assignment ${randomUUID()}`, trigger: 'deal.created', isActive: true, actions }));
  const fire = (eventId = randomUUID()) => scope(() => fireWorkflowTrigger({ tenantId, actorId, eventId, entityType: 'deal', entityId: dealId, triggerType: 'deal.created', context: {} }));
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
      adminRoleId = (await prisma.roleDefinition.create({ data: { tenantId, name: 'Client Admin', isSystemRole: true } })).id;
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
        { tenantId, roleId: restricted.id, module: 'deals', canView: true },
        { tenantId, roleId: restricted.id, module: 'tasks', canView: true, canCreate: true, canAssign: true },
      ] });
      groupId = (await prisma.tenantGroup.create({ data: { tenantId, name: 'Follow-up team' } })).id;
      await prisma.tenantGroupMember.createMany({ data: [actorId, taskUserId, salesUserId, secondSalesId].map(userId => ({ tenantId, groupId, userId })) });
      leadId = (await prisma.lead.create({ data: { tenantId, firstName: 'Workflow', lastName: 'Lead', assignedUserId: actorId, productInterest: [] } })).id;
      const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Assignment opportunities' } });
      const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
      dealId = (await prisma.deal.create({ data: { tenantId, title: 'Assignment fixture opportunity', pipelineId: pipeline.id, stageId: stage.id,
        assignedUserId: actorId, leadDeals: { create: { leadId, position: 0 } } } })).id;
    });
    foreignGroupId = (await prisma.tenantGroup.create({ data: { tenantId: foreignTenant, name: 'Foreign team' } })).id;
    foreignRoleId = (await prisma.roleDefinition.create({ data: { tenantId: foreignTenant, name: 'Foreign role' } })).id;
  });
  beforeEach(async () => {
    await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } });
    await prisma.user.updateMany({ where: { tenantId }, data: { status: 'ACTIVE' } });
    await prisma.roleDefinition.updateMany({ where: { tenantId }, data: { isArchived: false } });
    await prisma.deal.update({ where: { id: dealId }, data: { assignedUserId: actorId } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('returns separate eligibility counts and hides administration options without their permissions', async () => {
    const options = await scope(() => workflows.getOptions(tenantId, actorId));
    expect(options.users.map(user => user.id)).not.toContain(taskUserId);
    expect(options.taskAssignees.map(user => user.id)).toContain(taskUserId);
    expect(options.roles.map(role => role.id)).not.toContain(adminRoleId);
    expect(options.roles.map(role => role.id)).toContain(salesRoleId);
    expect(options.groups.find(group => group.id === groupId)).toMatchObject({ memberCount: 4, eligibleMemberCounts: { task_assignee: 3, crm_owner: 2 } });
    const hidden = await scope(() => workflows.getOptions(tenantId, restrictedId));
    expect([hidden.users, hidden.taskAssignees, hidden.groups, hidden.roles]).toEqual([[], [], [], []]);
  });
  it.each(['create_task', 'assign_owner'] as const)('rejects Client Admin %s targets on create, update, draft save, publish and activation', async type => {
    const actions: WorkflowAction[] = [{ type, config: { ...(type === 'create_task' ? { title: 'Protected assignment' } : {}), assignmentTarget: target('role', adminRoleId) } }];
    for (const isActive of [false, true]) await expect(scope(() => workflows.createWorkflow(tenantId, actorId, {
      name: `Forbidden ${randomUUID()}`, trigger: 'deal.created', isActive, actions,
    }))).rejects.toThrow(/role.*available/);
    const saved = await create([task(target('role', salesRoleId))]);
    await expect(scope(() => workflows.updateWorkflow(saved.id, tenantId, actorId, { actions, isActive: false }))).rejects.toThrow(/role.*available/);
    const draft = { name: saved.name, trigger: saved.trigger, isActive: false, actions };
    const input = { draft, expectedVersion: saved.version, expectedDraftRevision: saved.draftRevision };
    await expect(scope(() => workflows.saveWorkflowDraft(saved.id, tenantId, actorId, input))).rejects.toThrow('Client Admin cannot be assigned');
    await expect(scope(() => workflows.publishWorkflowDraft(saved.id, tenantId, actorId, input))).rejects.toThrow(/role.*available/);
    // Simulate a saved legacy definition without bypassing any public write validation.
    await prisma.workflow.update({ where: { id: saved.id }, data: { actions: actions as unknown as Prisma.InputJsonValue, isActive: false, status: 'PAUSED' } });
    await expect(scope(() => workflows.toggleWorkflow(saved.id, tenantId, actorId, true))).rejects.toThrow(/role.*available/);
    expect((await scope(() => workflows.getWorkflowById(saved.id, tenantId))).actions).toEqual(actions);
    expect(await prisma.roleDefinition.findUnique({ where: { id: adminRoleId } })).toMatchObject({ name: 'Client Admin', isSystemRole: true, isArchived: false });
    const repaired = await scope(() => workflows.saveWorkflowDraft(saved.id, tenantId, actorId, { ...input, draft: { ...draft, actions: [task(target('role', salesRoleId))] } }));
    expect(repaired.actions[0].config.assignmentTarget).toEqual(target('role', salesRoleId));
  });
  it('blocks legacy Client Admin pools before any action runs, even with an otherwise eligible member', async () => {
    const membership = await prisma.userRole.create({ data: { tenantId, userId: salesUserId, roleId: adminRoleId } });
    try {
      const saved = await create([{ type: 'update_field', config: { field: 'priority', value: 'HIGH' } }]);
      const actions: WorkflowAction[] = [{ type: 'update_field', config: { field: 'priority', value: 'HIGH' } }, { type: 'assign_owner', config: { assignmentTarget: target('role', adminRoleId) } }];
      await prisma.workflow.update({ where: { id: saved.id }, data: { actions: actions as unknown as Prisma.InputJsonValue } });
      const before = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
      const preview = await scope(() => workflows.testWorkflow(saved.id, tenantId, dealId, actorId));
      expect(preview.valid).toBe(false);
      await fire();
      expect((await runs(saved.id))[0].status).toBe('failed');
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: dealId } })).toMatchObject({ priority: before.priority, assignedUserId: before.assignedUserId });
    } finally { await prisma.userRole.delete({ where: { id: membership.id } }); }
  });
  it('uses batch-added Group memberships for Task assignment while preserving module permission requirements', async () => {
    const group = await scope(() => prisma.tenantGroup.create({ data: { tenantId, name: 'Batch Task pool' } }));
    const staff = await prisma.user.create({ data: { tenantId, role: 'Unprivileged staff', email: `${randomUUID()}@camxian.com`, firstName: 'No', lastName: 'Task grant' } });
    const saved = await scope(() => addMember(group.id, [taskUserId, salesUserId, staff.id], tenantId, actorId));
    expect(saved.members).toHaveLength(3);
    const options = await scope(() => workflows.getOptions(tenantId, actorId));
    expect(options.groups.find(row => row.id === group.id)).toMatchObject({ memberCount: 3, eligibleMemberCounts: { task_assignee: 2, crm_owner: 1 } });
    const workflow = await create([task(target('group', group.id))]);
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, dealId, actorId));
    expect(preview.actions[0].assignment?.candidateCount).toBe(2);
    await scope(() => removeMember(group.id, taskUserId, tenantId, actorId));
    await scope(() => removeMember(group.id, salesUserId, tenantId, actorId));
    await expect(scope(() => workflows.validateDraft(tenantId, actorId, { name: 'No implicit grant', trigger: 'deal.created', actions: [task(target('group', group.id))] }))).rejects.toThrow('no active members');
  });
  it.each(['role', 'group'] as const)('rotates %s assignments, preserves one Task owner, deduplicates events, and previews without mutation', async type => {
    const pool = target(type, type === 'role' ? salesRoleId : groupId);
    const workflow = await create([task(pool)]);
    const beforeTasks = await prisma.task.count({ where: { tenantId } });
    const beforeCursor = await prisma.tenantPreference.count({ where: { tenantId, module: 'workflow-assignment' } });
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, dealId, actorId));
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
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, dealId, actorId));
    expect(preview.actions[1].assignment?.resolvedUserId).toBe(preview.actions[0].assignment?.resolvedUserId);
    await fire();
    const history = (await runs(workflow.id))[0];
    expect(history.status).toBe('completed');
    const output = history.steps[0].output as Prisma.JsonObject;
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: dealId } })).assignedUserId).toBe(output.resolvedUserId);
    expect(history.steps[1].output).toMatchObject({ resolvedUserId: output.resolvedUserId });
  });
  it.each([
    ['role', 'create_task'], ['group', 'create_task'], ['role', 'assign_owner'], ['group', 'assign_owner'],
  ] as const)('rechecks active users for %s %s rotation, fails safely when empty, and resumes after reactivation', async (type, actionType) => {
    const group = type === 'group' ? await prisma.tenantGroup.create({ data: { tenantId, name: `Active pool ${randomUUID()}`, members: { create: [salesUserId, secondSalesId].map(userId => ({ userId })) } } }) : undefined;
    const pool = target(type, group?.id ?? salesRoleId);
    const workflow = await create([{ type: actionType, config: { ...(actionType === 'create_task' ? { title: 'Active users only' } : {}), assignmentTarget: pool } }]);
    await fire();
    const firstRun = (await runs(workflow.id))[0];
    const firstId = (firstRun.steps[0].output as Prisma.JsonObject).resolvedUserId as string;
    const remainingId = firstId === salesUserId ? secondSalesId : salesUserId;
    if (actionType === 'assign_owner') await prisma.deal.update({ where: { id: dealId }, data: { assignedUserId: actorId } });
    await prisma.task.updateMany({ where: { tenantId, assignedUserId: firstId, status: { notIn: ['completed', 'cancelled'] } }, data: { status: 'completed' } });
    await prisma.user.update({ where: { id: firstId }, data: { status: 'INACTIVE' } });
    const options = await scope(() => workflows.getOptions(tenantId, actorId));
    const option = (type === 'role' ? options.roles : options.groups).find(row => row.id === pool.id)!;
    expect(option.eligibleMemberCounts).toEqual({ crm_owner: 1, task_assignee: 1 });
    expect(option.members?.map(member => member.id)).toEqual([remainingId]);
    const preview = await scope(() => workflows.testWorkflow(workflow.id, tenantId, dealId, actorId));
    expect(preview.actions[0].assignment).toMatchObject({ resolvedUserId: remainingId, candidateCount: 1 });
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: remainingId, candidateCount: 1 } }] });
    if (actionType === 'assign_owner') await prisma.deal.update({ where: { id: dealId }, data: { assignedUserId: actorId } });
    await prisma.task.updateMany({ where: { tenantId, assignedUserId: remainingId, status: { notIn: ['completed', 'cancelled'] } }, data: { status: 'completed' } });
    await prisma.user.update({ where: { id: remainingId }, data: { status: 'INACTIVE' } });
    const beforeTasks = await prisma.task.count({ where: { tenantId } });
    const cursorKey = { tenantId, module: 'workflow-assignment', key: `${workflow.id}:0:${type}:${pool.id}` };
    const beforeCursor = await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursorKey } });
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('no active members') });
    expect(await prisma.task.count({ where: { tenantId } })).toBe(beforeTasks);
    expect((await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursorKey } })).value).toEqual(beforeCursor.value);
    if (actionType === 'assign_owner') expect((await prisma.deal.findUniqueOrThrow({ where: { id: dealId } })).assignedUserId).toBe(actorId);
    await prisma.user.update({ where: { id: firstId }, data: { status: 'ACTIVE' } });
    await fire();
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'completed', steps: [{ output: { resolvedUserId: firstId, candidateCount: 1 } }] });
    if (actionType === 'create_task') {
      const firstTaskId = (firstRun.steps[0].output as Prisma.JsonObject).taskId as string;
      expect((await prisma.task.findUniqueOrThrow({ where: { id: firstTaskId } })).assignedUserId).toBe(firstId);
    }
  });
  it.each(['least_workload', 'random', 'availability', 'capacity', 'sticky'])('rejects new %s definitions on create, update, draft save and validation', async strategy => {
    const workflow = await create([task(target('group', groupId))]);
    const actions = [{ type: 'create_task', config: { title: 'Unsupported method', assignmentTarget: { type: 'group', id: groupId, strategy } } }];
    await expect(scope(() => workflows.createWorkflow(tenantId, actorId, { name: `Rejected ${randomUUID()}`, trigger: 'deal.created', isActive: false, actions }))).rejects.toThrow('valid assignment target');
    await expect(scope(() => workflows.createWorkflow(tenantId, actorId, { name: `Rejected active ${randomUUID()}`, trigger: 'deal.created', isActive: true, actions }))).rejects.toThrow('valid assignment target');
    await expect(scope(() => workflows.updateWorkflow(workflow.id, tenantId, actorId, { actions }))).rejects.toThrow('valid assignment target');
    await expect(scope(() => workflows.validateDraft(tenantId, actorId, { name: 'Rejected validation', trigger: 'deal.created', actions }))).rejects.toThrow('valid assignment target');
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
    await prisma.deal.update({ where: { id: dealId, tenantId }, data: { assignedUserId: salesUserId } });
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
    await expect(scope(() => workflows.validateDraft(tenantId, restrictedId, { name: 'Forbidden pool', trigger: 'deal.created', actions: [task(target('group', groupId))] }))).rejects.toMatchObject({ statusCode: 403 });
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
  it.each(['update', 'draft-and-publish'] as const)('repairs an unsupported historical action through %s while preserving unchanged historical text', async mode => {
    const workflow = await create([task()]);
    const description = 'Historical '.repeat(100);
    await prisma.workflow.update({ where: { id: workflow.id }, data: { description, isActive: false, status: 'PAUSED', actions: [{ type: 'legacy_removed_action', config: {} }] } });
    const repaired = mode === 'update'
      ? await scope(() => workflows.updateWorkflow(workflow.id, tenantId, actorId, { actions: [task()] }))
      : await scope(async () => {
        const draft = { name: workflow.name, description, trigger: workflow.trigger, conditions: null, actions: [task()], isActive: false };
        const saved = await workflows.saveWorkflowDraft(workflow.id, tenantId, actorId, { draft, expectedVersion: workflow.version, expectedDraftRevision: workflow.draftRevision });
        expect(saved.draftDefinition).toMatchObject({ description, actions: [{ type: 'create_task' }] });
        return workflows.publishWorkflowDraft(workflow.id, tenantId, actorId, { draft, expectedVersion: saved.version, expectedDraftRevision: saved.draftRevision });
      });
    expect(repaired).toMatchObject({ version: 2, description, isActive: mode !== 'update', status: mode === 'update' ? 'PAUSED' : 'ACTIVE' });
    expect(repaired.actions).toMatchObject([{ type: 'create_task', config: { assignmentTarget: { type: 'record_owner' } } }]);
    await expect(scope(() => workflows.updateWorkflow(workflow.id, tenantId, actorId, { description: description + 'Changed', actions: [task()] }))).rejects.toThrow();
  });
});
