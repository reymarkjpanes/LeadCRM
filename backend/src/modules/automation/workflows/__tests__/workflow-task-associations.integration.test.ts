import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WorkflowAction, WorkflowDraft } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import * as workflows from '../workflows.service';
import { fireWorkflowTrigger } from '../workflow.engine';
import { flushWorkflowQueue } from './workflow-queue-test-helper';
import { entityContext } from '../workflows.repository';
import { dispatchAction } from '../../actions/action-dispatcher';
import * as taskPreparation from '../../actions/action-task-input';
import { createTask, getTaskById, getTasks } from '../../../operations/tasks/tasks.service';
import { crmActor, runAuthorizedWorkflow } from '../../../crm/access/crm-record-access.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('Workflow task matching and atomic associations on disposable PostgreSQL', { timeout: 30000 }, () => {
  let tenantId: string, actorId: string, taskUserId: string, taskRoleId: string, pipelineId: string, secondPipelineId: string;
  let initialStageId: string, nextStageId: string, secondStageId: string, productId: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const taskAction = (config: Record<string, unknown> = {}): WorkflowAction => ({ type: 'create_task', config: {
    title: `Follow up ${randomUUID()}`, assignedUserId: taskUserId, ...config,
  } });
  const create = (action: WorkflowAction, trigger = 'deal.updated', extra: Partial<WorkflowDraft> = {}) => scope(() => workflows.createWorkflow(tenantId, actorId, {
    name: `Task associations ${randomUUID()}`, trigger, isActive: true, actions: [action], ...extra,
  }));
  const newLead = () => scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Task', lastName: 'Lead', assignedUserId: actorId } }));
  const newContact = () => scope(() => prisma.contact.create({ data: { tenantId, firstName: 'Task', lastName: 'Contact', assignedUserId: actorId } }));
  const newDeal = (leadId?: string, contactId?: string, extra: Record<string, unknown> = {}) => scope(() => prisma.deal.create({ data: {
    tenantId, pipelineId, stageId: initialStageId, title: `Related deal ${randomUUID()}`, assignedUserId: actorId,
    ...(leadId ? { leadDeals: { create: { leadId } } } : {}), ...(contactId ? { contactDeals: { create: { contactId } } } : {}), ...extra,
  } }));
  const fire = async (entity: 'lead' | 'contact' | 'deal', id: string, eventId = randomUUID()) => {
    await scope(() => fireWorkflowTrigger({ tenantId, actorId, eventId, entityType: entity, entityId: id, triggerType: `${entity}.updated`, context: { 'event.changedFields': [entity === 'deal' ? 'title' : 'firstName'] } }));
    await flushWorkflowQueue(tenantId);
  };
  const runs = (workflowId: string) => scope(() => workflows.getWorkflowExecutions(workflowId, tenantId));
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow task matching', slug: randomUUID(), status: 'ACTIVE' } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, role: 'Client Admin', firstName: 'Workflow', lastName: 'Admin', email: `${randomUUID()}@camxian.com` } })).id;
    await scope(async () => {
      const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Task workers', permissions: { create: { module: 'tasks', canView: true } } } });
      taskRoleId = role.id;
      taskUserId = (await prisma.user.create({ data: { tenantId, role: role.name, firstName: 'Task', lastName: 'Assignee', email: `${randomUUID()}@camxian.com`, userRoles: { create: { roleId: role.id } } } })).id;
      pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Primary matching pipeline' } })).id;
      secondPipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Other pipeline' } })).id;
      initialStageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0 } })).id;
      nextStageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Qualified', order: 1 } })).id;
      secondStageId = (await prisma.stage.create({ data: { tenantId, pipelineId: secondPipelineId, name: 'Lead', order: 0 } })).id;
      productId = (await prisma.productInterest.create({ data: { tenantId, name: 'Task matching product', dealValue: 50 } })).id;
    });
  });
  beforeEach(async () => { await scope(() => prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } })); });
  afterAll(async () => { await prisma.$disconnect(); });

  const prepare = async (action: WorkflowAction, entity: 'lead' | 'contact', id: string) => scope(async () => {
    const context = await entityContext(entity, id, tenantId);
    return taskPreparation.prepareWorkflowTaskInput({ action, entity, tenantId, context: context!, assignedUserId: taskUserId });
  });
  it('retains legacy multi-Deal preparation and all CRM list associations while refusing new Lead Task workflows', async () => {
    const lead = await newLead(), contact = await newContact();
    const account = await scope(() => prisma.account.create({ data: { tenantId, name: 'Associated company' } }));
    const deals = await Promise.all(Array.from({ length: 3 }, () => newDeal(lead.id, contact.id, { accountId: account.id })));
    const action = taskAction({ targetMode: 'all_matching' });
    await expect(create(action, 'lead.updated')).rejects.toThrow('unavailable');
    const before = await prisma.task.count({ where: { tenantId } });
    const input = await prepare(action, 'lead', lead.id);
    expect(input.dealIds).toEqual(deals.map(deal => deal.id).sort());
    expect(await prisma.task.count({ where: { tenantId } })).toBe(before);
    const task = await scope(() => createTask(tenantId, actorId, { ...input, requestId: randomUUID() }));
    expect(await prisma.taskDeal.count({ where: { tenantId, taskId: task.id } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: task.id, action: 'task.created' } })).toBe(1);
    for (const query of [{ leadId: lead.id }, { contactId: contact.id }, { accountId: account.id }, ...deals.map(deal => ({ dealId: deal.id }))]) {
      const page = await scope(() => getTasks(tenantId, query));
      expect(page.meta.total).toBe(1); expect(page.data).toMatchObject([{ id: task.id, dealIds: input.dealIds }]);
    }
  });
  it('retains scoped Contact matching for legacy preparation while refusing Contact Task activation', async () => {
    const lead = await newLead(), contact = await newContact();
    await prisma.lead.update({ where: { id: lead.id }, data: { contactId: contact.id, convertedAt: new Date() } });
    const direct = await newDeal(undefined, contact.id, { productInterestId: productId });
    const converted = await newDeal(lead.id, undefined, { productInterestIds: [productId] });
    await newDeal(undefined, contact.id, { productInterestId: productId, stageId: nextStageId });
    await newDeal(undefined, contact.id, { productInterestId: productId, pipelineId: secondPipelineId, stageId: secondStageId });
    await newDeal(undefined, contact.id, { isArchived: true, productInterestId: productId });
    const action = taskAction({ targetMode: 'all_matching', pipelineId, currentStageId: initialStageId, productInterestId: productId });
    await expect(create(action, 'contact.updated')).rejects.toThrow('unavailable');
    expect((await prepare(action, 'contact', contact.id)).dealIds).toEqual([direct.id, converted.id].sort());
  });
  it('retains deterministic legacy matching errors and exact selections without creating tasks', async () => {
    const lead = await newLead(), deals = await Promise.all([newDeal(lead.id), newDeal(lead.id), newDeal(lead.id, undefined, { stageId: nextStageId })]);
    await expect(prepare(taskAction(), 'lead', lead.id)).rejects.toThrow('3 related deals match');
    expect((await prepare(taskAction({ dealId: deals[0].id }), 'lead', lead.id)).dealIds).toEqual([deals[0].id]);
    expect((await prepare(taskAction({ pipelineId, currentStageId: nextStageId }), 'lead', lead.id)).dealIds).toEqual([deals[2].id]);
    await expect(prepare(taskAction({ dealId: deals[0].id }), 'lead', (await newLead()).id)).rejects.toThrow('No related deals match');
    expect(await prisma.task.count({ where: { tenantId, dealLinks: { some: { dealId: { in: deals.map(deal => deal.id) } } } } })).toBe(0);
  });
  it('retains the 50-association Task limit in legacy preparation without silently dropping matches', async () => {
    const lead = await newLead(), ids = Array.from({ length: 51 }, () => randomUUID());
    await prisma.deal.createMany({ data: ids.map(id => ({ id, tenantId, pipelineId, stageId: initialStageId, title: 'Limit deal', assignedUserId: actorId })) });
    await prisma.leadDeal.createMany({ data: ids.map(dealId => ({ tenantId, dealId, leadId: lead.id })) });
    const action = taskAction({ targetMode: 'all_matching' });
    await expect(prepare(action, 'lead', lead.id)).rejects.toThrow('51 related deals match');
    await prisma.leadDeal.delete({ where: { leadId_dealId: { leadId: lead.id, dealId: ids[50] } } });
    const input = await prepare(action, 'lead', lead.id);
    const task = await scope(() => createTask(tenantId, actorId, input));
    expect(await prisma.taskDeal.count({ where: { tenantId, taskId: task.id } })).toBe(50);
  });

  it('revalidates source relationships inside the Task transaction before saving any record', async () => {
    const lead = await newLead(); const deal = await newDeal(lead.id);
    const workflow = await create(taskAction());
    const original = taskPreparation.prepareWorkflowTaskInput;
    const prepare = vi.spyOn(taskPreparation, 'prepareWorkflowTaskInput').mockImplementationOnce(async input => {
      const payload = await original(input);
      await prisma.deal.update({ where: { id: deal.id }, data: { isArchived: true } });
      return payload;
    });
    try { await fire('deal', deal.id); } finally { prepare.mockRestore(); }
    expect(await prisma.task.count({ where: { tenantId, title: String(workflow.actions[0].config.title) } })).toBe(0);
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'skipped', steps: [{ status: 'skipped', output: { reason: expect.stringContaining('no longer available') } }] });
  });

  it('uses the persisted Task receipt and assignee without rotating or regenerating input on repeated dispatch', async () => {
    const lead = await newLead(); const deal = await newDeal(lead.id);
    const action = taskAction({ assignmentTarget: { type: 'role', id: taskRoleId, strategy: 'round_robin' } });
    const workflow = await create(action); await fire('deal', deal.id);
    const run = (await runs(workflow.id))[0], step = run.steps[0];
    expect(run.status).toBe('completed');
    const storedBefore = await prisma.workflowExecutionStep.findUniqueOrThrow({ where: { id: step.id } });
    const cursorBefore = await prisma.tenantPreference.findMany({ where: { tenantId, module: 'workflow-assignment' } });
    const context = await scope(() => entityContext('deal', deal.id, tenantId));
    const prepare = vi.spyOn(taskPreparation, 'prepareWorkflowTaskInput');
    let replay: Awaited<ReturnType<typeof dispatchAction>>;
    try { replay = await scope(() => runAuthorizedWorkflow(tenantId, run.id, () => dispatchAction(action, context!, tenantId, actorId, { workflowId: workflow.id, actionIndex: 0, stepId: step.id }), actorId)); }
    finally { expect(prepare).not.toHaveBeenCalled(); prepare.mockRestore(); }
    expect(replay!).toMatchObject({ success: true, output: { taskId: step.output?.taskId, resolvedUserId: taskUserId, assignmentTargetType: 'role', assignmentTargetId: taskRoleId } });
    expect(await prisma.task.count({ where: { tenantId, title: String(action.config.title) } })).toBe(1);
    expect(await prisma.tenantPreference.findMany({ where: { tenantId, module: 'workflow-assignment' } })).toEqual(cursorBefore);
    expect((await prisma.workflowExecutionStep.findUniqueOrThrow({ where: { id: step.id } })).resolvedInput).toEqual(storedBefore.resolvedInput);
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: String(step.output?.taskId), action: 'task.created' } })).toBe(1);
  });

  it('reads back a Task handoff for execution and receipt without broadening manual Task access', async () => {
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: `Task automation ${randomUUID()}`, permissions: { create: [
      { module: 'workflows', canView: true, canActivate: true }, { module: 'deals', canView: true, canViewAll: true },
      { module: 'tasks', canView: true, canCreate: true, canAssign: true }, { module: 'users', canView: true },
    ] } } });
    const runner = await prisma.user.create({ data: { tenantId, role: role.name, firstName: 'Task', lastName: 'Author',
      email: `${randomUUID()}@camxian.com`, userRoles: { create: { roleId: role.id } } } });
    const deal = await newDeal(undefined, undefined, { assignedUserId: runner.id });
    const action = taskAction();
    const workflow = await scope(() => workflows.createWorkflow(tenantId, runner.id, { name: randomUUID(), trigger: 'deal.updated', actions: [action], isActive: true }));
    await fire('deal', deal.id);
    const [run] = await runs(workflow.id);
    expect(run.status).toBe('completed');
    const [step] = run.steps;
    expect(step).toMatchObject({ status: 'success', output: { dealIds: [deal.id], resolvedUserId: taskUserId } });
    const taskId = String(step.output?.taskId);
    const persistedStep = await prisma.workflowExecutionStep.findUniqueOrThrow({ where: { id: step.id } });
    const receipt = await scope(() => runAuthorizedWorkflow(tenantId, run.id,
      () => createTask(tenantId, runner.id, persistedStep.resolvedInput), runner.id));
    expect(receipt).toMatchObject({ id: taskId, createdById: runner.id, assignedUserId: taskUserId, dealLinks: [{ dealId: deal.id }] });
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'task.created', entityId: taskId } })).toBe(1);
    const actor = { userId: runner.id, tenantId, readRecords: true };
    await expect(scope(() => crmActor.run(actor, () => getTaskById(taskId, tenantId)))).rejects.toMatchObject({ statusCode: 404 });
    await expect(scope(() => crmActor.run(actor, () => createTask(tenantId, runner.id, persistedStep.resolvedInput)))).rejects.toMatchObject({ statusCode: 409 });
    const foreign = await prisma.tenant.create({ data: { name: 'Other Task workspace', slug: randomUUID(), status: 'ACTIVE' } });
    await expect(tenantContext.run({ tenantId: foreign.id }, () => getTaskById(taskId, foreign.id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechecks assignee eligibility after payload preparation and rejects unavailable filters on save', async () => {
    const lead = await newLead(); const deal = await newDeal(lead.id);
    await expect(create(taskAction({ pipelineId: randomUUID() }))).rejects.toThrow('triggering deal');
    await expect(create(taskAction({ pipelineId, currentStageId: secondStageId }))).rejects.toThrow('triggering deal');
    const workflow = await create(taskAction()); const original = taskPreparation.prepareWorkflowTaskInput;
    const prepare = vi.spyOn(taskPreparation, 'prepareWorkflowTaskInput').mockImplementationOnce(async input => {
      const payload = await original(input); await prisma.user.update({ where: { id: taskUserId }, data: { status: 'INACTIVE' } }); return payload;
    });
    try { await fire('deal', deal.id); } finally { prepare.mockRestore(); await prisma.user.update({ where: { id: taskUserId }, data: { status: 'ACTIVE' } }); }
    expect(await prisma.task.count({ where: { tenantId, title: String(workflow.actions[0].config.title) } })).toBe(0);
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'failed', steps: [{ status: 'failed', error: expect.stringContaining('assignee') }] });
  });

  it.each(['canCreate', 'canAssign', 'canAssignSelf', 'deals.view'] as const)('rechecks the Workflow author %s grant inside the Task write transaction', async revoked => {
    const lead = await newLead(); const deal = await newDeal(lead.id);
    const role = await scope(() => prisma.roleDefinition.create({ data: { tenantId, name: `Workflow runner ${randomUUID()}`, permissions: { create: [
      { module: 'workflows', canView: true, canActivate: true }, { module: 'leads', canView: true }, { module: 'deals', canView: true, canViewMy: true },
      { module: 'tasks', canView: true, canCreate: true, canAssign: true }, { module: 'users', canView: true },
    ] } } }));
    const runner = await scope(() => prisma.user.create({ data: { tenantId, role: role.name, firstName: 'Workflow', lastName: 'Runner', email: `${randomUUID()}@camxian.com`, userRoles: { create: { roleId: role.id } } } }));
    await prisma.deal.update({ where: { id: deal.id }, data: { assignedUserId: runner.id } });
    const action = taskAction(revoked === 'canAssignSelf' ? { assignedUserId: runner.id } : {});
    const workflow = await scope(() => workflows.createWorkflow(tenantId, runner.id, { name: `Permission race ${randomUUID()}`, trigger: 'deal.updated', actions: [action], isActive: true }));
    const original = taskPreparation.prepareWorkflowTaskInput;
    const prepare = vi.spyOn(taskPreparation, 'prepareWorkflowTaskInput').mockImplementationOnce(async input => {
      const payload = await original(input);
      await prisma.rolePermission.updateMany({ where: { tenantId, roleId: role.id, module: revoked === 'deals.view' ? 'deals' : 'tasks' },
        data: revoked === 'deals.view' ? { canView: false } : revoked === 'canCreate' ? { canCreate: false } : { canAssign: false } });
      return payload;
    });
    try { await fire('deal', deal.id); expect(prepare).toHaveBeenCalledOnce(); } finally { prepare.mockRestore(); }
    expect(await prisma.task.count({ where: { tenantId, title: String(action.config.title) } })).toBe(0);
    expect((await runs(workflow.id))[0]).toMatchObject({ status: 'failed', steps: [{ status: 'failed', error: 'Access denied' }] });
  });
});
