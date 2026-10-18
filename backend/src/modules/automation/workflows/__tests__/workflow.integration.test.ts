import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../../shared/errors/app-error';
import type { Server } from 'node:http';
import type { WorkflowDraft, WorkflowAction } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import { fireWorkflowTrigger } from '../workflow.engine';
import { dispatchQueuedWorkflows, enqueueWorkflowTrigger } from '../workflow-queue';
import { workflowLease } from '../workflow-dispatch-context';
import { salesTransaction } from '../../../crm/leads/lead-automation.service';
import { withTaskTransaction } from '../../../operations/tasks/tasks.repository';
import { flushWorkflowQueue } from './workflow-queue-test-helper';
import * as workflows from '../workflows.service';
import { sendEmail } from '../../../../integrations/gmail/gmail.service';
import app from '../../../../app';
import { taskContextWhere } from '../../../operations/tasks/tasks.repository';
import { sendMail } from '../../../../shared/services/email.service';
import { sendSms } from '../../../../shared/services/sms.service';
import { createCampaign } from '../../../marketing/campaigns/campaigns.service';
import { dispatchTenantNotifications } from '../../../notifications/notification-events.service';
import { prepareWorkflowRecipe, WORKFLOW_RECIPES } from '../../../../../../frontend/src/features/tenant/automation/workflows/services/workflow-recipes';
import { bindWorkflowTemplate, workflowTemplateDescriptor } from '../../../../../../frontend/src/features/tenant/automation/workflows/services/workflow-template-bindings';
import { listFields } from '../../../crm/closing-requirements/closing-requirements.service';
import { isStageEvent } from '../workflow-stage-entry';

vi.mock('../../../../shared/services/email.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../shared/services/email.service')>(),
  assertBrevoConfigured: vi.fn(), sendMail: vi.fn(),
}));

