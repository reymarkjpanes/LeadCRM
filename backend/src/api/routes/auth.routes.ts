import { ConfirmProfileEmailChangeSchema, RequestProfileEmailChangeSchema, UpdateSelfProfileSchema, AVATAR_MAX_BYTES, LogoutSchema, SessionActivitySchema } from '@leadcrm/shared';
import { tenantMiddleware } from '../middleware/tenant.middleware';
import { confirmEmailChange, patchProfile, requestEmailChange, uploadAvatar, getAvatar } from '../../core/auth/profile.controller';
import { Router, raw } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { authRateLimiter, loginIpRateLimiter, passwordResetRateLimiter, passwordRecoveryAddressRateLimiter } from '../middleware/rate-limit.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { LoginIdentitySchema, LoginLockoutSchema, ForgotPasswordSchema, ResetPasswordSchema } from '../../core/auth/auth.dto';
import * as authController from '../../core/auth/auth.controller';
import { PasswordChangeRequestSchema } from '../../core/auth/change-password.service';
import { changePasswordController } from '../../core/auth/change-password.controller';
import { authorizationEvents } from '../../modules/reporting/reports/dashboard.events';

const router = Router();
const parseAvatar = raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: AVATAR_MAX_BYTES });
router.patch('/profile', authMiddleware, tenantMiddleware, validate(UpdateSelfProfileSchema), patchProfile);
router.post('/profile/email/request', authRateLimiter, authMiddleware, tenantMiddleware, validate(RequestProfileEmailChangeSchema), requestEmailChange);
router.post('/profile/email/confirm', authRateLimiter, authMiddleware, tenantMiddleware, validate(ConfirmProfileEmailChangeSchema), confirmEmailChange);
router.post('/profile/avatar', authMiddleware, tenantMiddleware, (req, res, next) => {
  parseAvatar(req, res, error => next(error?.type === 'entity.too.large'
    ? new AppError('Image must be no larger than 5 MB.', 413)
    : error));
}, uploadAvatar);
router.get('/profile/avatar/:avatarId', authMiddleware, tenantMiddleware, getAvatar);
router.post('/login', loginIpRateLimiter, validate(LoginIdentitySchema), authController.login);
router.post('/login-lockout', loginIpRateLimiter, validate(LoginLockoutSchema), authController.loginLockout);
router.post('/logout', validate(LogoutSchema), authController.logout);
router.get('/me', authMiddleware, authController.me);
router.post('/activity', authMiddleware, validate(SessionActivitySchema), authController.activity);
router.get('/events', authMiddleware, tenantMiddleware, authorizationEvents);
router.post('/forgot-password', passwordResetRateLimiter, validate(ForgotPasswordSchema), passwordRecoveryAddressRateLimiter, authController.forgotPassword);
router.post('/reset-password', passwordResetRateLimiter, validate(ResetPasswordSchema), authController.resetPassword);
router.post('/change-password', authRateLimiter, authMiddleware, validate(PasswordChangeRequestSchema), changePasswordController);
router.get('/onboarding/status', authMiddleware, authController.getOnboardingStatus);
router.post('/onboarding/complete', authMiddleware, authController.completeOnboarding);
export default router;
