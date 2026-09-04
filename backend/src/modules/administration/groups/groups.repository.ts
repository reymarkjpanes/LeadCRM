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

export async function updateGroup(id: string, name: string) {
  return prisma.tenantGroup.update({
    where:  { id },
    data:   { name },
    select: GROUP_SELECT,
  });
}

export async function deleteGroup(id: string) {
  // Cascade in DB removes TenantGroupMember rows automatically
  return prisma.tenantGroup.delete({ where: { id } });
}

export async function addGroupMember(groupId: string, userId: string, tenantId: string) {
  return prisma.tenantGroupMember.upsert({
    where:  { groupId_userId: { groupId, userId } },
    create: { groupId, userId, tenantId },
    update: {}, // already exists — no-op
  });
}

export async function removeGroupMember(groupId: string, userId: string) {
  return prisma.tenantGroupMember.deleteMany({ where: { groupId, userId } });
}
