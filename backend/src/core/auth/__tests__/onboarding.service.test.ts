import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../config/database.config', async () => ({ default: (await import('./auth-test-db')).db }));
import { db, user, tenant, resetDb } from './auth-test-db';
import { completeOnboarding } from '../onboarding.service';
const actor = { userId: 'user-1', tenantId: 'tenant-1' };
beforeEach(() => { resetDb(); user.role = 'Client Admin'; });
it.each([0, 1, 2])('completes informational acknowledgment from legacy step %s', async step => {
  tenant.onboardingStep = step;
  const result = await completeOnboarding(actor);
  expect(result).toMatchObject({ role: 'Client Admin', onboardingStep: 3, tenantName: 'Workspace' });
  expect(result.onboardingCompletedAt).toEqual(expect.any(String));
  expect(db.auditLog.create).toHaveBeenCalledOnce();
});
it('does not require an owner or OTP for an internally provisioned admin', async () => {
  tenant.ownerUserId = 'another-admin'; user.emailVerified = null as never;
  await expect(completeOnboarding(actor)).resolves.toHaveProperty('onboardingStep', 3);
});
it.each(['Sales', 'Custom Role'])('allows informational onboarding for %s without changing permissions', async role => {
  user.role = role;
  await expect(completeOnboarding(actor)).resolves.toMatchObject({ role, onboardingStep: 3 });
  expect(db.userRole.create).not.toHaveBeenCalled();
  expect(db.tenant.updateMany).not.toHaveBeenCalled();
});
it('blocks completion before the temporary password is changed', async () => {
  user.mustChangePassword = true;
  await expect(completeOnboarding(actor)).rejects.toHaveProperty('code', 'PASSWORD_CHANGE_REQUIRED');
  expect(db.tenant.updateMany).not.toHaveBeenCalled();
});
it('preserves the first acknowledgment timestamp on repeated completion', async () => {
  user.onboardingCompletedAt = new Date('2026-01-01');
  const result = await completeOnboarding(actor);
  expect(result.onboardingCompletedAt).toBe('2026-01-01T00:00:00.000Z');
  expect(db.auditLog.create).not.toHaveBeenCalled();
});
