/** Public Lead list/detail projection. Product IDs are distinct from display names. */
export type LeadRead = {
  /** Read-only historical access scope; customer writes cannot set it. */
  readonly ownerGroupId?: string | null;
  statusEditOptions?: string[];
  statusEditRestrictions?: Record<string, string>;
  statusManagedByDeals?: boolean;
  manualCancellation?: boolean;
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  status: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  address: string | null;
  source: string | null;
  accountId: string | null;
  assignedUserId: string | null;
  productInterestIds: string[];
  productInterest: string[];
  productInterests: string[];
  firstStaffOutreachAt?: string | null;
  createdAt: string;
  readonly lastSalesActivityAt?: string;
  updatedAt: string;
  createdById: string | null;
  updatedById: string | null;
  lastStatusChangedAt: string | null;
  contactId: string | null;
  convertedAt: string | null;
  convertedById: string | null;
  isArchived: boolean;
  deletedAt: string | null;
  deletedBy: string | null;
  assignedUser?: LeadUserSummary | null;
  account?: import("./organization").AccountSummary | null;
  createdBy?: LeadUserSummary | null;
  updatedBy?: LeadUserSummary | null;
};
export interface LeadUserSummary { id: string; firstName: string; lastName: string }
