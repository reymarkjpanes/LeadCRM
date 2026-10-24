export interface Account {
  /** Read-only historical access scope; customer writes cannot set it. */
  readonly ownerGroupId?: string | null;
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

export type AccountMutationInput = Partial<Omit<Account, 'ownerGroupId'>> & { requestId?: string };

export interface AccountFilters {
  search: string;
  industries: string[];
  sizes: string[];
}
