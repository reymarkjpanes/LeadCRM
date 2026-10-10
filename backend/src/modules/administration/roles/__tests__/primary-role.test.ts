import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../../config/database.config', () => ({ default: {} }));
import { replaceUserRole } from '../roles.repository';
const tx = { user: { findFirst: vi.fn(), update: vi.fn() }, roleDefinition: { findFirst: vi.fn() }, userRole: { deleteMany: vi.fn(), create: vi.fn() } };
beforeEach(() => { vi.resetAllMocks(); tx.user.findFirst.mockResolvedValue({ id: 'u', role: 'Sales', email: 'staff@camxian.com' }); tx.roleDefinition.findFirst.mockResolvedValue({ id: 'sales-role', name: 'Sales' }); });
it('keeps the User role and permission assignment synchronized within the caller transaction', async () => {
  await replaceUserRole(tx as never, 'u', 'tenant', 'Sales');
  expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u', tenantId: 'tenant' } });
  expect(tx.roleDefinition.findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant', name: 'Sales', isArchived: false } });
  expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u' }, data: { role: 'Sales' } });
  expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u', tenantId: 'tenant' } });
  expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: 'u', tenantId: 'tenant', roleId: 'sales-role' } });
});
it.each(['user', 'role'])('rejects a missing or cross-tenant %s before changing assignments', async missing => {
  (missing === 'user' ? tx.user.findFirst : tx.roleDefinition.findFirst).mockResolvedValue(null);
  await expect(replaceUserRole(tx as never, 'u', 'tenant', 'Sales')).rejects.toThrow();
  expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
});