vi.mock('../../../../integrations/gmail/gmail.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../integrations/gmail/gmail.service')>(),
  sendEmail: vi.fn(),
}));
vi.mock('../../../../shared/services/sms.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../shared/services/sms.service')>(),
  isSmsConfigured: () => true, sendSms: vi.fn(async () => ({ submitted: true, messageId: 'fixture-sms' })),
}));
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('workflow acceptance on disposable PostgreSQL and authenticated HTTP', { timeout: 20000 }, () => {
  let tenantId: string, otherTenantId: string, token: string, viewerToken: string, base: string;
  let actor: any, owner: any, originalOwner: any, outsider: any, lead: any, contact: any, deal: any, won: any, lost: any, required: any, contacted: any, template: any, product: any;
  let server: Server;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const create = (actions: WorkflowAction[], extras: Partial<WorkflowDraft> = {}) => scope(() => workflows.createWorkflow(tenantId, actor.id, {
    name: `Acceptance workflow ${randomUUID()}`, trigger: actions.some(action => action.type === 'create_task' && action.enabled !== false) ? 'deal.created' : 'lead.created', isActive: true, actions, ...extras,
  }));
  const fire = (entity = 'lead', record = lead, trigger = `${entity}.created`) => scope(() => fireWorkflowTrigger({ tenantId, actorId: actor.id,
    eventId: randomUUID(), entityType: entity, entityId: record.id, triggerType: trigger, context: {} }));
  const runs = (workflowId: string) => scope(() => workflows.getWorkflowExecutions(workflowId, tenantId));
  async function call(path: string, method = 'GET', body?: unknown, auth = token) {
    if (path === '/crm/contacts' && method === 'POST' && body && typeof body === 'object') body = { requestId: randomUUID(), ...body };
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `leadcrm_token=${auth}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json();
    if (response.ok && method !== 'GET') await flushWorkflowQueue(tenantId);
    return { status: response.status, body: payload };
  }
  const closingValues = { 'confirmation-type': 'Approved Quotation', 'confirmation-date': '2026-10-01' };
  it('resolves template retirement by tenant and actual message overrides while preserving saved content', async () => {
    const template = await prisma.template.create({ data: { tenantId, name: `Old Account token ${randomUUID()}`, type: 'Email', subject: 'Original', content: 'Purchased {{account.activeProductIds}}' } });
    const actions = [{ type:'send_email',config:{templateId:template.id,senderUserId:owner.id} }];
    const saved = await prisma.workflow.create({ data: { tenantId, name:`Template repair ${randomUUID()}`,trigger:'contact.updated',actions,isActive:false,status:'PAUSED' } });
    const read = await call(`/automation/workflows/${saved.id}`);
    expect(read.body.data.repairReason).toContain('Account assignment, product fields and internal notes are retired');
    expect(read.body.data.actions).toEqual(actions);
    expect((await call(`/automation/workflows/${saved.id}`, 'PUT', { isActive:true })).status).toBe(400);
    expect((await call(`/automation/workflows/${saved.id}`, 'PUT', { description:'Template repair in progress' })).status).toBe(200);
    const { accountWorkflowRetirementReferences } = await import('../workflow-fields');
    expect(await accountWorkflowRetirementReferences({trigger:'contact.updated',actions:[{type:'send_email',config:{templateId:template.id,body:'Supported {{firstName}}'}}]},tenantId)).toEqual([]);
    expect(await accountWorkflowRetirementReferences({trigger:'contact.updated',actions},otherTenantId)).toEqual([]);
    expect((await prisma.template.findUniqueOrThrow({ where:{id:template.id} })).content).toBe('Purchased {{account.activeProductIds}}');
  });
  it('preserves retired Account workflow definitions for repair and blocks activation and new retired references', async () => {
    const conditions = { operator: 'AND', conditions: [{ field: 'account.productInterests', operator: 'is_empty', value: null }] };
    const actions = [{ type: 'assign_owner', config: { userId: owner.id } }];
    const saved = await prisma.workflow.create({ data: { tenantId, name: `Retired Account ${randomUUID()}`, trigger: 'account.updated', conditions, actions, isActive: false, status: 'PAUSED' } });
    const read = await call(`/automation/workflows/${saved.id}`);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ isActive: false, status: 'PAUSED', conditions, actions });
    expect(read.body.data.repairReason).toContain('Account assignment, product fields and internal notes are retired');
    const activate = await call(`/automation/workflows/${saved.id}`, 'PUT', { isActive: true });
    expect(activate.status).toBe(400);
    expect(activate.body.error).toContain('Account assignment, product fields and internal notes are retired');
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: saved.id } })).actions).toEqual(actions);
    const draft = { name: `Invalid Account ${randomUUID()}`, trigger: 'account.updated', conditions, actions, isActive: false };
    expect((await call('/automation/workflows', 'POST', draft)).status).toBe(400);
    const partial = await call(`/automation/workflows/${saved.id}`, 'PUT', { description: 'Repair in progress' });
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body.data.conditions).toEqual(conditions);
    const repaired = await call(`/automation/workflows/${saved.id}`, 'PUT', { conditions: null, actions: [{ type: 'update_field', config: { field: 'website', value: 'https://example.test' } }], isActive: true });
    expect(repaired.status, JSON.stringify(repaired.body)).toBe(200);
    expect(repaired.body.data.isActive).toBe(true);
  });
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
  const relatedDeal = (entity: string, id: string) => scope(() => prisma.deal.create({ data: {
    tenantId, title: 'Explicit workflow fixture Deal', pipelineId: deal.pipelineId, stageId: deal.stageId, assignedUserId: actor.id,
    ...(entity === 'lead' ? { leadDeals: { create: { leadId: id, position: 0 } } }
      : entity === 'contact' ? { contactDeals: { create: { contactId: id, position: 0 } } } : { accountId: id }),
  } }));
  beforeAll(async () => {
    const stamp = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow acceptance', slug: `workflow-${stamp}`, status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { name: 'Foreign workspace', slug: `workflow-other-${stamp}` } })).id;
    const user = (name: string, tenant = tenantId, role = 'Client Admin') => prisma.user.create({ data: { tenantId: tenant, role,
      email: `workflow-${name}-${stamp}@camxian.com`, firstName: name, lastName: 'Test', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date() } });
    actor = await user('actor'); owner = await user('owner', tenantId, 'Sales'); originalOwner = await user('original-owner', tenantId, 'Sales'); outsider = await user('outsider', otherTenantId);
    const salesRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales' } });
    await prisma.rolePermission.createMany({ data: ['leads', 'contacts', 'accounts', 'deals', 'tasks'].map(module => ({ tenantId, roleId: salesRole.id, module, canView: true, canEdit: true })) });
    await prisma.userRole.create({ data: { tenantId, userId: owner.id, roleId: salesRole.id } });
    await prisma.userRole.create({ data: { tenantId, userId: originalOwner.id, roleId: salesRole.id } });
    const viewer = await user('viewer', tenantId, 'Workflow Viewer');
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Workflow Viewer', permissions: { create: {
      module: 'workflows', canView: true, canCreate: false, canEdit: false, canDelete: false,
    } } } });
    await prisma.userRole.create({ data: { tenantId, userId: viewer.id, roleId: role.id } });
    token = (await issueAuthSession(actor)).token; viewerToken = (await issueAuthSession(viewer)).token;
    await scope(async () => {
      await listFields(tenantId);
      product = await prisma.productInterest.create({ data: { tenantId, name: 'Workflow catalog product', dealValue: 25000 } });
      const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Acceptance pipeline' } });
      const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0, requiredFields: [] } });
      won = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Won', order: 1, isWon: true, requiredFields: [] } });
      lost = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lost', order: 2, isLost: true, requiredFields: [] } });
      required = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Qualified', order: 3, requiredFields: ['expectedCloseDate'] } });
      contacted = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Contacted', order: 4, requiredFields: [] } });
      lead = await prisma.lead.create({ data: { tenantId, firstName: 'Ada', lastName: 'Lead', email: 'recipient@example.test', assignedUserId: actor.id, productInterest: [] } });
      contact = await prisma.contact.create({ data: { tenantId, firstName: 'Grace', lastName: 'Client', assignedUserId: actor.id, productInterests: [] } });
      deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, leadDeals: { create: { leadId: lead.id, position: 0 } }, contactDeals: { create: { contactId: contact.id, position: 0 } },
        title: 'Acceptance deal', value: 50000, assignedUserId: actor.id, tags: [], productInterests: [] } });
      template = await prisma.template.create({ data: { tenantId, name: 'Welcome', type: 'Email', subject: 'Hello {{first_name}}', content: '<p>Welcome {{first_name}}</p>' } });
    });
    await prisma.emailAccount.create({ data: { tenantId, userId: actor.id, email: actor.email, accessToken: 'disposable-fixture', scopes: ['gmail.send'] } });
    await prisma.emailAccount.create({ data: { tenantId, userId: owner.id, email: owner.email, accessToken: 'disposable-fixture', scopes: ['gmail.send'] } });
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  }, 30000);
  beforeEach(async () => {
    await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } });
    vi.mocked(sendEmail).mockReset().mockImplementation(async () => ({ messageId: `provider-message-${randomUUID()}`, threadId: `provider-thread-${randomUUID()}` }));
    vi.mocked(sendMail).mockReset().mockImplementation(async () => ({ messageId: randomUUID(), submitted: true }));
    vi.mocked(sendSms).mockClear();
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('accepts a legacy Campaign template with company_name and canonical custom variables', async () => {
    const fieldId = randomUUID();
    await prisma.closingFieldDefinition.create({ data: { tenantId, id: fieldId, definition: { id: fieldId, technicalAlias: 'project-code', name: 'Project Code', module: 'leads', group: 'Basic Information', type: 'Text', active: true, required: false, visibleInForm: true, visibleInDetails: true, options: [], description: '', order: 0, version: 1 } } });
    await prisma.customFieldValue.create({ data: { tenantId, fieldId, module: 'leads', leadId: lead.id, value: '<P-1>' } });
    await prisma.lead.update({ where: { id: lead.id }, data: { companyName: 'Example Company' } });
    const legacy = await prisma.template.create({ data: { tenantId, type: 'Email', name: 'Legacy Campaign', subject: 'Hello {{first_name}} at {{company_name}}', content: '<p>{{lastName}} {{companyName}} {{customFieldValues.project-code}}</p>' } });
    vi.mocked(sendEmail).mockResolvedValueOnce({ messageId: randomUUID(), threadId: randomUUID() });
    const workflow = await create([{ type: 'send_email', config: { templateId: legacy.id, senderUserId: actor.id } }]);
    await fire();
    expect((await runs(workflow.id))[0].status).toBe('completed');
    expect(sendEmail).toHaveBeenCalledWith(tenantId, actor.id, lead.email, 'Hello Ada at Example Company', '<p>Lead Example Company &lt;P-1&gt;</p>', undefined, undefined, undefined, expect.any(Object));
    expect((await prisma.template.findUniqueOrThrow({ where: { id: legacy.id } })).subject).toBe(legacy.subject);
    await expect(create([{ type: 'send_email', config: { subject: 'Hello {{unknownField}}', body: 'Message', senderUserId: actor.id } }])).rejects.toThrow('unknownField');
  });

  it.each(['lead', 'contact', 'account', 'deal'] as const)('skips false %s conditions before action validation and creates no activity on retries', async entity => {
    const record = entity === 'lead' ? lead : entity === 'contact' ? contact : entity === 'deal' ? deal : await prisma.account.create({ data: { tenantId, name: 'Skip Account' } });
    const trigger = entity === 'account' ? 'account.updated' : `${entity}.created`;
    const workflow = await prisma.workflow.create({ data: { tenantId, name: `False conditions ${entity}`, trigger, isActive: true, status: 'ACTIVE', activatedById: actor.id,
      conditions: { operator: 'AND', conditions: [{ field: `${entity}.${entity === 'deal' ? 'title' : entity === 'account' ? 'name' : 'lastName'}`, operator: 'equals', value: 'Never matches' }] },
      actions: [{ type: 'update_field', config: { field: 'unsupportedField', value: 'Invalid action should not run' } }] } });
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: entity, entityId: record.id, triggerType: trigger, context: entity === 'account' ? { 'event.changedFields': ['name'] } : {} };
    await scope(() => fireWorkflowTrigger(event));
    await scope(() => fireWorkflowTrigger(event));
    const executions = await runs(workflow.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('skipped');
    expect(executions[0].steps.every(step => step.status === 'skipped')).toBe(true);
    expect(await prisma.activity.count({ where: { tenantId, title: `Workflow: ${workflow.name}` } })).toBe(0);
    const queuedEvent = { ...event, eventId: randomUUID() };
    await scope(() => salesTransaction(tx => enqueueWorkflowTrigger(tx, queuedEvent)));
    await scope(() => salesTransaction(tx => enqueueWorkflowTrigger(tx, queuedEvent)));
    await flushWorkflowQueue(tenantId);
    expect((await runs(workflow.id)).map(run => run.status)).toEqual(['skipped', 'skipped']);
    expect(await prisma.activity.count({ where: { tenantId, title: `Workflow: ${workflow.name}` } })).toBe(0);
  });

  it.each(['lead', 'contact'] as const)('renders email with canonical and legacy variables for %s', async entity => {
    const company = 'companyName';
    await create([{ type: 'send_email', config: { subject: `Follow up with {{firstName}} {{lastName}} {{${company}}}`, body: '<p>Legacy {{first_name}} {{last_name}} {{companyName}} {{email}}</p>' } }], { trigger: `${entity}.created` });
    const response = await call(entity === 'lead' ? '/crm/leads' : '/crm/contacts', 'POST', { firstName: 'Josh', lastName: 'Variable', email: `${randomUUID()}@example.test`, [company]: 'Catalog Company',
      assignedUserId: owner.id, [entity === 'lead' ? 'productInterest' : 'productInterestIds']: [product.id] });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(sendEmail).toHaveBeenCalledWith(tenantId, owner.id, response.body.data.email, 'Follow up with Josh Variable Catalog Company', expect.stringContaining('Legacy Josh Variable Catalog Company'), undefined, undefined, undefined, expect.any(Object));
    expect(await prisma.task.count({ where: { tenantId, ...taskContextWhere(entity, response.body.data.id, tenantId) } })).toBe(0);
  });
  it('excludes Client Admin task candidates and rejects new and saved Workflow task assignments to admin', async () => {
    const options = (await call('/automation/workflow-options')).body.data;
    expect(options.taskAssignees.map((user: any) => user.id)).not.toContain(actor.id);
    await expect(create([{ type: 'create_task', config: { title: 'Admin rejected', assignedUserId: actor.id } }], { trigger: 'deal.created' })).rejects.toThrow(/assignee/);
    const saved = await prisma.workflow.create({ data: { tenantId, name: 'Historical admin assignment', trigger: 'deal.created', isActive: true, status: 'ACTIVE', activatedById: actor.id,
      actions: [{ type: 'create_task', config: { title: 'Saved admin rejected', assignedUserId: actor.id } }],
    } });
    await fire('deal', deal);
    await flushWorkflowQueue(tenantId);
    expect((await runs(saved.id))[0].status).toBe('failed');
    expect(await prisma.task.count({ where: { tenantId, title: 'Saved admin rejected' } })).toBe(0);
  });

  it('runs the real Deal-created path through cookie-authenticated HTTP with ordered actions and persisted history', async () => {
    const workflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }, { type: 'create_task', config: { title: 'Call Deal', dueDaysFromNow: 0 } },
      { type: 'update_field', config: { field: 'title', value: 'Follow up requested' } }], { trigger: 'deal.created' });
    const response = await call('/crm/deals', 'POST', { title: 'Created via HTTP', pipelineId: deal.pipelineId, stageId: deal.stageId, productInterestIds: [product.id], assignedUserId: owner.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const record = await prisma.deal.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(record.assignedUserId).toBe(owner.id); expect(record.title).toBe('Follow up requested');
    const task = await prisma.task.findFirstOrThrow({ where: { ...taskContextWhere('deal', record.id, tenantId) } });
    expect(task.assignedUserId).toBe(owner.id); expect(task.assignedById).toBe(actor.id);
    const history = await runs(workflow.id); expect(history).toHaveLength(1); expect(history[0].status).toBe('completed');
    expect(history[0].steps.map(step => step.status)).toEqual(['success', 'success', 'success']);
    expect(await prisma.activity.count({ where: { dealId: record.id, title: `Workflow: ${workflow.name}`, createdById: actor.id } })).toBe(1);
    expect((await call(`/automation/workflows/${workflow.id}/executions`)).body.data[0].id).toBe(history[0].id);
    const firstPage = await call(`/automation/workflows/${workflow.id}/executions?page=1&limit=10`);
    expect(firstPage.body.meta).toEqual({ total: 1, page: 1, limit: 10, hasMore: false });
    const emptyPage = await call(`/automation/workflows/${workflow.id}/executions?page=2&limit=10`);
    expect(emptyPage.body.data).toEqual([]); expect(emptyPage.body.meta.total).toBe(1);
    // Workflow tasks use the existing CRM notification path, including its retry deduplication.
    expect(await prisma.notificationEvent.findFirst({ where: { tenantId, type: 'task_assigned', entityId: task.id } })).toMatchObject({ ownerId: owner.id, actorId: actor.id });
    for (let attempt = 0; attempt < 2; attempt++) {
      for (let tick = 0; tick < 10; tick++) {
        const batch = await scope(() => dispatchTenantNotifications(tenantId, new Date(), 100));
        expect(batch.failed).toBe(0);
        if (!batch.claimed) break;
      }
      const notifications = await prisma.notification.findMany({ where: { tenantId, type: 'task_assigned', entityId: task.id } });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].userId).toBe(owner.id);
    }
  });
  it.each(WORKFLOW_RECIPES)('executes configured catalog template: $name', async recipe => {
    const options = (await call('/automation/workflow-options')).body.data;
    const index = WORKFLOW_RECIPES.indexOf(recipe);
    let draft = prepareWorkflowRecipe(recipe, options, index);
    const descriptor = workflowTemplateDescriptor(index);
    if (descriptor && descriptor.setup !== 'none') draft = bindWorkflowTemplate(draft, index, options, {
      pipelineId: deal.pipelineId, sourceStageId: deal.stageId,
      targetStageId: ['pipeline-routing', 'related-deal-routing'].includes(descriptor?.setup ?? '') ? contacted.id : required.id,
    });
    for (const action of draft.actions) {
      if (action.type === 'assign_owner') action.config.userId = owner.id;
      if (action.type === 'send_email') { action.config.senderUserId = owner.id; if (action.config.templateId === '') action.config.templateId = template.id; }
      if (action.type === 'update_field' && action.config.value === '') action.config.value = 'https://example.test';
      if (action.type === 'create_task' && draft.trigger.startsWith('account.')) action.config.assignmentTarget = { type: 'user', id: owner.id };
      if (action.type === 'move_deal_stage') action.config.stageId = contacted.id;
    }
    const entity = draft.trigger.split('.')[0];
    const status = draft.conditions?.conditions.find(rule => rule.field === `${entity}.status` || rule.field === 'event.newStatus')?.value;
    const stageId = draft.trigger === 'deal.closed_won' ? won.id : draft.trigger === 'deal.closed_lost' ? lost.id
      : draft.trigger === 'deal.stage_changed' ? required.id : deal.stageId;
    const recipeContact = entity === 'deal' && draft.actions.some(action => action.type === 'send_email')
      ? await prisma.contact.create({ data: { tenantId, firstName: 'Recipe', lastName: 'Contact', email: `${randomUUID()}@example.test`, assignedUserId: owner.id } }) : undefined;
    const record = await scope(async () => {
      const customer = { tenantId, firstName: 'Recipe', lastName: 'Recipient', email: 'recipe@example.test', phone: '+639171234567', assignedUserId: owner.id };
      if (entity === 'lead') return prisma.lead.create({ data: { ...customer, source: 'Website', status: String(status ?? 'Warm'), productInterest: [] } });
      if (entity === 'contact') return prisma.contact.create({ data: { ...customer, companyName: 'Example', status: String(status ?? 'Warm').toUpperCase() as 'HOT', productInterests: [] } });
      if (entity === 'account') return prisma.account.create({ data: { tenantId, name: 'Ownerless recipe Account' } });
      return prisma.deal.create({ data: { tenantId, title: 'Catalog opportunity', pipelineId: deal.pipelineId, stageId: isStageEvent(draft.trigger) ? deal.stageId : stageId,
        assignedUserId: owner.id, value: 300000, priority: 'HIGH', tags: [], productInterests: [], wonHistoryVerified: true,
        ...(recipeContact ? { contactDeals: { create: { contactId: recipeContact.id, position: 0 } } } : {}) } });
    });
    const relatedDeal = entity !== 'deal' && draft.actions.some(action => ['move_deal_stage', 'create_task'].includes(action.type))
      ? await prisma.deal.create({ data: { tenantId, title: 'Related recipe opportunity', pipelineId: deal.pipelineId, stageId: deal.stageId, assignedUserId: actor.id, wonHistoryVerified: true,
        ...(entity === 'lead' ? { leadDeals: { create: { leadId: record.id, position: 0 } } } : entity === 'contact' ? { contactDeals: { create: { contactId: record.id, position: 0 } } } : { accountId: record.id }),
      } }) : undefined;
    if (isStageEvent(draft.trigger)) {
      if (draft.trigger !== 'deal.closed_lost') await prepareQualified(record.id);
      if (draft.trigger !== 'deal.stage_changed') {
        const moved = await call(`/crm/deals/${record.id}/stage`, 'PATCH', { stageId, ...(draft.trigger === 'deal.closed_lost' ? { lostReason: 'Recorded template fixture' } : {}) });
        expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      }
    }
    const workflow = await create(draft.actions, { ...draft, name: `${draft.name} ${randomUUID()}`, isActive: true });
    vi.mocked(sendEmail).mockImplementation(async () => ({ messageId: randomUUID(), threadId: randomUUID() }));
    const entry = isStageEvent(draft.trigger) ? await prisma.dealStageHistory.findUniqueOrThrow({ where: { id: (await prisma.deal.findUniqueOrThrow({ where: { id: record.id } })).currentStageHistoryId! } }) : undefined;
    const context = entry
      ? { 'event.previousStageId': entry.previousStageId, 'event.newStageId': entry.newStageId, 'event.stageHistoryId': entry.id }
      : draft.trigger.endsWith('.status_changed') ? { 'event.previousStatus': status === 'Cold' ? 'Warm' : 'Cold', 'event.newStatus': status }
      : draft.trigger.endsWith('.updated') ? { 'event.changedFields': draft.conditions?.conditions.filter(rule => rule.field === 'event.changedFields' && rule.operator === 'contains').map(rule => String(rule.value)) ?? ['name'] } : {};
    const event = { tenantId, actorId: actor.id, eventId: entry ? `${draft.trigger}:${entry.id}` : randomUUID(), entityType: entity, entityId: record.id, triggerType: draft.trigger, context };
    await scope(() => fireWorkflowTrigger(event));
    // Delivery retries cannot duplicate tasks or emails from the same event.
    await scope(() => fireWorkflowTrigger(event));
    const history = await runs(workflow.id);
    expect(history).toHaveLength(1);
    expect(history[0].status, JSON.stringify(history[0])).toBe('completed');
    expect(history[0].steps.map(step => step.status)).toEqual(draft.actions.map(() => 'success'));
    const tasks = await prisma.task.findMany({ where: { tenantId, ...taskContextWhere(entity as 'lead' | 'contact' | 'account' | 'deal', record.id, tenantId) } });
    expect(tasks).toHaveLength(draft.actions.filter(action => action.type === 'create_task').length);
    for (const task of tasks) {
      expect(task.title).not.toContain('{{');
      expect(task.assignedUserId).toBe(owner.id);
    }
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(draft.actions.filter(action => action.type === 'send_email').length);
    expect(vi.mocked(sendSms)).toHaveBeenCalledTimes(draft.actions.filter(action => action.type === 'send_sms').length);
    for (const action of draft.actions) {
      if (action.type === 'update_field') {
        const updated = entity === 'lead' ? await prisma.lead.findUniqueOrThrow({ where: { id: record.id } }) : entity === 'account' ? await prisma.account.findUniqueOrThrow({ where: { id: record.id } }) : await prisma.contact.findUniqueOrThrow({ where: { id: record.id } });
        expect(updated[action.config.field as keyof typeof updated]).toBe(action.config.value);
      }
      if (action.type === 'move_deal_stage') expect((await prisma.deal.findUniqueOrThrow({ where: { id: relatedDeal?.id ?? record.id } })).stageId).toBe(contacted.id);
      if (action.type === 'assign_owner') {
        const assigned = entity === 'lead' ? await prisma.lead.findUniqueOrThrow({ where: { id: record.id } }) : await prisma.contact.findUniqueOrThrow({ where: { id: record.id } });
        expect(assigned.assignedUserId).toBe(owner.id);
      }
    }
  });
  it('filters Account sizes through authenticated HTTP, preserves the legacy alias, and rejects unsupported operators', async () => {
    const industry = randomUUID();
    const expected = await prisma.account.create({ data: { tenantId, name: 'Matching size', size: 'SMB', industry,  } });
    await prisma.account.create({ data: { tenantId, name: 'Other size', size: 'Enterprise', industry } });
    await prisma.account.create({ data: { tenantId: otherTenantId, name: 'Foreign size', size: 'SMB', industry } });
    for (const field of ['size', 'type']) {
      const query = new URLSearchParams({ 'filter[industry]': 'equals:' + industry, [`filter[${field}]`]: 'in:SMB' });
      const result = await call('/crm/accounts?' + query);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.data.map((row: { id: string }) => row.id)).toEqual([expected.id]);
      expect(result.body.meta.total).toBe(1);
    }
    const mine = await call('/crm/accounts?' + new URLSearchParams({ 'filter[industry]': 'equals:' + industry, 'filter[scope]': 'equals:my' }));
    expect(mine.status, JSON.stringify(mine.body)).toBe(400);
    expect(mine.body.error).toContain('Account assignment and product filters are retired');
    const invalid = await call('/crm/accounts?' + new URLSearchParams({ 'filter[size]': 'greater_than:3' }));
    expect(invalid.status).toBe(400);
  });
  it.each([
    ['lead', 0, 'single_match'], ['contact', 0, 'single_match'],
    ['lead', 2, 'single_match'], ['contact', 2, 'single_match'],
    ['lead', 2, 'all_matching'], ['contact', 2, 'all_matching'],
  ] as const)('handles %s related-deal routing with %s matches in %s mode through CRM HTTP', async (entity, count, targetMode) => {
    const customer = { tenantId, firstName: 'Routing', lastName: 'Recipient', assignedUserId: actor.id };
    const record = entity === 'lead' ? await prisma.lead.create({ data: { ...customer, status: 'Warm' } }) : await prisma.contact.create({ data: { ...customer, status: 'WARM' } });
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const row = await prisma.deal.create({ data: { tenantId, title: 'Routing match ' + index, pipelineId: deal.pipelineId, stageId: deal.stageId, wonHistoryVerified: true,
        ...(entity === 'lead' ? { leadDeals: { create: { leadId: record.id, position: 0 } } } : { contactDeals: { create: { contactId: record.id, position: 0 } } }),
      } });
      ids.push(row.id);
    }
    const workflow = await create([{ type: 'move_deal_stage', config: { stageId: contacted.id, currentStageId: deal.stageId, targetMode } }], {
      trigger: `${entity}.status_changed`, conditions: { operator: 'AND', conditions: [{ field: 'event.newStatus', operator: 'equals', value: 'Hot' }] },
    });
    const changed = await call(`/crm/${entity === 'lead' ? 'leads' : 'contacts'}/${record.id}`, 'PUT', { status: 'Hot' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const history = await runs(workflow.id);
    expect(history).toHaveLength(1);
    const ambiguous = count > 1 && targetMode === 'single_match';
    expect(history[0].status, JSON.stringify(history[0])).toBe(ambiguous ? 'failed' : 'completed');
    if (ambiguous) expect(history[0].errorMessage).toContain('Multiple related Deals');
    else expect(history[0].steps[0].output).toMatchObject({ matchedDealIds: expect.arrayContaining(ids), movedDealIds: expect.arrayContaining(ids), unchanged: count === 0 });
    const rows = await prisma.deal.findMany({ where: { id: { in: ids }, tenantId } });
    expect(rows.every(row => row.stageId === (ambiguous ? deal.stageId : contacted.id))).toBe(true);
    expect(await prisma.task.count({ where: { tenantId, ...taskContextWhere(entity as 'lead' | 'contact' | 'account' | 'deal', record.id, tenantId) } })).toBe(0);
  });
  it('persists disabled steps, skips their side effects, and validates them again when enabled', async () => {
    const workflow = await create([
      { type: 'create_task', config: { title: 'Enabled before', assignedUserId: owner.id } },
      { type: 'send_email', enabled: false, config: {} },
      { type: 'create_task', enabled: false, config: { title: 'Must never exist' } },
      { type: 'create_task', config: { title: 'Enabled after', assignedUserId: owner.id } },
    ], { trigger: 'deal.created' });
    const saved = await call(`/automation/workflows/${workflow.id}`);
    expect(saved.body.data.actions[1].enabled).toBe(false);
    const check = await scope(() => workflows.testWorkflow(workflow.id, tenantId, deal.id));
    expect(check.valid).toBe(true); expect(check.actions[1].message).toContain('Disabled');
    await fire('deal', deal);
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    expect(await prisma.task.count({ where: { tenantId, title: 'Must never exist' } })).toBe(0);
    const history = (await runs(workflow.id))[0];
    expect(history.status).toBe('completed');
    expect(history.steps.map(step => step.status)).toEqual(['success','skipped','skipped','success']);
    expect(history.steps[1].output).toBeNull();
    await expect(scope(() => workflows.updateWorkflow(workflow.id, tenantId, actor.id, {
      actions: [{ type: 'send_email', enabled: true, config: { recipient: 'primary_lead' } }],
    }))).rejects.toThrow('Choose a complete template or enter an email subject and message');
  });
  it('fires Lead status changes through the real update route only when the status changes', async () => {
    const workflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }], {
      trigger: 'lead.status_changed', conditions: { operator: 'AND', conditions: [{ field: 'lead.status', operator: 'equals', value: 'Warm' }] },
    });
    const created = await call('/crm/leads', 'POST', { firstName: 'Status', lastName: 'Example', email: 'status@example.test', status: 'Cold' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    await relatedDeal('lead', id);
    expect((await call(`/crm/leads/${id}`, 'PUT', { status: 'Warm' })).status).toBe(200);
    expect((await call(`/crm/leads/${id}`, 'PUT', { status: 'Warm', address: 'No second status event' })).status).toBe(200);
    expect(await runs(workflow.id)).toHaveLength(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).assignedUserId).toBe(owner.id);
    expect(await prisma.task.count({ where: { ...taskContextWhere('lead', id, tenantId) } })).toBe(0);
  });
  it('assigns Contact creation and guarded status changes from the Contact API', async () => {
    const createdWorkflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }], { trigger: 'contact.created' });
    const changedWorkflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }], {
      trigger: 'contact.status_changed', conditions: { operator: 'AND', conditions: [{ field: 'contact.status', operator: 'equals', value: 'Warm' }] },
    });
    const created = await call('/crm/contacts', 'POST', { firstName: 'Profile', lastName: 'Example', email: 'profile@example.test', status: 'Cold', productInterests: [] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    await relatedDeal('contact', id);
    expect((await call(`/crm/contacts/${id}`, 'PUT', { status: 'Warm' })).status).toBe(200);
    expect((await call(`/crm/contacts/${id}`, 'PUT', { status: 'Warm' })).status).toBe(200);
    expect(await runs(createdWorkflow.id)).toHaveLength(1);
    expect(await runs(changedWorkflow.id)).toHaveLength(1);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id } })).assignedUserId).toBe(owner.id);
    const [failedCreation] = await runs(createdWorkflow.id);
    expect(failedCreation.status).toBe('completed');
    expect(await prisma.task.count({ where: { tenantId, title: 'Profile created' } })).toBe(0);
    expect(await prisma.task.count({ where: { ...taskContextWhere('contact', id!, tenantId), title: 'Contact warmed' } })).toBe(0);
  });
  it('fires Deal creation, stage change, won and lost through governed HTTP transitions', { timeout: 60000 }, async () => {
    const triggers = ['deal.created', 'deal.stage_changed', 'deal.closed_won', 'deal.closed_lost'];
    const definitions = await Promise.all(triggers.map(trigger => create([{ type: 'create_task', config: { title: trigger, assignedUserId: owner.id } }], { trigger })));
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
    const record = await relatedDeal('lead', lead.id);
    await prisma.deal.update({ where: { id: record.id }, data: { assignedUserId: originalOwner.id } });
    const workflow = await create([{ type: 'assign_owner', enabled: false, config: { userId: owner.id } }, { type: 'create_task', config: { title: 'Original owner remains' } }], { trigger: 'deal.created' });
    expect((await scope(() => workflows.testWorkflow(workflow.id, tenantId, record.id))).valid).toBe(true);
    await fire('deal', record);
    const task = await prisma.task.findFirstOrThrow({ where: { ...taskContextWhere('deal', record.id, tenantId) } });
    expect(task.assignedUserId).toBe(originalOwner.id);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: record.id } })).assignedUserId).toBe(originalOwner.id);
    expect((await runs(workflow.id))[0].steps.map(step => step.status)).toEqual(['skipped', 'success']);
  });
  it('runs bulk Deal transitions through the same stage service, without repeated events for unchanged stages', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Bulk qualified follow-up', assignedUserId: owner.id } }], { trigger: 'deal.stage_changed',
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
    const leadWorkflow = await create([{ type: 'update_field', config: { field: 'address', value: 'Converted Lead' } }], {
      trigger: 'lead.updated', conditions: { operator: 'AND', conditions: [{ field: 'lead.accountId', operator: 'is_not_empty', value: null }] },
    });
    const contactWorkflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }], { trigger: 'contact.created' });
    const dealWorkflow = await create([{ type: 'create_task', config: { title: 'Converted Deal', assignedUserId: owner.id } }], { trigger: 'deal.created' });
    const created = await call('/crm/leads', 'POST', { firstName: 'Conversion', lastName: 'Example', email: 'conversion@example.test', assignedUserId: owner.id });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const completedDeal = await confirmedDeal(id);
    const converted = await call('/crm/leads/' + id + '/convert', 'POST', { accountName: 'Conversion account', createContact: true, dealId: completedDeal.id });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    const record = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(record.status).toBe('Warm');
    expect(await prisma.workflowTriggerRecord.count({ where: { tenantId, entityId: id, triggerType: 'lead.status_changed' } })).toBe(0);
    expect(record.convertedAt).toBeInstanceOf(Date);
    for (const workflow of [leadWorkflow, contactWorkflow]) {
      const history = await runs(workflow.id);
      expect(history).toHaveLength(1);
      expect(history[0].status, JSON.stringify(history[0])).toBe(workflow.id === leadWorkflow.id ? 'failed' : 'completed');
      if (workflow.id === leadWorkflow.id) expect(history[0].errorMessage).toMatch(/converted|unavailable|no longer available|conversion/i);
    }
    expect(await prisma.task.count({ where: { ...taskContextWhere('lead', id, tenantId), title: 'Converted Lead' } })).toBe(0);
    expect(await prisma.task.count({ where: { ...taskContextWhere('contact', record.contactId!, tenantId), title: 'Converted Profile' } })).toBe(0);
    expect(await runs(dealWorkflow.id)).toHaveLength(0);
    expect(converted.body.data.deal.id).toBe(completedDeal.id);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: id } } } })).toBe(1);
    expect(await prisma.task.count({ where: { dealLinks: { some: { dealId: completedDeal.id } }, title: 'Converted Deal' } })).toBe(0);
    expect((await call('/crm/leads/' + id + '/convert', 'POST', { createContact: true, dealId: completedDeal.id })).status).toBe(200);
    expect(await runs(leadWorkflow.id)).toHaveLength(1);
    expect(await runs(contactWorkflow.id)).toHaveLength(1);
  });
  it('does not emit creation events for conversion links or emit any event when conversion rolls back', async () => {
    const contactWorkflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }], { trigger: 'contact.created' });
    const dealWorkflow = await create([{ type: 'create_task', config: { title: 'Must be new Deal', assignedUserId: owner.id } }], { trigger: 'deal.created' });
    const leadWorkflow = await create([{ type: 'update_field', config: { field: 'address', value: 'Converted successfully' } }], { trigger: 'lead.updated', conditions: { operator: 'AND', conditions: [{ field: 'lead.accountId', operator: 'is_not_empty', value: null }] } });
    const source = await call('/crm/leads', 'POST', { firstName: 'Link', lastName: 'Example', email: 'link@example.test' });
    expect(source.status).toBe(201);
    const completedDeal = await confirmedDeal(source.body.data.id);
    const existingContact = await scope(() => prisma.contact.create({ data: { tenantId, firstName: 'Existing', lastName: 'Conversion contact', email: 'existing-link@example.test', productInterests: [] } }));
    const linked = await call('/crm/leads/' + source.body.data.id + '/convert', 'POST', { accountName: 'Link account', contactId: existingContact.id, dealId: completedDeal.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data.contact.id).toBe(existingContact.id);
    expect(await runs(contactWorkflow.id)).toHaveLength(0);
    expect(await runs(dealWorkflow.id)).toHaveLength(0);
    expect(await runs(leadWorkflow.id)).toHaveLength(1);
    const failedSource = await call('/crm/leads', 'POST', { firstName: 'Rollback', lastName: 'Example', email: 'rollback@example.test' });
    expect(failedSource.status).toBe(201);
    const failedDeal = await confirmedDeal(failedSource.body.data.id);
    const archivedContact = await scope(() => prisma.contact.create({ data: { tenantId, firstName: 'Archived', lastName: 'Conversion contact', isArchived: true, productInterests: [] } }));
    const failed = await call('/crm/leads/' + failedSource.body.data.id + '/convert', 'POST', { accountName: 'Rolled back account', contactId: archivedContact.id, dealId: failedDeal.id });
    expect(failed.status, JSON.stringify(failed.body)).toBe(404);
    expect(failed.body).toMatchObject({ success: false, error: 'Active Contact not found' });
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
    const workflow = await create([{ type: 'create_task', config: { title: 'Duplicated deal follow-up', assignedUserId: owner.id } }], { trigger: 'deal.created' });
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
    await expect(create([{ type: 'create_task', config: { title: 'Enabled' } }, { type: 'assign_owner', enabled: false, config: { userId: outsider.id } }])).rejects.toThrow('active agent');
  });
  it.each(['lead', 'contact', 'account'] as const)('rejects %s Task activation even when a related Deal exists', async entity => {
    const record = entity === 'lead' ? await prisma.lead.create({ data: { tenantId, firstName: 'Resolve', lastName: 'Lead', assignedUserId: actor.id } })
      : entity === 'contact' ? await prisma.contact.create({ data: { tenantId, firstName: 'Resolve', lastName: 'Contact', assignedUserId: actor.id } })
        : await prisma.account.create({ data: { tenantId, name: 'Resolve Account',  } });
    const title = `Resolve ${entity} Task`;
    const trigger = entity === 'account' ? 'account.updated' : `${entity}.created`;
    await relatedDeal(entity, record.id);
    await expect(create([{ type: 'create_task', config: { title, assignedUserId: owner.id } }], { trigger })).rejects.toThrow('unavailable');
    expect(await prisma.task.count({ where: { tenantId, title } })).toBe(0);
  });
  it('keeps Client Profile actions attached to Contact, with the relationship Status unchanged', async () => {
    const beforeTasks = await prisma.task.count({ where: { ...taskContextWhere('contact', contact.id!, tenantId) } });
    const workflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }, { type: 'update_field', config: { field: 'address', value: 'Client follow-up' } }], { trigger: 'contact.created' });
    await fire('contact', contact);
    expect((await runs(workflow.id))[0].status).toBe('completed');
    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.status).toBe(contact.status); expect(updated.address).toBe('Client follow-up'); expect(updated.assignedUserId).toBe(owner.id);
    expect(await prisma.task.count({ where: { ...taskContextWhere('contact', contact.id!, tenantId) } })).toBe(beforeTasks);
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
    const workflow = await create([{ type: 'create_task', config: { title: 'Dry run only', dealId: deal.id, assignedUserId: owner.id } }, { type: 'send_email', config: { templateId: template.id, recipient: 'primary_lead' } }], { isActive: false });
    const result = await call(`/automation/workflows/${workflow.id}/test`, 'POST', { entityId: deal.id });
    expect(result.status).toBe(200); expect(result.body.data.valid).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled(); expect(await runs(workflow.id)).toHaveLength(0);
    expect(await prisma.task.count({ where: { tenantId, title: 'Dry run only' } })).toBe(0);
  });
  it('projects an earlier owner assignment during dry-run without changing the record', async () => {
    const unassigned = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Unassigned', lastName: 'Sample', email: 'unassigned@example.test', productInterest: [] } }));
    await relatedDeal('lead', unassigned.id);
    const workflow = await create([{ type: 'assign_owner', config: { userId: owner.id } }, { type: 'send_email', config: { templateId: template.id } }], {
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
      { type: 'send_email', config: { templateId: template.id } },
    ], { isActive: false });
    const result = await scope(() => workflows.testWorkflow(workflow.id, tenantId, record.id));
    expect(result.valid).toBe(false);
    expect(result.actions[0].message).toContain('Use Assign Agent');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: record.id } })).assignedUserId).toBe(owner.id);
    expect(await runs(workflow.id)).toHaveLength(0);
  });
  it('persists Gmail acknowledgement; reports provider failure and skips later actions', async () => {
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, recipient: 'primary_lead' } },
      { type: 'create_task', config: { title: 'After email', dealId: deal.id, assignedUserId: owner.id } }]);
    await fire('deal', deal); expect((await runs(workflow.id))[0].status).toBe('completed');
    expect(sendEmail).toHaveBeenCalledWith(tenantId, actor.id, lead.email, 'Hello Ada', '<p>Welcome Ada</p>', undefined, undefined, undefined, expect.objectContaining({ messageId: expect.stringMatching(/^<workflow-.+@leadcrm\.local>$/) }));
    const receipt = await vi.mocked(sendEmail).mock.results[0].value;
    expect(await prisma.emailDeliveryLog.count({ where: { tenantId, gmailMessageId: receipt.messageId, status: 'sent' } })).toBe(1);
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Provider credential detail must not leak'));
    await fire('deal', deal); const [failed] = await runs(workflow.id);
    expect(failed.status).toBe('failed'); expect(failed.errorMessage).not.toContain('credential detail');
    expect(failed.steps.map(step => step.status)).toEqual(['failed', 'skipped']);
    expect(await prisma.activity.findFirst({ where: { tenantId, title: `Workflow: ${workflow.name}`, description: 'Run failed.' } })).toMatchObject({ metadata: { workflowId: workflow.id, runId: failed.id, status: 'failed' } });
    expect(await prisma.emailDeliveryLog.count({ where: { tenantId, status: 'failed' } })).toBe(1);
    expect(await prisma.task.count({ where: { tenantId, title: 'After email' } })).toBe(1);
  });
  it('previews projected email values and whitespace template fallback without sending or changing records', async () => {
    const sample = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Before', lastName: 'Preview', email: `${randomUUID()}@example.test`, assignedUserId: actor.id } }));
    const workflow = await create([
      { type: 'update_field', config: { field: 'firstName', value: 'After' } },
      { type: 'send_email', config: { templateId: template.id, subject: '  ', body: ' ' } },
    ], { isActive: false });
    const check = await scope(() => workflows.testWorkflow(workflow.id, tenantId, sample.id));
    expect(check).toMatchObject({ valid: true, actions: [{ valid: true }, { emailPreview: {
      senderEmail: actor.email, recipient: sample.email, subject: 'Hello After', body: '<p>Welcome After</p>', warnings: [],
    } }] });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: sample.id } })).firstName).toBe('Before');
    expect(sendEmail).not.toHaveBeenCalled(); expect(await runs(workflow.id)).toHaveLength(0);
    await scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, true));
    await fire('lead', sample);
    expect(sendEmail).toHaveBeenCalledWith(tenantId, actor.id, sample.email, 'Hello After', '<p>Welcome After</p>', undefined, undefined, undefined, expect.anything());
  });
  it('keeps missing-value warnings in preview and execution history without exposing delivery evidence', async () => {
    const sample = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Missing', lastName: 'Value', email: `${randomUUID()}@example.test`, assignedUserId: actor.id } }));
    const workflow = await create([{ type: 'send_email', config: { subject: 'Hello {{firstName}}', body: '<p>Call {{phone}}</p>' } }]);
    const check = await scope(() => workflows.testWorkflow(workflow.id, tenantId, sample.id));
    expect(check.actions[0].emailPreview?.warnings).toEqual([expect.stringContaining('{{phone}}')]);
    expect(sendEmail).not.toHaveBeenCalled();
    await fire('lead', sample);
    const [run] = await runs(workflow.id);
    expect(run.steps[0].output).toEqual({ warnings: [expect.stringContaining('{{phone}}')] });
    expect(run.steps[0]).not.toHaveProperty('resolvedInput');
  });
  it('preserves successful email and failed Task evidence when the same event is delivered again', async () => {
    const sample = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Partial', lastName: 'Run', email: `${randomUUID()}@example.test`, assignedUserId: actor.id } }));
    const sourceDeal = await relatedDeal('lead', sample.id);
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, recipient: 'primary_lead' } },
      { type: 'create_task', config: { title: 'Ambiguous after email', assignedUserId: owner.id } }]);
    vi.mocked(sendEmail).mockImplementationOnce(async () => {
      await prisma.deal.update({ where: { id: sourceDeal.id }, data: { isArchived: true } });
      return { messageId: `partial-${randomUUID()}`, threadId: `partial-thread-${randomUUID()}` };
    });
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: 'deal', entityId: sourceDeal.id, triggerType: 'deal.created', context: {} };
    await scope(() => fireWorkflowTrigger(event));
    const first = await runs(workflow.id);
    expect(first).toHaveLength(1); expect(first[0].status).toBe('failed');
    expect(first[0].steps.map(step => step.status)).toEqual(['success', 'failed']);
    expect(first[0].steps[1].error).toMatch(/active|unavailable|no longer available|No related deals/i);
    await expect(scope(() => fireWorkflowTrigger(event))).rejects.toThrow('Triggering record not found');
    await dispatchQueuedWorkflows(); await dispatchQueuedWorkflows();
    expect(sendEmail).toHaveBeenCalledOnce(); expect(await runs(workflow.id)).toEqual(first);
    expect(await prisma.task.count({ where: { tenantId, title: 'Ambiguous after email' } })).toBe(0);
    expect(await prisma.emailDeliveryLog.count({ where: { tenantId, leadId: sample.id, status: 'sent' } })).toBe(1);
  });
  it('requires valid ownership, connected sender, required stage fields and a lost reason', async () => {
    await expect(create([{ type: 'assign_owner', config: { userId: outsider.id } }])).rejects.toThrow();
    const automatic = await create([{ type: 'send_email', config: { templateId: template.id, senderUserId: originalOwner.id } }]);
    expect(automatic.actions).toEqual([{ type: 'send_email', config: { templateId: template.id } }]);
    await prisma.lead.update({ where: { id: lead.id }, data: { assignedUserId: originalOwner.id } });
    const disconnected = await scope(() => workflows.testWorkflow(automatic.id, tenantId, lead.id));
    expect(disconnected.valid).toBe(false); expect(disconnected.actions[0].message).toContain('connect their work Gmail');
    await prisma.lead.update({ where: { id: lead.id }, data: { assignedUserId: actor.id } });
    await expect(create([{ type: 'move_deal_stage', config: { stageId: lost.id, includeLossReason: true } }], { trigger: 'deal.created' })).rejects.toThrow(/reason/);
    const workflow = await create([{ type: 'move_deal_stage', config: { stageId: required.id } }], { trigger: 'deal.created' });
    const dry = await scope(() => workflows.testWorkflow(workflow.id, tenantId, deal.id));
    expect(dry.valid).toBe(false); expect(dry.actions[0].message).toContain('expectedCloseDate');
    await fire('deal', deal); expect((await runs(workflow.id))[0].status).toBe('failed');
  });
  it.each([
    ['lead', 'leads'], ['contact', 'contacts'], ['deal', 'deals'],
  ] as const)('validates %s Assigned Agent conditions using combined grants for that module', async (entity, module) => {
    const viewRole = await prisma.roleDefinition.create({ data: { tenantId, name: `View ${module} ${randomUUID()}`,
      permissions: { create: { module, canView: true } } } });
    const editRole = await prisma.roleDefinition.create({ data: { tenantId, name: `Edit ${module} ${randomUUID()}`,
      permissions: { create: { module, canEdit: true } } } });
    const moduleAgent = await prisma.user.create({ data: { tenantId, role: 'Module staff', firstName: 'Module', lastName: 'Agent', email: `${randomUUID()}@camxian.com`,
      userRoles: { create: [{ roleId: viewRole.id }, { roleId: editRole.id }] } } });
    const configuration = (userId: string) => ({ trigger: `${entity}.created`, conditions: {
      operator: 'AND' as const, conditions: [{ field: `${entity}.assignedUserId`, operator: 'equals' as const, value: userId }],
    } });
    const actions: WorkflowAction[] = [{ type: 'assign_owner', config: { userId: moduleAgent.id } }];
    const workflow = await create(actions, configuration(moduleAgent.id));
    expect(workflow).toMatchObject({ isActive: true, status: 'ACTIVE' });
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: editRole.id, module }, data: { canEdit: false } });
    await expect(create(actions, configuration(moduleAgent.id))).rejects.toThrow(/eligible agent/);
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: editRole.id, module }, data: { canEdit: true } });
    await prisma.user.update({ where: { id: moduleAgent.id }, data: { status: 'INACTIVE' } });
    await expect(create(actions, configuration(moduleAgent.id))).rejects.toThrow(/eligible agent/);
    await prisma.user.update({ where: { id: moduleAgent.id }, data: { status: 'ACTIVE' } });
    for (const unavailableId of [actor.id, outsider.id]) {
      await expect(create(actions, configuration(unavailableId))).rejects.toThrow(/eligible agent/);
    }
    await prisma.user.update({ where: { id: moduleAgent.id }, data: { role: 'Guest', status: 'INACTIVE' } });
    await expect(create(actions, configuration(moduleAgent.id))).rejects.toThrow(/eligible agent/);
    await expect(prisma.user.update({ where: { id: moduleAgent.id }, data: { status: 'ACTIVE' } })).rejects.toThrow(/User_no_active_guest/);
  });
  it('records an uncertain email outcome as interrupted and never replays the same source event', async () => {
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, senderUserId: actor.id } }]);
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: 'lead', entityId: lead.id, triggerType: 'lead.created', context: {} };
    vi.mocked(sendEmail).mockRejectedValueOnce(new AppError('Gmail outcome requires review.', 503, 'GMAIL_OUTCOME_UNKNOWN'));
    await scope(() => fireWorkflowTrigger(event)); await scope(() => fireWorkflowTrigger(event));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const history = await runs(workflow.id);
    expect(history).toHaveLength(1); expect(history[0].status).toBe('interrupted');
    expect(await prisma.activity.findFirst({ where: { tenantId, title: `Workflow: ${workflow.name}`, description: 'Run interrupted.' } })).toMatchObject({ metadata: { workflowId: workflow.id, runId: history[0].id, status: 'interrupted' } });
    expect(history[0].steps[0]).toMatchObject({ status: 'failed', output: null });
    const stored = await prisma.workflowExecutionStep.findFirstOrThrow({ where: { tenantId, executionId: history[0].id, actionType: 'send_email' } });
    expect(stored.resolvedInput).toMatchObject({ messageId: `<workflow-${stored.id}@leadcrm.local>` });
    expect(stored.output).toMatchObject({ outcomeUnknown: true });
    expect(await prisma.emailDeliveryLog.count({ where: { tenantId, status: 'uncertain', leadId: lead.id } })).toBe(1);
  });
  it('retries undispatched work after a transient preparation failure without losing its queued event', async () => {
    const sample = await prisma.lead.create({ data: { tenantId, firstName: 'Queued', lastName: 'Label', email: `${randomUUID()}@example.test`, assignedUserId: actor.id } });
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, senderUserId: actor.id } }]);
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: 'lead', entityId: sample.id, triggerType: 'lead.created', context: {} };
    await scope(() => salesTransaction(tx => enqueueWorkflowTrigger(tx, event)));
    await prisma.lead.update({ where: { id: sample.id }, data: { firstName: 'Current' } });
    const loading = vi.spyOn(prisma.workflow, 'findFirst').mockRejectedValueOnce(new Error('Transient database read failure'));
    try { await dispatchQueuedWorkflows(); }
    finally { loading.mockRestore(); }
    const queued = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, workflowId: workflow.id }, include: { steps: true } });
    expect(queued).toMatchObject({ status: 'queued', dispatchStartedAt: null, completedAt: null, leaseId: null, leaseUntil: null });
    expect(queued.steps).toHaveLength(0); expect(sendEmail).not.toHaveBeenCalled();
    const history = await runs(workflow.id);
    expect(history[0].trigger.payload).toMatchObject({ recordName: 'Queued Label' });
    expect(history[0]).not.toHaveProperty('dispatchContext');
    vi.mocked(sendEmail).mockResolvedValueOnce({ messageId: `recovered-${randomUUID()}`, threadId: `recovered-thread-${randomUUID()}` });
    await dispatchQueuedWorkflows();
    expect(await prisma.workflowExecutionRun.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: 'completed' });
    expect(await prisma.workflowExecutionRun.count({ where: { tenantId, workflowId: workflow.id } })).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    await dispatchQueuedWorkflows(); expect(sendEmail).toHaveBeenCalledOnce();
  });
  it('uses the committed dispatch marker after its acknowledgement is lost and never requeues started work', async () => {
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, senderUserId: actor.id } }]);
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: 'lead', entityId: lead.id, triggerType: 'lead.created', context: {} };
    await scope(() => salesTransaction(tx => enqueueWorkflowTrigger(tx, event)));
    const update = prisma.workflowExecutionRun.updateMany.bind(prisma.workflowExecutionRun);
    const acknowledgement = vi.spyOn(prisma.workflowExecutionRun, 'updateMany')
      .mockImplementationOnce(update)
      .mockImplementationOnce(args => update(args).then(() => { throw new Error('Lost committed dispatch acknowledgement'); }) as ReturnType<typeof update>);
    try { await dispatchQueuedWorkflows(); }
    finally { acknowledgement.mockRestore(); }
    const interrupted = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, workflowId: workflow.id }, include: { steps: true } });
    expect(interrupted).toMatchObject({ status: 'interrupted', leaseId: null, leaseUntil: null });
    expect(interrupted.dispatchStartedAt).not.toBeNull(); expect(interrupted.steps).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
    await dispatchQueuedWorkflows(); expect(sendEmail).not.toHaveBeenCalled();
    expect((await prisma.workflowExecutionRun.findUniqueOrThrow({ where: { id: interrupted.id } })).status).toBe('interrupted');
  });
  it.each(['before provider write', 'after provider acceptance'] as const)('fences a suspended workflow %s after another worker interrupts its expired lease', async boundary => {
    const sample = await prisma.lead.create({ data: { tenantId, firstName: 'Lease', lastName: 'Recipient', email: `lease-${randomUUID()}@example.test`, assignedUserId: actor.id } });
    const sourceDeal = await relatedDeal('lead', sample.id);
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, recipient: 'primary_lead' } },
      { type: 'create_task', config: { title: 'Must not run after expired dispatch', assignedUserId: owner.id } }]);
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: 'deal', entityId: sourceDeal.id, triggerType: 'deal.created', context: {} };
    await scope(() => salesTransaction(tx => enqueueWorkflowTrigger(tx, event)));
    let resume!: () => void, started!: () => void, providerWrites = 0;
    const waiting = new Promise<void>(resolve => { resume = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(sendEmail).mockImplementationOnce(async (...args) => {
      if (boundary === 'after provider acceptance') { await args[8]?.beforeProviderWrite?.(); providerWrites++; }
      started(); await waiting;
      if (boundary === 'before provider write') { await args[8]?.beforeProviderWrite?.(); providerWrites++; }
      return { messageId: 'accepted-during-suspension', threadId: 'accepted-thread' };
    });
    const originalWorker = dispatchQueuedWorkflows();
    try {
      await entered;
      const run = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, workflowId: workflow.id, status: 'running' } });
      await prisma.workflowExecutionRun.update({ where: { id: run.id }, data: { leaseUntil: new Date(Date.now() - 1) } });
      await dispatchQueuedWorkflows();
      expect((await prisma.workflowExecutionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('interrupted');
      resume(); await originalWorker;
      await dispatchQueuedWorkflows();
      const saved = await prisma.workflowExecutionRun.findUniqueOrThrow({ where: { id: run.id }, include: { steps: true } });
      expect(saved.status).toBe('interrupted'); expect(saved.leaseId).toBeNull();
      expect(saved.steps.map(step => step.status)).toEqual(['failed']);
      expect(saved.steps[0].output).toMatchObject({ outcomeUnknown: true });
      const input = saved.steps[0].resolvedInput as { deliveryLogId: string };
      expect((await prisma.emailDeliveryLog.findUniqueOrThrow({ where: { id: input.deliveryLogId } })).status).toBe('uncertain');
      expect(await prisma.activity.count({ where: { tenantId, title: `Workflow: ${workflow.name}` } })).toBe(0);
      expect(await prisma.task.count({ where: { tenantId, title: 'Must not run after expired dispatch' } })).toBe(0);
      expect(sendEmail).toHaveBeenCalledOnce(); expect(providerWrites).toBe(boundary === 'before provider write' ? 0 : 1);
    } finally { resume(); await originalWorker; }
  });
  it('blocks expired workflow ownership before both CRM and Task source transactions write', async () => {
    const workflow = await create([], { isActive: false });
    const trigger = await prisma.workflowTriggerRecord.create({ data: { tenantId, workflowId: workflow.id, triggerType: 'lead.created', entityType: 'lead', entityId: lead.id, eventId: randomUUID() } });
    const leaseId = randomUUID();
    const run = await prisma.workflowExecutionRun.create({ data: { tenantId, workflowId: workflow.id, triggerId: trigger.id, entityType: 'lead', entityId: lead.id, status: 'running', dispatchContext: { version: 1 }, dispatchStartedAt: new Date(), leaseId, leaseUntil: new Date(Date.now() - 1) } });
    const lease = { tenantId, executionId: run.id, leaseId }, before = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    await expect(scope(() => workflowLease.run(lease, () => salesTransaction(tx => tx.lead.update({ where: { id: lead.id }, data: { address: 'Stale worker mutation' } }))))).rejects.toMatchObject({ code: 'WORKFLOW_LEASE_LOST' });
    await expect(scope(() => workflowLease.run(lease, () => withTaskTransaction(tx => tx.task.create({ data: { tenantId, title: 'Expired workflow task', dueDate: new Date(), assignedUserId: owner.id } }))))).rejects.toMatchObject({ code: 'WORKFLOW_LEASE_LOST' });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).address).toBe(before.address);
    expect(await prisma.task.count({ where: { tenantId, title: 'Expired workflow task' } })).toBe(0);
  });
  it('classifies started step and delivery evidence atomically when dispatch throws, retaining known accepted delivery', async () => {
    const workflow = await create([{ type: 'send_email', config: { templateId: template.id, senderUserId: actor.id } }]);
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), entityType: 'lead', entityId: lead.id, triggerType: 'lead.created', context: {} };
    await scope(() => salesTransaction(tx => enqueueWorkflowTrigger(tx, event)));
    const engine = await import('../workflow.engine');
    let pendingId = '', confirmedId = '';
    const dispatch = vi.spyOn(engine, 'fireWorkflowTrigger').mockImplementationOnce(async (_params, prepared) => {
      await prisma.$transaction(async tx => {
        const pending = await tx.emailDeliveryLog.create({ data: { tenantId, fromEmail: actor.email, toEmail: lead.email, subject: 'Pending provider acknowledgement', status: 'pending' } });
        const confirmed = await tx.emailDeliveryLog.create({ data: { tenantId, fromEmail: actor.email, toEmail: lead.email, subject: 'Known accepted message', status: 'sent', gmailMessageId: 'confirmed-provider-id' } });
        pendingId = pending.id; confirmedId = confirmed.id;
        await tx.workflowExecutionStep.createMany({ data: [{ tenantId, executionId: prepared!.run.id, stepIndex: 0, actionType: 'send_email', status: 'running', resolvedInput: { deliveryLogId: pending.id } },
          { tenantId, executionId: prepared!.run.id, stepIndex: 1, actionType: 'send_email', status: 'running', resolvedInput: { deliveryLogId: confirmed.id } }] });
      });
      throw new Error('Forced dispatch failure before completion evidence');
    });
    try { await dispatchQueuedWorkflows(); }
    finally { dispatch.mockRestore(); }
    const run = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, workflowId: workflow.id }, include: { steps: true } });
    expect(run.status).toBe('interrupted'); expect(run.leaseId).toBeNull();
    expect(run.steps.map(step => step.status)).toEqual(['failed', 'failed']);
    expect((await prisma.emailDeliveryLog.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe('uncertain');
    expect(await prisma.emailDeliveryLog.findUniqueOrThrow({ where: { id: confirmedId } })).toMatchObject({ status: 'sent', gmailMessageId: 'confirmed-provider-id' });
    await dispatchQueuedWorkflows(); expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.activity.count({ where: { tenantId, title: `Workflow: ${workflow.name}` } })).toBe(0);
  });
  it('automatically uses the assigned Gmail sender and projects an earlier owner assignment without changing the record', async () => {
    const sample = await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Mail', lastName: 'Scope', email: 'scope-check@example.test', assignedUserId: actor.id } }));
    const role = await prisma.roleDefinition.findFirstOrThrow({ where: { tenantId, name: 'Sales' } });
    await prisma.emailAccount.upsert({ where: { tenantId_userId_provider: { tenantId, userId: owner.id, provider: 'gmail' } }, create: { tenantId, userId: owner.id, email: owner.email, accessToken: 'disposable-fixture', scopes: ['gmail.send'] }, update: { isActive: true } });
    try {
      const emailAction: WorkflowAction = { type: 'send_email', config: { templateId: template.id, senderUserId: owner.id } };
      const blocked = await create([emailAction], { isActive: false });
      const assigned = await scope(() => workflows.testWorkflow(blocked.id, tenantId, sample.id));
      expect(assigned.valid).toBe(true); expect(assigned.actions[0].emailPreview?.senderEmail).toBe(actor.email);
      const projected = await create([{ type: 'assign_owner', config: { userId: owner.id } }, emailAction], { isActive: false });
      const success = await scope(() => workflows.testWorkflow(projected.id, tenantId, sample.id));
      expect(success.valid).toBe(true); expect(success.actions[1].message).toContain('projected assignment');
      expect(success.actions[1].emailPreview?.senderEmail).toBe(owner.email);
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
  it('filters history by current CRM View grants and never exposes dispatch or provider recovery data', async () => {
    const workflow = await create([], { isActive: false });
    const trigger = await prisma.workflowTriggerRecord.create({ data: { tenantId, workflowId: workflow.id, triggerType: 'lead.created', entityType: 'lead', entityId: lead.id, eventId: randomUUID() } });
    const run = await prisma.workflowExecutionRun.create({ data: { tenantId, workflowId: workflow.id, triggerId: trigger.id, entityType: 'lead', entityId: lead.id,
      status: 'interrupted', completedAt: new Date(), dispatchContext: { version: 1, eventContext: { privateBody: 'private-dispatch-evidence' } },
      leaseId: randomUUID(), leaseUntil: new Date(), dispatchStartedAt: new Date(), definitionSnapshot: { name: workflow.name, trigger: workflow.trigger, actions: [] },
      steps: { create: ['send_email', 'send_sms'].map((actionType, stepIndex) => ({ stepIndex, actionType, status: 'failed',
        resolvedInput: { recipient: 'private-recipient@example.test', body: 'private-resolved-input' }, output: { messageId: 'private-provider-id' } })) },
    } });
    const restrictedRole = await prisma.roleDefinition.findFirstOrThrow({ where: { tenantId, name: 'Workflow Viewer' } });
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: restrictedRole.id, module: 'workflows' }, data: { canViewRuns: true } });
    try {
      const hidden = await call(`/automation/workflows/${workflow.id}/executions`, 'GET', undefined, viewerToken);
      expect(hidden.status).toBe(200); expect(hidden.body.data).toEqual([]); expect(hidden.body.meta.total).toBe(0);
      expect((await call(`/automation/workflows/${workflow.id}/executions/${run.id}`, 'GET', undefined, viewerToken)).status).toBe(404);
      const directory = await call('/automation/workflows', 'GET', undefined, viewerToken);
      expect(directory.body.data.find((row: { id: string }) => row.id === workflow.id)).toMatchObject({ totalRuns: 0, successfulRuns: 0, failedRuns: 0, lastRunAt: null });
      for (const suffix of ['/executions', `/executions/${run.id}`]) {
        const visible = await call(`/automation/workflows/${workflow.id}${suffix}`);
        expect(visible.status).toBe(200);
        const item = Array.isArray(visible.body.data) ? visible.body.data[0] : visible.body.data;
        for (const field of ['dispatchContext', 'leaseId', 'leaseUntil', 'dispatchStartedAt']) expect(item).not.toHaveProperty(field);
        for (const step of item.steps) { expect(step).not.toHaveProperty('resolvedInput'); expect(step.output).toBeNull(); }
        expect(JSON.stringify(visible.body)).not.toMatch(/private-(dispatch|resolved|provider|recipient)/);
      }
      const viewGrant = await prisma.rolePermission.create({ data: { tenantId, roleId: restrictedRole.id, module: 'leads', canView: true } });
      try {
        const visible = await call(`/automation/workflows/${workflow.id}/executions`, 'GET', undefined, viewerToken);
        expect(visible.body.data).toHaveLength(1); expect(visible.body.meta.total).toBe(1);
        await prisma.rolePermission.update({ where: { id: viewGrant.id }, data: { canView: false } });
        expect((await call(`/automation/workflows/${workflow.id}/executions`, 'GET', undefined, viewerToken)).body.meta.total).toBe(0);
      } finally { await prisma.rolePermission.delete({ where: { id: viewGrant.id } }); }
    } finally { await prisma.rolePermission.updateMany({ where: { tenantId, roleId: restrictedRole.id, module: 'workflows' }, data: { canViewRuns: false } }); }
  });
  it('does not execute paused, archived, foreign-tenant workflows', async () => {
    const paused = await create([{ type: 'create_task', config: { title: 'Paused' } }], { isActive: false });
    const archived = await create([{ type: 'create_task', config: { title: 'Archived' } }]);
    await scope(() => workflows.archiveWorkflow(archived.id, tenantId, actor.id));
    await fire('deal', deal); expect(await runs(paused.id)).toHaveLength(0); expect(await runs(archived.id)).toHaveLength(0);
    await expect(fireWorkflowTrigger({ tenantId, actorId: actor.id, entityType: 'lead', entityId: lead.id, triggerType: 'lead.created', context: {} })).rejects.toThrow(/tenant context/);
  });
  it('persists draft, update, activation, pause and archive through registered API routes', async () => {
    const created = await call('/automation/workflows', 'POST', { name: 'Persistent draft', trigger: 'lead.created', actions: [] });
    expect(created.status).toBe(201); const id = created.body.data.id;
    expect((await call(`/automation/workflows/${id}`)).body.data.status).toBe('DRAFT');
    expect((await call(`/automation/workflows/${id}`, 'PUT', { name: 'Saved edit', trigger: 'deal.created', actions: [{ type: 'create_task', config: { title: 'Follow up', assignedUserId: owner.id } }] })).status).toBe(200);
    for (let index = 0; index < 2; index++) expect((await call(`/automation/workflows/${id}/toggle`, 'PATCH', { isActive: true })).body.data.isActive).toBe(true);
    const secondSession = (await issueAuthSession(actor)).token;
    expect((await call(`/automation/workflows/${id}`, 'GET', undefined, secondSession)).body.data.name).toBe('Saved edit');
    expect((await call(`/automation/workflows/${id}/toggle`, 'PATCH', { isActive: false })).body.data.status).toBe('PAUSED');
    expect((await call(`/automation/workflows/${id}/archive`, 'PATCH')).status).toBe(200);
    expect((await call(`/automation/workflows/${id}`)).body.data.isArchived).toBe(true);
  });
  it('claims concurrent duplicate events once and returns persisted metrics and execution detail', async () => {
    const workflow = await create([{ type: 'create_task', config: { title: 'Exactly one follow-up', dealId: deal.id, assignedUserId: owner.id } }]);
    const event = { tenantId, actorId: actor.id, entityType: 'deal', entityId: deal.id, triggerType: 'deal.created', eventId: randomUUID(), context: {} };
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
    try { await fire('deal', deal); expect((await runs(workflow.id))[0].status).toBe('failed');
      expect(await prisma.task.count({ where: { tenantId, title: 'Revoked author task' } })).toBe(0);
    } finally { await prisma.user.update({ where: { id: actor.id }, data: { role: 'Client Admin' } }); }
  });
  it('blocks retired Contact selectors before any action and retains definition/execution history for repair', async () => {
    const conditions = {operator:'AND',conditions:[{field:'contact.score',operator:'is_empty',value:null}]};
    const actions = [{type:'update_field',config:{field:'address',value:'Unsafe retired Contact task'}}];
    const saved = await prisma.workflow.create({data:{tenantId,name:'Saved retired Contact score',trigger:'contact.created',conditions,actions,isActive:true,status:'ACTIVE',activatedById:actor.id}});
    await fire('contact',contact);
    const history = await runs(saved.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({status:'failed',errorMessage:expect.stringContaining('Retired Contact field')});
    expect(history[0].definitionSnapshot).toMatchObject({conditions,actions});
    expect(await prisma.task.count({where:{tenantId,title:'Unsafe retired Contact task'}})).toBe(0);
    expect((await call(`/automation/workflows/${saved.id}/toggle`,'PATCH',{isActive:false})).status).toBe(200);
    expect((await prisma.workflow.findUniqueOrThrow({where:{id:saved.id}})).conditions).toEqual(conditions);
    expect((await call(`/automation/workflows/${saved.id}/toggle`,'PATCH',{isActive:true})).status).toBe(400);
    await expect(create([{type:'update_field',config:{field:'activeProducts',value:[]}}],{trigger:'contact.created',isActive:false})).rejects.toThrow('Retired Contact fields');
    expect(await runs(saved.id)).toHaveLength(1);
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
