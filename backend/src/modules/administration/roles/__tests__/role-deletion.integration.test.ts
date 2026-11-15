import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Prisma } from '@prisma/client';
import prisma from '../../../../config/database.config';
import app from '../../../../app';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { archiveRole } from '../roles.service';
import { replaceUserRole } from '../roles.repository';
import { update as updateUser } from '../../users/users.service';
import { dispatchTenantNotifications } from '../../../notifications/notification-events.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_(?:polish_test|environment_test_\d+)$/.test(url.pathname);
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe.skipIf(!disposable)('role deletion: retained database records and concurrent assignment', () => {
  let server: Server, base: string, tenantId: string, adminId: string, token: string, systemRoleId: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function role() {
    return prisma.roleDefinition.create({ data: { tenantId, name: `Deletion ${randomUUID()}`,
      permissions: { create: [{ module: 'leads', canView: true }] } } });
  }
  async function staff() {
    const definition = await role();
    const user = await prisma.user.create({ data: { tenantId, role: definition.name, email: `${randomUUID()}@camxian.com`,
      firstName: 'Assigned', lastName: 'Staff', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date(),
      userRoles: { create: { roleId: definition.id } } } });
    return { user, definition };
  }
  async function waitForLock(mode: 'UPDATE' | 'SHARE') {
    await expect.poll(async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%RoleDefinition%FOR ${mode}%`}`;
      return Number(rows[0].count);
    }, { timeout: 5000, interval: 25 }).toBeGreaterThan(0);
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Role deletion QA', slug: randomUUID(), status: 'ACTIVE' } })).id;
    systemRoleId = (await prisma.roleDefinition.create({ data: { tenantId, name: 'Client Admin', isSystemRole: true } })).id;
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: `${randomUUID()}@camxian.com`, firstName: 'Delete', lastName: 'Admin',
      mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId: systemRoleId } } } });
    adminId = admin.id; token = (await issueAuthSession(admin)).token;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });

  it('soft-deletes through HTTP, preserves permissions and history, audits, and forbids assignment or archive recovery', async () => {
    const target = await role();
    const beforePermissions = await prisma.rolePermission.findMany({ where: { roleId: target.id } });
    const history = await prisma.auditLog.create({ data: { tenantId, userId: adminId, action: 'role.created', entityType: 'RoleDefinition', entityId: target.id } });
    expect((await call(`/administration/roles/${target.id}/archive`, 'PATCH', {})).status).toBe(200);
    expect(await prisma.roleDefinition.findUnique({ where: { id: target.id } })).toMatchObject({ id: target.id, name: target.name, isArchived: true });
    expect(await prisma.rolePermission.findMany({ where: { roleId: target.id } })).toEqual(beforePermissions);
    expect(await prisma.auditLog.findUnique({ where: { id: history.id } })).toEqual(history);
    const audits = await prisma.auditLog.findMany({ where: { tenantId, entityId: target.id, action: 'role.deleted' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: adminId, entityType: 'RoleDefinition', changeset: {
      before: { name: target.name, isArchived: false }, after: { name: target.name, isArchived: true } } });
    await dispatchTenantNotifications(tenantId, new Date(Date.now() + 10000), 100);
    expect(await prisma.notification.findFirst({ where: { tenantId, entityId: target.id, type: 'role_archived' } })).toMatchObject({
      title: 'Role Deleted', body: `"${target.name}" was deleted.` });
    expect((await call('/administration/roles')).body.data.some((row: { id: string }) => row.id === target.id)).toBe(false);
    expect((await call(`/administration/roles/${target.id}`)).status).toBe(404);
    const person = await staff();
    expect((await call('/administration/roles/assign', 'POST', { userId: person.user.id, roleId: target.id })).status).toBe(404);
    for (const sortBy of ['archivedAt', 'name', 'type', 'detail']) {
      const list = await call(`/administration/archived-data?sortBy=${sortBy}&search=${encodeURIComponent(target.name)}`);
      expect(list.status).toBe(200); expect(list.body.meta.total).toBe(0); expect(list.body.data).toEqual([]);
    }
    expect((await call('/administration/archived-data?type=Role')).status).toBe(400);
    expect((await call(`/administration/archived-data/Role/${target.id}/restore`, 'PATCH', {})).status).toBe(400);
    expect((await call(`/administration/roles/${target.id}/archive`, 'PATCH', {})).status).toBe(404);
    expect(await prisma.roleDefinition.findUnique({ where: { id: target.id } })).toMatchObject({ isArchived: true });
  });

  it('counts secondary and inactive-user assignments, preserving all relationships on conflict', async () => {
    const target = await role(); const person = await staff();
    await prisma.user.update({ where: { id: person.user.id }, data: { status: 'INACTIVE' } });
    const link = await prisma.userRole.create({ data: { tenantId, userId: person.user.id, roleId: target.id } });
    const result = await call(`/administration/roles/${target.id}/archive`, 'PATCH', {});
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain('Role has 1 assigned user(s). Reassign users to another role before deleting.');
    expect(await prisma.roleDefinition.findUnique({ where: { id: target.id } })).toMatchObject({ isArchived: false });
    expect(await prisma.userRole.findUnique({ where: { id: link.id } })).toEqual(link);
    expect(await prisma.auditLog.count({ where: { entityId: target.id, action: 'role.deleted' } })).toBe(0);
  });

  it('rejects system, missing and foreign roles', async () => {
    expect((await call(`/administration/roles/${systemRoleId}/archive`, 'PATCH', {})).status).toBe(403);
    expect((await call(`/administration/roles/${randomUUID()}/archive`, 'PATCH', {})).status).toBe(404);
    const foreignTenant = await prisma.tenant.create({ data: { name: 'Foreign deletion QA', slug: randomUUID() } });
    const foreign = await prisma.roleDefinition.create({ data: { tenantId: foreignTenant.id, name: 'Foreign role' } });
    expect((await call(`/administration/roles/${foreign.id}/archive`, 'PATCH', {})).status).toBe(404);
    expect(await prisma.roleDefinition.findUnique({ where: { id: foreign.id } })).toMatchObject({ isArchived: false });
  });

  it('waits for an earlier assignment transaction, then rejects deletion with conflict', async () => {
    const target = await role(); const person = await staff(); const held = gate(), release = gate();
    const assigning = scope(() => prisma.$transaction(async tx => {
      await replaceUserRole(tx, person.user.id, tenantId, target.name); held.resolve(); await release.promise;
    }, { timeout: 15000 }));
    await held.promise;
    const deleting = call(`/administration/roles/${target.id}/archive`, 'PATCH', {});
    try { await waitForLock('UPDATE'); } finally { release.resolve(); }
    await assigning; expect((await deleting).status).toBe(409);
    expect(await prisma.roleDefinition.findUnique({ where: { id: target.id } })).toMatchObject({ isArchived: false });
    expect(await prisma.userRole.count({ where: { tenantId, roleId: target.id } })).toBe(1);
  });

  it('waits for an earlier deletion transaction, then rejects assignment after rechecking active state', async () => {
    const target = await role(); const person = await staff(); const held = gate(), release = gate();
    const transaction = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(((work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
      transaction(async tx => { const result = await work(tx); held.resolve(); await release.promise; return result; }, { ...options, timeout: 15000 })) as typeof prisma.$transaction);
    const deleting = scope(() => archiveRole(target.id, tenantId, adminId));
    await held.promise;
    const assigning = call('/administration/roles/assign', 'POST', { userId: person.user.id, roleId: target.id });
    try { await waitForLock('SHARE'); } finally { release.resolve(); spy.mockRestore(); }
    await deleting; expect((await assigning).status).toBe(404);
    expect(await prisma.roleDefinition.findUnique({ where: { id: target.id } })).toMatchObject({ isArchived: true });
    expect(await prisma.userRole.count({ where: { tenantId, roleId: target.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: person.user.id } })).toMatchObject({ role: person.definition.name });
  });

  it('protects a promotion from a custom assignment or unassignment already in flight', async () => {
    const person = await staff();
    const custom = await role();
    const held = gate(), release = gate();
    const transaction = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(((work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
      transaction(async tx => { const result = await work(tx); held.resolve(); await release.promise; return result; }, { ...options, timeout: 15000 })) as typeof prisma.$transaction);
    const userId = person.user.id;
    const promotion = scope(() => updateUser(userId, tenantId, adminId, { role: 'Client Admin' }));
    try {
      await Promise.race([held.promise, promotion]);
    } finally { spy.mockRestore(); }
    const assignment = call('/administration/roles/assign', 'POST', { userId, roleId: custom.id });
    const removal = call('/administration/roles/unassign', 'DELETE', { userId, roleId: systemRoleId });
    try {
      await expect.poll(async () => {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%"User"%'`;
        return Number(rows[0].count);
      }, { timeout: 5000, interval: 25 }).toBe(2);
    } finally { release.resolve(); }
    expect(await promotion).toMatchObject({ role: 'Client Admin' });
    expect((await assignment).status).toBe(409);
    expect((await removal).status).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: userId } })).toMatchObject({ role: 'Client Admin' });
    expect(await prisma.userRole.findMany({ where: { tenantId, userId }, select: { roleId: true } })).toEqual([{ roleId: systemRoleId }]);
  });
});
