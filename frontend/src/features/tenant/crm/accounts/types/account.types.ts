export interface Account {
  customFieldValues?: import('@leadcrm/shared').ClosingValues;
  id: string;
  tenantId: string;
  name: string;
  industry?: string;
  size?: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  country?: string;
  assignedUserId?: string;
  assignedUser?: { id: string; firstName: string; lastName: string };
  tags?: string[];
  notes?: string;
  internalNotes?: string;
  productInterests?: string[];
  activeProducts?: string[];
  createdAt: string;
  isArchived?: boolean;
}

export interface AccountFilters {
  search: string;
  industries: string[];
  sizes: string[];
}
