import type { CompanySetupInput, OnboardingProgressInput } from '@leadcrm/shared';
import { requireEmployeeAccount } from './account-access';
import { AppError } from '../../shared/errors/app-error';
import { authTransaction } from './auth-transaction';
import { readAuthUser } from './auth-user';
export interface OnboardingActor { userId: string; tenantId: string; }
export async function advanceOnboarding(_actor: OnboardingActor, _input: OnboardingProgressInput) {
  throw new AppError('This setup route is no longer available.', 404);
}
export async function completeOnboarding(actor: OnboardingActor, _input?: CompanySetupInput) {
  return authTransaction(async tx => {
    const user = await tx.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError('Active account required.', 403);
    }
    requireEmployeeAccount(user);
    if (user.mustChangePassword) throw new AppError('Change your password first.', 403, 'PASSWORD_CHANGE_REQUIRED');
    const changed = await tx.user.updateMany({
      where: { id: user.id, tenantId: user.tenantId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date() },
    });
    if (changed.count) await tx.auditLog.create({ data: {
      tenantId: user.tenantId, userId: user.id, action: 'ONBOARDING_COMPLETED', entityType: 'User', entityId: user.id,
    } });
    return readAuthUser(user.id, user.tenantId, tx);
  });
}
