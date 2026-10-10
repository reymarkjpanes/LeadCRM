export type TenantStatus = 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}
