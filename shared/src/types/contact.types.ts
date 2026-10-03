/**
 * Contact/Lead entity types — shared between frontend and backend.
 * These represent the API response shape for the contacts/leads module.
 *
 * Both frontend and backend MUST import from here to ensure compile-time
 * detection of field name mismatches via TypeScript strict mode.
 */

/** Possible status values for a Contact/Lead record. */
export type { CrmStatus as ContactStatus } from '../contracts/record-experience';

/**
 * Core Contact/Lead entity as returned by the list and detail API endpoints.
 * Maps to the Prisma `Lead` model in the backend.
 */
export interface Contact {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  address?: string;
  description?: string;
  website?: string;
  productInterest?: string[];
  source?: string;
  assignedUserId?: string;
  accountId?: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  createdById?: string;
  updatedById?: string;
  lastStatusChangedAt?: string;
  isArchived?: boolean;
  deletedAt?: string | null;
  deletedBy?: string | null;

  // Conversion tracking (set when lead is converted to a contact)
  contactId?: string;
  convertedAt?: string;
  convertedById?: string;

  // Joined relations (included in list/detail responses)
  assignedUser?: { id: string; firstName: string; lastName: string };
  account?: { id: string; name: string };
  createdByUser?: { id: string; firstName: string; lastName: string };
  updatedByUser?: { id: string; firstName: string; lastName: string };
  convertedContact?: { id: string; firstName: string; lastName: string };
  convertedByUser?: { id: string; firstName: string; lastName: string };
}

/**
 * Fields accepted by POST /api/v1/crm/contacts (create).
 * Mirrors the backend `CreateContactSchema` Zod DTO.
 */
export interface CreateContactRequest {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  status?: string;
  source?: string;
  accountId?: string;
  assignedUserId?: string;
  productInterest?: string[];
  address?: string;
}

/**
 * Fields accepted by PUT /api/v1/crm/contacts/:id (update).
 * All fields optional — mirrors the backend `UpdateContactSchema`.
 */
export interface UpdateContactRequest extends Partial<CreateContactRequest> {}
