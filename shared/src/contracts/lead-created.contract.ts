import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const parsed = new Date(v + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}, 'Enter a valid calendar date');
export const LeadCreatedFilterSchema = z.discriminatedUnion('operator', [
  z.object({ operator: z.literal('lte'), date }).strict(),
  z.object({ operator: z.literal('gte'), date }).strict(),
  z.object({ operator: z.literal('between'), from: date, to: date }).strict(),
]).refine(v => v.operator !== 'between' || v.from <= v.to, 'From must be on or before To');
export type LeadCreatedFilter = z.infer<typeof LeadCreatedFilterSchema>;

/** Camxian calendar days are Asia/Manila (UTC+08:00), independent of browser/server timezone. */
export function leadCreatedBounds(filter: LeadCreatedFilter) {
  const start = (value: string) => new Date(value + 'T00:00:00.000+08:00');
  const end = (value: string) => new Date(value + 'T23:59:59.999+08:00');
  if (filter.operator === 'lte') return { lte: end(filter.date) };
  if (filter.operator === 'gte') return { gte: start(filter.date) };
  return { gte: start(filter.from), lte: end(filter.to) };
}
