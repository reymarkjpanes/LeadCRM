import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../../config/database.config', () => ({ default: {} }));
import { replaceUserRole } from '../roles.repository';
const tx = { $queryRaw: vi.fn(), user: { findFirst: vi.fn(), updateMany: vi.fn() }, roleDefinition: { findFirst: vi.fn() }, userRole: { deleteMany: vi.fn(), upsert: vi.fn() } };
beforeEach(() => {
  vi.resetAllMocks();
  tx.user.findFirst.mockResolvedValue({ id: 'u', role: 'Sales', email: 'staff@camxian.com' });
  tx.user.updateMany.mockResolvedValue({ count: 1 });
  tx.roleDefinition.findFirst.mockResolvedValue({ id: 'sales-role', name: 'Sales' });
});
it('keeps the User role and permission assignment synchronized within the caller transaction', async () => {
  await replaceUserRole(tx as never, 'u', 'tenant', 'Sales');
  expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u', tenantId: 'tenant' } });
  expect(tx.roleDefinition.findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant', name: 'Sales', isArchived: false } });
  expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u', tenantId: 'tenant', role: 'Sales' }, data: { role: 'Sales' } });
  expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u', tenantId: 'tenant', roleId: { not: 'sales-role' }, role: { tenantId: 'tenant', name: 'Sales' } } });
  expect(tx.userRole.upsert).toHaveBeenCalledWith({ where: { userId_roleId_tenantId: { userId: 'u', tenantId: 'tenant', roleId: 'sales-role' } }, create: { userId: 'u', tenantId: 'tenant', roleId: 'sales-role' }, update: {} });
});
it('leaves memberships intact when the primary role changed after it was read', async () => {
  tx.user.updateMany.mockResolvedValue({ count: 0 });
  await expect(replaceUserRole(tx as never, 'u', 'tenant', 'Sales')).rejects.toMatchObject({ statusCode: 409 });
  expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
  expect(tx.userRole.upsert).not.toHaveBeenCalled();
});
it.each(['user', 'role'])('rejects a missing or cross-tenant %s before changing assignments', async missing => {
  (missing === 'user' ? tx.user.findFirst : tx.roleDefinition.findFirst).mockResolvedValue(null);
  await expect(replaceUserRole(tx as never, 'u', 'tenant', 'Sales')).rejects.toThrow();
  expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
});
