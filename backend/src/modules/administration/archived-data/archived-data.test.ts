import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const model = () => ({ count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() });
  return { db: { lead: model(), contact: model(), account: model(), deal: model(), pipeline: model(), user: model(),
    task: model(), roleDefinition: model(), workflow: model(), campaign: model(), template: model(), auditLog: { findMany: vi.fn() }, $queryRaw: vi.fn() },
    permission: vi.fn(), audit: vi.fn() };
});
vi.mock('../../../config/database.config', () => ({ default: state.db }));
vi.mock('../../../core/permissions/permission.service', () => ({ assertPermissions: state.permission }));
vi.mock('../../../core/audit/audit.service', () => ({ writeAuditLog: state.audit }));
import { list, restore } from './archived-data.service';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { ArchiveQuerySchema } from '@leadcrm/shared';
import { AppError } from '../../../shared/errors/app-error';

const actor = { userId: 'admin', tenantId: 'tenant', role: 'Client Admin' };
const scoped = <T>(work: () => T) => tenantContext.run({ tenantId: actor.tenantId }, work);
beforeEach(() => {
  vi.resetAllMocks();
  state.permission.mockResolvedValue(undefined);
  for (const model of Object.values(state.db)) if ('count' in model) { model.count.mockResolvedValue(0); model.findMany.mockResolvedValue([]); }
  state.db.roleDefinition.count.mockResolvedValue(1);
  state.db.roleDefinition.findMany.mockResolvedValue([{ id: 'role', name: 'Archived Sales', isSystemRole: false }]);
  state.db.auditLog.findMany.mockResolvedValue([{ entityId: 'role', action: 'role.archived', createdAt: new Date('2026-01-01') }]);
  state.db.$queryRaw.mockResolvedValue([{ id: 'role', type: 'Role', name: 'Archived Sales', detail: '', isSystemRole: false, archivedAt: new Date('2026-01-01') }]);
});

it('includes archived Roles in All, with their RoleDefinition audit timestamp and recoverability', async () => {
  const result = await scoped(() => list(actor, ArchiveQuerySchema.parse({ sortBy: 'name' })));
  expect(result.data).toEqual([{ id: 'role', type: 'Role', name: 'Archived Sales', detail: '', canRestore: true, archivedAt: '2026-01-01T00:00:00.000Z' }]);
  expect(result.meta.total).toBe(1);
  expect(state.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant', entityType: { in: ['Role', 'RoleDefinition'] } }) }));
});

it('scopes Role search and permission checks to the active workspace', async () => {
  await scoped(() => list(actor, ArchiveQuerySchema.parse({ type: 'Role', search: 'Archived Sales' })));
  expect(state.permission).toHaveBeenCalledWith(actor, ['roles.view']);
  expect(state.db.roleDefinition.count).toHaveBeenCalledWith({ where: { tenantId: 'tenant', isArchived: true,
    AND: [{ OR: [{ name: { contains: 'Archived', mode: 'insensitive' } }] }, { OR: [{ name: { contains: 'Sales', mode: 'insensitive' } }] }] } });
});

it('hides roles from staff without roles.view and rejects explicit restricted filters', async () => {
  state.permission.mockImplementation(async (_actor, required) => { if (required.includes('roles.view')) throw new AppError('Access denied', 403); });
  state.db.$queryRaw.mockResolvedValue([]);
  expect((await scoped(() => list(actor, ArchiveQuerySchema.parse({})))).data).toEqual([]);
  await expect(scoped(() => list(actor, ArchiveQuerySchema.parse({ type: 'Role' })))).rejects.toMatchObject({ statusCode: 403 });
  expect(state.db.roleDefinition.findMany).not.toHaveBeenCalled();
});

it('hydrates only a bounded page for the default archive date ordering', async () => {
  const result = await scoped(() => list(actor, ArchiveQuerySchema.parse({ page: 2, limit: 5 })));
  expect(result.data[0]).toMatchObject({ type: 'Role', archivedAt: '2026-01-01T00:00:00.000Z' });
  expect(state.db.$queryRaw).toHaveBeenCalledOnce();
  const statement = state.db.$queryRaw.mock.calls[0][0];
  expect(statement.sql).toContain('NULLS LAST');
  expect(statement.sql).toContain('LIMIT ? OFFSET ?');
  expect(statement.values.slice(-2)).toEqual([5, 5]);
  expect(state.db.roleDefinition.findMany).not.toHaveBeenCalled();
  expect(state.db.auditLog.findMany).not.toHaveBeenCalled();
});

it('restores only a custom archived role and rejects a repeat or cross-tenant ID', async () => {
  state.db.roleDefinition.findFirst.mockResolvedValue({ id: 'role', name: 'Archived Sales', isSystemRole: false });
  state.db.roleDefinition.updateMany.mockResolvedValue({ count: 1 });
  await scoped(() => restore(actor, { type: 'Role', id: 'role' }));
  expect(state.permission).toHaveBeenCalledWith(actor, ['archived_data.restore', 'roles.view']);
  expect(state.db.roleDefinition.updateMany).toHaveBeenCalledWith({ where: { id: 'role', tenantId: 'tenant', isArchived: true, isSystemRole: false }, data: { isArchived: false } });
  state.db.roleDefinition.findFirst.mockResolvedValue(null);
  await expect(scoped(() => restore(actor, { type: 'Role', id: 'foreign' }))).rejects.toMatchObject({ statusCode: 404 });
  expect(state.db.roleDefinition.updateMany).toHaveBeenCalledOnce();
});

it.each([{ name: 'Client Admin', isSystemRole: true }, { name: 'Guest', isSystemRole: false }])('preserves reserved role protection (%s)', async reserved => {
  state.db.roleDefinition.findFirst.mockResolvedValue({ id: 'role', ...reserved });
  await expect(scoped(() => restore(actor, { type: 'Role', id: 'role' }))).rejects.toMatchObject({ statusCode: 403 });
  expect(state.db.roleDefinition.updateMany).not.toHaveBeenCalled();
});

it('rejects requests outside the authenticated tenant context', async () => {
  await expect(list(actor, ArchiveQuerySchema.parse({}))).rejects.toMatchObject({ statusCode: 403 });
  expect(state.db.roleDefinition.count).not.toHaveBeenCalled();
});
