import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { tenantContext } from '../../../core/tenant/tenant-context';
import app from '../../../app';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
describe.skipIf(url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_polish_test')('database-paged archive through authenticated HTTP', () => {
  let tenantId: string, adminId: string, adminToken: string, staffToken: string, base: string, server: Server;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const taskIds: string[] = [];
  let roleId: string, leadId: string, unknownDateTask: string;
  async function read(query = '', token = adminToken) {
    const response = await fetch(`${base}/administration/archived-data${query}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Archive polish', slug: randomUUID(), status: 'ACTIVE' } })).id;
    const admin = await prisma.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'Admin', lastName: 'Archive', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    adminId = admin.id; adminToken = (await issueAuthSession(admin)).token;
    const role = await scope(() => prisma.roleDefinition.create({ data: { tenantId, name: 'Archive task reader' } }));
    await scope(() => prisma.rolePermission.createMany({ data: ['archived_data', 'tasks'].map(module => ({ tenantId, roleId: role.id, module, canView: true })) }));
    const staff = await prisma.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'Staff', lastName: 'Archive', role: role.name, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    await scope(() => prisma.userRole.create({ data: { tenantId, roleId: role.id, userId: staff.id } })); staffToken = (await issueAuthSession(staff)).token;
    for (let index = 0; index < 30; index++) {
      const task = await scope(() => prisma.task.create({ data: { tenantId, assignedUserId: adminId, title: `Archived ${index}`, dueDate: new Date('2026-01-01'), isArchived: true } }));
      taskIds.push(task.id);
      await prisma.auditLog.create({ data: { tenantId, userId: adminId, action: 'task.archived', entityType: 'Task', entityId: task.id, createdAt: new Date(Date.UTC(2026, 0, index + 1)) } });
    }
    unknownDateTask = (await scope(() => prisma.task.create({ data: { tenantId, assignedUserId: adminId, title: 'Archived without audit', dueDate: new Date('2026-01-01'), isArchived: true } }))).id;
    roleId = (await scope(() => prisma.roleDefinition.create({ data: { tenantId, name: 'Retired role', isArchived: true } }))).id;
    await prisma.auditLog.create({ data: { tenantId, userId: adminId, action: 'role.archived', entityType: 'RoleDefinition', entityId: roleId, createdAt: new Date('2026-02-01') } });
    leadId = (await scope(() => prisma.lead.create({ data: { tenantId, firstName: 'Literal', lastName: '100%_match', isArchived: true, deletedAt: new Date('2026-02-02') } }))).id;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  }, 30000);
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });
  it('orders all types together, includes Role audit dates, and returns stable distinct pages', async () => {
    const first = await read('?limit=5'); const second = await read('?limit=5&page=2');
    expect(first.status).toBe(200); expect(first.body.meta).toMatchObject({ total: 33, hasMore: true });
    expect(first.body.data.map((row: { id: string }) => row.id)).toEqual([leadId, roleId, taskIds[29], taskIds[28], taskIds[27]]);
    expect(second.body.data.map((row: { id: string }) => row.id)).toEqual(taskIds.slice(22, 27).reverse());
    const oldest = await read('?sortOrder=asc&limit=5');
    expect(oldest.body.data.map((row: { id: string }) => row.id)).toEqual(taskIds.slice(0, 5));
    const last = await read('?limit=50');
    expect(last.body.data.at(-1)).toMatchObject({ id: unknownDateTask, archivedAt: null });
  });
  it('matches literal search terms consistently and preserves type permission boundaries', async () => {
    const match = await read('?search=100%25_match'); expect(match.status).toBe(200);
    expect(match.body.meta.total).toBe(1); expect(match.body.data[0].id).toBe(leadId);
    const staff = await read('?limit=50', staffToken); expect(staff.status).toBe(200);
    expect(staff.body.meta.total).toBe(31); expect(staff.body.data.every((row: { type: string; canRestore: boolean }) => row.type === 'Task' && !row.canRestore)).toBe(true);
    expect((await read('?type=Role', staffToken)).status).toBe(403);
  });
});
