import { z } from 'zod';

export const TemplateTypeEnum = z.enum(['Email', 'SMS', 'Quotation']);

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  type: TemplateTypeEnum,
  category: z.string().max(100).optional(),
  subject: z.string().max(500).optional(),
  content: z.string().min(1).max(50000),
});

export const UpdateTemplateSchema = CreateTemplateSchema.partial();

export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplateDto = z.infer<typeof UpdateTemplateSchema>;
