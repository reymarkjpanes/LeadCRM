import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: { $transaction: vi.fn() }, tx: {
  roleDefinition: { findFirst: vi.fn(), update: vi.fn() }, user: { updateMany: vi.fn() },
  rolePermission: { deleteMany: vi.fn(), upsert: vi.fn() },
} }));
vi.mock('../../../../config/database.config', () => ({ default: state.db }));
import { updateRoleAndPermissions } from '../roles.repository';
import { EMPTY_PERMISSION_FLAGS } from '@leadcrm/shared';

let saved: { role: { id: string; name: string; description: string; isSystemRole: boolean }; userRole: string; permissions: string[] };
beforeEach(() => {
  vi.resetAllMocks();
  saved = { role: { id: 'role', name: 'Sales', description: 'Original', isSystemRole: false }, userRole: 'Sales', permissions: ['leads', 'contacts'] };
  state.db.$transaction.mockImplementation(async work => {
    const snapshot = structuredClone(saved);
    try { return await work(state.tx); } catch (error) { saved = snapshot; throw error; }
  });
  state.tx.roleDefinition.findFirst.mockImplementation(async ({ where }) => typeof where.id === 'string' ? { ...saved.role } : null);
  state.tx.roleDefinition.update.mockImplementation(async ({ data }) => { Object.assign(saved.role, data); return { ...saved.role }; });
  state.tx.user.updateMany.mockImplementation(async ({ data }) => { saved.userRole = data.role; return { count: 1 }; });
  state.tx.rolePermission.deleteMany.mockImplementation(async ({ where }) => { saved.permissions = saved.permissions.filter(module => where.module.notIn.includes(module)); });
  state.tx.rolePermission.upsert.mockImplementation(async ({ create }) => { if (!saved.permissions.includes(create.module)) saved.permissions.push(create.module); });
});

it('commits renamed role, affected staff labels and replacement permissions together', async () => {
  await updateRoleAndPermissions('role', 'tenant', { name: 'Account Manager', description: 'Updated' }, [{ ...EMPTY_PERMISSION_FLAGS, module: 'deals', canView: true }]);
  expect(saved).toMatchObject({ role: { name: 'Account Manager', description: 'Updated' }, userRole: 'Account Manager', permissions: ['deals'] });
  expect(state.db.$transaction).toHaveBeenCalledOnce();
  expect(state.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  expect(state.tx.user.updateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', role: 'Sales' }, data: { role: 'Account Manager' } });
});

it('rolls back metadata and staff role labels when a permission replacement fails', async () => {
  state.tx.rolePermission.upsert.mockRejectedValue(new Error('permission write failed'));
  await expect(updateRoleAndPermissions('role', 'tenant', { name: 'Renamed' }, [{ ...EMPTY_PERMISSION_FLAGS, module: 'deals' }])).rejects.toThrow('permission write failed');
  expect(saved).toEqual({ role: { id: 'role', name: 'Sales', description: 'Original', isSystemRole: false }, userRole: 'Sales', permissions: ['leads', 'contacts'] });
});

it('rejects an archived, missing or foreign role inside the transaction before writes', async () => {
  state.tx.roleDefinition.findFirst.mockResolvedValue(null);
  await expect(updateRoleAndPermissions('foreign', 'tenant', { name: 'Renamed' }, [])).rejects.toMatchObject({ statusCode: 404 });
  expect(state.tx.roleDefinition.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 'tenant', isArchived: false } });
  expect(state.tx.roleDefinition.update).not.toHaveBeenCalled();
  expect(state.tx.rolePermission.deleteMany).not.toHaveBeenCalled();
});

it('leaves permissions unchanged when omitted and supports explicit empty replacement', async () => {
  await updateRoleAndPermissions('role', 'tenant', { description: 'New description' });
  expect(saved.permissions).toEqual(['leads', 'contacts']);
  await updateRoleAndPermissions('role', 'tenant', {}, []);
  expect(saved.permissions).toEqual([]);
});
