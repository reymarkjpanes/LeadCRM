/**
 * verification.dto.ts
 * Zod validation schemas for the business verification module.
 */

import { z } from 'zod';

// ─── Document Keys ────────────────────────────────────────────────────────────

export const DOCUMENT_KEYS = [
  'businessRegistration',
  'birCertificate',
  'businessPermit',
  'proofOfAddress',
  'articlesOfIncorporation',
  'articlesOfPartnership',
  'industryPermit',
] as const;

export type DocumentKeyValue = typeof DOCUMENT_KEYS[number];

// ─── Business Types ───────────────────────────────────────────────────────────

export const BUSINESS_TYPES = [
  'Sole Proprietorship',
  'Corporation',
  'Partnership',
  'Cooperative',
  'Other',
] as const;

// ─── Validation Schemas ───────────────────────────────────────────────────────

export const DocumentKeySchema = z.enum(DOCUMENT_KEYS);

export const SubmitVerificationSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES, {
    errorMap: () => ({ message: 'Please select a valid business type' }),
  }),
});

export type SubmitVerificationInput = z.infer<typeof SubmitVerificationSchema>;
