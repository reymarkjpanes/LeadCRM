// ─── Deal, Pipeline, Stage ─────────────────────────────────────────────────
// Extends the shared Deal/Pipeline/Stage types with additional UI/display fields.
// Core API response fields are defined in @leadcrm/shared to ensure
// compile-time detection of field name mismatches between FE and BE.

import type {
  Deal as SharedDeal,
  DealPriority as SharedDealPriority,
  Pipeline as SharedPipeline,
  Stage as SharedStage,
} from '@leadcrm/shared';

// ─── Deal Ownership History ────────────────────────────────────────────────

export interface DealOwnershipRecord {
  assignedTo: string;   // userId
  assignedBy: string;   // userId or 'system'
  assignedAt: string;   // ISO timestamp
  reason?: string;      // e.g. "Territory Transfer", "Rep Left Company"
}

// ─── Stage (extended) ──────────────────────────────────────────────────────

export interface Stage extends SharedStage {
  isDefault?: boolean;
  requiredFields?: string[];
  rottenAfterDays?: number;
}

// ─── Pipeline (extended) ────────────────────────────────────────────────────

export interface Pipeline extends Omit<SharedPipeline, 'stages' | 'createdAt'> {
  stages: Stage[];
  isArchived?: boolean;
  createdAt?: string;
}

// ─── Deal (extended) ────────────────────────────────────────────────────────

/**
 * Deal — extends the shared Deal type with additional
 * frontend-specific display, history, and UI fields.
 * The core API fields come from @leadcrm/shared.
 */
export interface Deal extends Omit<SharedDeal, 'priority' | 'value' | 'order'> {
  customFieldValues?: import('@leadcrm/shared').ClosingValues;
  // Value is treated as required in frontend (defaults to 0 for display)
  value: number;
  // Order is required for kanban drag-and-drop positioning
  order: number;
  // Priority uses display-friendly casing in frontend
  priority: SharedDealPriority | 'Low' | 'Medium' | 'High';
  companyId?: string;
  companyName: string;
  contactPerson: string;
  lastStageChangeDate?: string;
  campaign?: string;
  customerType?: 'New Business' | 'Existing Customer' | string;
  tags?: string[];
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  customFields?: Record<string, string>;
  history?: {
    stageId: string;
    previousStageId?: string;
    timestamp: string;
    userId: string;
    note?: string;
  }[];
  activities?: { id: string; type: 'call' | 'email' | 'meeting' | 'note'; description: string; timestamp: string; userId: string }[];
  ownershipHistory?: DealOwnershipRecord[];
  // Lead linkage
  leadId?: string;
  leadIds?: string[];
  leadPerson?: { id: string; firstName: string; lastName: string };
}

// Re-export the shared priority type for use in type-only contexts
export type { SharedDealPriority as DealPriority };
