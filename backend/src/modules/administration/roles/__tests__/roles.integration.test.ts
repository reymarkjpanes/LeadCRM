import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { PERMISSION_MODULES } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import app from '../../../../app';
import * as repo from '../roles.repository';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_environment_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('custom roles: authenticated HTTP and database persistence', () => {
  let server: Server, base: string, tenantId: string, otherTenantId: string, token: string, readerToken: string, otherToken: string;
  const password = 'Role-Test-Password-123!';
  const email = `roles-admin-${Date.now()}@camxian.com`;
  const permissions = ['contacts', 'accounts', 'deals'].map(module => ({ module, canView: true, canCreate: true, canEdit: true, canDelete: false, canArchive: true }));
  async function call(path: string, method = 'GET', body?: unknown, bearer = token) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), token: response.headers.get('set-cookie')?.match(/leadcrm_token=([^;]+)/)?.[1] };
  }
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Role test', slug: `roles-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } });
    tenantId = tenant.id;
    otherTenantId = (await prisma.tenant.create({ data: { name: 'Other role test', slug: `roles-other-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email, firstName: 'Role', lastName: 'Admin', mustChangePassword: false, passwordHash: await bcrypt.hash(password, 10) } });
    token = (await issueAuthSession(admin)).token;
    readerToken = (await issueAuthSession(await prisma.user.create({ data: { tenantId, role: 'Reader', email: `roles-reader-${Date.now()}@camxian.com`, firstName: 'Role', lastName: 'Reader', mustChangePassword: false } }))).token;
    otherToken = (await issueAuthSession(await prisma.user.create({ data: { tenantId: otherTenantId, role: 'Client Admin', email: `roles-other-${Date.now()}@camxian.com`, firstName: 'Other', lastName: 'Admin', mustChangePassword: false } }))).token;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });
  it('returns the canonical module registry', async () => {
    expect((await call('/administration/permissions')).body.data).toEqual(PERMISSION_MODULES);
  });
  it('creates RoleDefinition and RolePermission rows, returns them, reloads, and survives logout/login and a new session', async () => {
    const created = await call('/administration/roles', 'POST', { name: ' Sales Assistant ', description: 'Persisted', permissions });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ success: true, data: { name: 'Sales Assistant', description: 'Persisted', tenantId, userCount: 0, isSystemRole: false } });
    const id = created.body.data.id;
    expect(created.body.data.createdAt).toBeTruthy();
    const row = await prisma.roleDefinition.findUniqueOrThrow({ where: { id }, include: { permissions: true } });
    expect(row.name).toBe('Sales Assistant'); expect(row.permissions).toHaveLength(3);
    for (const permission of permissions) {
      expect(row.permissions).toContainEqual(expect.objectContaining({ ...permission, tenantId, roleId: id }));
      expect(created.body.data.permissions).toContainEqual(expect.objectContaining(permission));
    }
    expect((await call('/administration/roles')).body.data).toContainEqual(created.body.data);
    expect((await call('/auth/logout', 'POST', {})).status).toBe(200);
    const login = await call('/auth/login', 'POST', { email, password }, '');
    expect(login.status).toBe(200); token = login.token!;
    expect((await call(`/administration/roles/${id}`)).body.data).toMatchObject(created.body.data);
    const secondSession = await issueAuthSession(await prisma.user.findUniqueOrThrow({ where: { tenantId_email: { tenantId, email } } }));
    expect((await call('/administration/roles', 'GET', undefined, secondSession.token)).body.data).toContainEqual(created.body.data);
    const updated = await call(`/administration/roles/${id}`, 'PUT', { permissions: [permissions[0]] });
    expect(updated.body.data.permissions).toHaveLength(1);
    expect(await prisma.rolePermission.count({ where: { roleId: id } })).toBe(1);
    expect((await call(`/administration/roles/${id}`, 'GET', undefined, otherToken)).status).toBe(404);
    expect((await call(`/administration/roles/${id}`, 'PUT', { name: 'Stolen' }, otherToken)).status).toBe(404);
  });
  it('allows zero permissions, rejects invalid names/modules/flags and browser tenant IDs without writes', async () => {
    expect((await call('/administration/roles', 'POST', { name: 'No access', permissions: [] })).status).toBe(201);
    for (const payload of [{ name: ' ' }, { name: '' }, { name: 'Invalid module', permissions: [{ ...permissions[0], module: 'p2' }] }, { name: 'Invalid action', permissions: [{ ...permissions[0], module: 'dashboard' }] }, { name: 'Duplicate module', permissions: [permissions[0], permissions[0]] }, { name: 'Spoof', tenantId: otherTenantId }]) {
      expect((await call('/administration/roles', 'POST', payload)).status).toBe(400);
    }
    expect(await prisma.roleDefinition.count({ where: { tenantId, name: { in: ['Invalid module', 'Invalid action', 'Duplicate module', 'Spoof'] } } })).toBe(0);
  });
  it('rejects duplicates with a friendly conflict, including archived names and concurrent writes; uniqueness is tenant scoped', async () => {
    const duplicate = await call('/administration/roles', 'POST', { name: 'Sales Assistant', permissions });
    expect(duplicate.status).toBe(409); expect(JSON.stringify(duplicate.body)).toContain('A role with this name already exists.');
    expect(await prisma.roleDefinition.count({ where: { tenantId, name: 'Sales Assistant' } })).toBe(1);
    expect((await call('/administration/roles', 'POST', { name: 'Sales Assistant', permissions }, otherToken)).status).toBe(201);
    const archived = await prisma.roleDefinition.create({ data: { tenantId, name: 'Archived role', isArchived: true } });
    expect((await call('/administration/roles', 'POST', { name: archived.name })).status).toBe(409);
    const race = await Promise.all([call('/administration/roles', 'POST', { name: 'Concurrent', permissions }), call('/administration/roles', 'POST', { name: 'Concurrent', permissions })]);
    expect(race.map(result => result.status).sort()).toEqual([201, 409]);
  });
  it('enforces authentication/authorization and propagates server errors', async () => {
    expect((await call('/administration/roles', 'POST', { name: 'Anonymous' }, '')).status).toBe(401);
    expect((await call('/administration/roles', 'POST', { name: 'Forbidden' }, readerToken)).status).toBe(403);
    const failure = vi.spyOn(repo, 'createRole').mockRejectedValueOnce(new Error('Simulated unavailable database'));
    try { expect((await call('/administration/roles', 'POST', { name: 'Failure' })).status).toBe(500); }
    finally { failure.mockRestore(); }
    expect(await prisma.roleDefinition.count({ where: { tenantId, name: { in: ['Anonymous', 'Forbidden', 'Failure'] } } })).toBe(0);
  });
  it('rolls back the RoleDefinition after a simulated RolePermission write failure', async () => {
    const transaction = prisma.$transaction.bind(prisma);
    const failure = vi.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: (tx: any) => Promise<unknown>) => transaction(async tx => {
      const write = vi.spyOn(tx.rolePermission, 'createMany').mockRejectedValueOnce(new Error('Simulated permission write failure'));
      try { return await work(tx); } finally { write.mockRestore(); }
    })) as never);
    try { await expect(repo.createRole(tenantId, { name: 'Rollback' }, [permissions[0]])).rejects.toThrow('Simulated permission write failure'); }
    finally { failure.mockRestore(); }
    expect(await prisma.roleDefinition.count({ where: { tenantId, name: 'Rollback' } })).toBe(0);
    expect(await prisma.rolePermission.count({ where: { tenantId, role: { name: 'Rollback' } } })).toBe(0);
  });
});
