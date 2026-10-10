import type { TaskRecord as importTaskRecord } from '@leadcrm/shared';
// ─── Task, AuditLog ───────────────────────────────────────────────────────

// ─── Activity — universal event record for all business objects ─────────────

// Must match backend Zod enum exactly: activities.dto.ts
export type ActivityType =
  | 'call' | 'meeting' | 'email' | 'sms' | 'whatsapp'
  | 'note' | 'task' | 'workflow'
  | 'stage_change' | 'stage-change'
  | 'file_upload' | 'file-upload'
  | 'deal_action' | 'deal-created' | 'contact-created'
  | 'deal_action' | 'file_upload';

export interface Activity {
  id: string;
  tenantId: string;
  type: ActivityType;
  relatedToType: 'contact' | 'company' | 'deal' | 'task';
  relatedToId: string;
  title: string;
  description?: string;
  createdBy: string;        // userId or 'system' for automations
  createdAt: string;        // ISO timestamp
  metadata?: Record<string, unknown>;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  details: string;
  timestamp: string;
  ipAddress?: string;
  tenantId?: string;
  rowId?: string;
  changeset?: Record<string, { old: unknown; new: unknown }>;
  operatorRole?: string;
}

export type { TaskStatus } from '@leadcrm/shared';

export interface TaskAssignmentRecord {
  assignedTo: string;       // userId
  assignedBy: string;       // userId
  assignedAt: string;       // ISO timestamp
  previousAssignee?: string; // userId before this assignment
  reason?: string;           // e.g. "Territory Transfer", "Capacity"
}

export interface Task extends importTaskRecord {
  /** Legacy demo-only attribution; live data uses assignedById and assignedByUser. */
  assignedBy?: string;
  assignmentHistory?: TaskAssignmentRecord[];
}
