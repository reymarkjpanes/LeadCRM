import { z } from 'zod';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { comparePassword, hashPassword } from '../../shared/helpers/crypto';
import { authTransaction } from './auth-transaction';
import { isAllowlistedDevelopmentGmail, isAllowlistedProductionGmail } from './account-access';
import { generateTemporaryPassword } from './temporary-password';
import { sendWelcomeCredentials } from './welcome-credentials.service';

const Input = z.object({
  tenantId: z.string().min(1), email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  reissue: z.boolean().default(false),
  production: z.boolean().default(false),
}).strict();

/** Deliberate CLI-only provisioning; never mounted as an application endpoint. */
export async function provisionTestUser(input: z.input<typeof Input>) {
  const data = Input.parse(input);
  const allowed = data.production ? isAllowlistedProductionGmail(data.email) : isAllowlistedDevelopmentGmail(data.email);
  if (!allowed) {
    throw new AppError('Provisioning requires the matching environment, its enabled exact Gmail allowlist, and --production for production access.', 403);
  }
  const matches = await prisma.user.findMany({ where: { email: { equals: data.email, mode: 'insensitive' } }, take: 2 });
  if (matches.length > 1 || matches.some(user => user.tenantId !== data.tenantId)) {
    throw new AppError('Resolve the existing account and tenant before provisioning.', 409);
  }
  const existing = matches[0];
  if (existing && !data.reissue) {
    return { email: data.email, status: 'preserved' as const, submitted: false };
  }
  if (existing && existing.status !== 'ACTIVE') throw new AppError('Resolve the existing account status before reissuing credentials.', 409);
  let temporaryPassword = generateTemporaryPassword(data.firstName, data.lastName);
  // A reissue must supersede the old credential even if the two-digit draw repeats.
  for (let attempt = 0; existing?.passwordHash && await comparePassword(temporaryPassword, existing.passwordHash); attempt++) {
    if (attempt >= 10) throw new AppError('Unable to generate a different temporary password. Retry the provisioning command.', 503);
    temporaryPassword = generateTemporaryPassword(data.firstName, data.lastName);
  }
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await authTransaction(async tx => {
    const tenant = await tx.tenant.findFirst({ where: { id: data.tenantId, status: { in: ['ACTIVE', 'SANDBOX'] } } });
    const role = await tx.roleDefinition.findFirst({ where: { tenantId: data.tenantId, name: 'Client Admin', isArchived: false } });
    if (!tenant || !role) throw new AppError('An active workspace and its existing Client Admin role are required.', 400);
    const fields = { passwordHash, mustChangePassword: true, onboardingCompletedAt: null, role: role.name };
    const created = existing
      ? await tx.user.update({ where: { id: existing.id }, data: fields })
      : await tx.user.create({ data: { tenantId: data.tenantId, email: data.email, firstName: data.firstName, lastName: data.lastName, ...fields } });
    await tx.userRole.deleteMany({ where: { userId: created.id, tenantId: data.tenantId } });
    await tx.userRole.create({ data: { userId: created.id, roleId: role.id, tenantId: data.tenantId } });
    await tx.session.deleteMany({ where: { userId: created.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: created.id } });
    await tx.auditLog.create({ data: {
      tenantId: data.tenantId, userId: created.id, entityType: 'User', entityId: created.id,
      action: data.production
        ? (existing ? 'user.production_credentials_reissued' : 'user.production_provisioned')
        : (existing ? 'user.test_credentials_reissued' : 'user.test_provisioned'),
      changeset: { before: null, after: { email: created.email, role: created.role } },
    } });
    return created;
  });
  const submitted = await sendWelcomeCredentials(user, temporaryPassword);
  return { email: user.email, status: existing ? 'reissued' as const : 'created' as const, submitted };
}
