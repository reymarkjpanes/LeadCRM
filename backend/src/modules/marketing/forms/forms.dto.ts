import { z } from 'zod';
import { CreateFormSchema, UpdateFormSchema } from '@leadcrm/shared';
export { CreateFormSchema, UpdateFormSchema };
export type CreateFormDto = z.infer<typeof CreateFormSchema>;
export type UpdateFormDto = z.infer<typeof UpdateFormSchema>;
