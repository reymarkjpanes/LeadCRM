// ─── User, Tenant, RBAC ────────────────────────────────────────────────────

export type Role = string;

export interface Permission {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface RoleDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  isSystemRole: boolean;
  userCount: number;
  permissions: string[];
  updatedAt: string;
  isArchived?: boolean;
}

export interface User {
  createdAt?: string;
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  avatarUrl?: string;
  org?: string; // keeping org for legacy compatibility temporarily if used elsewhere
  team?: string; // keeping team for legacy compatibility temporarily
  role: Role;
  status: 'active' | 'pending' | 'inactive' | 'ACTIVE' | 'PENDING' | 'INACTIVE';
  lastLogin?: string;
  lastLoginAt?: string;
  isArchived?: boolean;
  // Auth-response fields — populated from /auth/me and POST /auth/login
  emailVerified?: string | null;
  passwordChangedAt?: string | null;
  tenantName?: string | null;
  tenantStatus?: string | null;
  onboardingStep?: number;
  onboardingCompletedAt?: string | null;
  /** Flattened workspace information */
  industry?: string | null;
  /** Whether a password has been provisioned for this account. */
  hasPassword?: boolean;
  mustChangePassword?: boolean;
  companySize?: string | null;
  website?: string | null;
  isTenantOwner?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  industry: string;
  size: string;
  email: string;
  phone: string;
  address: string;
  status: 'active' | 'pending' | 'suspended' | 'rejected';
  createdAt: string;
  timezone?: string;
  currency?: string;
  domain?: string;
}
