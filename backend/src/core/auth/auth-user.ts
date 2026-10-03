import type { AuthUser } from '@leadcrm/shared';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';

export const authTenantSelect = {
  name: true, status: true,
  industry: true, companySize: true, website: true, currency: true,
  onboardingStep: true, onboardingCompletedAt: true, ownerUserId: true,
} satisfies Prisma.TenantSelect;

export interface AuthUserSource {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  status?: string;
  emailVerified?: Date | null;
  passwordHash?: string | null;
  passwordChangedAt?: Date | null;
  mustChangePassword?: boolean;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  avatarUrl?: string | null;
  tenant?: {
    name?: string | null;
    status?: string | null;
    industry?: string | null;
    companySize?: string | null;
    website?: string | null;
    currency?: string | null;
    onboardingStep?: number | null;
    onboardingCompletedAt?: Date | null;
    ownerUserId?: string | null;
  } | null;
}

export type AuthUserResponse = AuthUser;

/** Explicit allowlist: credentials and provider tokens never enter this response. */
export function buildAuthUserResponse(user: AuthUserSource): AuthUser {
  const tenant = user.tenant;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    tenantId: user.tenantId,
    status: user.status ?? null,
    emailVerified: user.emailVerified?.toISOString() ?? null,
    phone: user.phone ?? null,
    jobTitle: user.jobTitle ?? null,
    department: user.department ?? null,
    avatarUrl: user.avatarUrl ?? null,
    tenantName: tenant?.name ?? null,
    tenantStatus: tenant?.status ?? null,
    industry: tenant?.industry ?? null,
    companySize: tenant?.companySize ?? null,
    website: tenant?.website ?? null,
    currency: tenant?.currency ?? null,
    onboardingStep: tenant?.onboardingStep ?? 0,
    onboardingCompletedAt: tenant?.onboardingCompletedAt?.toISOString() ?? null,
    isTenantOwner: tenant?.ownerUserId === user.id,
    hasPassword: Boolean(user.passwordHash),
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

export async function readAuthUser(
  userId: string,
  tenantId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<AuthUser> {
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    include: { tenant: { select: authTenantSelect } },
  });
  if (!user) throw new AppError('Authentication required', 401);
  return buildAuthUserResponse(user);
}
