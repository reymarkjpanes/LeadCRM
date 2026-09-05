// ─── User, Tenant, RBAC ────────────────────────────────────────────────────

export type Role = 'System Admin' | 'Client Admin' | 'Sales Rep' | 'Viewer' | string;

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
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  avatarUrl?: string;
  timeZone?: string;
  org?: string; // keeping org for legacy compatibility temporarily if used elsewhere
  team?: string; // keeping team for legacy compatibility temporarily
  role: Role;
  status: 'active' | 'pending' | 'inactive' | 'ACTIVE' | 'PENDING' | 'INACTIVE';
  lastLogin?: string;
  lastLoginAt?: string;
  isArchived?: boolean;
  // Auth-response fields — populated from /auth/me and POST /auth/login
  emailVerified?: string | null;
  tenantName?: string | null;
  tenantStatus?: string | null;
  subscriptionStatus?: string | null;
  plan?: string | null;
  onboardingStep?: number;
  onboardingCompletedAt?: string | null;
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
  approvalStep: 'basic' | 'requirements' | 'completed';
  environment: 'none' | 'sandbox' | 'production' | 'both';
  createdAt: string;
  timezone?: string;
  currency?: string;
  domain?: string;
  businessReqs?: { requirements: string; documentName?: string };
  verificationDocs?: { businessPermit?: string; taxId?: string; validId?: string; uploadedAt: string };
  adminNotes?: string;
  healthMetrics?: {
    cpuUsage: number;
    memoryUsage: number;
    storageUsage?: number;
    uptime: string;
    status: 'healthy' | 'warning' | 'critical';
    lastCheck: string;
  };
}
