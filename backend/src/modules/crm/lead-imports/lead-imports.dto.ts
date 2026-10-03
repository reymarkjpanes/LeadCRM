import { LeadStatusSchema } from '@leadcrm/shared';
import { recordText, recordName } from '../record-validation';
import { z } from 'zod';

/**
 * Schema for a single row of lead data being imported.
 * Validates the 6 required fields + optional fields.
 */
export const ImportLeadRowSchema = z.object({
  firstName:   recordName(),
  lastName:    recordName(),
  email:       z.string().min(1, 'Email is required').email('Invalid email address'),
  phone:       z.string().min(1, 'Phone Number is required'),
  companyName: z.string().min(1, 'Company Name is required').max(200),
  address:     z.string().min(1, 'Full Address is required').max(500),
  // Optional fields (new — backward compatible)
  website:     z.string().max(500).optional(),
  source:      z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  status:      LeadStatusSchema.optional(),
});

export type ImportLeadRowDto = z.infer<typeof ImportLeadRowSchema>;

/**
 * Schema for the import request body — an array of mapped rows + metadata.
 */
export const CreateLeadImportSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(2), // row 1 is header
        firstName: recordName().optional().default(''),
        lastName: recordName().optional().default(''),
        email: z.string().optional().default(''),
        phone: z.string().optional().default(''),
        companyName: recordText(200).optional().default(''),
        address: recordText(500).optional().default(''),
        // Optional fields (new — backward compatible)
        website: recordText(500).optional().default(''),
        source: recordText(100).optional().default(''),
        description: recordText().optional().default(''),
        status: LeadStatusSchema.optional().default('Warm'),
      }),
    )
    .min(1, 'At least one row is required')
    .max(5000, 'Maximum 5000 rows per import'),
});

export type CreateLeadImportDto = z.infer<typeof CreateLeadImportSchema>;

/**
 * Query params for listing imports.
 */
export const ListImportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Query params for listing import results.
 */
export const ListImportResultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['imported', 'failed']).optional(),
});
