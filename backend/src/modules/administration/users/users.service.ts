import { EmployeeEmailSchema, isOnboardingComplete, isWorkspaceAccessible, type CreateAdministrationUserInput, type UpdateAdministrationUserInput } from '@leadcrm/shared';
import { assertNoOwnership } from './user-deactivation.service';
import { replaceUserGroups, serializeUserGroups } from './user-groups';
import { eligibleAssignedAgents, hasAssignedAgentAccess, crmAssignmentRequirements, TASK_ASSIGNEE_REQUIREMENTS, type AssignedAgent } from '../../crm/access/assigned-agent-eligibility';
import { requestPasswordReset } from '../../../core/auth/password-reset.service';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import { readSelfAvatar } from '../../../core/auth/profile.service';
import { replaceUserRole } from '../roles/roles.repository';
import { CreateUsersSchema, UpdateUsersSchema } from './users.dto';
import { requireEmployeeAccount, requireStaffIdentity } from '../../../core/auth/account-access';
import { assertPermissions } from '../../../core/permissions/permission.service';
import { readAuthUser } from '../../../core/auth/auth-user';
import { generateTemporaryPassword } from '../../../core/auth/temporary-password';
import { sendWelcomeCredentials } from '../../../core/auth/welcome-credentials.service';
import prisma from '../../../config/database.config';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { revokeAllUserSessions } from '../../../core/auth/session.service';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../../../shared/errors/http-error';
import { hashPassword } from '../../../shared/helpers/crypto';
import { getPaginationParams, paginate } from '../../../shared/helpers/pagination';
import { Prisma } from '@prisma/client';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { findUserByEmail } from './users.repository';

const SAFE_USER_SELECT = {
  id: true, tenantId: true, firstName: true, lastName: true,
  email: true, role: true, status: true, createdAt: true, updatedAt: true,
  phone: true, jobTitle: true, avatarUrl: true, lastLoginAt: true, securityLockedAt: true,
  groupMemberships: { select: { group: { select: { id: true, name: true } } } },
  // passwordHash is NEVER selected
};

function assignmentEligibility(user: AssignedAgent, tenantId: string) {
  const assignableModules = (['leads', 'contacts', 'deals', 'tasks'] as const).filter(module =>
    hasAssignedAgentAccess(user, tenantId, module === 'tasks' ? TASK_ASSIGNEE_REQUIREMENTS : crmAssignmentRequirements(module)));
  return { assignableModules, assignableAgent: ['leads', 'deals'].every(module => assignableModules.includes(module as 'leads' | 'deals')) };
}


export async function getAll(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;
  const where: Prisma.UserWhereInput = {
    tenantId,
    ...(query.status ? { status: String(query.status) as 'ACTIVE' | 'INACTIVE' | 'PENDING' } : {}),
    ...(query.role   ? { role:   String(query.role) }   : {}),
    AND: buildSearchClauses(query.search, ['firstName', 'lastName', 'email', 'phone', 'role', 'jobTitle']),
  };
  const ids = await sortedPageIds(query.sort === 'createdAt:desc' ? undefined : query.sort, ['name', 'firstName', 'email', 'role', 'status', 'groups', 'createdAt'], skip, limit,
    async () => (await prisma.user.findMany({ where, select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, createdAt: true, groupMemberships: SAFE_USER_SELECT.groupMemberships } }))
      .map(user => ({ ...user, name: `${user.firstName} ${user.lastName}`.trim(), groups: (user.groupMemberships ?? []).map(member => member.group.name).sort().join(', ') })),
    direction => prisma.user.findMany({ where, skip, take: limit, orderBy: [{ createdAt: direction }, { id: 'asc' }], select: { id: true } }));
  const [data, total] = await Promise.all([
    prisma.user.findMany({ where: ids ? { ...where, id: { in: ids } } : where, skip: ids ? 0 : skip, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: SAFE_USER_SELECT }),
    prisma.user.count({ where }),
  ]);
  const assignable = new Map((await eligibleAssignedAgents(prisma, tenantId, [])).map(user => [user.id, assignmentEligibility(user, tenantId)]));
  return paginate(orderPage(data, ids).map(user => ({ ...serializeUserGroups(user), ...(assignable.get(user.id) ?? { assignableAgent: false, assignableModules: [] }) })), total, { page, limit });
}

export async function getById(id: string, tenantId: string) {
  const user = await prisma.user.findFirst({ where: { id, tenantId }, select: SAFE_USER_SELECT });
  if (!user) throw new NotFoundError('User');
  const agent = (await eligibleAssignedAgents(prisma, tenantId, [])).find(agent => agent.id === id);
  return { ...serializeUserGroups(user), ...(agent ? assignmentEligibility(agent, tenantId) : { assignableAgent: false, assignableModules: [] }) };
}

export async function getAvatar(id: string, tenantId: string, avatarId: string) {
  await getById(id, tenantId);
  return readSelfAvatar(id, tenantId, avatarId);
}

