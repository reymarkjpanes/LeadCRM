// ─── Lead ─────────────────────────────────────────────────────────────────
// Extends the shared Contact type with additional UI/display fields.
// Core API response fields are defined in @leadcrm/shared to ensure
// compile-time detection of field name mismatches between FE and BE.
// The backend Lead model maps to the same Prisma model as Contact.

import type { Contact as SharedContact, CreateContactRequest, UpdateContactRequest } from '@leadcrm/shared';

/**
 * Lead — extends the shared Contact type with additional
 * frontend-specific display and enrichment fields.
 * firstName/lastName are optional to stay assignable from Contact (which has them optional).
 */
export interface Lead extends Omit<SharedContact, 'firstName' | 'lastName'> {
  firstName?: string;
  lastName?: string;

  // ── UI / display fields (derived or legacy-compat) ──────────────────────
  leadPerson?: string;
  displayName?: string;
  recordType?: string;
  customerType?: string;
  jobTitle?: string;
  industry?: string;
  website?: string;
  description?: string;
  notes?: string;
  internalNotes?: string;
  score?: number;
  updateStatus?: string;
  organizationId?: string;
  isArchived?: boolean;
  archivedAt?: string;

  // ── Audit / creator fields ───────────────────────────────────────────────
  createdByUser?: { id: string; firstName: string; lastName: string };
  updatedByUser?: { id: string; firstName: string; lastName: string };
  lastStatusChangedAt?: string;

  // ── Legacy / extra contact fields used by UI ────────────────────────────
  leadSource?: string;
  estimatedValue?: number;
  expectedCloseDate?: string;
  priority?: string;
  linkedin?: string;
  secondaryEmail?: string;
  workEmail?: string;
  altPhone?: string;
  mobileNumber?: string;
  leadNumbers?: string[];
  contactNumbers?: { id: string; type: string; countryCode?: string; number: string; notes?: string }[];
  createdBy?: string;
  lastUpdated?: string;
  tags?: string;
  productInterests?: string[];
  productInterestIds?: string[];

  // ── Address breakdown fields ────────────────────────────────────────────
  streetAddress?: string;
  city?: string;
  province?: string;
  region?: string;
  barangay?: string;
  country?: string;
  postalCode?: string;
  building?: string;
  floor?: string;
  unit?: string;

  // ── Extended org fields ────────────────────────────────────────────────
  size?: string;
  orgWebsite?: string;
  companySize?: string;
  businessType?: string;

  // ── Custom fields ─────────────────────────────────────────────────────
  customFields?: Record<string, string>;

  // ── Misc legacy compat ────────────────────────────────────────────────
  contactPerson?: string;
  preferredName?: string;
  middleName?: string;
  suffix?: string;
}

/**
 * Create lead request — re-exported from shared with additional UI fields.
 */
export interface CreateLeadRequest extends CreateContactRequest {
  recordType?: string;
  leadSource?: string;
  estimatedValue?: number;
  expectedCloseDate?: string;
  jobTitle?: string;
  notes?: string;
  organizationId?: string;
  productInterests?: string[];
  productInterestIds?: string[];
}

/**
 * Update lead request.
 */
export interface UpdateLeadRequest extends Partial<CreateLeadRequest> {}
