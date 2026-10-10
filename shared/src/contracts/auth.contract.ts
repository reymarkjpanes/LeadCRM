/** Serialized account state returned by every authentication/onboarding endpoint. */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  status: string | null;
  emailVerified: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  groups?: { id: string; name: string }[];
  avatarUrl: string | null;
  tenantName: string | null;
  tenantStatus: string | null;
  industry: string | null;
  companySize: string | null;
  website: string | null;
  currency: string | null;
  onboardingStep: number;
  /** The authenticated user's acknowledgment, independent of the workspace's legacy setup. */
  onboardingCompletedAt: string | null;
  isTenantOwner: boolean;
  hasPassword: boolean;
  passwordChangedAt?: string | null;
  mustChangePassword?: boolean;
}

export interface AuthResponse {
  success: boolean;
  data: { user: AuthUser };
}

export type LoginResponse = AuthResponse;

/** Public recovery response deliberately contains no eligibility or tenant information. */
export interface PasswordRecoveryResponse {
  success: true;
  message: string;
  expiresInMinutes: number;
  resendAfterSeconds: number;
}

export const PASSWORD_RECOVERY_MESSAGE = 'If an account exists with this email address, you will receive a password reset link shortly.';
export const PASSWORD_RECOVERY_RESEND_SECONDS = 60;
export const PASSWORD_RECOVERY_SEND_ERROR = 'Unable to send the password reset email. Please try again later.';
