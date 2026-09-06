export type TenantStatus = 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: 'STARTER' | 'PRO' | 'ENTERPRISE' | null;
  createdAt: string;
  updatedAt: string;
}
