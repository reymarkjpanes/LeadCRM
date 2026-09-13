import { randomBytes } from 'crypto';
import prisma from '../../../config/database.config';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { revokeAllUserSessions } from '../../../core/auth/session.service';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../../../shared/errors/http-error';
import { hashPassword } from '../../../shared/helpers/crypto';
import { getPaginationParams, paginate } from '../../../shared/helpers/pagination';
import { Role } from '../../../shared/constants/roles';

const SAFE_USER_SELECT = {
  id: true, tenantId: true, firstName: true, lastName: true,
  email: true, role: true, status: true, createdAt: true, updatedAt: true,
  phone: true, jobTitle: true, department: true, avatarUrl: true, timeZone: true, lastLoginAt: true,
  // passwordHash is NEVER selected
};

/** Case-insensitive check for System Admin role — guards against both 'System Admin' and 'SYSTEM_ADMIN' variants. */
function isSystemAdminRole(role: string | null | undefined): boolean {
  return (role ?? '').toLowerCase() === Role.SYSTEM_ADMIN.toLowerCase();
}

export async function getAll(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;
  const where = {
    tenantId,
    ...(query.status ? { status: String(query.status) as 'ACTIVE' | 'INACTIVE' | 'PENDING' } : {}),
    ...(query.role   ? { role:   String(query.role) }   : {}),
    ...(query.search ? {
      OR: [
        { firstName: { contains: String(query.search), mode: 'insensitive' as const } },
        { lastName:  { contains: String(query.search), mode: 'insensitive' as const } },
        { email:     { contains: String(query.search), mode: 'insensitive' as const } },
      ],
    } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: SAFE_USER_SELECT }),
    prisma.user.count({ where }),
  ]);
  return paginate(data, total, { page, limit });
}

export async function getById(id: string, tenantId: string) {
  const user = await prisma.user.findFirst({ where: { id, tenantId }, select: SAFE_USER_SELECT });
  if (!user) throw new NotFoundError('User');
  return user;
}

export async function create(tenantId: string, actorId: string, dto: {
  firstName: string; lastName: string; email: string; password?: string; role?: string; phone?: string; jobTitle?: string; department?: string; avatarUrl?: string; timeZone?: string;
}) {
  if (isSystemAdminRole(dto.role)) {
    throw new ForbiddenError('Cannot assign System Admin role via tenant user management');
  }
  const existing = await prisma.user.findFirst({ where: { email: dto.email, tenantId } });
  if (existing) throw new ConflictError('A user with this email already exists in this tenant');

  // Use a secure random password if none is provided, requiring the user to reset it later
  const secureRandomPassword = dto.password || randomBytes(32).toString('hex');
  const passwordHash = await hashPassword(secureRandomPassword);
  const user = await prisma.user.create({
    data: { 
      tenantId, firstName: dto.firstName, lastName: dto.lastName, email: dto.email, passwordHash, role: dto.role ?? Role.USER,
      phone: dto.phone, jobTitle: dto.jobTitle, department: dto.department, avatarUrl: dto.avatarUrl, timeZone: dto.timeZone
    },
    select: SAFE_USER_SELECT,
  });
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.created', entityType: 'User', entityId: user.id, after: { email: dto.email, role: user.role } });
  return user;
}

export async function update(id: string, tenantId: string, actorId: string, dto: {
  firstName?: string; lastName?: string; role?: string; status?: string; phone?: string; jobTitle?: string; department?: string; avatarUrl?: string; timeZone?: string;
}) {
  if (isSystemAdminRole(dto.role)) {
    throw new ForbiddenError('Cannot assign System Admin role via tenant user management');
  }
  if (dto.status && !['ACTIVE', 'INACTIVE', 'PENDING'].includes(dto.status)) {
    throw new ValidationError('Invalid status value provided');
  }
  
  const existing = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('User');

  // Prevent modifying System Admin users
  if (isSystemAdminRole(existing.role)) {
    throw new ForbiddenError('Cannot modify System Admin users');
  }

  const updateData: any = { ...dto };
  if (dto.status) updateData.status = dto.status as any; // Cast as enum

  const user = await prisma.user.update({ where: { id }, data: updateData, select: SAFE_USER_SELECT });
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.updated', entityType: 'User', entityId: id, after: dto as Record<string, unknown> });
  return user;
}

export async function archive(id: string, tenantId: string, actorId: string) {
  const existing = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('User');
  if (id === actorId) throw new ForbiddenError('Cannot archive your own account');

  await prisma.user.update({ where: { id }, data: { status: 'INACTIVE' } });
  await revokeAllUserSessions(id);
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.archived', entityType: 'User', entityId: id, after: { status: 'INACTIVE' }, severity: 'WARNING' });
}

export async function restore(id: string, tenantId: string, actorId: string) {
  const existing = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('User');

  await prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.restored', entityType: 'User', entityId: id, after: { status: 'ACTIVE' }, severity: 'INFO' });
}

export async function deleteRecord(id: string, tenantId: string, actorId: string) {
  const existing = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('User');
  if (id === actorId) throw new ForbiddenError('Cannot delete your own account');
  if (isSystemAdminRole(existing.role)) throw new ForbiddenError('Cannot delete System Admin users');

  await prisma.user.delete({ where: { id } });
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.deleted', entityType: 'User', entityId: id, severity: 'CRITICAL' });
}

export async function bulkUpdate(ids: string[], tenantId: string, actorId: string, dto: Record<string, any>) {
  if (isSystemAdminRole(dto.role)) throw new ForbiddenError('Cannot assign System Admin role');
  if (dto.status && !['ACTIVE', 'INACTIVE', 'PENDING'].includes(dto.status)) {
    throw new ValidationError('Invalid status value provided');
  }
  
  await prisma.user.updateMany({
    // Prevent bulk updating System Admins — use mode: 'insensitive' for case-safe exclusion
    where: {
      id: { in: ids },
      tenantId,
      NOT: { role: { equals: Role.SYSTEM_ADMIN, mode: 'insensitive' } },
    },
    data: dto
  });
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.bulk_updated', entityType: 'User', after: { ids, updates: dto }, severity: 'WARNING' });
}

export async function bulkDelete(ids: string[], tenantId: string, actorId: string) {
  if (ids.includes(actorId)) throw new ForbiddenError('Cannot delete your own account in a bulk operation');
  
  await prisma.user.deleteMany({
    // Prevent bulk deleting System Admins — use mode: 'insensitive' for case-safe exclusion
    where: {
      id: { in: ids },
      tenantId,
      NOT: { role: { equals: Role.SYSTEM_ADMIN, mode: 'insensitive' } },
    },
  });
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.bulk_deleted', entityType: 'User', after: { ids }, severity: 'CRITICAL' });
}
