import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { WorkflowDraft, WorkflowAction } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import { fireWorkflowTrigger } from '../workflow.engine';
import * as workflows from '../workflows.service';
import { sendEmail } from '../../../../integrations/gmail/gmail.service';
import app from '../../../../app';
import { sendMail } from '../../../../shared/services/email.service';
import { createCampaign } from '../../../marketing/campaigns/campaigns.service';
import { dispatchTenantNotifications } from '../../../notifications/notification-events.service';
import { prepareWorkflowRecipe, WORKFLOW_RECIPES } from '../../../../../../frontend/src/features/tenant/automation/workflows/services/workflow-recipes';

vi.mock('../../../../shared/services/email.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../shared/services/email.service')>(),
  assertBrevoConfigured: vi.fn(), sendMail: vi.fn(),
}));

vi.mock('../../../../integrations/gmail/gmail.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../integrations/gmail/gmail.service')>(),
  sendEmail: vi.fn(),
}));
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('workflow acceptance on disposable PostgreSQL and authenticated HTTP', { timeout: 20000 }, () => {
  let tenantId: string, otherTenantId: string, token: string, viewerToken: string, base: string;
  let actor: any, owner: any, outsider: any, lead: any, contact: any, deal: any, won: any, lost: any, required: any, contacted: any, template: any, product: any;
  let server: Server;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const create = (actions: WorkflowAction[], extras: Partial<WorkflowDraft> = {}) => scope(() => workflows.createWorkflow(tenantId, actor.id, {
    name: `Acceptance workflow ${randomUUID()}`, trigger: 'lead.created', isActive: true, actions, ...extras,
  }));
  const fire = (entity = 'lead', record = lead, trigger = `${entity}.created`) => scope(() => fireWorkflowTrigger({ tenantId, actorId: actor.id,
    eventId: randomUUID(), entityType: entity, entityId: record.id, triggerType: trigger, context: {} }));
  const runs = (workflowId: string) => scope(() => workflows.getWorkflowExecutions(workflowId, tenantId));
  async function call(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `leadcrm_token=${auth}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const closingValues = { 'confirmation-type': 'Approved Quotation', 'confirmation-date': '2026-10-01' };
  async function prepareQualified(id: string) {
    const evidence = await call('/crm/deals/' + id + '/closing-requirements', 'PATCH', { values: closingValues });
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(200);
    const edit = await call('/crm/deals/' + id, 'PUT', { expectedCloseDate: '2026-10-10T00:00:00.000Z' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const moved = await call('/crm/deals/' + id + '/stage', 'PATCH', { stageId: required.id });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
  }
  // An existing confirmed sale is the prerequisite for the explicit conversion
  // endpoint. Fixture creation itself must not emit Deal Created.
  const confirmedDeal = (leadId: string) => scope(() => prisma.deal.create({ data: {
    tenantId, pipelineId: deal.pipelineId, stageId: won.id, leadDeals: { create: { leadId: leadId, position: 0 } }, title: 'Existing confirmed sale',
    assignedUserId: actor.id, tags: [], productInterests: [], closedAt: new Date(),
    wonConfirmedAt: new Date(), wonConfirmedById: actor.id, closingValues,
    closingSnapshot: { fields: [], values: closingValues },
  } }));
  beforeAll(async () => {
    const stamp = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow acceptance', slug: `workflow-${stamp}`, status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { name: 'Foreign workspace', slug: `workflow-other-${stamp}` } })).id;
    const user = (name: string, tenant = tenantId, role = 'Client Admin') => prisma.user.create({ data: { tenantId: tenant, role,
      email: `workflow-${name}-${stamp}@camxian.com`, firstName: name, lastName: 'Test', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date() } });
    actor = await user('actor'); owner = await user('owner', tenantId, 'Sales'); outsider = await user('outsider', otherTenantId);
    const salesRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales' } });
    await prisma.rolePermission.createMany({ data: ['leads', 'deals', 'tasks'].map(module => ({ tenantId, roleId: salesRole.id, module, canView: true, canEdit: true })) });
    await prisma.userRole.create({ data: { tenantId, userId: owner.id, roleId: salesRole.id } });
    const viewer = await user('viewer', tenantId, 'Workflow Viewer');
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Workflow Viewer', permissions: { create: {
      module: 'workflows', canView: true, canCreate: false, canEdit: false, canDelete: false,
    } } } });
    await prisma.userRole.create({ data: { tenantId, userId: viewer.id, roleId: role.id } });
    token = (await issueAuthSession(actor)).token; viewerToken = (await issueAuthSession(viewer)).token;
    await scope(async () => {
      product = await prisma.productInterest.create({ data: { tenantId, name: 'Workflow catalog product', dealValue: 25000 } });
      const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Acceptance pipeline' } });
      const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0, requiredFields: [] } });
      won = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Won', order: 1, isWon: true, requiredFields: [] } });
      lost = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lost', order: 2, isLost: true, requiredFields: [] } });
      required = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Qualified', order: 3, requiredFields: ['expectedCloseDate'] } });
      contacted = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Contacted', order: 4, requiredFields: [] } });
      lead = await prisma.lead.create({ data: { tenantId, firstName: 'Ada', lastName: 'Lead', email: 'recipient@example.test', assignedUserId: actor.id, productInterest: [] } });
      contact = await prisma.contact.create({ data: { tenantId, firstName: 'Grace', lastName: 'Client', assignedUserId: actor.id, activeProducts: [], productInterests: [] } });
      deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, leadDeals: { create: { leadId: lead.id, position: 0 } }, contactDeals: { create: { contactId: contact.id, position: 0 } },
        title: 'Acceptance deal', value: 50000, assignedUserId: actor.id, tags: [], productInterests: [] } });
      template = await prisma.template.create({ data: { tenantId, name: 'Welcome', type: 'Email', subject: 'Hello {{first_name}}', content: '<p>Welcome {{first_name}}</p>' } });
    });
    await prisma.emailAccount.create({ data: { tenantId, userId: actor.id, email: actor.email, accessToken: 'disposable-fixture', scopes: ['gmail.send'] } });
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  }, 30000);
  beforeEach(async () => {
    await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } });
    vi.mocked(sendEmail).mockReset().mockResolvedValue({ messageId: `provider-message-${tenantId}`, threadId: `provider-thread-${tenantId}` });
    vi.mocked(sendMail).mockReset().mockImplementation(async () => ({ messageId: randomUUID(), submitted: true }));
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('runs the real lead-created path through cookie-authenticated HTTP with ordered actions and persisted history', async () => {
    const workflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }, { type: 'create_task', config: { title: 'Call lead', dueDaysFromNow: 0 } },
      { type: 'update_field', config: { field: 'address', value: 'Follow up requested' } }]);
    const response = await call('/crm/leads', 'POST', { firstName: 'Created', lastName: 'Via HTTP', email: 'created@example.test' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const record = await prisma.lead.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(record.assignedUserId).toBe(owner.id); expect(record.address).toBe('Follow up requested');
    const task = await prisma.task.findFirstOrThrow({ where: { leadLinks: { some: { leadId: record.id } } } });
    expect(task.assignedUserId).toBe(owner.id); expect(task.assignedById).toBe(actor.id);
    const history = await runs(workflow.id); expect(history).toHaveLength(1); expect(history[0].status).toBe('completed');
    expect(history[0].steps.map(step => step.status)).toEqual(['success', 'success', 'success']);
    expect(await prisma.activity.count({ where: { leadId: record.id, title: `Workflow: ${workflow.name}`, createdById: actor.id } })).toBe(1);
    expect((await call(`/automation/workflows/${workflow.id}/executions`)).body.data[0].id).toBe(history[0].id);
    const firstPage = await call(`/automation/workflows/${workflow.id}/executions?page=1&limit=10`);
    expect(firstPage.body.meta).toEqual({ total: 1, page: 1, limit: 10, hasMore: false });
    const emptyPage = await call(`/automation/workflows/${workflow.id}/executions?page=2&limit=10`);
    expect(emptyPage.body.data).toEqual([]); expect(emptyPage.body.meta.total).toBe(1);
    // Workflow tasks use the existing CRM notification path, including its retry deduplication.
    for (let attempt = 0; attempt < 2; attempt++) {
      await scope(() => dispatchTenantNotifications(tenantId));
      const notifications = await prisma.notification.findMany({ where: { tenantId, type: 'task_assigned', entityId: task.id } });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].userId).toBe(owner.id);
    }
  });
  it.each(WORKFLOW_RECIPES)('executes configured catalog template: $name', async recipe => {
    const draft = prepareWorkflowRecipe(recipe, { users: [{ id: owner.id, name: 'Assigned agent' }], templates: [], campaigns: [],
      pipelines: [{ id: deal.pipelineId, name: 'Sales', stages: [{ id: required.id, name: 'Qualified' }] }] });
    for (const action of draft.actions) {
      if (action.type === 'assign_owner') action.config.userId = owner.id;
      if (action.type === 'send_email') action.config.senderUserId = actor.id;
      if (action.type === 'move_deal_stage') action.config.stageId = contacted.id;
    }
    const entity = draft.trigger.split('.')[0];
    const status = draft.conditions?.conditions.find(rule => rule.field === `${entity}.status`)?.value;
    const stageId = draft.trigger === 'deal.closed_won' ? won.id : draft.trigger === 'deal.closed_lost' ? lost.id
      : draft.trigger === 'deal.stage_changed' ? required.id : deal.stageId;
    const record = await scope(async () => {
      const customer = { tenantId, firstName: 'Recipe', lastName: 'Recipient', email: 'recipe@example.test', assignedUserId: actor.id };
      if (entity === 'lead') return prisma.lead.create({ data: { ...customer, source: 'Website', status: String(status ?? 'Warm'), productInterest: [] } });
      if (entity === 'contact') return prisma.contact.create({ data: { ...customer, company: 'Example', status: String(status ?? 'Warm').toUpperCase() as 'HOT', activeProducts: [], productInterests: [] } });
      return prisma.deal.create({ data: { tenantId, title: 'Catalog opportunity', pipelineId: deal.pipelineId, stageId,
        assignedUserId: actor.id, value: 300000, priority: 'HIGH', tags: [], productInterests: [], wonHistoryVerified: true } });
    });
    const workflow = await create(draft.actions, { ...draft, name: `${draft.name} ${randomUUID()}`, isActive: true });
    vi.mocked(sendEmail).mockImplementation(async () => ({ messageId: randomUUID(), threadId: randomUUID() }));
    const context = entity === 'deal' && draft.trigger !== 'deal.created'
      ? { 'event.previousStageId': deal.stageId, 'event.newStageId': stageId }
      : draft.trigger.endsWith('.status_changed') ? { 'event.previousStatus': status === 'Cold' ? 'Warm' : 'Cold', 'event.newStatus': status } : {};
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: entity, entityId: record.id, triggerType: draft.trigger, context };
    await scope(() => fireWorkflowTrigger(event));
    // Delivery retries cannot duplicate tasks or emails from the same event.
    await scope(() => fireWorkflowTrigger(event));
    const history = await runs(workflow.id);
    expect(history).toHaveLength(1);
    expect(history[0].status, JSON.stringify(history[0])).toBe('completed');
    expect(history[0].steps.map(step => step.status)).toEqual(draft.actions.map(() => 'success'));
    const tasks = await prisma.task.findMany({ where: { tenantId, [entity + 'Links']: { some: { [entity + 'Id']: record.id } } } });
    expect(tasks).toHaveLength(draft.actions.filter(action => action.type === 'create_task').length);
    for (const task of tasks) {
      expect(task.title).not.toContain('{{');
      expect(task.assignedUserId).toBe(draft.actions.some(action => action.type === 'assign_owner') ? owner.id : actor.id);
    }
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(draft.actions.filter(action => action.type === 'send_email').length);
    for (const action of draft.actions) {
      if (action.type === 'update_field') {
        const updated = entity === 'lead' ? await prisma.lead.findUniqueOrThrow({ where: { id: record.id } }) : await prisma.contact.findUniqueOrThrow({ where: { id: record.id } });
        expect(updated[action.config.field as keyof typeof updated]).toBe(action.config.value);
      }
      if (action.type === 'move_deal_stage') expect((await prisma.deal.findUniqueOrThrow({ where: { id: record.id } })).stageId).toBe(contacted.id);
    }
  });
  it('persists disabled steps, skips their side effects, and validates them again when enabled', async () => {
    const workflow = await create([
      { type: 'create_task', config: { title: 'Enabled before' } },
      { type: 'send_email', enabled: false, config: {} },
      { type: 'create_task', enabled: false, config: { title: 'Must never exist' } },
      { type: 'create_task', config: { title: 'Enabled after' } },
    ]);
    const saved = await call(`/automation/workflows/${workflow.id}`);
    expect(saved.body.data.actions[1].enabled).toBe(false);
    const check = await scope(() => workflows.testWorkflow(workflow.id, tenantId, lead.id));
    expect(check.valid).toBe(true); expect(check.actions[1].message).toContain('Disabled');
    await fire();
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    expect(await prisma.task.count({ where: { tenantId, title: 'Must never exist' } })).toBe(0);
    const history = (await runs(workflow.id))[0];
    expect(history.status).toBe('completed');
    expect(history.steps.map(step => step.status)).toEqual(['success','skipped','skipped','success']);
    expect(history.steps[1].output).toEqual({ reason: 'Action disabled' });
    await expect(scope(() => workflows.updateWorkflow(workflow.id, tenantId, actor.id, {
      actions: [{ type: 'send_email', enabled: true, config: {} }],
    }))).rejects.toThrow('Connected Gmail sender is required');
  });
  it('fires Lead status changes through the real update route only when the status changes', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Warm status follow-up', assignedUserId: actor.id } }], {
      trigger: 'lead.status_changed', conditions: { operator: 'AND', conditions: [{ field: 'lead.status', operator: 'equals', value: 'Warm' }] },
    });
    const created = await call('/crm/leads', 'POST', { firstName: 'Status', lastName: 'Example', email: 'status@example.test', status: 'Cold' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect((await call(`/crm/leads/${id}`, 'PUT', { status: 'Warm' })).status).toBe(200);
    expect((await call(`/crm/leads/${id}`, 'PUT', { status: 'Warm', address: 'No second status event' })).status).toBe(200);
    expect(await runs(workflow.id)).toHaveLength(1);
    expect(await prisma.task.count({ where: { leadLinks: { some: { leadId: id } }, title: 'Warm status follow-up' } })).toBe(1);
    const listed = await call('/operations/tasks?limit=100');
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((task: { leadId: string }) => task.leadId === id)).toBe(true);
  });
  it('fires Client Profile creation and status changes from the Contact API and keeps tasks linked to Contact', async () => {
    const createdWorkflow = await create([{ type: 'create_task', config: { title: 'Profile created', assignedUserId: actor.id } }], { trigger: 'contact.created' });
    const changedWorkflow = await create([{ type: 'create_task', config: { title: 'Contact warmed', assignedUserId: actor.id } }], {
      trigger: 'contact.status_changed', conditions: { operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value: 'Warm' }] },
    });
    const created = await call('/crm/contacts', 'POST', { firstName: 'Profile', lastName: 'Example', email: 'profile@example.test', status: 'Cold', activeProducts: [], productInterests: [] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect((await call(`/crm/contacts/${id}`, 'PUT', { status: 'Warm' })).status).toBe(200);
    expect((await call(`/crm/contacts/${id}`, 'PUT', { status: 'Warm' })).status).toBe(200);
    expect(await runs(createdWorkflow.id)).toHaveLength(1);
    expect(await runs(changedWorkflow.id)).toHaveLength(1);
    const task = await prisma.task.findFirstOrThrow({ where: { contactLinks: { some: { contactId: id } }, title: 'Profile created' }, include: { leadLinks: true } });
    expect(task.leadLinks).toEqual([]);
    expect(await prisma.task.count({ where: { contactLinks: { some: { contactId: id } }, title: 'Contact warmed' } })).toBe(1);
  });
  it('fires Deal creation, stage change, won and lost through governed HTTP transitions', async () => {
    const triggers = ['deal.created', 'deal.stage_changed', 'deal.closed_won', 'deal.closed_lost'];
    const definitions = await Promise.all(triggers.map(trigger => create([{ type: 'create_task', config: { title: trigger, assignedUserId: actor.id } }], { trigger })));
    const created = await call('/crm/deals', 'POST', { title: 'Event coverage deal', pipelineId: deal.pipelineId, stageId: deal.stageId, productInterestIds: [product.id], assignedUserId: owner.id });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    await prepareQualified(id);
    expect((await call('/crm/deals/' + id + '/stage', 'PATCH', { stageId: won.id })).status).toBe(200);
    expect((await call('/crm/deals/' + id + '/stage', 'PATCH', { stageId: lost.id, lostReason: 'Acceptance scenario' })).status).toBe(400);
    const second = await call('/crm/deals', 'POST', { title: 'Lost event coverage', pipelineId: deal.pipelineId, stageId: deal.stageId, productInterestIds: [product.id], assignedUserId: owner.id });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((await call('/crm/deals/' + second.body.data.id + '/stage', 'PATCH', { stageId: lost.id, lostReason: 'Acceptance scenario' })).status).toBe(200);
    for (let index = 0; index < definitions.length; index++) {
      const count = index === 0 ? 2 : index === 1 ? 3 : 1;
      const history = await runs(definitions[index].id);
      expect(history).toHaveLength(count);
      expect(history.every(run => run.status === 'completed')).toBe(true);
      expect(await prisma.task.count({ where: { dealLinks: { some: { dealId: { in: [id, second.body.data.id] } } }, title: triggers[index] } })).toBe(count);
    }
    expect(await prisma.dealStageHistory.count({ where: { dealId: id, previousStageId: null } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { dealId: id, previousStageId: { not: null } } })).toBe(2);
  });
  it('does not project or execute a disabled owner assignment before a task', async () => {
    const record = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Disabled', lastName: 'Owner', assignedUserId: actor.id, productInterest: [] } }));
    const workflow = await create([{ type: 'assign_owner', enabled: false, config: { userId: owner.id } }, { type: 'create_task', config: { title: 'Original owner remains' } }]);
    expect((await scope(() => workflows.testWorkflow(workflow.id, tenantId, record.id))).valid).toBe(true);
    await fire('lead', record);
    const task = await prisma.task.findFirstOrThrow({ where: { leadLinks: { some: { leadId: record.id } } } });
    expect(task.assignedUserId).toBe(actor.id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: record.id } })).assignedUserId).toBe(actor.id);
    expect((await runs(workflow.id))[0].steps.map(step => step.status)).toEqual(['skipped', 'success']);
  });
  it('runs bulk Deal transitions through the same stage service, without repeated events for unchanged stages', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Bulk qualified follow-up', assignedUserId: actor.id } }], { trigger: 'deal.stage_changed',
      conditions: { operator: 'AND', conditions: [{ field: 'deal.stageId', operator: 'equals', value: required.id }] } });
    const created = await call('/crm/deals', 'POST', { title: 'Bulk transition', pipelineId: deal.pipelineId, stageId: deal.stageId, productInterestIds: [product.id] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect((await call('/crm/deals/' + id, 'PUT', { expectedCloseDate: '2026-10-10T00:00:00.000Z' })).status).toBe(200);
    expect((await call('/crm/deals/' + id + '/closing-requirements', 'PATCH', { values: closingValues })).status).toBe(200);
    const move = () => call('/crm/deals/bulk/stage', 'POST', { dealIds: [id], stageId: required.id });
    for (let index = 0; index < 2; index++) {
      const response = await move();
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.data.succeeded).toBe(1);
    }
    expect(await runs(workflow.id)).toHaveLength(1);
    expect(await prisma.task.count({ where: { dealLinks: { some: { dealId: id } }, title: 'Bulk qualified follow-up' } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { dealId: id, previousStageId: null } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { dealId: id, previousStageId: { not: null } } })).toBe(1);
    expect((await call('/crm/deals/bulk/stage', 'POST', { dealIds: [id], stageId: won.id })).status).toBe(400);
    expect((await call('/crm/deals/' + id + '/stage', 'PATCH', { stageId: won.id })).status).toBe(200);
    const rejected = await call('/crm/deals/bulk/stage', 'POST', { dealIds: [id], stageId: required.id });
    expect(rejected.body.data.failed).toBe(1);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id } })).stageId).toBe(won.id);
    expect(await prisma.dealStageHistory.count({ where: { dealId: id, previousStageId: { not: null } } })).toBe(2);
  });
  it('emits conversion events after commit for the converted Lead and new Contact while retaining the completed Deal', async () => {
    const leadWorkflow = await create([{ type: 'create_task', config: { title: 'Converted Lead', assignedUserId: actor.id } }], {
      trigger: 'lead.status_changed', conditions: { operator: 'AND', conditions: [{ field: 'lead.status', operator: 'equals', value: 'Closed' }] },
    });
    const contactWorkflow = await create([{ type: 'create_task', config: { title: 'Converted Profile', assignedUserId: actor.id } }], { trigger: 'contact.created' });
    const dealWorkflow = await create([{ type: 'create_task', config: { title: 'Converted Deal', assignedUserId: actor.id } }], { trigger: 'deal.created' });
    const created = await call('/crm/leads', 'POST', { firstName: 'Conversion', lastName: 'Example', email: 'conversion@example.test', assignedUserId: owner.id });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const completedDeal = await confirmedDeal(id);
    const converted = await call('/crm/leads/' + id + '/convert', 'POST', { accountName: 'Conversion account', createContact: true, dealId: completedDeal.id });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    const record = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(record.status).toBe('Closed');
    expect(record.convertedAt).toBeInstanceOf(Date);
    for (const workflow of [leadWorkflow, contactWorkflow]) {
      const history = await runs(workflow.id);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('completed');
    }
    expect(await prisma.task.count({ where: { leadLinks: { some: { leadId: id } }, title: 'Converted Lead' } })).toBe(1);
    expect(await prisma.task.count({ where: { contactLinks: { some: { contactId: record.contactId } }, title: 'Converted Profile' } })).toBe(1);
    expect(await runs(dealWorkflow.id)).toHaveLength(0);
    expect(converted.body.data.deal.id).toBe(completedDeal.id);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: id } } } })).toBe(1);
    expect(await prisma.task.count({ where: { dealLinks: { some: { dealId: completedDeal.id } }, title: 'Converted Deal' } })).toBe(0);
    expect((await call('/crm/leads/' + id + '/convert', 'POST', { createContact: true, dealId: completedDeal.id })).status).toBe(200);
    expect(await runs(leadWorkflow.id)).toHaveLength(1);
    expect(await runs(contactWorkflow.id)).toHaveLength(1);
  });
  it('does not emit creation events for conversion links or emit any event when conversion rolls back', async () => {
    const contactWorkflow = await create([{ type: 'create_task', config: { title: 'Must be newly created', assignedUserId: actor.id } }], { trigger: 'contact.created' });
    const dealWorkflow = await create([{ type: 'create_task', config: { title: 'Must be new Deal', assignedUserId: actor.id } }], { trigger: 'deal.created' });
    const leadWorkflow = await create([{ type: 'create_task', config: { title: 'Converted successfully', assignedUserId: actor.id } }], { trigger: 'lead.status_changed' });
    const source = await call('/crm/leads', 'POST', { firstName: 'Link', lastName: 'Example', email: 'link@example.test' });
    expect(source.status).toBe(201);
    const completedDeal = await confirmedDeal(source.body.data.id);
    const existingContact = await scope(() => prisma.contact.create({ data: { tenantId, firstName: 'Existing', lastName: 'Conversion contact', email: 'existing-link@example.test', activeProducts: [], productInterests: [] } }));
    const linked = await call('/crm/leads/' + source.body.data.id + '/convert', 'POST', { accountName: 'Link account', contactId: existingContact.id, dealId: completedDeal.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data.contact.id).toBe(existingContact.id);
    expect(await runs(contactWorkflow.id)).toHaveLength(0);
    expect(await runs(dealWorkflow.id)).toHaveLength(0);
    expect(await runs(leadWorkflow.id)).toHaveLength(1);
    const failedSource = await call('/crm/leads', 'POST', { firstName: 'Rollback', lastName: 'Example', email: 'rollback@example.test' });
    expect(failedSource.status).toBe(201);
    const failedDeal = await confirmedDeal(failedSource.body.data.id);
    const archivedContact = await scope(() => prisma.contact.create({ data: { tenantId, firstName: 'Archived', lastName: 'Conversion contact', isArchived: true, activeProducts: [], productInterests: [] } }));
    const failed = await call('/crm/leads/' + failedSource.body.data.id + '/convert', 'POST', { accountName: 'Rolled back account', contactId: archivedContact.id, dealId: failedDeal.id });
    expect(failed.status, JSON.stringify(failed.body)).toBe(409);
    expect(await runs(contactWorkflow.id)).toHaveLength(0);
    expect(await runs(dealWorkflow.id)).toHaveLength(0);
    expect(await runs(leadWorkflow.id)).toHaveLength(1);
    expect(await prisma.contact.count({ where: { tenantId, firstName: 'Rollback' } })).toBe(0);
    expect(await prisma.account.count({ where: { tenantId, name: 'Rolled back account' } })).toBe(0);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: failedSource.body.data.id } })).toMatchObject({ status: 'Warm', contactId: null, companyName: null, convertedAt: null });
  });
  it('emits Deal created for duplication after copying CRM associations', async () => {
    await scope(async () => {
      const product = await prisma.productInterest.create({ data: { tenantId, name: 'Duplication test Product', dealValue: 25000 } });
      await prisma.deal.update({ where: { id: deal.id }, data: { productInterestId: product.id, productsNormalized: true } });
      await prisma.leadDeal.createMany({ data: [{ tenantId, leadId: lead.id, dealId: deal.id, addedById: actor.id }], skipDuplicates: true });
      await prisma.contactDeal.createMany({ data: [{ tenantId, contactId: contact.id, dealId: deal.id, addedById: actor.id }], skipDuplicates: true });
    });
    const workflow = await create([{ type: 'create_task', config: { title: 'Duplicated deal follow-up', assignedUserId: actor.id } }], { trigger: 'deal.created' });
    const response = await call(`/crm/deals/${deal.id}/duplicate`, 'POST');
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const duplicateId = response.body.data.id;
    const history = await runs(workflow.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('completed');
    expect(await prisma.leadDeal.count({ where: { tenantId, dealId: duplicateId, leadId: lead.id } })).toBe(1);
    expect(await prisma.contactDeal.count({ where: { tenantId, dealId: duplicateId, contactId: contact.id } })).toBe(1);
    expect(await prisma.task.count({ where: { dealLinks: { some: { dealId: duplicateId } }, title: 'Duplicated deal follow-up' } })).toBe(1);
  });
  it('does not accept foreign references even in disabled steps', async () => {
    await expect(create([{ type: 'create_task', config: { title: 'Enabled' } }, { type: 'assign_owner', enabled: false, config: { userId: outsider.id } }])).rejects.toThrow('active sales agent');
  });
  it('keeps Client Profile actions attached to Contact, with the relationship Status unchanged', async () => {
    const workflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }, { type: 'update_field', config: { field: 'address', value: 'Client follow-up' } },
      { type: 'create_task', config: { title: 'Call Client Profile', priority: '', dueDaysFromNow: '' } }], { trigger: 'contact.created' });
    await fire('contact', contact);
    expect((await runs(workflow.id))[0].status).toBe('completed');
    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.status).toBe(contact.status); expect(updated.address).toBe('Client follow-up'); expect(updated.assignedUserId).toBe(owner.id);
    const task = await prisma.task.findFirstOrThrow({ where: { contactLinks: { some: { contactId: contact.id } } }, include: { leadLinks: true } });
    expect(task.leadLinks).toEqual([]);
    expect(task.priority).toBe('Medium');
    expect(task.dueDate!.getTime() - task.createdAt.getTime()).toBeGreaterThan(2 * 86400000);
    expect(task.dueDate!.getTime() - task.createdAt.getTime()).toBeLessThanOrEqual(3 * 86400000);
  });
  it('uses the stage domain service, records one history entry, and never changes Lead/Contact Status', async () => {
    const workflow = await create([{ type: 'move_deal_stage', config: { stageId: contacted.id } }], { trigger: 'deal.created' });
    await fire('deal', deal);
    expect((await runs(workflow.id))).toHaveLength(1);
    expect((await runs(workflow.id))[0].status).toBe('completed');
    const transitions = await prisma.dealStageHistory.findMany({ where: { dealId: deal.id, previousStageId: { not: null } } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ previousStageId: deal.stageId, newStageId: contacted.id });
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ stageId: contacted.id, closedAt: null });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe(lead.status);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe(contact.status);
  });
  it('skips every action when numeric conditions do not match', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Must not exist' } }], { trigger: 'deal.created', conditions: {
      operator: 'AND', conditions: [{ field: 'deal.value', operator: 'greater_than', value: 100000 }],
    } });
    await fire('deal', deal); const [run] = await runs(workflow.id);
    expect(run.status).toBe('skipped'); expect(run.steps[0].status).toBe('skipped');
    expect(await prisma.task.count({ where: { tenantId, title: 'Must not exist' } })).toBe(0);
  });
  it('validates drafts and performs dry runs without mutations or deliveries', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Dry run only' } }, { type: 'send_email', config: { templateId: template.id, senderUserId: actor.id } }], { isActive: false });
    const result = await call(`/automation/workflows/${workflow.id}/test`, 'POST', { entityId: lead.id });
    expect(result.status).toBe(200); expect(result.body.data.valid).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled(); expect(await runs(workflow.id)).toHaveLength(0);
    expect(await prisma.task.count({ where: { tenantId, title: 'Dry run only' } })).toBe(0);
  });
  it('projects an earlier owner assignment during dry-run without changing the record', async () => {
    const unassigned = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Unassigned', lastName: 'Sample', productInterest: [] } }));
    const workflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }, { type: 'create_task', config: { title: 'Projected owner' } }], {
      isActive: false, conditions: { operator: 'AND', conditions: [{ field: 'lead.source', operator: 'is_empty', value: null }] },
    });
    const result = await scope(() => workflows.testWorkflow(workflow.id, tenantId, unassigned.id));
    expect(result.valid).toBe(true); expect(result.conditions.matched).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: unassigned.id } })).assignedUserId).toBeNull();
  });
  it('records invalid legacy definitions as failed validation without changing CRM data', async () => {
    const workflow = await scope(() => prisma.workflow.create({ data: { tenantId, name: 'Legacy', trigger: 'lead.created', isActive: true, status: 'ACTIVE',
      actions: [{ type: 'update_field', field: 'status', value: 'HOT' }] } }));
    await fire(); const [run] = await runs(workflow.id);
    expect(run.status).toBe('failed'); expect(run.steps[0].actionType).toBe('validation');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe(lead.status);
  });
  it('projects an explicit field clear during dry-run without clearing the saved assignment', async () => {
    const record = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Clear', lastName: 'Preview', assignedUserId: owner.id, productInterest: [] } }));
    const workflow = await create([
      { type: 'update_field', config: { field: 'assignedUserId', value: owner.id, clear: true } },
      { type: 'create_task', config: { title: 'Needs an agent' } },
    ], { isActive: false });
    const result = await scope(() => workflows.testWorkflow(workflow.id, tenantId, record.id));
    expect(result.valid).toBe(false);
    expect(result.actions[1].message).toContain('Assign an agent to the triggering record');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: record.id } })).assignedUserId).toBe(owner.id);
    expect(await runs(workflow.id)).toHaveLength(0);
  });
  it('persists Gmail acknowledgement; reports provider failure and skips later actions', async () => {
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, senderUserId: actor.id } },
      { type: 'create_task', config: { title: 'After email' } }]);
    await fire(); expect((await runs(workflow.id))[0].status).toBe('completed');
    expect(sendEmail).toHaveBeenCalledWith(tenantId, actor.id, lead.email, 'Hello Ada', '<p>Welcome Ada</p>');
    expect(await prisma.emailDeliveryLog.count({ where: { tenantId, gmailMessageId: `provider-message-${tenantId}`, status: 'sent' } })).toBe(1);
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Provider credential detail must not leak'));
    await fire(); const [failed] = await runs(workflow.id);
    expect(failed.status).toBe('failed'); expect(failed.errorMessage).not.toContain('credential detail');
    expect(failed.steps.map(step => step.status)).toEqual(['failed', 'skipped']);
    expect(await prisma.emailDeliveryLog.count({ where: { tenantId, status: 'failed' } })).toBe(1);
    expect(await prisma.task.count({ where: { tenantId, title: 'After email' } })).toBe(1);
  });
  it('requires valid ownership, connected sender, required stage fields and a lost reason', async () => {
    await expect(create([{ type: 'assign_owner', config: { userId: outsider.id } }])).rejects.toThrow();
    await expect(create([{ type: 'send_email', config: { templateId: template.id, senderUserId: owner.id } }])).rejects.toThrow(/Connect/);
    await expect(create([{ type: 'move_deal_stage', config: { stageId: lost.id } }], { trigger: 'deal.created' })).rejects.toThrow(/reason/);
    const workflow = await create([{ type: 'move_deal_stage', config: { stageId: required.id } }], { trigger: 'deal.created' });
    const dry = await scope(() => workflows.testWorkflow(workflow.id, tenantId, deal.id));
    expect(dry.valid).toBe(false); expect(dry.actions[0].message).toContain('expectedCloseDate');
    await fire('deal', deal); expect((await runs(workflow.id))[0].status).toBe('failed');
  });
  it('checks the Gmail sender assignment and projects an earlier owner assignment without changing the record', async () => {
    const sample = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Mail', lastName: 'Scope', email: 'scope-check@example.test', assignedUserId: actor.id } }));
    const role = await prisma.roleDefinition.findFirstOrThrow({ where: { tenantId, name: 'Sales' } });
    await prisma.emailAccount.create({ data: { tenantId, userId: owner.id, email: owner.email, accessToken: 'disposable-fixture', scopes: ['gmail.send'] } });
    try {
      const emailAction: WorkflowAction = { type: 'send_email', config: { templateId: template.id, senderUserId: owner.id } };
      const blocked = await create([emailAction], { isActive: false });
      const mismatch = await scope(() => workflows.testWorkflow(blocked.id, tenantId, sample.id));
      expect(mismatch.valid).toBe(false); expect(mismatch.actions[0].message).toContain('must be assigned');
      const projected = await create([{ type: 'assign_owner', config: { userId: owner.id } }, emailAction], { isActive: false });
      const success = await scope(() => workflows.testWorkflow(projected.id, tenantId, sample.id));
      expect(success.valid).toBe(true); expect(success.actions[1].message).toContain('projected assignment');
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: sample.id } })).assignedUserId).toBe(actor.id);
      expect(sendEmail).not.toHaveBeenCalled();
      await prisma.lead.update({ where: { id: sample.id }, data: { assignedUserId: owner.id } });
      await prisma.rolePermission.updateMany({ where: { tenantId, roleId: role.id, module: 'leads' }, data: { canEdit: false } });
      const revoked = await scope(() => workflows.testWorkflow(blocked.id, tenantId, sample.id));
      expect(revoked.valid).toBe(false); expect(revoked.actions[0].message).toContain('permission');
      await prisma.rolePermission.updateMany({ where: { tenantId, roleId: role.id, module: 'leads' }, data: { canEdit: true } });
    } finally {
      await prisma.rolePermission.updateMany({ where: { tenantId, roleId: role.id, module: 'leads' }, data: { canEdit: true } });
      await prisma.emailAccount.deleteMany({ where: { tenantId, userId: owner.id } });
    }
  });
  it('rejects protected fields, unsupported actions/triggers, and invalid numeric conditions at activation', async () => {
    for (const actions of [[{ type: 'update_field', config: { field: 'status', value: 'HOT' } }], [{ type: 'send_sms', config: {} }]]) {
      expect((await call('/automation/workflows', 'POST', { name: 'Unsafe', trigger: 'lead.created', actions, isActive: true })).status).toBe(400);
    }
    expect((await call('/automation/workflows', 'POST', { name: 'Unsupported', trigger: 'task.overdue', actions: [], isActive: false })).status).toBe(400);
    await expect(create([{ type: 'create_task', config: { title: 'Invalid comparison' } }], { trigger: 'deal.created', conditions: {
      operator: 'AND', conditions: [{ field: 'deal.value', operator: 'greater_than', value: '1000' }],
    } })).rejects.toThrow(/number/);
    const draft = await create([], { isActive: false });
    expect((await call(`/automation/workflows/${draft.id}/toggle`, 'PATCH')).status).toBe(400);
  });
  it('enforces view-only RBAC and tenant ownership on mutation, dry run, and history routes', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Permission check' } }]);
    expect((await call('/automation/workflows', 'GET', undefined, viewerToken)).status).toBe(200);
    for (const [path, method, body] of [[`/${workflow.id}/toggle`, 'PATCH', undefined], [`/${workflow.id}/archive`, 'PATCH', undefined],
      [`/${workflow.id}`, 'PUT', { name: 'Forbidden' }], ['', 'POST', { name: 'Forbidden', trigger: 'lead.created', actions: [] }]] as const) {
      expect((await call(`/automation/workflows${path}`, method, body, viewerToken)).status).toBe(403);
    }
    const foreign = await prisma.workflow.create({ data: { tenantId: otherTenantId, name: 'Foreign', trigger: 'lead.created', actions: [] } });
    for (const suffix of ['', '/executions']) expect((await call(`/automation/workflows/${foreign.id}${suffix}`)).status).toBe(404);
    expect((await call(`/automation/workflows/${foreign.id}/test`, 'POST', { entityId: lead.id })).status).toBe(404);
  });
  it('does not execute paused, archived, foreign-tenant workflows', async () => {
    const paused = await create([{ type: 'create_task', config: { title: 'Paused' } }], { isActive: false });
    const archived = await create([{ type: 'create_task', config: { title: 'Archived' } }]);
    await scope(() => workflows.archiveWorkflow(archived.id, tenantId, actor.id));
    await fire(); expect(await runs(paused.id)).toHaveLength(0); expect(await runs(archived.id)).toHaveLength(0);
    await expect(fireWorkflowTrigger({ tenantId, actorId: actor.id, entityType: 'lead', entityId: lead.id, triggerType: 'lead.created', context: {} })).rejects.toThrow(/tenant context/);
  });
  it('persists draft, update, activation, pause and archive through registered API routes', async () => {
    const created = await call('/automation/workflows', 'POST', { name: 'Persistent draft', trigger: 'lead.created', actions: [] });
    expect(created.status).toBe(201); const id = created.body.data.id;
    expect((await call(`/automation/workflows/${id}`)).body.data.status).toBe('DRAFT');
    expect((await call(`/automation/workflows/${id}`, 'PUT', { name: 'Saved edit', actions: [{ type: 'create_task', config: { title: 'Follow up', assignedUserId: owner.id } }] })).status).toBe(200);
    for (let index = 0; index < 2; index++) expect((await call(`/automation/workflows/${id}/toggle`, 'PATCH', { isActive: true })).body.data.isActive).toBe(true);
    const secondSession = (await issueAuthSession(actor)).token;
    expect((await call(`/automation/workflows/${id}`, 'GET', undefined, secondSession)).body.data.name).toBe('Saved edit');
    expect((await call(`/automation/workflows/${id}/toggle`, 'PATCH', { isActive: false })).body.data.status).toBe('PAUSED');
    expect((await call(`/automation/workflows/${id}/archive`, 'PATCH')).status).toBe(200);
    expect((await call(`/automation/workflows/${id}`)).body.data.isArchived).toBe(true);
  });
  it('claims concurrent duplicate events once and returns persisted metrics and execution detail', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Exactly one follow-up', assignedUserId: owner.id } }]);
    const event = { tenantId, actorId: actor.id, entityType: 'lead', entityId: lead.id, triggerType: 'lead.created', eventId: randomUUID(), context: {} };
    await Promise.all(Array.from({length: 5}, () => scope(() => fireWorkflowTrigger(event))));
    const history = await runs(workflow.id); expect(history).toHaveLength(1);
    expect(await prisma.task.count({ where: { tenantId, title: 'Exactly one follow-up' } })).toBe(1);
    const listed = (await call('/automation/workflows')).body.data.find((row: any) => row.id === workflow.id);
    expect(listed.totalRuns).toBe(1); expect(listed.successfulRuns).toBe(1); expect(listed.failedRuns).toBe(0);
    expect((await call(`/automation/workflows/${workflow.id}/executions/${history[0].id}`)).body.data.steps[0].status).toBe('success');
  });
  it('rejects foreign references, unexpected settings and protected fields even in drafts', async () => {
    for (const action of [
      { type: 'assign_owner', config: { userId: outsider.id } },
      { type: 'update_field', config: { field: 'tenantId', value: otherTenantId } },
      { type: 'create_task', config: { title: 'Task', surprise: 'untrusted' } },
      { type: 'send_email', config: { templateId: randomUUID() } },
    ]) expect((await call('/automation/workflows', 'POST', { name: 'Unsafe draft', trigger: 'lead.created', actions: [action] })).status).toBeGreaterThanOrEqual(400);
    expect((await call('/automation/workflows', 'POST', { name: 'Unsafe condition', trigger: 'lead.created', actions: [], conditions: { operator: 'AND', conditions: [{ field: 'password', operator: 'equals', value: 'secret' }] } })).status).toBe(400);
    expect((await call('/automation/workflows', 'POST', { name: 'Foreign condition', trigger: 'lead.created', actions: [], conditions: { operator: 'AND', conditions: [{ field: 'lead.assignedUserId', operator: 'equals', value: outsider.id }] } })).status).toBe(400);
  });
  it('rejects header injection and removes unsafe HTML before the existing email transport', async () => {
    const config = { senderUserId: actor.id, subject: 'Hello\r\nBcc: attacker@example.test', body: '<p>Welcome</p>' };
    await expect(create([{ type: 'send_email', config }])).rejects.toThrow(/subject/i);
    vi.mocked(sendEmail).mockResolvedValueOnce({ messageId: randomUUID(), threadId: randomUUID() });
    const workflow = await create([{ type: 'send_email', config: { ...config, subject: 'Welcome', body: '<p onclick="evil()">Safe</p><script>evil()</script><iframe src="https://example.test"></iframe><a href="javascript:evil()">Link</a>' } }]);
    await fire(); expect((await runs(workflow.id))[0].status).toBe('completed');
    expect(vi.mocked(sendEmail).mock.calls[0][4]).toBe('<p>Safe</p><a>Link</a>');
  });
  it('rechecks the activating user permissions before any side effect', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Revoked author task', assignedUserId: owner.id } }]);
    await prisma.user.update({ where: { id: actor.id }, data: { role: 'Workflow Viewer' } });
    try { await fire(); expect((await runs(workflow.id))[0].status).toBe('failed');
      expect(await prisma.task.count({ where: { tenantId, title: 'Revoked author task' } })).toBe(0);
    } finally { await prisma.user.update({ where: { id: actor.id }, data: { role: 'Client Admin' } }); }
  });
  it('preserves retired campaign steps in drafts and prevents activation or sending', async () => {
    const previousSender = process.env.BREVO_FROM_EMAIL; process.env.BREVO_FROM_EMAIL = 'workflow-tests@example.test';
    try {
      const campaign = await scope(() => createCampaign(tenantId, actor.id, { name: 'Workflow campaign', type: 'EMAIL', subject: 'Hello {{first_name}}', body: '<p>Welcome</p>', audienceSource: 'LEADS' }));
      const workflow = await create([{ type: 'send_campaign', config: { campaignId: campaign.id } }], { isActive: false });
      expect(workflow.actions[0].config.campaignId).toBe(campaign.id);
      expect((await call(`/automation/workflows/${workflow.id}/toggle`, 'PATCH', { isActive: true })).status).toBe(400);
      await fire(); expect(await runs(workflow.id)).toHaveLength(0);
      expect(sendMail).not.toHaveBeenCalled(); expect(sendEmail).not.toHaveBeenCalled();
    } finally { if (previousSender === undefined) delete process.env.BREVO_FROM_EMAIL; else process.env.BREVO_FROM_EMAIL = previousSender; }
  });

});
