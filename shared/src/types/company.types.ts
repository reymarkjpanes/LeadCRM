/**
 * Company/Account entity types — shared between frontend and backend.
 * These represent the API response shape for the accounts/companies module.
 *
 * Both frontend and backend MUST import from here to ensure compile-time
 * detection of field name mismatches via TypeScript strict mode.
 */


/** Possible company size categories. */
export type CompanySize = '1-10' | '11-50' | '51-200' | '200+';

/**
 * Core Company/Account entity as returned by the list and detail API endpoints.
 * Maps to the Prisma `Account` model in the backend.
 */
export interface Company {
  id: string;
  tenantId: string;
  name: string;
  industry?: string;
  size?: CompanySize;
  website?: string;
  tags?: string[];
  address?: string;
  city?: string;
  province?: string;
  country?: string;
  assignedUserId?: string;
  notes?: string;
  internalNotes?: string;
  productInterests?: string[];
  activeProducts?: string[];
  createdAt: string;
  updatedAt?: string;

  // Joined relations (included in list/detail responses)
  assignedUser?: { id: string; firstName: string; lastName: string };
}

/**
 * Fields accepted by POST /api/v1/crm/accounts (create).
 * Mirrors the backend `CreateCompanySchema` Zod DTO.
 */
export interface CreateCompanyRequest {
  name: string;
  industry?: string;
  size?: CompanySize;
  website?: string;
  tags?: string[];
  address?: string;
  city?: string;
  province?: string;
  country?: string;
  assignedUserId?: string;
  notes?: string;
  internalNotes?: string;
  productInterests?: string[];
  activeProducts?: string[];
}

/**
 * Fields accepted by PUT /api/v1/crm/accounts/:id (update).
 * All fields optional — mirrors the backend `UpdateCompanySchema`.
 */
export interface UpdateCompanyRequest extends Partial<CreateCompanyRequest> {}
