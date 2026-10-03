import { z } from 'zod';
import { cleanText } from './administration-user.schema';

const optionalText = (max: number) => cleanText(max).optional().default('');
export const ImportDealRowSchema = z.object({
  title: cleanText(255).pipe(z.string().min(1, 'Deal title is required.')),
  pipeline: cleanText(255).pipe(z.string().min(1, 'Pipeline is required.')),
  stage: cleanText(255).pipe(z.string().min(1, 'Stage is required.')),
  value: optionalText(32).refine(value => !value || (/^\d+(\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 999_999_999_999), 'Value must be a positive amount, at most 999999999999, with up to two decimal places.'),
  priority: optionalText(10).transform(value => value.toUpperCase() || 'MEDIUM').pipe(z.enum(['LOW', 'MEDIUM', 'HIGH'])),
  expectedCloseDate: optionalText(10).refine(value => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Expected close date must be a real date in YYYY-MM-DD format.'),
  account: optionalText(255),
  contact: optionalText(255),
  assignedUser: optionalText(254),
}).strict();

const rawFields = Object.fromEntries(Object.keys(ImportDealRowSchema.shape).map(key => [key, z.string().max(10000).optional().default('')]));
export const CreateDealImportSchema = z.object({
  fileName: cleanText(255).pipe(z.string().min(1)),
  rows: z.array(z.object({ ...rawFields, rowNumber: z.number().int().min(2) }).strict()).min(1).max(5000)
    .refine(rows => new Set(rows.map(row => row.rowNumber)).size === rows.length, 'Row numbers must be unique.'),
}).strict();
export type ImportDealRow = z.infer<typeof ImportDealRowSchema>;
export type CreateDealImportInput = z.infer<typeof CreateDealImportSchema>;
