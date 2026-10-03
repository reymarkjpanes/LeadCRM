import { LeadCreatedFilterSchema, leadCreatedBounds } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';
export function parseLeadCreatedFilter(query: Record<string, unknown>) {
  const nested = query.filter;
  const flat = query['filter[createdAt]'];
  const raw = flat ?? (nested && typeof nested === 'object' ? (nested as Record<string, unknown>).createdAt : undefined);
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new ValidationError('Invalid Lead Created filter');
  const [operator, value, extra] = raw.split(':');
  if (!value || extra !== undefined) throw new ValidationError('Invalid Lead Created filter');
  const dates = value.split(',');
  const parsed = LeadCreatedFilterSchema.safeParse(operator === 'between'
    ? { operator, from: dates[0], to: dates[1] }
    : { operator, date: value });
  if (!parsed.success || (operator === 'between' && dates.length !== 2)) throw new ValidationError('Invalid Lead Created operator or dates');
  return leadCreatedBounds(parsed.data);
}
