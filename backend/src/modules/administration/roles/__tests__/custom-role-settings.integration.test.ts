import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EMPTY_PERMISSION_FLAGS, PERMISSION_MODULES } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import app from '../../../../app';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import { assertPermissions } from '../../../../core/permissions/permission.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_environment_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('custom-role Settings access with persisted assignments and authenticated HTTP', () => {
  let server: Server, base: string, tenantId: string, otherTenantId: string, adminToken: string;
  let adminId: string, adminRoleId: string, salesRoleId: string;
  let sequence = 0;
  const row = (module: string, grants: object = {}) => ({ module, ...EMPTY_PERMISSION_FLAGS, ...grants });
  async function role(name: string, permissions: ReturnType<typeof row>[] = [], scope = tenantId) {
    return prisma.roleDefinition.create({ data: { tenantId: scope, name, permissions: { create: permissions } } });
  }
  async function actor(primary: string, assigned: string[], scope = tenantId) {
    const user = await prisma.user.create({ data: {
      tenantId: scope, role: primary, email: `settings-access-${++sequence}@camxian.com`, firstName: 'Access', lastName: 'QA',
      mustChangePassword: false, onboardingCompletedAt: new Date(),
      userRoles: { create: assigned.map(roleId => ({ roleId })) },
    } });
    return { user, token: (await issueAuthSession(user)).token };
  }
  async function call(path: string, bearer = adminToken, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function snapshot() {
    return {
      organization: await prisma.tenant.findUnique({ where: { id: tenantId } }),
      roles: await prisma.roleDefinition.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      permissions: await prisma.rolePermission.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      users: await prisma.user.findMany({ where: { tenantId }, select: { id: true, role: true, firstName: true }, orderBy: { id: 'asc' } }),
      assignments: await prisma.userRole.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      audits: await prisma.auditLog.count({ where: { tenantId } }),
    };
  }
  const writes = (userId: string): Array<[string, string, unknown]> => [
    ['PATCH', '/administration/organization-settings', { name: 'Unauthorized organization' }],
    ['POST', '/administration/roles', { name: 'Unauthorized role', permissions: [] }],
    ['PUT', `/administration/roles/${salesRoleId}`, { permissions: [] }],
    ['PATCH', `/administration/roles/${salesRoleId}/archive`, {}],
    ['POST', '/administration/roles/assign', { userId, roleId: salesRoleId }],
    ['DELETE', '/administration/roles/unassign', { userId, roleId: salesRoleId }],
    ['PUT', `/administration/users/${userId}`, { role: 'Sales' }],
    ['POST', '/administration/users/bulk-update', { ids: [userId], role: 'Sales' }],
  ];
  async function denyWrites(token: string, userId: string) {
    const before = await snapshot();
    for (const [method, path, body] of writes(userId)) expect((await call(path, token, method, body)).status, `${method} ${path}`).toBe(403);
    expect(await snapshot()).toEqual(before);
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Settings access QA', slug: `settings-access-${Date.now()}`, email: 'settings@camxian.com', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenantId = (await prisma.tenant.create({ data: { name: 'Other Settings QA', slug: `other-settings-access-${Date.now()}`, email: 'other@camxian.com', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    adminRoleId = (await prisma.roleDefinition.create({ data: { tenantId, name: 'Client Admin', isSystemRole: true,
      permissions: { create: PERMISSION_MODULES.map(module => row(module.key, Object.fromEntries(module.actions.map(action => [action, true])))) } } })).id;
    salesRoleId = (await role('Sales', [row('leads', { canView: true, canViewMy: true, canEdit: true }), row('tasks', { canView: true }), row('roles'), row('settings')])).id;
    const admin = await actor('Client Admin', []); adminToken = admin.token; adminId = admin.user.id;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('denies the confirmed Sales label/Client Admin assignment mismatch without writes or request-role bypass', async () => {
    const sales = await actor('Sales', [adminRoleId]);
    expect((await call(`/administration/users/${sales.user.id}/permissions`, sales.token)).body.data).toEqual({});
    for (const path of ['/administration/roles', `/administration/roles/${salesRoleId}`, '/administration/permissions', '/administration/organization-settings']) {
      expect((await call(path, sales.token)).status, path).toBe(403);
    }
    await denyWrites(sales.token, sales.user.id);
    await expect(assertPermissions({ userId: sales.user.id, tenantId, role: 'Client Admin' }, ['settings.edit'])).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.userRole.findMany({ where: { userId: sales.user.id } })).map(link => link.roleId)).toEqual([adminRoleId]);
  });
  it('ignores incompatible administrator links while retaining enabled Sales modules and personal settings', async () => {
    const sales = await actor('Sales', [salesRoleId, adminRoleId]);
    const grants = (await call(`/administration/users/${sales.user.id}/permissions`, sales.token)).body.data;
    expect(grants).toMatchObject({ roles: { canView: false, canEdit: false }, settings: { canView: false, canEdit: false }, leads: { canView: true, canEdit: true } });
    for (const path of ['/crm/leads', '/operations/tasks', '/auth/me']) expect((await call(path, sales.token)).status, path).toBe(200);
    expect((await call('/administration/organization-settings', sales.token)).status).toBe(403);
    await denyWrites(sales.token, sales.user.id);
  });
  it('combines legitimate secondary grants and permits view-only reads while rejecting every protected write', async () => {
    const reader = await role('Settings secondary reader', [row('roles', { canView: true }), row('settings', { canView: true })]);
    const sales = await actor('Sales', [salesRoleId, reader.id]);
    const grants = (await call(`/administration/users/${sales.user.id}/permissions`, sales.token)).body.data;
    expect(grants).toMatchObject({ roles: { canView: true, canEdit: false, canAssign: false }, settings: { canView: true, canEdit: false }, leads: { canEdit: true } });
    for (const path of ['/administration/roles', `/administration/roles/${salesRoleId}`, '/administration/organization-settings']) expect((await call(path, sales.token)).status, path).toBe(200);
    await denyWrites(sales.token, sales.user.id);
  });
  it('persists disabled flags and revokes a live session and its already-open edit form immediately', async () => {
    const editorRole = await role('Settings editor', [row('roles', { canView: true, canEdit: true }), row('settings', { canView: true, canEdit: true })]);
    const editor = await actor(editorRole.name, [editorRole.id]);
    expect((await call('/administration/organization-settings', editor.token)).status).toBe(200);
    expect((await call(`/administration/roles/${salesRoleId}`, editor.token)).status).toBe(200);
    const revision = await prisma.dashboardRevision.findUniqueOrThrow({ where: { tenantId } });
    const updated = await call(`/administration/roles/${editorRole.id}`, adminToken, 'PUT', { permissions: [row('roles'), row('settings')] });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.permissions).toEqual(expect.arrayContaining([expect.objectContaining(row('roles')), expect.objectContaining(row('settings'))]));
    expect((await prisma.dashboardRevision.findUniqueOrThrow({ where: { tenantId } })).access).toBeGreaterThan(revision.access);
    expect((await call(`/administration/users/${editor.user.id}/permissions`, editor.token)).body.data).toMatchObject({ roles: { canView: false, canEdit: false }, settings: { canView: false, canEdit: false } });
    expect((await call('/administration/roles', editor.token)).status).toBe(403);
    expect((await call('/administration/organization-settings', editor.token)).status).toBe(403);
    await denyWrites(editor.token, editor.user.id);
  });
  it('requires each Roles action independently without allowing general user edits to assign roles', async () => {
    for (const [flag, method, path, body] of [
      ['canCreate', 'POST', '/administration/roles', { name: 'Independent custom role', permissions: [] }],
      ['canEdit', 'PUT', `/administration/roles/${salesRoleId}`, { description: 'Authorized edit' }],
      ['canArchive', 'PATCH', `/administration/roles/${salesRoleId}/archive`, {}],
      ['canAssign', 'POST', '/administration/roles/assign', {}],
    ] as const) {
      const definition = await role(`Independent ${flag}`, [row('roles', { canView: true })]);
      const staff = await actor(definition.name, [definition.id]);
      const target = await actor('Sales', [salesRoleId]);
      const payload = flag === 'canAssign' ? { userId: target.user.id, roleId: definition.id } : body;
      expect((await call(path, staff.token, method, payload)).status).toBe(403);
      await prisma.rolePermission.update({ where: { roleId_module: { roleId: definition.id, module: 'roles' } }, data: { [flag]: true } });
      const result = await call(path, staff.token, method, payload);
      // Archive reaches the business guard because this role has assigned users.
      expect(result.status, JSON.stringify(result.body)).toBe(flag === 'canArchive' ? 409 : flag === 'canCreate' ? 201 : 200);
    }
    const userEditor = await role('General user editor', [row('users', { canView: true, canEdit: true })]);
    const staff = await actor(userEditor.name, [userEditor.id]);
    const target = await actor('Sales', [salesRoleId]);
    expect((await call(`/administration/users/${target.user.id}`, staff.token, 'PUT', { role: userEditor.name })).status).toBe(403);
  });
  it('keeps valid secondary assignments and junction identities during primary reassignment and protects Client Admin', async () => {
    const secondary = await role('Assignment secondary', [row('settings', { canView: true })]);
    const destination = await role('Assignment destination', [row('leads', { canView: true })]);
    const target = await actor('Sales', [salesRoleId, secondary.id]);
    const secondaryLink = await prisma.userRole.findUniqueOrThrow({ where: { userId_roleId_tenantId: { userId: target.user.id, roleId: secondary.id, tenantId } } });
    for (const [path, body] of [
      ['/administration/roles/assign', { userId: target.user.id, roleId: destination.id }],
      [`/administration/users/${target.user.id}`, { role: destination.name }],
      ['/administration/users/bulk-update', { ids: [target.user.id], role: destination.name }],
    ] as const) {
      expect((await call(path, adminToken, path.includes('/users/') && !path.endsWith('bulk-update') ? 'PUT' : 'POST', body)).status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } })).role).toBe(destination.name);
      expect(await prisma.userRole.findUnique({ where: { id: secondaryLink.id } })).toEqual(secondaryLink);
      expect((await prisma.userRole.findMany({ where: { userId: target.user.id } })).map(link => link.roleId).sort()).toEqual([secondary.id, destination.id].sort());
    }
    expect((await call('/administration/roles/unassign', adminToken, 'DELETE', { userId: target.user.id, roleId: secondary.id })).status).toBe(200);
    expect((await call('/administration/roles/assign', adminToken, 'POST', { userId: target.user.id, roleId: adminRoleId })).status).toBe(403);
    expect((await call(`/administration/users/${adminId}`, adminToken, 'PUT', { role: destination.name })).status).toBe(403);
    const adminGrants = (await call(`/administration/users/${adminId}/permissions`)).body.data;
    for (const module of PERMISSION_MODULES) for (const action of module.actions) expect(adminGrants[module.key][action]).toBe(true);
  });
  it('rejects self-assignment through role, user and bulk endpoints without partially changing other users', async () => {
    const definition = await role('Delegated role assigner', [row('roles', { canView: true, canCreate: true, canAssign: true }), row('users', { canView: true, canEdit: true })]);
    const manager = await actor(definition.name, [definition.id]);
    const target = await actor('Sales', [salesRoleId]);
    const privileged = await call('/administration/roles', manager.token, 'POST', {
      name: 'Delegated privileged definition', permissions: [row('settings', { canView: true, canEdit: true })],
    });
    expect(privileged.status, JSON.stringify(privileged.body)).toBe(201);
    const before = await snapshot();
    for (const [path, method, body] of [
      ['/administration/roles/assign', 'POST', { userId: manager.user.id, roleId: privileged.body.data.id }],
      [`/administration/users/${manager.user.id}`, 'PUT', { role: privileged.body.data.name }],
      ['/administration/users/bulk-update', 'POST', { ids: [target.user.id, manager.user.id], role: privileged.body.data.name }],
    ] as const) {
      const result = await call(path, manager.token, method, body);
      expect(result.status, JSON.stringify(result.body)).toBe(403);
      expect(await snapshot()).toEqual(before);
    }
    expect((await call('/administration/roles/assign', manager.token, 'POST', { userId: target.user.id, roleId: privileged.body.data.id })).status).toBe(200);
    expect((await call('/administration/roles/assign', adminToken, 'POST', { userId: manager.user.id, roleId: privileged.body.data.id })).status).toBe(200);
    expect((await call('/administration/organization-settings', manager.token)).status).toBe(200);
  });
  it('protects permissions on primary and secondary assigned roles while allowing metadata and other-role edits', async () => {
    const definition = await role('Delegated role editor', [row('roles', { canView: true, canEdit: true })]);
    const secondary = await role('Delegated editor secondary', [row('leads', { canView: true, canViewMy: true })]);
    const manager = await actor(definition.name, [definition.id, secondary.id]);
    const incoming = [row('roles', { canView: true, canEdit: true, canAssign: true })];
    for (const assigned of [definition, secondary]) {
      const before = await snapshot();
      const response = await call(`/administration/roles/${assigned.id}`, manager.token, 'PUT', { name: `${assigned.name} changed`, permissions: incoming });
      expect(response.status, JSON.stringify(response.body)).toBe(403);
      expect(await snapshot()).toEqual(before);
    }
    expect((await call(`/administration/roles/${definition.id}`, manager.token, 'PUT', { description: 'Updated by delegated editor' })).status).toBe(200);
    const other = await role('Delegated editor other role');
    expect((await call(`/administration/roles/${other.id}`, manager.token, 'PUT', { permissions: incoming })).status).toBe(200);
    expect((await call(`/administration/roles/${secondary.id}`, adminToken, 'PUT', { permissions: incoming })).status).toBe(200);
    expect((await call(`/administration/users/${manager.user.id}/permissions`, manager.token)).body.data.roles.canAssign).toBe(true);
  });
  it('isolates role grants, permission responses and organization reads/writes by tenant', async () => {
    const foreignRole = await role('Foreign settings editor', [row('roles', { canView: true, canEdit: true }), row('settings', { canView: true, canEdit: true })], otherTenantId);
    const foreign = await actor(foreignRole.name, [foreignRole.id], otherTenantId);
    const sales = await actor('Sales', [salesRoleId]);
    const original = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect((await call(`/administration/roles/${salesRoleId}`, foreign.token)).status).toBe(404);
    expect((await call(`/administration/roles/${salesRoleId}`, foreign.token, 'PUT', { description: 'Foreign write' })).status).toBe(404);
    expect((await call(`/administration/users/${sales.user.id}/permissions`, foreign.token)).status).toBe(403);
    const path = `/administration/organization-settings?tenantId=${tenantId}`;
    expect((await call(path, foreign.token)).body.data.id).toBe(otherTenantId);
    expect((await call(path, foreign.token, 'PATCH', { name: 'Other edited' })).status).toBe(200);
    expect(await prisma.tenant.findUnique({ where: { id: tenantId } })).toEqual(original);
    expect((await call(`/administration/organization-settings?tenantId=${otherTenantId}`, sales.token)).status).toBe(403);
    await expect(prisma.userRole.create({ data: { userId: sales.user.id, tenantId, roleId: foreignRole.id } })).rejects.toThrow();
  });
});
