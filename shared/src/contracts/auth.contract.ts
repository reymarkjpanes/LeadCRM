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
  department?: string | null;
  avatarUrl: string | null;
  tenantName: string | null;
  tenantStatus: string | null;
  industry: string | null;
  companySize: string | null;
  website: string | null;
  currency: string | null;
  onboardingStep: number;
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
