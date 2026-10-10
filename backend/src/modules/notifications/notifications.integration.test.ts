import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../config/database.config';
import { issueAuthSession } from '../../core/auth/auth-session';
import app from '../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = url.hostname === '127.0.0.1' && url.pathname === '/leadcrm_forms_test_2';
describe.skipIf(!disposable)('Notification HTTP persistence and isolation', () => {
  let tenantId: string, userId: string, otherUserId: string, otherTenant: string, token: string, base: string, server: Server;
  let ids: string[], otherId: string, foreignId: string;
  async function request(path = '', method = 'GET', body?: unknown, authenticated = true) {
    const response = await fetch(base + '/notifications' + path, {
      method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Notifications test', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } })).id;
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other notifications test', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } })).id;
    const user = await prisma.user.create({ data: { tenantId, email: `notifications-${randomUUID()}@camxian.com`, firstName: 'Notification', lastName: 'Tester', role: 'Viewer', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    userId = user.id;
    token = (await issueAuthSession(user)).token;
    otherUserId = (await prisma.user.create({ data: { tenantId, email: `other-${randomUUID()}@camxian.com`, firstName: 'Other', lastName: 'User', role: 'Viewer', mustChangePassword: false, onboardingCompletedAt: new Date() } })).id;
    const foreignUser = await prisma.user.create({ data: { tenantId: otherTenant, email: `foreign-${randomUUID()}@camxian.com`, firstName: 'Foreign', lastName: 'User', role: 'Viewer' } });
    ids = [];
    for (let i = 0; i < 25; i++) ids.push((await prisma.notification.create({ data: { tenantId, userId, type: 'task_overdue', title: `Notification ${i}`, isRead: i >= 22 } })).id);
    otherId = (await prisma.notification.create({ data: { tenantId, userId: otherUserId, type: 'task_due', title: 'Another recipient' } })).id;
    foreignId = (await prisma.notification.create({ data: { tenantId: otherTenant, userId: foreignUser.id, type: 'task_due', title: 'Another tenant' } })).id;
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('requires authentication and returns database totals for paginated All/Unread/Read', async () => {
    expect((await request('', 'GET', undefined, false)).status).toBe(401);
    const all = await request('?limit=20');
    expect(all.body).toMatchObject({ unreadCount: 22, totalCount: 25, meta: { total: 25, hasMore: true } });
    expect(all.body.data).toHaveLength(20);
    const unread = await request('?isRead=false&limit=20&page=2');
    expect(unread.body.data).toHaveLength(2);
    expect(unread.body).toMatchObject({ unreadCount: 22, totalCount: 25, meta: { total: 22 } });
    const read = await request('?isRead=true');
    expect(read.body.data).toHaveLength(3);
    expect(read.body.data.every((n: { isRead: boolean }) => n.isRead)).toBe(true);
  });

  it('persists individual reads and readAt, without modifying another user or tenant', async () => {
    expect((await request(`/${ids[0]}/read`, 'PATCH')).body).toMatchObject({ unreadCount: 21, totalCount: 25 });
    const record = await prisma.notification.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(record.isRead).toBe(true); expect(record.readAt).not.toBeNull();
    await request(`/${ids[0]}/read`, 'PATCH');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: ids[0] } })).readAt).toEqual(record.readAt);
    for (const id of [otherId, foreignId]) {
      await request(`/${id}/read`, 'PATCH');
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).isRead).toBe(false);
    }
    expect((await request('?isRead=true')).body.meta.total).toBe(4);
  });

  it('rolls back mixed-owner deletion and rejects malformed/forged input', async () => {
    for (const id of [otherId, foreignId, randomUUID()]) {
      expect((await request('', 'DELETE', { ids: [ids[1], id] })).status).toBe(404);
      expect(await prisma.notification.findUnique({ where: { id: ids[1] } })).not.toBeNull();
    }
    for (const body of [{ ids: [] }, { ids: ['invalid'] }, { ids: [ids[1]], tenantId: otherTenant }, { ids: [ids[1]], userId: otherUserId }]) {
      expect((await request('', 'DELETE', body)).status).toBe(400);
    }
  });

  it('commits single and bulk deletion, with correct totals after fresh GETs', async () => {
    expect((await request('', 'DELETE', { ids: [ids[0]] })).body).toMatchObject({ success: true, totalCount: 24, unreadCount: 21 });
    expect(await prisma.notification.findUnique({ where: { id: ids[0] } })).toBeNull();
    expect((await request('', 'DELETE', { ids: [ids[1], ids[2], ids[2]] })).body).toMatchObject({ success: true, totalCount: 22, unreadCount: 19 });
    expect((await request('?limit=100')).body.data.map((n: { id: string }) => n.id)).not.toEqual(expect.arrayContaining(ids.slice(0, 3)));
    expect((await request()).body).toMatchObject({ totalCount: 22, unreadCount: 19 });
  });

  it('marks all pages read persistently and preserves other recipients', async () => {
    expect((await request('/read-all', 'PATCH')).body).toMatchObject({ success: true, totalCount: 22, unreadCount: 0 });
    expect((await request('?isRead=false')).body.data).toEqual([]);
    expect((await request('?isRead=true')).body.meta.total).toBe(22);
    expect(await prisma.notification.count({ where: { tenantId, userId, isRead: false } })).toBe(0);
    for (const id of [otherId, foreignId]) expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).isRead).toBe(false);
  });
});
