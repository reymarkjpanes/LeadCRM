// Groups service — business logic layer.
// No req/res here; all Prisma access goes through groups.repository.ts.

import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ConflictError } from '../../../shared/errors/http-error';
import * as repo from './groups.repository';

export async function getAll(tenantId: string) {
  return repo.findAllGroups(tenantId);
}

export async function create(tenantId: string, actorId: string, name: string) {
  const group = await repo.createGroup(tenantId, name);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'group.created', entityType: 'TenantGroup', entityId: group.id,
    after: { name },
  });
  return group;
}

export async function update(id: string, tenantId: string, actorId: string, name: string) {
  const existing = await repo.findGroupById(id, tenantId);
  if (!existing) throw new NotFoundError('Group');

  const group = await repo.updateGroup(id, name);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'group.updated', entityType: 'TenantGroup', entityId: id,
    after: { name },
  });
  return group;
}

export async function remove(id: string, tenantId: string, actorId: string) {
  const existing = await repo.findGroupById(id, tenantId);
  if (!existing) throw new NotFoundError('Group');

  await repo.deleteGroup(id);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'group.deleted', entityType: 'TenantGroup', entityId: id,
    severity: 'WARNING',
  });
}

export async function addMember(groupId: string, userId: string, tenantId: string, actorId: string) {
  const group = await repo.findGroupById(groupId, tenantId);
  if (!group) throw new NotFoundError('Group');

  await repo.addGroupMember(groupId, userId, tenantId);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'group.member_added', entityType: 'TenantGroup', entityId: groupId,
    after: { userId },
  });
}

export async function removeMember(groupId: string, userId: string, tenantId: string, actorId: string) {
  const group = await repo.findGroupById(groupId, tenantId);
  if (!group) throw new NotFoundError('Group');

  await repo.removeGroupMember(groupId, userId);
  await writeAuditLog({
    tenantId, userId: actorId,
    action: 'group.member_removed', entityType: 'TenantGroup', entityId: groupId,
    after: { userId },
  });
}
