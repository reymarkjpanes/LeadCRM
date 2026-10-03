/**
 * Deal, Pipeline, and Stage entity types — shared between frontend and backend.
 * These represent the API response shape for the deals module.
 *
 * Both frontend and backend MUST import from here to ensure compile-time
 * detection of field name mismatches via TypeScript strict mode.
 */

/** Possible priority values for a Deal. */
export type DealPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Core Deal entity as returned by the list and detail API endpoints.
 * Maps to the Prisma `Deal` model in the backend.
 */
export interface Deal {
  productInterestIds?: string[];
  id: string;
  tenantId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  value?: number;
  currency?: string;
  billingFrequency?: 'monthly' | 'one_time' | 'annual' | 'quarterly';
  priority: DealPriority;
  expectedCloseDate?: string;
  leadSource?: string;
  organizationId?: string;
  assignedUserId?: string;
  contactId?: string;
  contactIds?: string[];
  industry?: string;
  address?: string;
  productInterests?: string[];
  productInterestId?: string;
  order?: number;
  lostReason?: string;
  isArchived?: boolean;
  createdAt: string;
  updatedAt?: string;

  // Joined relations (included in list/detail responses)
  stage?: { id: string; name: string; order: number };
  pipeline?: { id: string; name: string };
  assignedUser?: { id: string; firstName: string; lastName: string };
  account?: { id: string; name: string };
}

/**
 * Fields accepted by POST /api/v1/crm/deals (create).
 * Mirrors the backend `CreateDealSchema` Zod DTO.
 */
export interface CreateDealRequest {
  productInterestId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  value?: number;
  currency?: string;
  priority?: DealPriority;
  expectedCloseDate?: string;
  leadSource?: string;
  organizationId?: string;
  assignedUserId?: string;
  contactIds?: string[];
  industry?: string;
  address?: string;
  productInterests?: string[];
}

/**
 * Fields accepted by PUT /api/v1/crm/deals/:id (update).
 * All CreateDealSchema fields except stageId and pipelineId, all optional.
 * Stage changes must go through PATCH /deals/:id/stage.
 */
export interface UpdateDealRequest {
  title?: string;
  value?: number;
  currency?: string;
  priority?: DealPriority;
  expectedCloseDate?: string;
  leadSource?: string;
  organizationId?: string;
  assignedUserId?: string;
  contactIds?: string[];
  industry?: string;
  address?: string;
  productInterests?: string[];
}

/** Pipeline entity as returned by the API. */
export interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  stages: Stage[];
  createdAt: string;
  updatedAt?: string | null;
}

/** Stage entity within a Pipeline. */
export interface Stage {
  id: string;
  pipelineId?: string;
  name: string;
  order: number;
  probability?: number;
  color?: string;
  isWon?: boolean;
  isLost?: boolean;
}
