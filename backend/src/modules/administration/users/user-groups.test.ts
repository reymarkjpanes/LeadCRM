import { beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { replaceUserGroups, serializeUserGroups } from './user-groups';
import { CreateAdministrationUserSchema, UpdateSelfProfileSchema } from '@leadcrm/shared';

const tx = {
  user: { findFirst: vi.fn() }, tenantGroup: { findMany: vi.fn() },
  tenantGroupMember: { deleteMany: vi.fn(), createMany: vi.fn() },
};
const save = (ids: string[]) => replaceUserGroups(tx as unknown as Prisma.TransactionClient, 'tenant-a', 'user-a', ids);
beforeEach(() => { vi.resetAllMocks(); tx.user.findFirst.mockResolvedValue({ id: 'user-a' }); });
it('replaces membership using tenant-scoped validated relationships and preserves idempotency', async () => {
  tx.tenantGroup.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
  await save(['g1', 'g2']);
  expect(tx.tenantGroup.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', id: { in: ['g1', 'g2'] } }, select: { id: true } });
  expect(tx.tenantGroupMember.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', userId: 'user-a', groupId: { notIn: ['g1', 'g2'] } } });
  expect(tx.tenantGroupMember.createMany).toHaveBeenCalledWith({ data: [
    { tenantId: 'tenant-a', userId: 'user-a', groupId: 'g1' }, { tenantId: 'tenant-a', userId: 'user-a', groupId: 'g2' },
  ], skipDuplicates: true });
});
it('rejects foreign groups and inactive users before changing any memberships', async () => {
  tx.tenantGroup.findMany.mockResolvedValue([]);
  await expect(save(['foreign'])).rejects.toThrow('this workspace');
  expect(tx.tenantGroupMember.deleteMany).not.toHaveBeenCalled();
  tx.user.findFirst.mockResolvedValue(null);
  await expect(save([])).rejects.toThrow('active workspace user');
  expect(tx.tenantGroupMember.createMany).not.toHaveBeenCalled();
});
it('can clear memberships and never exposes raw junction rows in the user response', async () => {
  tx.tenantGroup.findMany.mockResolvedValue([]); await save([]);
  expect(tx.tenantGroupMember.createMany).not.toHaveBeenCalled();
  const response = serializeUserGroups({ id: 'u', groupMemberships: [{ group: { id: 'g', name: 'Sales' } }] });
  expect(response).toEqual({ id: 'u', groups: [{ id: 'g', name: 'Sales' }] });
});
it('rejects self-assigned memberships and retired department data', () => {
  expect(UpdateSelfProfileSchema.safeParse({ groupIds: ['g'] }).success).toBe(false);
  expect(UpdateSelfProfileSchema.safeParse({ department: 'Sales' }).success).toBe(false);
  const base = { firstName: 'A', lastName: 'B', email: 'a@camxian.com', phone: '9123456789', role: 'Sales' };
  expect(CreateAdministrationUserSchema.safeParse({ ...base, department: 'Sales' }).success).toBe(false);
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  expect(CreateAdministrationUserSchema.safeParse({ ...base, groupIds: [id, id] }).success).toBe(false);
});
