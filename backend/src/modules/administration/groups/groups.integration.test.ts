import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { issueAuthSession } from '../../../core/auth/auth-session';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_(?:polish_test|campaign_test_\d+)$/.test(url.pathname);
let server: Server, base: string, tenantId: string, token: string, deniedToken: string, userId: string, foreignUserId: string;
const scoped = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
async function request(path: string, method = 'GET', body?: unknown, auth = token) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  if (!disposable) return;
  tenantId = (await prisma.tenant.create({ data: { name: 'Groups tests', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
  const other = await prisma.tenant.create({ data: { name: 'Other tenant', slug: randomUUID() } });
  const user = await prisma.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'Julie', lastName: 'Tiron', role: 'Client Admin', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } });
  userId = user.id; token = (await issueAuthSession(user)).token;
  const denied = await prisma.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'Denied', lastName: 'User', role: 'Sales', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } });
  deniedToken = (await issueAuthSession(denied)).token;
  foreignUserId = (await prisma.user.create({ data: { tenantId: other.id, email: `${randomUUID()}@camxian.com`, firstName: 'Other', lastName: 'User', role: 'Sales' } })).id;
  server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/administration/groups`;
}, 30000);
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

it.skipIf(!disposable)('validates blank names on create/update, trims, permits zero members and deletes an empty group', async () => {
  for (const name of ['', '   ', '\t\n']) expect((await request('', 'POST', { name })).status).toBe(400);
  const created = await request('', 'POST', { name: ' Support ' }); expect(created.status).toBe(201); expect(created.body.data.name).toBe('Support'); expect(created.body.data.members).toEqual([]);
  const id = created.body.data.id;
  expect((await request(`/${id}`, 'PUT', { name: '  ' })).status).toBe(400);
  const updated = await request(`/${id}`, 'PUT', { name: ' Customer Support ' }); expect(updated.body.data.name).toBe('Customer Support');
  expect((await request(`/${id}`, 'DELETE')).status).toBe(200);
  expect(await scoped(() => prisma.tenantGroup.findFirst({ where: { id, tenantId } }))).toBeNull();
});
it.skipIf(!disposable)('rejects nonempty deletion from actual rows, keeps members unique, removes then permits deletion', async () => {
  const id = (await request('', 'POST', { name: 'Sales' })).body.data.id;
  expect((await request(`/${id}/members`, 'POST', { userId })).status).toBe(200);
  expect((await request(`/${id}/members`, 'POST', { userId })).status).toBe(200);
  expect(await scoped(() => prisma.tenantGroupMember.count({ where: { groupId: id, tenantId } }))).toBe(1);
  const denied = await request(`/${id}`, 'DELETE'); expect(denied.status).toBe(409); expect(denied.body.error).toBe('Remove all members from this group before deleting it.');
  const rows = (await request('')).body.data; expect(rows.find((group: { id: string }) => group.id === id).members[0].user).toMatchObject({ firstName: 'Julie', lastName: 'Tiron', role: 'Client Admin' });
  expect((await request(`/${id}/members/${userId}`, 'DELETE')).status).toBe(200);
  expect((await request(`/${id}`, 'DELETE')).status).toBe(200);
});
it.skipIf(!disposable)('preserves RBAC and tenant isolation for group and membership mutations', async () => {
  expect((await request('', 'GET', undefined, deniedToken)).status).toBe(403);
  const id = (await request('', 'POST', { name: 'Scoped group' })).body.data.id;
  expect((await request(`/${id}/members`, 'POST', { userId: foreignUserId })).status).toBe(404);
  expect((await request(`/${id}`, 'DELETE', undefined, deniedToken)).status).toBe(403);
  expect((await request('', 'POST', { name: 'Denied' }, deniedToken)).status).toBe(403);
  const otherTenant = (await prisma.user.findUniqueOrThrow({ where: { id: foreignUserId } })).tenantId;
  const foreignGroup = await tenantContext.run({ tenantId: otherTenant }, () => prisma.tenantGroup.create({ data: { name: 'Private', tenantId: otherTenant } }));
  expect((await request(`/${foreignGroup.id}`, 'DELETE')).status).toBe(404);
  expect((await request(`/${foreignGroup.id}/members`, 'POST', { userId })).status).toBe(404);
});

it.skipIf(!disposable)('allows group viewers to view group members but reserves membership changes for Client Admin', async () => {
  const id = (await request('', 'POST', { name: 'Read only group' })).body.data.id;
  expect((await request(`/${id}/members`, 'POST', { userId })).status).toBe(200);

  const viewerRole = await scoped(() => prisma.roleDefinition.create({ data: { tenantId, name: 'Group Viewer' } }));
  await scoped(() => prisma.rolePermission.create({ data: { tenantId, roleId: viewerRole.id, module: 'groups', canView: true } }));
  const staff = await prisma.user.findFirstOrThrow({ where: { tenantId, role: 'Sales' } });
  await scoped(() => prisma.userRole.create({ data: { tenantId, userId: staff.id, roleId: viewerRole.id } }));
  const visible = await request('', 'GET', undefined, deniedToken);
  expect(visible.status).toBe(200);
  expect(visible.body.data.find((group: { id: string }) => group.id === id).members[0].user)
    .toMatchObject({ firstName: 'Julie', lastName: 'Tiron', role: 'Client Admin' });
  expect((await request(`/${id}/members`, 'POST', { userId }, deniedToken)).status).toBe(403);
  expect((await request(`/${id}/members/${userId}`, 'DELETE', undefined, deniedToken)).status).toBe(403);
  expect((await request(`/${id}/members/${userId}`, 'DELETE')).status).toBe(200);
  expect((await request(`/${id}`, 'DELETE')).status).toBe(200);
});
