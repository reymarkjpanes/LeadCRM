import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { EMPTY_PERMISSION_FLAGS, PERMISSION_ACTIONS, ROLE_TEMPLATES, type PermissionFlags } from '@leadcrm/shared';
import app from '../../../../app';
import prisma from '../../../../config/database.config';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { fireWorkflowTrigger } from '../workflow.engine';
import { runAuthorizedWorkflow } from '../../../crm/access/crm-record-access.service';
import { convertClosedLead } from '../../../crm/leads/lead-conversion.service';
import { salesTransaction } from '../../../crm/leads/lead-automation.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('Workflow capability separation with authenticated HTTP and SQL', () => {
  let server: Server, base: string, tenantId: string;
  let manager: { id: string; token: string; roleId: string }, associate: typeof manager;
  const row = (module: string, grants: Partial<PermissionFlags> = {}) => ({ module, ...EMPTY_PERMISSION_FLAGS, ...grants });
  const draft = () => ({ name: `Workflow ${randomUUID()}`, trigger: 'lead.created', isActive: false,
    actions: [{ type: 'update_field', config: { field: 'address', value: 'Workflow action completed' } }] });
  async function actor(name: string, workflowGrants: PermissionFlags) {
    const role = await prisma.roleDefinition.create({ data: { tenantId, name, permissions: { create: [
      row('workflows', workflowGrants), row('leads', { canView: true, canViewAll: true, canEdit: true }),
    ] } } });
    const user = await prisma.user.create({ data: { tenantId, role: name, firstName: name, lastName: 'QA',
      email: `${randomUUID()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date(),
      userRoles: { create: { roleId: role.id } } } });
    return { id: user.id, roleId: role.id, token: (await issueAuthSession(user)).token };
  }
  async function call(path: string, user = associate, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function create(active = true) {
    const saved = await call('/automation/workflows', manager, 'POST', draft());
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    if (!active) return saved.body.data;
    const activated = await call(`/automation/workflows/${saved.body.data.id}/toggle`, manager, 'PATCH', { isActive: true });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    return activated.body.data;
  }
  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  beforeEach(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow RBAC', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    manager = await actor('Sales Admin', ROLE_TEMPLATES.find(template => template.key === 'sales-admin')!.permissions.workflows);
    associate = await actor('Sales Associate', ROLE_TEMPLATES.find(template => template.key === 'sales-associate')!.permissions.workflows);
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });

  it.each(['contacts', 'accounts'])('enforces %s create permission on nested Workflow sale conversion', async module => {
    await prisma.rolePermission.createMany({ data: ['contacts', 'accounts', 'deals'].map(key => ({
      tenantId, roleId: manager.roleId, ...row(key, { canView: true, canViewAll: true, canEdit: true, canCreate: key !== module }),
    })) });
    const companyName = `Conversion ${randomUUID()}`;
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Conversion', lastName: 'QA', companyName, assignedUserId: manager.id } });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Conversion pipeline' } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Won', order: 0, isWon: true } });
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, title: 'Confirmed sale', wonConfirmedAt: new Date(),
      assignedUserId: manager.id, leadDeals: { create: { leadId: lead.id } } } });
    const convert = () => tenantContext.run({ tenantId }, () => runAuthorizedWorkflow(tenantId, randomUUID(),
      () => salesTransaction(tx => convertClosedLead(tx, tenantId, lead.id, manager.id)), manager.id));
    await expect(convert()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toMatchObject({ convertedAt: null, accountId: null, contactId: null });
    expect(await prisma.deal.findUnique({ where: { id: deal.id } })).toMatchObject({ accountId: null });
    expect(await prisma.account.count({ where: { tenantId, name: companyName } })).toBe(0);
    expect(await prisma.contact.count({ where: { tenantId, companyName } })).toBe(0);
    await prisma.rolePermission.update({ where: { roleId_module: { roleId: manager.roleId, module } }, data: { canCreate: true } });
    await expect(convert()).resolves.toMatchObject({ lead: { id: lead.id, status: 'Closed Deal' }, contact: { tenantId, status: 'CLOSED_DEAL' } });
  });

  it('lets Sales Admin configure and activate, and Sales Associate view, check and read actual execution history', async () => {
    await prisma.tenantGroup.create({ data: { tenantId, name: 'Workflow supervision', members: { create: [
      { userId: manager.id, isHead: true }, { userId: associate.id },
    ] } } });
    const workflow = await create(false);
    const edited = await call(`/automation/workflows/${workflow.id}`, manager, 'PUT', { description: 'Configured by Sales Admin' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect((await call(`/automation/workflows/${workflow.id}/toggle`, manager, 'PATCH', { isActive: true })).status).toBe(200);
    expect((await call('/automation/workflows')).body.data.map((record: { id: string }) => record.id)).toContain(workflow.id);
    expect((await call(`/automation/workflows/${workflow.id}`)).status).toBe(200);
    const sample = await prisma.lead.create({ data: { tenantId, firstName: 'Workflow', lastName: 'Customer', address: 'Original', assignedUserId: associate.id } });
    const check = await call(`/automation/workflows/${workflow.id}/test`, associate, 'POST', { entityId: sample.id });
    expect(check.status, JSON.stringify(check.body)).toBe(200); expect(check.body.data.valid).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: sample.id } })).address).toBe('Original');
    expect(await prisma.workflowExecutionRun.count({ where: { tenantId } })).toBe(0);
    await tenantContext.run({ tenantId }, () => fireWorkflowTrigger({ tenantId, triggerType: 'lead.created', entityType: 'lead', entityId: sample.id, actorId: associate.id, eventId: randomUUID(), context: {} }));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: sample.id } })).address).toBe('Workflow action completed');
    const runs = await call(`/automation/workflows/${workflow.id}/executions`);
    expect(runs.status, JSON.stringify(runs.body)).toBe(200); expect(runs.body.data[0].status).toBe('completed');
    expect((await call(`/automation/workflows/${workflow.id}/executions/${runs.body.data[0].id}`)).status).toBe(200);
  });

  it('denies every management route and state payload to the default Sales Associate without modifying the workflow', async () => {
    const workflow = await create();
    const prefix = `/automation/workflows/${workflow.id}`;
    const revision = { draft: draft(), expectedVersion: workflow.version, expectedDraftRevision: workflow.draftRevision };
    for (const [method, path, body] of [
      ['POST', '/automation/workflows', draft()], ['PUT', prefix, { name: 'Forbidden' }],
      ['PUT', prefix, { isActive: false }], ['PUT', prefix, { isActive: true }],
      ['PUT', prefix, { name: 'Forbidden', isActive: false }], ['PUT', `${prefix}/draft`, revision],
      ['POST', `${prefix}/publish`, revision], ['POST', `${prefix}/duplicate`, {}],
      ['POST', `${prefix}/versions/1/restore`, revision], ['PATCH', `${prefix}/archive`, {}],
      ['PATCH', `${prefix}/toggle`, { isActive: false }], ['PATCH', `${prefix}/toggle`, { isActive: true }],
    ] as const) expect((await call(path, associate, method, body)).status, `${method} ${path}`).toBe(403);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } }))).toMatchObject({ isActive: true, isArchived: false, name: workflow.name });
    await call(`${prefix}/toggle`, manager, 'PATCH', { isActive: false });
    expect((await call(`${prefix}/toggle`, associate, 'PATCH', { isActive: true })).status).toBe(403);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).status).toBe('PAUSED');
  });

  it('persists configurable grants, applies them to existing sessions, preserves unrelated modules and separates pause/resume from activation', async () => {
    await prisma.rolePermission.create({ data: { tenantId, roleId: manager.roleId, ...row('roles', { canView: true, canEdit: true }) } });
    const workflow = await create(), inactive = await create(false);
    const unrelated = await prisma.rolePermission.findUniqueOrThrow({ where: { roleId_module: { roleId: associate.roleId, module: 'leads' } } });
    const detail = await call(`/administration/roles/${associate.roleId}`, manager);
    expect(detail.status).toBe(200);
    const permissions = detail.body.data.permissions.map((permission: PermissionFlags & { module: string }) => row(permission.module,
      Object.fromEntries(PERMISSION_ACTIONS.map(flag => [flag, permission[flag] === true]))));
    const workflowRow = permissions.find((permission: { module: string }) => permission.module === 'workflows');
    workflowRow.canPause = true;
    expect((await call(`/administration/roles/${associate.roleId}`, manager, 'PUT', { permissions })).status).toBe(200);
    expect((await call(`/administration/roles/${associate.roleId}`, manager)).body.data.permissions.find((permission: { module: string }) => permission.module === 'workflows').canPause).toBe(true);
    expect((await call(`/administration/users/${associate.id}/permissions`)).body.data.workflows.canPause).toBe(true);
    expect((await call(`/automation/workflows/${workflow.id}/toggle`, associate, 'PATCH', { isActive: false })).status).toBe(200);
    expect((await call(`/automation/workflows/${workflow.id}/toggle`, associate, 'PATCH', { isActive: true })).status).toBe(200);
    expect((await call(`/automation/workflows/${workflow.id}/toggle`, associate, 'PATCH', { isActive: true })).status).toBe(200);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).activatedById).toBe(manager.id);
    expect((await call(`/automation/workflows/${inactive.id}/toggle`, associate, 'PATCH', { isActive: true })).status).toBe(403);
    expect((await call(`/automation/workflows/${workflow.id}`, associate, 'PUT', { name: 'Forbidden', isActive: false })).status).toBe(403);
    workflowRow.canPause = false; workflowRow.canExecute = false; workflowRow.canViewRuns = false;
    expect((await call(`/administration/roles/${associate.roleId}`, manager, 'PUT', { permissions })).status).toBe(200);
    expect((await call(`/automation/workflows/${workflow.id}/toggle`, associate, 'PATCH', { isActive: false })).status).toBe(403);
    expect((await call(`/automation/workflows/${workflow.id}/test`, associate, 'POST', { entityId: randomUUID() })).status).toBe(403);
    expect((await call(`/automation/workflows/${workflow.id}/executions`)).status).toBe(403);
    expect((await call(`/automation/workflows/${workflow.id}`)).body.data).not.toHaveProperty('totalRuns');
    expect(await prisma.rolePermission.findUniqueOrThrow({ where: { id: unrelated.id } })).toEqual(unrelated);
    expect((await call(`/administration/roles/${associate.roleId}`, associate, 'PUT', { permissions })).status).toBe(403);
  });

  it('does not treat activation as pause authority and retains deleted workflows and their history', async () => {
    await prisma.rolePermission.update({ where: { roleId_module: { roleId: associate.roleId, module: 'workflows' } }, data: { canActivate: true } });
    const workflow = await create(false);
    expect((await call(`/automation/workflows/${workflow.id}/toggle`, associate, 'PATCH', { isActive: true })).status).toBe(200);
    for (const method of ['PATCH', 'PUT']) {
      expect((await call(`/automation/workflows/${workflow.id}${method === 'PATCH' ? '/toggle' : ''}`, associate, method, { isActive: false })).status).toBe(403);
    }
    expect((await call(`/automation/workflows/${workflow.id}/archive`, manager, 'PATCH')).status).toBe(200);
    expect(await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).toMatchObject({ isActive: false, isArchived: true });
    expect(await prisma.workflowPublication.count({ where: { workflowId: workflow.id } })).toBeGreaterThan(0);
  });

  it('retains action permissions for checks and tenant boundaries for shared workflow access', async () => {
    const workflow = await create();
    const sample = await prisma.lead.create({ data: { tenantId, firstName: 'Permission', lastName: 'Customer' } });
    await prisma.rolePermission.update({ where: { roleId_module: { roleId: associate.roleId, module: 'leads' } }, data: { canEdit: false } });
    expect((await call(`/automation/workflows/${workflow.id}/test`, associate, 'POST', { entityId: sample.id })).status).toBe(403);
    const foreignTenant = await prisma.tenant.create({ data: { name: 'Foreign', slug: randomUUID() } });
    const foreign = await prisma.workflow.create({ data: { tenantId: foreignTenant.id, name: 'Foreign workflow', trigger: 'lead.created', actions: [] } });
    expect((await call(`/automation/workflows/${foreign.id}`)).status).toBe(404);
    expect((await call(`/automation/workflows/${foreign.id}/executions`)).status).toBe(404);
    expect((await call(`/automation/workflows/${foreign.id}/toggle`, manager, 'PATCH', { isActive: true })).status).toBe(404);
    expect((await call(`/automation/workflows/${foreign.id}/test`, associate, 'POST', { entityId: sample.id })).status).toBe(404);
  });

  it('accepts permitted manual status and stage changes and rejects the same direct requests without grants', async () => {
    await prisma.rolePermission.create({ data: { tenantId, roleId: manager.roleId, ...row('deals', { canView: true, canViewAll: true, canEdit: true }) } });
    await prisma.rolePermission.update({ where: { roleId_module: { roleId: associate.roleId, module: 'leads' } }, data: { canEdit: false } });
    expect((await call('/automation/workflows', manager, 'POST', { ...draft(), isActive: true, trigger: 'lead.status_changed',
      conditions: { operator: 'AND', conditions: [{ field: 'lead.status', operator: 'equals', value: 'Hot' }] } })).status).toBe(201);
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Manual', lastName: 'QA', status: 'Hot', assignedUserId: manager.id } });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Manual pipeline' } });
    const initial = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
    const next = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Contacted', order: 1 } });
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: initial.id, title: 'Manual Deal', assignedUserId: manager.id } });
    const leadPath = `/crm/leads/${lead.id}`, stagePath = `/crm/deals/${deal.id}/stage`;
    expect((await call(leadPath, associate, 'PUT', { status: 'Cold' })).status).toBe(403);
    expect((await call(stagePath, associate, 'PATCH', { stageId: next.id })).status).toBe(403);
    expect((await call(leadPath, manager, 'PUT', { status: 'Warm' })).status).toBe(200);
    expect((await call(stagePath, manager, 'PATCH', { stageId: next.id })).status).toBe(200);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: 'Warm' });
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ stageId: next.id });
  });

  it('scopes execution history, counts and action Deal metadata to current authorized Groups', async () => {
    const outside = await actor('Other sales team', ROLE_TEMPLATES.find(template => template.key === 'sales-associate')!.permissions.workflows);
    for (const user of [manager, associate, outside]) await prisma.rolePermission.create({ data: {
      tenantId, roleId: user.roleId, ...row('deals', { canView: true, canViewAll: true }),
    } });
    const groupA = await prisma.tenantGroup.create({ data: { tenantId, name: 'History Group A', members: { create: [
      { userId: manager.id, isHead: true }, { userId: associate.id },
    ] } } });
    await prisma.tenantGroup.create({ data: { tenantId, name: 'History Group B', members: { create: { userId: outside.id } } } });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'History pipeline' } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
    const deals = await Promise.all([associate, manager, outside].map(user => prisma.deal.create({ data: {
      tenantId, pipelineId: pipeline.id, stageId: stage.id, title: `History Deal ${user.id}`, assignedUserId: user.id,
    } })));
    const workflow = await prisma.workflow.create({ data: { tenantId, createdById: manager.id,
      name: 'Group scoped history', trigger: 'deal.updated', actions: [] } });
    const ownOutput = { taskId: randomUUID(), dealIds: [deals[0].id], deals: [{ id: deals[0].id, title: deals[0].title }],
      dealCount: 1, associationSummary: '1 associated Deal' };
    const mixedOutput = { ...ownOutput, dealIds: [deals[0].id, deals[2].id],
      deals: [{ id: deals[0].id, title: deals[0].title }, { id: deals[2].id, title: deals[2].title }], dealCount: 2 };
    const runs = await Promise.all(deals.map(async (deal, index) => {
      const trigger = await prisma.workflowTriggerRecord.create({ data: { tenantId, workflowId: workflow.id, triggerType: 'deal.updated',
        entityType: 'deal', entityId: deal.id, eventId: randomUUID(), payload: { recordName: deal.title } } });
      return prisma.workflowExecutionRun.create({ data: { tenantId, workflowId: workflow.id, triggerId: trigger.id,
        entityType: 'deal', entityId: deal.id, status: 'completed', steps: { create: index ? [] : [
          { stepIndex: 0, actionType: 'create_task', status: 'success', output: mixedOutput },
          { stepIndex: 1, actionType: 'move_deal_stage', status: 'success', output: { matchedDealIds: [deals[0].id, deals[2].id], movedDealIds: [deals[2].id], failedDealId: deals[2].id } },
          { stepIndex: 2, actionType: 'create_task', status: 'success', output: ownOutput },
          { stepIndex: 3, actionType: 'create_task', status: 'success', output: { taskId: ownOutput.taskId,
            dealNames: [deals[2].title], dealCount: 1, associationSummary: '1 associated Deal' } },
        ] } } });
    }));
    const page = await call(`/automation/workflows/${workflow.id}/executions`);
    expect(page.status).toBe(200);
    expect(page.body.meta.total).toBe(1);
    expect(page.body.data.map((run: { id: string }) => run.id)).toEqual([runs[0].id]);
    const list = await call('/automation/workflows');
    expect(list.body.data.find((row: { id: string }) => row.id === workflow.id).totalRuns).toBe(1);
    expect((await call(`/automation/workflows/${workflow.id}/executions`, manager)).body.meta.total).toBe(2);
    expect((await call(`/automation/workflows/${workflow.id}/executions/${runs[1].id}`)).status).toBe(404);
    expect((await call(`/automation/workflows/${workflow.id}/executions/${runs[2].id}`, manager)).status).toBe(404);
    expect((await call(`/automation/workflows/${workflow.id}/executions/${runs[2].id}`)).status).toBe(404);
    const detail = await call(`/automation/workflows/${workflow.id}/executions/${runs[0].id}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain(deals[2].id);
    expect(JSON.stringify(detail.body)).not.toContain(deals[2].title);
    expect(detail.body.data.steps[0].output).toEqual({ taskId: ownOutput.taskId });
    expect(detail.body.data.steps[1].output).toEqual({});
    expect(detail.body.data.steps[2].output).toEqual(ownOutput);
    expect(detail.body.data.steps[3].output).toEqual({ taskId: ownOutput.taskId });
    const clientAdmin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', firstName: 'History', lastName: 'Admin',
      email: `${randomUUID()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    await prisma.tenantGroup.create({ data: { tenantId, name: 'Administrative history Group', members: { create: { userId: clientAdmin.id, isHead: true } } } });
    const admin = { id: clientAdmin.id, roleId: '', token: (await issueAuthSession(clientAdmin)).token };
    expect((await call(`/automation/workflows/${workflow.id}/executions`, admin)).body.meta.total).toBe(3);
    expect((await call(`/automation/workflows/${workflow.id}/executions/${runs[0].id}`, admin)).body.data.steps[0].output).toEqual(mixedOutput);
    await prisma.tenantGroupMember.update({ where: { groupId_userId: { groupId: groupA.id, userId: manager.id } }, data: { isHead: false } });
    expect((await call(`/automation/workflows/${workflow.id}/executions`, manager)).body.meta.total).toBe(1);
    expect((await call(`/automation/workflows/${workflow.id}/executions/${runs[0].id}`, manager)).status).toBe(404);
  });
});
