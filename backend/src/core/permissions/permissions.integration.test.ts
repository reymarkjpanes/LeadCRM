import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PERMISSION_MODULES, PERMISSION_ACTION_KEYS, EMPTY_PERMISSION_FLAGS, type PermissionKey } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import app from '../../app';
import { issueAuthSession } from '../auth/auth-session';
import { assertPermissions } from './permission.service';
import { seedSystemRoles } from '../../database/seeders/roles.seed';
import { mailboxPermissions } from '../../integrations/gmail/mailbox-sync.service';
import { tenantContext } from '../tenant/tenant-context';
import { eligibleAgents } from '../../modules/crm/leads/lead-automation.service';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost','127.0.0.1'].includes(url.hostname) && /^\/leadcrm_environment_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('independent module actions with real sessions and database roles', () => {
  let server: Server, base: string, tenantId: string, adminToken: string;
  async function roleUser(name: string, permissions: Array<Record<string, unknown>>) {
    const role = await prisma.roleDefinition.create({ data: { name, tenantId, permissions: { create: permissions.map(p => ({ ...EMPTY_PERMISSION_FLAGS, ...p })) as never } } });
    const user = await prisma.user.create({ data: { tenantId, role: name, email: `${role.id}@camxian.com`, firstName: name, lastName: 'QA', mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId: role.id } } } });
    return { token: (await issueAuthSession(user)).token, user: { userId: user.id, tenantId, role: name }, roleId: role.id };
  }
  async function call(path: string, token: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Permission QA', slug: `permission-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    await seedSystemRoles(tenantId);
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: 'permissions-admin@camxian.com', firstName: 'QA', lastName: 'Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    adminToken = (await issueAuthSession(admin)).token;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });
  it('enforces each of the 75 grants independently and requires its module View', async () => {
    const actor = await roleUser('Catalog QA', []);
    let count = 0;
    for (const module of PERMISSION_MODULES) {
      for (const action of module.actions) {
        const key = `${module.key}.${PERMISSION_ACTION_KEYS[action]}` as PermissionKey;
        await expect(assertPermissions(actor.user, [key])).rejects.toMatchObject({ statusCode: 403 });
        const row = await prisma.rolePermission.create({ data: { tenantId, roleId: actor.roleId, module: module.key, ...EMPTY_PERMISSION_FLAGS, canView: true, [action]: true } });
        await expect(assertPermissions(actor.user, [key])).resolves.toBeUndefined();
        await prisma.rolePermission.update({ where: { id: row.id }, data: { canView: false } });
        await expect(assertPermissions(actor.user, [key])).rejects.toMatchObject({ statusCode: 403 });
        await prisma.rolePermission.delete({ where: { id: row.id } }); count++;
      }
    }
    expect(count).toBe(75);
    for (const key of ['roles.manage','settings.create','settings.delete','reports.view','billing.view','leads.delete']) {
      await expect(assertPermissions({ ...actor.user, role: 'Client Admin' }, [key as PermissionKey])).rejects.toMatchObject({ statusCode: 403 });
    }
  }, 60000);
  it('Sales Staff can create/edit Leads but cannot archive, import, manage roles or settings', async () => {
    const actor = await roleUser('Sales Staff', [{ module: 'leads', canView: true, canCreate: true, canEdit: true }]);
    const created = await call('/crm/leads', actor.token, 'POST', { firstName: 'Test', lastName: 'Lead', email: 'qa-lead@example.com' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await call(`/crm/leads/${created.body.data.id}`, actor.token, 'PUT', { firstName: 'Updated' })).status).toBe(200);
    for (const path of ['/administration/roles','/administration/organization-settings','/crm/contacts']) expect((await call(path, actor.token)).status).toBe(403);
    expect((await call(`/crm/leads/${created.body.data.id}/archive`, actor.token, 'PATCH')).status).toBe(403);
    expect((await call('/crm/leads/imports', actor.token, 'POST', {})).status).toBe(403);
  });
  it('Campaign draft editors cannot send, duplicate or read reports through HTTP', async () => {
    const actor = await roleUser('Campaign Staff', [{ module: 'campaigns', canView: true, canCreate: true, canEdit: true }]);
    expect((await call('/marketing/campaigns', actor.token)).status).toBe(200);
    const draft = await call('/marketing/campaigns', actor.token, 'POST', { name: 'Draft QA', type: 'EMAIL', subject: 'Hello', body: '<p>Draft</p>', audienceSource: 'LEADS' });
    expect(draft.status).toBe(201);
    expect((await call(`/marketing/campaigns/${draft.body.data.id}`, actor.token, 'PUT', { name: 'Edited draft' })).status).toBe(200);
    for (const [method,path] of [['PATCH','/marketing/campaigns/missing/send'],['POST','/marketing/campaigns/missing/duplicate'],['GET','/marketing/campaigns/missing/report'],['GET','/marketing/campaigns/metrics']]) expect((await call(path, actor.token, method, method === 'GET' ? undefined : {})).status).toBe(403);
  });
  it('Sales Manager needs an explicit stage-management grant independently of editing deals', async () => {
    const actor = await roleUser('Sales Manager', [{ module: 'deals', canView: true, canCreate: true, canEdit: true, canArchive: true }]);
    expect((await call('/crm/pipelines/missing', actor.token, 'PUT', { name: 'Updated pipeline' })).status).toBe(403);
    await prisma.rolePermission.update({ where: { roleId_module: { roleId: actor.roleId, module: 'deals' } }, data: { canManageStages: true } });
    await expect(assertPermissions(actor.user, ['deals.manage_stages'])).resolves.toBeUndefined();
    expect((await call('/crm/pipelines/missing', actor.token, 'PUT', { name: 'Updated pipeline' })).status).toBe(404);
  });
  it('blocks direct endpoints and generic task/user mutation bypasses', async () => {
    const actor = await roleUser('Restricted QA', []);
    for (const [method,path] of [
      ['GET','/operations/tasks'], ['GET','/automation/workflows'], ['GET','/marketing/forms'],
      ['GET','/administration/product-interests'], ['GET','/administration/closing-requirements'], ['GET','/administration/archived-data'],
      ['PATCH','/operations/tasks/missing/complete'], ['PATCH','/automation/workflows/missing/toggle'], ['GET','/automation/workflows/missing/executions'],
      ['PATCH','/marketing/forms/missing/publish'], ['DELETE','/marketing/forms/missing'], ['GET','/marketing/forms/missing/submissions'],
      ['GET','/administration/product-interests/missing/closed-won'], ['PATCH','/administration/archived-data/leads/missing/restore'],
      ['POST','/administration/roles/assign'], ['PUT',`/administration/users/${actor.user.userId}`],
    ]) expect((await call(path, actor.token, method, method === 'GET' ? undefined : {})).status, path).toBe(403);
    // Group directory reads require the same explicit View grant as other modules.
    expect((await call('/administration/groups', actor.token)).status).toBe(403);
    expect((await call('/administration/groups/missing/members', actor.token, 'POST', { userId: actor.user.userId })).status).toBe(403);
    const editor = await roleUser('Task Editor QA', [{ module: 'tasks', canView: true, canCreate: true, canEdit: true }]);
    const task = await call('/operations/tasks', editor.token, 'POST', { title: 'Permission QA', dueDate: '2026-11-01T09:00:00.000Z', assignedUserId: editor.user.userId });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    expect((await call(`/operations/tasks/${task.body.data.id}`, editor.token, 'PUT', { status: 'completed' })).status).toBe(403);
    expect((await call(`/operations/tasks/${task.body.data.id}`, editor.token, 'PUT', { assignedUserId: actor.user.userId })).status).toBe(403);
    const operator = await roleUser('Task Operator QA', [{ module: 'tasks', canView: true, canComplete: true, canAssign: true }]);
    expect((await call(`/operations/tasks/${task.body.data.id}`, operator.token, 'PUT', { assignedUserId: actor.user.userId })).status).toBe(200);
    expect((await call(`/operations/tasks/${task.body.data.id}`, operator.token, 'PUT', { status: 'completed' })).status).toBe(200);
    expect((await call(`/operations/tasks/${task.body.data.id}`, operator.token, 'PUT', { title: 'Unauthorized rename' })).status).toBe(403);
  });
  it('validates unknown flags/prerequisites and protects Client Admin permissions and role', async () => {
    for (const permission of [{ module: 'leads', canView: false, canEdit: true }, { module: 'settings', canCreate: true }, { module: 'leads', arbitrary: true }]) {
      expect((await call('/administration/roles', adminToken, 'POST', { name: 'Bad permission', permissions: [{ ...EMPTY_PERMISSION_FLAGS, ...permission }] })).status).toBe(400);
    }
    const admin = await prisma.roleDefinition.findUniqueOrThrow({ where: { tenantId_name: { tenantId, name: 'Client Admin' } }, include: { permissions: true } });
    expect(admin.permissions.reduce((sum, row) => sum + PERMISSION_MODULES.find(m => m.key === row.module)!.actions.filter(action => row[action]).length, 0)).toBe(75);
    expect((await call(`/administration/roles/${admin.id}`, adminToken, 'PUT', { permissions: [] })).status).toBe(403);
    expect((await call(`/administration/roles/${admin.id}/archive`, adminToken, 'PATCH')).status).toBe(403);
  });
  it('allows disabling a custom field without granting general field editing', async () => {
    const actor = await roleUser('Field Maintenance QA', [{ module: 'custom_fields', canView: true, canDisable: true }]);
    const field = await call('/administration/closing-requirements', adminToken, 'POST', { name: 'QA field', type: 'Text', appliesTo: 'Closed Won Requirements', required: false, active: true });
    expect(field.status, JSON.stringify(field.body)).toBe(200);
    const disabled = await call(`/administration/closing-requirements/${field.body.data.id}`, actor.token, 'PATCH', { active: false });
    expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);
    expect(disabled.body.data.active).toBe(false);
    expect((await call(`/administration/closing-requirements/${field.body.data.id}`, actor.token, 'PATCH', { name: 'Unauthorized rename' })).status).toBe(403);
  });
  it('separates user role assignment and activation from editing personal details', async () => {
    const target = await roleUser('Assignment Target QA', []);
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Assignment Destination QA' } });
    const actor = await roleUser('Access Manager QA', [{ module: 'users', canView: true, canActivate: true }, { module: 'roles', canView: true, canAssign: true }]);
    expect((await call(`/administration/users/${target.user.userId}`, actor.token, 'PUT', { role: role.name })).status).toBe(200);
    expect((await call(`/administration/users/${target.user.userId}`, actor.token, 'PUT', { status: 'INACTIVE' })).status).toBe(200);
    expect((await call(`/administration/users/${target.user.userId}`, actor.token, 'PUT', { firstName: 'Unauthorized rename' })).status).toBe(403);
    const editor = await roleUser('User Editor QA', [{ module: 'users', canView: true, canEdit: true }]);
    expect((await call(`/administration/users/${target.user.userId}`, editor.token, 'PUT', { role: role.name })).status).toBe(403);
    expect((await call(`/administration/users/${target.user.userId}`, editor.token, 'PUT', { status: 'ACTIVE' })).status).toBe(403);
  });
  it('does not use Contacts grants for Lead mailbox automation', async () => {
    const contactActor = await roleUser('Contact Mail QA', [{ module: 'contacts', canView: true, canEdit: true }]);
    const leadActor = await roleUser('Lead Mail QA', [{ module: 'leads', canView: true, canEdit: true }]);
    expect(await tenantContext.run({ tenantId }, () => mailboxPermissions(tenantId, contactActor.user.userId, false)))
      .toMatchObject({ contactsView: true, contactsEdit: true, leadsView: false, leadsEdit: false });
    expect(await tenantContext.run({ tenantId }, () => mailboxPermissions(tenantId, leadActor.user.userId, false)))
      .toMatchObject({ contactsView: false, contactsEdit: false, leadsView: true, leadsEdit: true });
  });
  it('requires Lead and Deal grants for automatic Lead ownership instead of Contact grants', async () => {
    const contactActor = await roleUser('Contact Sales QA', [
      { module: 'contacts', canView: true, canEdit: true },
      { module: 'deals', canView: true, canEdit: true },
    ]);
    const leadActor = await roleUser('Lead Sales QA', [
      { module: 'leads', canView: true, canEdit: true },
      { module: 'deals', canView: true, canEdit: true },
    ]);
    const agents = await tenantContext.run({ tenantId }, () => eligibleAgents(prisma, tenantId));
    expect(agents.map(agent => agent.id)).toContain(leadActor.user.userId);
    expect(agents.map(agent => agent.id)).not.toContain(contactActor.user.userId);
  });
});
