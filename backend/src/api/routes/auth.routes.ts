import { Router } from 'express';
import {
  authRateLimiter,
  registerRateLimiter,
  passwordResetRateLimiter,
  verifyEmailRateLimiter,
  resendVerificationRateLimiter,
} from '../middleware/rate-limit.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { Permission } from '../../shared/constants/permissions';
import { validate } from '../middleware/validate.middleware';
import {
  LoginSchema,
  ClientAdminRegisterSchema,
  GuestRegisterSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  SendRegistrationOtpSchema,
  VerifyRegistrationOtpSchema,
} from '../../core/auth/auth.dto';
import * as authController from '../../core/auth/auth.controller';

const router = Router();

// GET /api/v1/auth/sandbox-info — returns sandbox configuration (public, no auth required)
router.get('/sandbox-info', authController.getSandboxInfo);

// GET /api/v1/auth/check-email — checks if an email is already registered
router.get('/check-email', registerRateLimiter, authController.checkEmail);

// POST /api/v1/auth/login — rate-limited, validated
router.post('/login', authRateLimiter, validate(LoginSchema), authController.login);

// POST /api/v1/auth/logout — revokes session + clears HttpOnly cookie
router.post('/logout', authController.logout);

// GET /api/v1/auth/me — returns current user from token (session-validated)
router.get('/me', authMiddleware, authController.me);

// POST /api/v1/auth/register/client-admin
router.post('/register/client-admin', registerRateLimiter, validate(ClientAdminRegisterSchema), authController.registerClientAdmin);

// POST /api/v1/auth/register/guest
router.post('/register/guest', registerRateLimiter, validate(GuestRegisterSchema), authController.registerGuest);

// POST /api/v1/auth/send-registration-otp — sends 6-digit verification code (registration step)
router.post('/send-registration-otp', registerRateLimiter, validate(SendRegistrationOtpSchema), authController.sendRegOtp);

// POST /api/v1/auth/verify-registration-otp — verifies the code and activates the account
router.post('/verify-registration-otp', registerRateLimiter, validate(VerifyRegistrationOtpSchema), authController.verifyRegOtp);

// GET /api/v1/auth/verify-email?token=xxx — magic link email verification (public, rate-limited)
// Validates token, activates user, issues session cookie, redirects to /onboarding
router.get('/verify-email', verifyEmailRateLimiter, authController.verifyEmailByLink);

// POST /api/v1/auth/resend-verification — resends verification email (public, strict rate-limited)
router.post('/resend-verification', resendVerificationRateLimiter, authController.resendVerification);

// POST /api/v1/auth/forgot-password — request reset link (strict rate-limited, validated)
router.post('/forgot-password', passwordResetRateLimiter, validate(ForgotPasswordSchema), authController.forgotPassword);

// POST /api/v1/auth/reset-password — confirm reset with token + new password (strict rate-limited, validated)
router.post('/reset-password', passwordResetRateLimiter, validate(ResetPasswordSchema), authController.resetPassword);

// POST /api/v1/auth/seed-demo — creates a demo tenant + user (System Admin only)
router.post('/seed-demo', authMiddleware, authorize(Permission.ADMIN_ACCESS), authController.seedDemo);

// POST /api/v1/auth/seed-admin — creates the system admin user (run once after deploy, requires env secret)
router.post('/seed-admin', authController.seedAdmin);

// POST /api/v1/auth/oauth/google — Google OAuth bridge (called by NextAuth signIn callback)
// Validates id_token with Google, finds or creates user, issues HttpOnly JWT cookie
router.post('/oauth/google', authRateLimiter, authController.oauthGoogle);

// PATCH /api/v1/auth/oauth/complete-profile — new Google OAuth user fills in company details
// Requires valid session cookie — tenantId sourced from JWT, never from request body
router.patch('/oauth/complete-profile', authMiddleware, authController.completeOAuthProfile);

// ── Onboarding Progress ──────────────────────────────────────────────────────
// GET /api/v1/auth/onboarding/status — returns current onboarding step + tenant details
router.get('/onboarding/status', authMiddleware, authController.getOnboardingStatus);

// PATCH /api/v1/auth/onboarding/workspace — saves company details (step 1)
router.patch('/onboarding/workspace', authMiddleware, authController.saveOnboardingWorkspace);

// PATCH /api/v1/auth/onboarding/step — updates the step number (0-3)
router.patch('/onboarding/step', authMiddleware, authController.updateOnboardingStep);

// POST /api/v1/auth/onboarding/complete — marks done, activates tenant, sends welcome email
router.post('/onboarding/complete', authMiddleware, authController.completeOnboarding);

export default router;
