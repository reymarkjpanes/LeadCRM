import { expect, it } from 'vitest';
import authRoutes from '../auth.routes';
import administrationRoutes from '../administration.routes';
import { UpdateUsersSchema } from '../../../modules/administration/users/users.dto';
function paths(router: typeof authRoutes): string[] {
  return router.stack.filter(layer => layer.route).map(layer => layer.route.path);
}
it('does not register public signup, OTP, Google, or company-setup endpoints', () => {
  const enabled = paths(authRoutes);
  for (const path of ['/register/client-admin', '/register/guest', '/oauth/google', '/send-registration-otp', '/verify-registration-otp', '/verify-email', '/resend-verification', '/onboarding/step', '/onboarding/workspace', '/oauth/complete-profile']) {
    expect(enabled).not.toContain(path);
  }
  expect(enabled).toContain('/change-password');
  expect(enabled).toContain('/onboarding/complete');
});
it('does not register billing or team domain APIs', () => {
  expect(paths(administrationRoutes).some(path => /domains|domain-settings/.test(path))).toBe(false);
});
it.each(['mustChangePassword', 'passwordHash', 'tenantId', 'email'])('rejects injected security field %s through user management', field => {
  expect(UpdateUsersSchema.safeParse({ [field]: field === 'mustChangePassword' ? false : 'injected' }).success).toBe(false);
});