export async function create(tenantId: string, actorId: string, dto: CreateAdministrationUserInput) {
  dto = CreateUsersSchema.parse(dto);
  requireStaffIdentity({ email: dto.email, role: dto.role });
  const existing = await findUserByEmail(dto.email, tenantId);
  if (existing) throw new ConflictError('A user with this email already exists in this tenant');

  const temporaryPassword = generateTemporaryPassword(dto.firstName, dto.lastName);
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await prisma.$transaction(async tx => {
    const actor = await readAuthUser(actorId, tenantId, tx);
    await requireEmployeeAccount(actor, tx);
    if (actor.status !== 'ACTIVE' || actor.mustChangePassword || !isOnboardingComplete(actor) || !isWorkspaceAccessible(actor.tenantStatus)) throw new ForbiddenError('Active administrator access is required.');
    await assertPermissions({ userId: actorId, tenantId, role: actor.role }, ['users.create', 'roles.assign'], tx);
    const externalEmail = !EmployeeEmailSchema.safeParse(dto.email).success;
    if (externalEmail && actor.role !== 'Client Admin') throw new ForbiddenError('Only Client Admin users can approve an external staff email.');
    const creatingAdmin = dto.role === 'Client Admin';
    if (creatingAdmin && actor.role !== 'Client Admin') throw new ForbiddenError('Only Client Admin users can create another Client Admin.');
    const role = await tx.roleDefinition.findFirst({ where: { tenantId, name: dto.role, isArchived: false, isSystemRole: creatingAdmin } });
    if (!role) throw new ValidationError('Select an active role.');
    const created = await tx.user.create({
      data: {
        tenantId, firstName: dto.firstName, lastName: dto.lastName,
        email: dto.email.trim().toLowerCase(), passwordHash,
        mustChangePassword: true, onboardingCompletedAt: null, role: dto.role,
        phone: dto.phone, jobTitle: dto.jobTitle,
      },
      select: SAFE_USER_SELECT,
    });
    if (externalEmail) await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'user.staff_approved', category: 'auth', entityType: 'User', entityId: created.id,
      metadata: { email: dto.email, approvedByRole: actor.role } } });
    if (creatingAdmin) {
      await tx.userRole.create({ data: { userId: created.id, tenantId, roleId: role.id } });
    } else await replaceUserRole(tx, created.id, tenantId, created.role);
    if (dto.groupIds !== undefined) await replaceUserGroups(tx, tenantId, created.id, dto.groupIds);
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'user.created', entityType: 'User', entityId: created.id, changeset: { before: null, after: { email: dto.email, role: created.role } } } });
    return dto.groupIds !== undefined ? tx.user.findFirstOrThrow({ where: { id: created.id, tenantId }, select: SAFE_USER_SELECT }) : created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const setupEmailSent = await sendWelcomeCredentials(user, temporaryPassword);
  return { ...serializeUserGroups(user), setupEmailSent };
}

export async function update(id: string, tenantId: string, actorId: string, dto: UpdateAdministrationUserInput) {
  dto = UpdateUsersSchema.parse(dto);
  if (dto.status && !['ACTIVE', 'INACTIVE', 'PENDING'].includes(dto.status)) {
    throw new ValidationError('Invalid status value provided');
  }

  const existing = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('User');


  if (existing.role === 'Client Admin' && dto.role !== undefined) throw new ForbiddenError('Client Admin role cannot be reassigned');
  if (id === actorId && dto.status === 'INACTIVE') throw new ForbiddenError('Cannot deactivate your own account');
  const { groupIds, ...updateData } = dto;
  if (dto.status) updateData.status = dto.status as any; // Cast as enum

  const protectsLastClientAdmin = existing.role === 'Client Admin' && existing.status === 'ACTIVE' && dto.status === 'INACTIVE';
  let user;
  try {
    user = await prisma.$transaction(async tx => {
      if (dto.status === 'INACTIVE') await assertNoOwnership(tx, tenantId, id);
      if (protectsLastClientAdmin) {
        const activeAdmins = await tx.user.count({ where: { tenantId, role: 'Client Admin', status: 'ACTIVE' } });
        if (activeAdmins <= 1) throw new ConflictError('At least one active Client Admin must remain.');
      }
      if (dto.role) await replaceUserRole(tx, id, tenantId, dto.role, actorId);
      const updated = await tx.user.update({ where: { id, tenantId }, data: updateData, select: SAFE_USER_SELECT });
      if (groupIds !== undefined) {
        if (dto.status === 'INACTIVE') throw new ValidationError('Reassign groups separately before deactivating a user.');
        await replaceUserGroups(tx, tenantId, id, groupIds);
      }
      await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'user.updated', category: 'admin', entityType: 'User', entityId: id,
        changeset: JSON.parse(JSON.stringify({ before: { status: existing.status }, after: dto })) as Prisma.InputJsonValue } });
      return groupIds !== undefined ? tx.user.findFirstOrThrow({ where: { id, tenantId }, select: SAFE_USER_SELECT }) : updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    // A concurrent administrator deactivation can invalidate the serializable count.
    if (protectsLastClientAdmin && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new ConflictError('At least one active Client Admin must remain.');
    }
    throw error;
  }
  if (dto.status === 'INACTIVE') await revokeAllUserSessions(id);
  return serializeUserGroups(user);
}

