// Groups repository — thin DB layer, all queries scoped to tenantId.
// Business logic lives in groups.service.ts.

import prisma from '../../../config/database.config';

const GROUP_SELECT = {
  id:        true,
  tenantId:  true,
  name:      true,
  createdAt: true,
  updatedAt: true,
  members: {
    select: {
      id:     true,
      userId: true,
      user: {
        select: {
          id:        true,
          firstName: true,
          lastName:  true,
          email:     true,
          role:      true,
        },
      },
    },
  },
} as const;

export async function findAllGroups(tenantId: string) {
  return prisma.tenantGroup.findMany({
    where:   { tenantId },
    select:  GROUP_SELECT,
    orderBy: { name: 'asc' },
  });
}

export async function findGroupById(id: string, tenantId: string) {
  return prisma.tenantGroup.findFirst({
    where:  { id, tenantId },
    select: GROUP_SELECT,
  });
}

export async function createGroup(tenantId: string, name: string) {
  return prisma.tenantGroup.create({
    data:   { tenantId, name },
    select: GROUP_SELECT,
  });
}

export async function updateGroup(id: string, tenantId: string, name: string) {
  return prisma.tenantGroup.update({
    where:  { id, tenantId },
    data:   { name },
    select: GROUP_SELECT,
  });
}

export async function deleteEmptyGroup(id: string, tenantId: string) {
  // The predicate and serializable transaction protect against concurrent additions.
  return prisma.$transaction(tx => tx.tenantGroup.deleteMany({
    where: { id, tenantId, members: { none: {} } },
  }), { isolationLevel: 'Serializable' });
}

export async function addGroupMember(groupId: string, userId: string, tenantId: string) {
  return prisma.$transaction(async tx => {
    await tx.tenantGroup.findFirstOrThrow({ where: { id: groupId, tenantId } });
    return tx.tenantGroupMember.upsert({
      where: { groupId_userId: { groupId, userId }, tenantId },
      create: { groupId, userId, tenantId },
      update: {}, // already exists — no-op
    });
  }, { isolationLevel: 'Serializable' });
}

export async function findMemberUser(userId: string, tenantId: string) {
  return prisma.user.findFirst({ where: { id: userId, tenantId, status: 'ACTIVE' }, select: { id: true } });
}

export async function removeGroupMember(groupId: string, userId: string, tenantId: string) {
  return prisma.tenantGroupMember.deleteMany({ where: { groupId, userId, tenantId } });
}
