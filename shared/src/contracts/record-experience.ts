import { z } from 'zod';

export const CRM_STATUSES = ['Hot', 'Warm', 'Cold', 'Closed', 'Cancelled'] as const;
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
