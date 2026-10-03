import { UpdateSelfProfileSchema, AVATAR_MAX_BYTES } from '@leadcrm/shared';
import { tenantMiddleware } from '../middleware/tenant.middleware';
import { patchProfile, uploadAvatar, getAvatar } from '../../core/auth/profile.controller';
import { Router, raw } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { authRateLimiter, passwordResetRateLimiter } from '../middleware/rate-limit.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { LoginSchema, ForgotPasswordSchema, ResetPasswordSchema } from '../../core/auth/auth.dto';
import * as authController from '../../core/auth/auth.controller';
import { ChangePasswordSchema } from '../../core/auth/change-password.service';
import { changePasswordController } from '../../core/auth/change-password.controller';

const router = Router();
const parseAvatar = raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: AVATAR_MAX_BYTES });
router.patch('/profile', authMiddleware, tenantMiddleware, validate(UpdateSelfProfileSchema), patchProfile);
router.post('/profile/avatar', authMiddleware, tenantMiddleware, (req, res, next) => {
  parseAvatar(req, res, error => next(error?.type === 'entity.too.large'
    ? new AppError('Image must be no larger than 5 MB.', 413)
    : error));
}, uploadAvatar);
router.get('/profile/avatar/:avatarId', authMiddleware, tenantMiddleware, getAvatar);
router.post('/login', authRateLimiter, validate(LoginSchema), authController.login);
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.me);
router.post('/forgot-password', passwordResetRateLimiter, validate(ForgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', passwordResetRateLimiter, validate(ResetPasswordSchema), authController.resetPassword);
router.post('/change-password', authRateLimiter, authMiddleware, validate(ChangePasswordSchema), changePasswordController);
router.get('/onboarding/status', authMiddleware, authController.getOnboardingStatus);
router.post('/onboarding/complete', authMiddleware, authController.completeOnboarding);
export default router;