export async function archive(id: string, tenantId: string, actorId: string) {
  const existing = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('User');
  if (existing.role === 'Client Admin') throw new ForbiddenError('Client Admin cannot be archived');
  if (id === actorId) throw new ForbiddenError('Cannot archive your own account');

  await prisma.$transaction(async tx => {
    await assertNoOwnership(tx, tenantId, id);
    await tx.user.update({ where: { id, tenantId }, data: { status: 'INACTIVE' } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await revokeAllUserSessions(id);
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.archived', entityType: 'User', entityId: id, after: { status: 'INACTIVE' }, severity: 'WARNING' });
}

export async function restore(id: string, tenantId: string, actorId: string) {
  const existing = await prisma.user.findFirst({ where: { id, tenantId, status: 'INACTIVE' } });
  if (!existing) throw new NotFoundError('User');
  const result = await prisma.user.updateMany({ where: { id, tenantId, status: 'INACTIVE' }, data: { status: 'ACTIVE' } });
  if (!result.count) throw new NotFoundError('Archived user');
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.restored', entityType: 'User', entityId: id, after: { status: 'ACTIVE' }, severity: 'INFO' });
}

export async function bulkUpdate(ids: string[], tenantId: string, actorId: string, dto: Record<string, any>) {
  dto = UpdateUsersSchema.parse(dto);
  if (dto.groupIds !== undefined) throw new ValidationError('Update group membership for each user individually.');
  if (dto.status && !['ACTIVE', 'INACTIVE', 'PENDING'].includes(dto.status)) {
    throw new ValidationError('Invalid status value provided');
  }

  if (dto.status !== undefined && (ids.includes(actorId) || await prisma.user.count({ where: { id: { in: ids }, tenantId, role: 'Client Admin' } }))) throw new ForbiddenError('Cannot change your own or Client Admin status in bulk');
  if (dto.status === 'INACTIVE') throw new ConflictError('Deactivate users individually to review CRM ownership.');
  await prisma.$transaction(async tx => {
    const where = { id: { in: ids }, tenantId };
    if (dto.role) {
      const targets = await tx.user.findMany({ where, select: { id: true } });
      for (const target of targets) await replaceUserRole(tx, target.id, tenantId, dto.role, actorId);
    }
    await tx.user.updateMany({ where, data: dto });
  });
  if (dto.status === 'INACTIVE') for (const id of ids) await revokeAllUserSessions(id);
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.bulk_updated', entityType: 'User', after: { ids, updates: dto }, severity: 'WARNING' });
}

export async function sendPasswordReset(id: string, tenantId: string, actorId: string) {
  const user = await getById(id, tenantId);
  if (user.status !== 'ACTIVE') throw new ForbiddenError('Password recovery is unavailable for this user.');
  try { await requestPasswordReset({ email: user.email }, { userId: user.id, tenantId }); }
  catch { throw new ValidationError('Unable to send recovery email. Please try again.'); }
  await writeAuditLog({ tenantId, userId: actorId, action: 'user.password_reset_requested_by_admin', entityType: 'User', entityId: id });
}

/** Explicit approval for historical external-email staff with no provisioning evidence. */
export async function approveStaffEmail(id: string, tenantId: string, actorId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const actor = await readAuthUser(actorId, tenantId, tx);
    await requireEmployeeAccount(actor, tx);
    if (actor.role !== 'Client Admin' || actor.status !== 'ACTIVE' || actor.mustChangePassword || !isOnboardingComplete(actor) || !isWorkspaceAccessible(actor.tenantStatus)) throw new ForbiddenError('Only an active Client Admin can approve a staff email.');
    await assertPermissions({ userId: actorId, tenantId, role: actor.role }, ['users.edit'], tx);
    const target = await tx.user.findFirst({ where: { id, tenantId } });
    if (!target) throw new NotFoundError('User');
    if (target.status !== 'ACTIVE') throw new ForbiddenError('Activate this staff account before approving its email.');
    requireStaffIdentity(target);
    const existing = await tx.auditLog.findFirst({ where: { tenantId, entityType: 'User', entityId: id, action: 'user.staff_approved',
      AND: [{ metadata: { path: ['email'], equals: target.email.trim().toLowerCase() } }, { metadata: { path: ['approvedByRole'], equals: 'Client Admin' } }] }, select: { id: true } });
    if (!existing) await tx.auditLog.create({ data: { tenantId, userId: actorId, entityType: 'User', entityId: id,
      action: 'user.staff_approved', category: 'auth', metadata: { email: target.email.trim().toLowerCase(), approvedByRole: actor.role } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
