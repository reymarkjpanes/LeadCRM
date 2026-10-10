export type { FormField, FormFieldType, FormDesign, FormSettings } from '@leadcrm/shared';
export { DEFAULT_DESIGN, DEFAULT_SETTINGS } from '@leadcrm/shared';
import type { FormDefinition } from '@leadcrm/shared';
export type FormStatus = 'draft' | 'published';
export type FormFieldRadius = FormDefinition['design']['fieldRadius'];
export type FormFieldSize = FormDefinition['design']['fieldSize'];
export interface FormRecord extends FormDefinition {
  id: string; tenantId: string; publicId: string; status: FormStatus; revision: number;
  publishedVersion: number; publishedRevision: number | null;
  createdAt: string; updatedAt: string; publishedAt?: string;
}
export interface CreateFormInput { name: string; tenantId: string; }
