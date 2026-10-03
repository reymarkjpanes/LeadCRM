// ─── Contact & Organization ────────────────────────────────────────────────
// Extends the shared package types with additional UI/display fields.
// Core API response fields are defined in @leadcrm/shared to ensure
// compile-time detection of field name mismatches between FE and BE.

import type { Contact as SharedContact, Company as SharedCompany } from '@leadcrm/shared';

/**
 * Organization — extends the shared Company type with additional
 * frontend-specific display fields.
 */
export interface Organization extends SharedCompany {
  isArchived?: boolean;
  postalCode?: string;
}

/**
 * Contact — extends the shared Contact type with additional
 * frontend-specific display and enrichment fields.
 * The core API fields (id, tenantId, firstName, lastName, email, phone,
 * companyName, status, etc.) come from @leadcrm/shared.
 */
export interface Contact extends SharedContact {
  organizationId?: string;
  contactPerson?: string;
  leadPerson?: string;
  jobTitle?: string;
  leadSource?: string;
  estimatedValue?: number;
  expectedCloseDate?: string;
  notes?: string;
  lifecycleStage?: string;
  recordType?: string;
  score?: number;
  isArchived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  type?: string;
  customerType?: string;
  customerSince?: string;
  activeProducts?: string[];
  qualifiedAt?: string;
  disqualifiedReason?: string;
  callStatus?: string;
  updateStatus?: string;
  contactNumbers?: { id: string; type: string; countryCode?: string; number: string; notes?: string }[];
  leadNumbers?: string[];
  productInterests?: string[];
  doNotContact?: boolean;
  // Enriched fields
  middleName?: string;
  suffix?: string;
  displayName?: string;
  preferredName?: string;
  department?: string;
  profilePhoto?: string;
  gender?: string;
  dateOfBirth?: string;
  secondaryEmail?: string;
  workEmail?: string;
  mobileNumber?: string;
  phoneCountryCode?: string;
  altPhone?: string;
  website?: string;
  linkedin?: string;
  facebook?: string;
  otherSocial?: string;
  businessType?: string;
  companySize?: string;
  orgOwner?: string;
  orgWebsite?: string;
  orgAddress?: string;
  country?: string;
  region?: string;
  province?: string;
  city?: string;
  barangay?: string;
  postalCode?: string;
  streetAddress?: string;
  building?: string;
  floor?: string;
  unit?: string;
  assignedTeam?: string;
  ownerId?: string;
  createdBy?: string;
  lastUpdated?: string;
  tags?: string;
  customFields?: Record<string, string>;
  internalNotes?: string;
  priority?: string;
}
