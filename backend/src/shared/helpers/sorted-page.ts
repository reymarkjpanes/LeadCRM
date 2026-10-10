import { compareSortValues } from '@leadcrm/shared';
import { AppError } from '../errors/app-error';

/** Sort only keys on the server, then hydrate a single page through tenant-scoped Prisma.
 * Prisma cannot express case-insensitive/natural ordering; never sort a fetched page.
 */
export async function sortedPageIds(
  sort: unknown,
  fields: readonly string[],
  skip: number,
  limit: number,
  readKeys: () => Promise<Array<{ id: string; [key: string]: unknown }>>,
  readDatePage?: (direction: 'asc' | 'desc') => Promise<Array<{ id: string }>>,
): Promise<string[] | null> {
  if (sort == null || sort === '') return null;
  if (typeof sort !== 'string') throw new AppError('Invalid sort', 400);
  const [field, direction, extra] = sort.split(':');
  if (!fields.includes(field) || !['asc', 'desc'].includes(direction) || extra !== undefined) {
    throw new AppError('Unsupported sort field or direction', 400);
  }
  // Date values have the same order in PostgreSQL and compareSortValues.
  // Keep natural text ordering until a compatible database collation is deployed.
  if (field === 'createdAt' && readDatePage) return (await readDatePage(direction as 'asc' | 'desc')).map(row => row.id);
  const rows = await readKeys();
  const value = (row: Record<string, unknown>) => field === 'firstName'
    ? `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() : row[field];
  return [...rows].sort((a, b) => compareSortValues(value(a), value(b), direction as 'asc' | 'desc') || a.id.localeCompare(b.id))
    .slice(skip, skip + limit).map(row => row.id);
}

export function orderPage<T extends { id: string }>(rows: T[], ids: string[] | null): T[] {
  if (!ids) return rows;
  const positions = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
}
