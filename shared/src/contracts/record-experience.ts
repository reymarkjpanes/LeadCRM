import { z } from 'zod';

export const CRM_STATUSES = ['Hot', 'Warm', 'Cold', 'Closed', 'Cancelled'] as const;
export const LEAD_SOURCES = ['Google Ads', 'Referral', 'Email Campaign', 'Website', 'Social Media Advertisement', 'Direct Mail', 'Content Marketing', 'Others'] as const;
export const LeadSourceSchema = z.enum(LEAD_SOURCES);
export const COMPANY_SIZE_OPTIONS = ['1-10', '11-50', '51-200', '200+'] as const;

/** Keep assignment eligibility consistent between CRM controls and audience validation. */
export function isAssignableAgent(user: { role?: string | null; status?: string | null; isArchived?: boolean; assignableAgent?: boolean }): boolean {
  return !user.isArchived && !['client admin', 'guest'].includes(user.role?.trim().toLowerCase() ?? '')
    && user.status?.toUpperCase() === 'ACTIVE' && user.assignableAgent === true;
}
export const CrmStatusSchema = z.enum(CRM_STATUSES);
export type CrmStatus = z.infer<typeof CrmStatusSchema>;
export const LEAD_STATUSES = CRM_STATUSES;
export const LeadStatusSchema = CrmStatusSchema;

/** Read legacy stored statuses into canonical UI state. API validation stays strict. */
export function normalizeCrmStatus(status?: string): CrmStatus {
  return CRM_STATUSES.find(value => value.toLowerCase() === status?.toLowerCase()) ?? 'Warm';
}
export const RECORD_FILE_MAX_BYTES = 10 * 1024 * 1024;
export interface RecordFileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  uploadedBy?: string;
  url: string;
}
