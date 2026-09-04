/**
 * Server-owned pipeline templates — REQ132: four business-purpose pipelines.
 * Consumed by both the seeder and the "Create from template" UI.
 *
 * Stage-count rule (AD-4): max 5 working stages per pipeline.
 * Won and Lost are terminal (not counted) because they are outcomes, not work states.
 */

export interface StageTemplate {
  name: string;
  order: number;
  probability: number;
  color: string;
  isDefault?: boolean;
  isWon?: boolean;
  isLost?: boolean;
  requiredFields?: string[];
  rottenAfterDays?: number;
}

export interface PipelineTemplate {
  templateKey: string;
  name: string;
  type: string;
  isDefault?: boolean;
  stages: StageTemplate[];
}

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    templateKey: 'sales-inquiries',
    name: 'Sales Inquiries',
    type: 'Sales',
    isDefault: true,
    stages: [
      { name: 'New Inquiry',    order: 1, probability: 10, color: '#6366f1', isDefault: true, requiredFields: ['accountId'], rottenAfterDays: 3 },
      { name: 'Contacted',      order: 2, probability: 20, color: '#8b5cf6', requiredFields: [], rottenAfterDays: 7 },
      { name: 'Qualified',      order: 3, probability: 40, color: '#0ea5e9', requiredFields: ['value', 'expectedCloseDate'], rottenAfterDays: 14 },
      { name: 'Proposal Sent',  order: 4, probability: 60, color: '#3b82f6', requiredFields: [], rottenAfterDays: 10 },
      { name: 'Negotiation',    order: 5, probability: 80, color: '#f59e0b', requiredFields: [], rottenAfterDays: 14 },
      { name: 'Won',            order: 6, probability: 100, color: '#10b981', isWon: true },
      { name: 'Lost',           order: 7, probability: 0,   color: '#ef4444', isLost: true },
    ],
  },
  {
    templateKey: 'technical-support',
    name: 'Technical Support',
    type: 'Service',
    stages: [
      { name: 'Reported',        order: 1, probability: 10, color: '#ef4444', isDefault: true, requiredFields: [], rottenAfterDays: 1 },
      { name: 'Triaged',         order: 2, probability: 30, color: '#f59e0b', requiredFields: [], rottenAfterDays: 2 },
      { name: 'In Progress',     order: 3, probability: 60, color: '#3b82f6', requiredFields: [], rottenAfterDays: 5 },
      { name: 'Awaiting Client', order: 4, probability: 70, color: '#8b5cf6', requiredFields: [], rottenAfterDays: 7 },
      { name: 'Verification',    order: 5, probability: 90, color: '#06b6d4', requiredFields: [], rottenAfterDays: 3 },
      { name: 'Resolved',        order: 6, probability: 100, color: '#10b981', isWon: true },
      { name: 'Cancelled',       order: 7, probability: 0,   color: '#6b7280', isLost: true },
    ],
  },
  {
    templateKey: 'project-implementation',
    name: 'Project Implementation',
    type: 'Onboarding',
    stages: [
      { name: 'Kickoff',         order: 1, probability: 10, color: '#6366f1', isDefault: true, requiredFields: ['accountId'], rottenAfterDays: 3 },
      { name: 'Planning',        order: 2, probability: 30, color: '#8b5cf6', requiredFields: [], rottenAfterDays: 7 },
      { name: 'Execution',       order: 3, probability: 60, color: '#3b82f6', requiredFields: [], rottenAfterDays: 14 },
      { name: 'Testing',         order: 4, probability: 80, color: '#f59e0b', requiredFields: [], rottenAfterDays: 7 },
      { name: 'Handover',        order: 5, probability: 95, color: '#06b6d4', requiredFields: [], rottenAfterDays: 5 },
      { name: 'Delivered',       order: 6, probability: 100, color: '#10b981', isWon: true },
      { name: 'Cancelled',       order: 7, probability: 0,   color: '#6b7280', isLost: true },
    ],
  },
  {
    templateKey: 'after-sales',
    name: 'After-Sales Concerns',
    type: 'Service',
    stages: [
      { name: 'Received',        order: 1, probability: 10, color: '#ef4444', isDefault: true, requiredFields: [], rottenAfterDays: 2 },
      { name: 'Under Review',    order: 2, probability: 30, color: '#f59e0b', requiredFields: [], rottenAfterDays: 3 },
      { name: 'Action Taken',    order: 3, probability: 60, color: '#3b82f6', requiredFields: [], rottenAfterDays: 5 },
      { name: 'Follow-up',       order: 4, probability: 80, color: '#8b5cf6', requiredFields: [], rottenAfterDays: 7 },
      { name: 'Client Confirmed',order: 5, probability: 95, color: '#06b6d4', requiredFields: [], rottenAfterDays: 5 },
      { name: 'Closed',          order: 6, probability: 100, color: '#10b981', isWon: true },
      { name: 'Unresolved',      order: 7, probability: 0,   color: '#6b7280', isLost: true },
    ],
  },
];
