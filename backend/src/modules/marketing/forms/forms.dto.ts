import { z } from 'zod';

// ─── Field Types ──────────────────────────────────────────────────────────────

const FormFieldTypeEnum = z.enum([
  'heading', 'paragraph', 'divider',
  'single-line', 'multi-line', 'email', 'phone', 'number', 'date',
  'checkbox', 'radio', 'dropdown', 'url', 'rating', 'file',
  'contact-name', 'contact-email', 'contact-phone',
  'company-name', 'company-website',
]);

const FormFieldSchema = z.object({
  id:          z.string().min(1),
  type:        FormFieldTypeEnum,
  label:       z.string().max(500),
  placeholder: z.string().max(500).optional(),
  required:    z.boolean().optional(),
  options:     z.array(z.string().max(200)).max(100).optional(),
  mapToField:  z.string().max(100).optional(),
});

// ─── Design ───────────────────────────────────────────────────────────────────

const FormDesignSchema = z.object({
  generalBg:    z.string().max(50).default(''),
  generalBorder: z.string().max(50).default(''),
  generalText:  z.string().max(50).default(''),
  fieldBg:      z.string().max(50).default(''),
  fieldBorder:  z.string().max(50).default(''),
  fieldText:    z.string().max(50).default(''),
  fieldRadius:  z.enum(['none', 'sm', 'md', 'lg', 'full']).default('none'),
  fieldSize:    z.enum(['sm', 'regular', 'lg']).default('regular'),
  buttonBg:     z.string().max(50).default(''),
  buttonBorder: z.string().max(50).default(''),
  buttonText:   z.string().max(50).default(''),
});

// ─── Settings ─────────────────────────────────────────────────────────────────

const UtmParamSchema = z.object({
  key:   z.string().max(100),
  mapTo: z.string().max(100),
});

const FormSettingsSchema = z.object({
  notificationEmail: z.string().email().or(z.literal('')).default(''),
  trackUrlParams:    z.boolean().default(true),
  utmParams:         z.array(UtmParamSchema).max(20).default([]),
});

// ─── Request Schemas ──────────────────────────────────────────────────────────

/**
 * POST /marketing/forms
 * Only the name is required on creation — fields/design/settings default to
 * empty values in the database and are populated later via PUT.
 */
export const CreateFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
});

/**
 * PUT /marketing/forms/:id
 * All fields optional — partial update, send only what changed.
 */
export const UpdateFormSchema = z.object({
  name:     z.string().min(1).max(200).optional(),
  fields:   z.array(FormFieldSchema).max(100).optional(),
  design:   FormDesignSchema.optional(),
  settings: FormSettingsSchema.optional(),
}).strict();

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type CreateFormDto  = z.infer<typeof CreateFormSchema>;
export type UpdateFormDto  = z.infer<typeof UpdateFormSchema>;
