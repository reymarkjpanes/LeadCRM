import type { LucideIcon } from 'lucide-react';
import React from 'react';
import { LEAD_STATUSES } from '@leadcrm/shared';

export type RecordModule = 'lead' | 'contact' | 'account' | 'deal';

export interface StatusOption {
  label: string;
  description?: string;
  tone?: 'info' | 'success' | 'warning' | 'muted';
}

export interface PipelineStage {
  id?: string;
  label: string;
  tone?: 'warning' | 'success' | 'muted';
  dot?: string;
  isWon?: boolean;
  isLost?: boolean;
}

export interface ActivityItem {
  id: string;
  kind: 'status' | 'task' | 'created' | 'note' | 'email' | 'call';
  title?: string;
  from?: string;
  to?: string;
  actor?: { name: string; initials: string };
  when: string;
  metadata?: Record<string, any>;
}

export interface FileItem {
  id: string;
  name: string;
  size: string;
  uploadedBy?: string;
  uploadedAt: string;
  type?: string;
  url?: string;
}

export interface FieldRow {
  label: string;
  value?: React.ReactNode;
  icon?: LucideIcon;
  editable?: boolean;
  onEdit?: () => void;
  onCopy?: () => void;
}

export interface SectionConfig {
  id: string;
  title: string;
  icon: LucideIcon;
  count?: number;
  collapsible?: boolean;
  actions?: React.ReactNode;
  content: React.ReactNode;
}

export interface CustomFieldItem {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'url';
  value: string;
  description?: string;
}

// ── Default Status Configurations ─────────────────────────────────────────────

const LEAD_STATUS_DETAILS: Record<typeof LEAD_STATUSES[number], Omit<StatusOption, 'label'>> = {
  Hot: { tone: 'warning', description: 'High purchase intent, urgent' },
  Warm: { tone: 'warning', description: 'Engaged, evaluating solutions' },
  Cold: { tone: 'muted', description: 'Unresponsive or low priority' },
  Closed: { tone: 'success', description: 'Converted or deal finalized' },
  Cancelled: { tone: 'muted', description: 'Disqualified or canceled' },
};
export const DEFAULT_LEAD_STATUSES: StatusOption[] = LEAD_STATUSES.map(label => ({ label, ...LEAD_STATUS_DETAILS[label] }));

export const DEFAULT_CONTACT_STATUSES = DEFAULT_LEAD_STATUSES;


export const DEFAULT_PIPELINE = {
  name: 'Sales Pipeline',
  stages: [
    { label: 'Demo Completed', tone: 'warning' as const, dot: 'bg-warning' },
    { label: 'Proposal Sent', tone: 'warning' as const, dot: 'bg-warning' },
    { label: 'Contract Sent', tone: 'warning' as const, dot: 'bg-warning' },
    { label: 'Won', tone: 'success' as const, dot: 'bg-success', isWon: true },
    { label: 'Lost', tone: 'muted' as const, dot: 'bg-muted-foreground/40', isLost: true },
  ],
};
