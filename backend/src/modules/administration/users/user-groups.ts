import type { Prisma } from '@prisma/client';
import { ValidationError } from '../../../shared/errors/http-error';

export async function replaceUserGroups(tx: Prisma.TransactionClient, tenantId: string, userId: string, groupIds: string[]) {
  const user = await tx.user.findFirst({ where: { id: userId, tenantId, status: 'ACTIVE' }, select: { id: true } });
  if (!user) throw new ValidationError('Group membership requires an active workspace user.');
  const groups = await tx.tenantGroup.findMany({ where: { tenantId, id: { in: groupIds } }, select: { id: true } });
  if (groups.length !== groupIds.length) throw new ValidationError('Choose groups from this workspace.');
  await tx.tenantGroupMember.deleteMany({ where: { tenantId, userId, groupId: { notIn: groupIds } } });
  if (groupIds.length) await tx.tenantGroupMember.createMany({
    data: groupIds.map(groupId => ({ tenantId, userId, groupId })), skipDuplicates: true,
  });
}

export function serializeUserGroups<T extends { groupMemberships?: { group: { id: string; name: string } }[] }>(user: T) {
  const { groupMemberships, ...fields } = user;
  return { ...fields, groups: (groupMemberships ?? []).map(member => member.group).sort((a, b) => a.name.localeCompare(b.name)) };
}
