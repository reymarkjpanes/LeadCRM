import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    lead: { count: vi.fn(), findMany: vi.fn() }, contact: { count: vi.fn(), findMany: vi.fn() },
    account: { count: vi.fn(), findMany: vi.fn() }, deal: { count: vi.fn(), findMany: vi.fn() },
    task: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    activity: { createMany: vi.fn() }, auditLog: { create: vi.fn() }, session: { updateMany: vi.fn() },
  }, validateOwner: vi.fn(),
}));
vi.mock('../../../config/database.config', () => ({ default: state.db }));
vi.mock('../../crm/leads/lead-automation.service', () => ({
  salesTransaction: (work: (tx: unknown) => unknown) => work(state.db), validateSalesOwner: state.validateOwner,
}));

import { assertNoOwnership, deactivateUser, deactivationImpact } from './user-deactivation.service';
const target = { id: 'departing', firstName: 'Leaving', lastName: 'Agent', role: 'Sales', status: 'ACTIVE' };
let tasks: Array<{ id: string; tenantId: string; assignedUserId: string; isArchived: boolean; status: string }>;
const matches = (task: typeof tasks[number], where: { tenantId: string; assignedUserId: string; isArchived: boolean; status: { notIn: string[] }; id?: { gt?: string; in?: string[] } }) =>
  task.tenantId === where.tenantId && task.assignedUserId === where.assignedUserId && task.isArchived === where.isArchived && !where.status.notIn.includes(task.status)
  && (!where.id?.gt || task.id > where.id.gt) && (!where.id?.in || where.id.in.includes(task.id));

beforeEach(() => {
  vi.resetAllMocks();
  state.db.user.findFirst.mockImplementation(async ({ where }) => where.id === 'admin' ? { id: 'admin' } : { ...target });
  state.db.user.count.mockResolvedValue(2);
  state.validateOwner.mockResolvedValue({ id: 'replacement', role: 'Sales', userRoles: [{ role: { permissions: [{ module: 'tasks', canView: true }] } }] });
  for (const model of [state.db.lead, state.db.contact, state.db.account, state.db.deal]) {
    model.count.mockResolvedValue(0); model.findMany.mockResolvedValue([]);
  }
  tasks = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'].map((status, i) => ({ id: `task-${i}`, tenantId: 'tenant', assignedUserId: target.id, isArchived: false, status }));
  tasks.push({ ...tasks[0], id: 'archived', isArchived: true }, { ...tasks[0], id: 'foreign', tenantId: 'another-tenant' });
  state.db.task.count.mockImplementation(async ({ where }) => tasks.filter(task => matches(task, where)).length);
  state.db.task.findMany.mockImplementation(async ({ where }) => tasks.filter(task => matches(task, where)).map(task => ({ id: task.id })).sort((a, b) => a.id.localeCompare(b.id)));
  state.db.task.updateMany.mockImplementation(async ({ where, data }) => { const rows = tasks.filter(task => matches(task, where)); rows.forEach(task => Object.assign(task, data)); return { count: rows.length }; });
});

it('includes only unfinished active workspace Tasks in the impact check', async () => {
  expect(await deactivationImpact(target.id, 'tenant', 'admin')).toEqual({ userId: target.id,
    counts: { leads: 0, contacts: 0, accounts: 0, deals: 0, tasks: 3 }, total: 3 });
  await expect(assertNoOwnership(state.db as never, 'tenant', target.id)).rejects.toMatchObject({ statusCode: 409 });
});

it('blocks task-only deactivation without a replacement before any writes', async () => {
  await expect(deactivateUser(target.id, 'tenant', 'admin')).rejects.toMatchObject({ statusCode: 409 });
  expect(state.db.task.updateMany).not.toHaveBeenCalled();
  expect(state.db.user.update).not.toHaveBeenCalled();
  expect(state.db.session.updateMany).not.toHaveBeenCalled();
});

it('reassigns unfinished Tasks, records history and revokes sessions while preserving terminal/archive history', async () => {
  const result = await deactivateUser(target.id, 'tenant', 'admin', 'replacement');
  expect(result.counts.tasks).toBe(3);
  expect(tasks.filter(task => task.assignedUserId === 'replacement').map(task => task.id)).toEqual(['task-0', 'task-1', 'task-2']);
  expect(tasks.filter(task => ['completed', 'cancelled'].includes(task.status) || task.isArchived || task.tenantId !== 'tenant').every(task => task.assignedUserId === target.id)).toBe(true);
  expect(state.db.activity.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ taskId: 'task-0', tenantId: 'tenant', createdById: 'admin', metadata: expect.objectContaining({ reason: 'user_deactivation' }) })]) });
  expect(state.db.user.update).toHaveBeenCalledWith({ where: { tenantId: 'tenant', id: target.id }, data: { status: 'INACTIVE' } });
  expect(state.db.session.updateMany).toHaveBeenCalledWith({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  expect(state.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ tasks: 3 }) }) });
});

it('rejects inactive or foreign replacement agents without changing responsibilities', async () => {
  state.validateOwner.mockRejectedValue(new Error('invalid owner'));
  await expect(deactivateUser(target.id, 'tenant', 'admin', 'foreign')).rejects.toMatchObject({ statusCode: 409 });
  expect(state.db.task.updateMany).not.toHaveBeenCalled();
});

it('retains self-deactivation and Client Admin transfer guards', async () => {
  await expect(deactivationImpact('admin', 'tenant', 'admin')).rejects.toMatchObject({ statusCode: 403 });
  state.db.user.findFirst.mockImplementation(async ({ where }) => where.id === 'manager' ? null : target);
  await expect(deactivateUser(target.id, 'tenant', 'manager', 'replacement')).rejects.toMatchObject({ statusCode: 403 });
  expect(state.db.task.updateMany).not.toHaveBeenCalled();
});

it('prevents transferring unfinished Tasks to a sales agent who cannot view Tasks', async () => {
  state.validateOwner.mockResolvedValue({ id: 'replacement', role: 'Sales', userRoles: [{ role: { permissions: [{ module: 'tasks', canView: false }] } }] });
  await expect(deactivateUser(target.id, 'tenant', 'admin', 'replacement')).rejects.toMatchObject({ statusCode: 409, message: 'Choose an Assigned Agent with Tasks View permission to receive the unfinished tasks.' });
  expect(state.db.task.updateMany).not.toHaveBeenCalled();
  expect(state.db.user.update).not.toHaveBeenCalled();
});

it('does not require Task visibility when no unfinished Tasks are being transferred', async () => {
  tasks = tasks.filter(task => ['completed', 'cancelled'].includes(task.status));
  state.validateOwner.mockResolvedValue({ id: 'replacement', role: 'Sales', userRoles: [] });
  await deactivateUser(target.id, 'tenant', 'admin', 'replacement');
  expect(state.db.user.update).toHaveBeenCalledOnce();
});
