import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type LoginDto = z.infer<typeof LoginSchema>;

// Strong password regex: min 8 chars, at least 1 uppercase, 1 lowercase, 1 number, 1 special char
const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~])/,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  );

export const ClientAdminRegisterSchema = z.object({
  firstName: z.string().min(2, 'First name is required'),
  lastName: z.string().min(2, 'Last name is required'),
  email: z.string().email('Valid email required'),
  password: strongPasswordSchema,
  companyName: z.string().optional(),
  companySize: z.string().optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  acceptTerms: z.boolean().refine((val) => val === true, {
    message: 'You must accept the terms and conditions',
  }).optional(), // optional when joining via invitation token
  invitationToken: z.string().optional(),
}).superRefine((data, ctx) => {
  // companyName is only required when NOT joining via an invitation token
  if (!data.invitationToken && (!data.companyName || data.companyName.trim().length < 2)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Company name is required',
      path: ['companyName'],
    });
  }
  // acceptTerms is only required when NOT joining via an invitation token
  if (!data.invitationToken && data.acceptTerms !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'You must accept the terms and conditions',
      path: ['acceptTerms'],
    });
  }
});

export const GuestRegisterSchema = z.object({
  firstName: z.string().min(2, 'First name is required'),
  lastName: z.string().min(2, 'Last name is required'),
  email: z.string().email('Valid email required'),
  password: strongPasswordSchema,
  companyName: z.string().min(2, 'Company name is required'),
  industry: z.string().optional(),
  companySize: z.string().optional(),
  businessWebsite: z.string().url('Invalid URL').optional().or(z.literal('')),
  acceptTerms: z.boolean().refine((val) => val === true, {
    message: 'You must accept the terms and conditions',
  }).optional(), // optional for backward compat — enforced in frontend
  invitationToken: z.string().optional(),
});

export type ClientAdminRegisterDto = z.infer<typeof ClientAdminRegisterSchema>;
export type GuestRegisterDto = z.infer<typeof GuestRegisterSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Valid email required'),
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

export const SendRegistrationOtpSchema = z.object({
  email: z.string().email('Valid email required'),
});

export const VerifyRegistrationOtpSchema = z.object({
  email: z.string().email('Valid email required'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

export type SendRegistrationOtpDto = z.infer<typeof SendRegistrationOtpSchema>;
export type VerifyRegistrationOtpDto = z.infer<typeof VerifyRegistrationOtpSchema>;

// ─── OAuth (Google Sign-In) ───────────────────────────────────────────────────
// Posted by the NextAuth signIn callback to the backend bridge endpoint.
// The backend validates the id_token with Google before trusting any fields.
export const OAuthGoogleSchema = z.object({
  providerAccountId: z.string().min(1, 'providerAccountId is required'),
  idToken:           z.string().min(1, 'idToken is required'),
  accessToken:       z.string().optional(),
  refreshToken:      z.string().optional(),
  expiresAtEpoch:    z.number().int().positive().optional(),
  scope:             z.string().optional(),
  // Profile fields pre-populated from the OIDC id_token claims
  email:             z.string().email('Valid email required'),
  firstName:         z.string().min(1, 'firstName is required'),
  lastName:          z.string().default(''),
  avatarUrl:         z.string().url().optional(),
  emailVerified:     z.boolean(),
});

export type OAuthGoogleDto = z.infer<typeof OAuthGoogleSchema>;

// ─── Complete OAuth Profile ───────────────────────────────────────────────────
// PATCH /api/v1/auth/oauth/complete-profile
// Called after new Google OAuth user fills in their company details.
// Note: country is accepted but not persisted — Tenant model has no country field.
export const CompleteOAuthProfileSchema = z.object({
  companyName:  z.string().min(2, 'Company name is required'),
  industry:     z.string().min(1, 'Industry is required'),
  companySize:  z.string().min(1, 'Company size is required'),
  country:      z.string().optional(),
});

export type CompleteOAuthProfileDto = z.infer<typeof CompleteOAuthProfileSchema>;

// ─── Onboarding ───────────────────────────────────────────────────────────────
export const OnboardingWorkspaceSchema = z.object({
  companyName: z.string().min(2, 'Company name is required').max(100),
  industry:    z.string().min(1, 'Industry is required').max(100),
  companySize: z.string().min(1, 'Company size is required').max(20),
  timezone:    z.string().max(50).optional(),
});

export const OnboardingStepSchema = z.object({
  step: z.number().int().min(0).max(3),
});

export type OnboardingWorkspaceDto = z.infer<typeof OnboardingWorkspaceSchema>;
export type OnboardingStepDto = z.infer<typeof OnboardingStepSchema>;

// ─── Resend Verification ──────────────────────────────────────────────────────
export const ResendVerificationSchema = z.object({
  email: z.string().email('Valid email required'),
});

export type ResendVerificationDto = z.infer<typeof ResendVerificationSchema>;
