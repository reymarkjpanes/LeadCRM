export interface Account {
  statusEditOptions?: string[];
  statusEditRestrictions?: Record<string, string>;
  customFieldValues?: import('@leadcrm/shared').ClosingValues;
  id: string;
  tenantId: string;
  name: string;
  industry?: string;
  size?: string | null;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  dealCount?: number;
  dealValue?: number;
  isArchived?: boolean;
}

export type AccountMutationInput = Partial<Account> & { requestId?: string; duplicateReviewToken?: string };

export interface AccountFilters {
  search: string;
  industries: string[];
  sizes: string[];
}
