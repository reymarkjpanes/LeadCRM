import { describe, it, expect } from 'vitest';
import { parseFilterParams, buildPrismaFilters } from '../filter-parser';

/**
 * Unit tests for the filter-parser helper.
 *
 * parseFilterParams  — extracts filter[field]=operator:value from query objects
 * buildPrismaFilters — converts parsed filters to Prisma-compatible AND clauses
 *
 * These helpers are the backend counterpart to the frontend useModuleData hook's
 * buildQueryParams. Together they form the complete server-side filter pipeline:
 *
 *   Frontend TrelloFilter state
 *     → FilterCondition[]
 *     → useModuleData buildQueryParams()
 *     → URL: ?filter[status]=in:Hot,Warm
 *     → Express req.query
 *     → parseFilterParams()
 *     → buildPrismaFilters()
 *     → Prisma AND clause
 *     → PostgreSQL WHERE
 */

// ── parseFilterParams ─────────────────────────────────────────────────────────

describe('parseFilterParams', () => {
  it('extracts a single in-filter', () => {
    const result = parseFilterParams({ 'filter[status]': 'in:Hot,Warm' });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ field: 'status', operator: 'in', value: ['Hot', 'Warm'] });
  });

  it('extracts multiple filters', () => {
    const result = parseFilterParams({
      'filter[status]': 'in:Hot,Warm',
      'filter[assignedUserId]': 'in:user-1,user-2',
    });
    expect(result).toHaveLength(2);
    const fields = result.map((r) => r.field).sort();
    expect(fields).toEqual(['assignedUserId', 'status']);
  });

  it('parses equals operator', () => {
    const result = parseFilterParams({ 'filter[assignedUserId]': 'equals:user-abc' });
    expect(result[0]).toEqual({ field: 'assignedUserId', operator: 'equals', value: 'user-abc' });
  });

  it('parses contains operator', () => {
    const result = parseFilterParams({ 'filter[companyName]': 'contains:Acme' });
    expect(result[0]).toEqual({ field: 'companyName', operator: 'contains', value: 'Acme' });
  });

  it('parses not_in operator', () => {
    const result = parseFilterParams({ 'filter[status]': 'not_in:Cancelled,Closed' });
    expect(result[0]).toEqual({
      field: 'status',
      operator: 'not_in',
      value: ['Cancelled', 'Closed'],
    });
  });

  it('parses is_null operator (no colon, no value)', () => {
    const result = parseFilterParams({ 'filter[deletedAt]': 'is_null' });
    expect(result[0]).toEqual({ field: 'deletedAt', operator: 'is_null', value: null });
  });

  it('parses is_not_null operator', () => {
    const result = parseFilterParams({ 'filter[email]': 'is_not_null' });
    expect(result[0]).toEqual({ field: 'email', operator: 'is_not_null', value: null });
  });

  it('ignores non-filter query params', () => {
    const result = parseFilterParams({
      page: '1',
      pageSize: '25',
      search: 'john',
      sort: 'createdAt:desc',
      'filter[status]': 'in:Hot',
    });
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe('status');
  });

  it('returns empty array when no filter params present', () => {
    expect(parseFilterParams({ page: '1', search: 'test' })).toHaveLength(0);
    expect(parseFilterParams({})).toHaveLength(0);
  });

  it('trims whitespace from values', () => {
    const result = parseFilterParams({ 'filter[status]': 'in: Hot , Warm ' });
    expect(result[0].value).toEqual(['Hot', 'Warm']);
  });

  it('skips empty filter values', () => {
    const result = parseFilterParams({ 'filter[status]': '' });
    expect(result).toHaveLength(0);
  });

  it('parses single-value in as array of one', () => {
    const result = parseFilterParams({ 'filter[status]': 'in:Hot' });
    expect(Array.isArray(result[0].value)).toBe(true);
    expect(result[0].value).toEqual(['Hot']);
  });
});

// ── buildPrismaFilters ────────────────────────────────────────────────────────

describe('buildPrismaFilters', () => {
  const ALLOWED = new Set(['status', 'assignedUserId', 'source', 'industry']);

  it('builds IN clause for array value', () => {
    const parsed = [{ field: 'status', operator: 'in', value: ['Hot', 'Warm'] }];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toEqual({ status: { in: ['Hot', 'Warm'] } });
  });

  it('builds NOT IN clause', () => {
    const parsed = [{ field: 'status', operator: 'not_in', value: ['Cancelled', 'Closed'] }];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses[0]).toEqual({ status: { notIn: ['Cancelled', 'Closed'] } });
  });

  it('builds equals clause', () => {
    const parsed = [{ field: 'assignedUserId', operator: 'equals', value: 'user-1' }];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses[0]).toEqual({ assignedUserId: 'user-1' });
  });

  it('builds contains clause with insensitive mode', () => {
    const parsed = [{ field: 'industry', operator: 'contains', value: 'Tech' }];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses[0]).toEqual({ industry: { contains: 'Tech', mode: 'insensitive' } });
  });

  it('builds is_null clause', () => {
    const allowed = new Set(['deletedAt']);
    const parsed = [{ field: 'deletedAt', operator: 'is_null', value: null }];
    const clauses = buildPrismaFilters(parsed, allowed);
    expect(clauses[0]).toEqual({ deletedAt: null });
  });

  it('builds is_not_null clause', () => {
    const allowed = new Set(['email']);
    const parsed = [{ field: 'email', operator: 'is_not_null', value: null }];
    const clauses = buildPrismaFilters(parsed, allowed);
    expect(clauses[0]).toEqual({ email: { not: null } });
  });

  it('silently skips disallowed fields', () => {
    const parsed = [
      { field: 'status', operator: 'in', value: ['Hot'] },
      { field: 'tenantId', operator: 'equals', value: 'other-tenant' }, // injection attempt
    ];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toEqual({ status: { in: ['Hot'] } });
  });

  it('applies field aliases', () => {
    const parsed = [{ field: 'leadSource', operator: 'in', value: ['Website', 'Referral'] }];
    const aliases: Record<string, string> = { leadSource: 'source' };
    const clauses = buildPrismaFilters(parsed, new Set(['leadSource']), aliases);
    // Maps leadSource → source in Prisma clause
    expect(clauses[0]).toEqual({ source: { in: ['Website', 'Referral'] } });
  });

  it('skips in/not_in with empty array values', () => {
    const parsed = [{ field: 'status', operator: 'in', value: [] }];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses).toHaveLength(0);
  });

  it('returns empty array for empty filter list', () => {
    expect(buildPrismaFilters([], ALLOWED)).toHaveLength(0);
  });

  it('silently skips unknown operators', () => {
    const parsed = [{ field: 'status', operator: 'fuzzy_match', value: 'Hot' }];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses).toHaveLength(0);
  });

  it('produces multiple clauses that will be AND-combined', () => {
    const parsed = [
      { field: 'status', operator: 'in', value: ['Hot', 'Warm'] },
      { field: 'assignedUserId', operator: 'in', value: ['user-1', 'user-2'] },
      { field: 'industry', operator: 'contains', value: 'Tech' },
    ];
    const clauses = buildPrismaFilters(parsed, ALLOWED);
    expect(clauses).toHaveLength(3);
  });
});

// ── Integration: full round-trip ──────────────────────────────────────────────

describe('filter-parser full round-trip', () => {
  it('leads filter: status + source + assignedUserId', () => {
    const query = {
      page: '1',
      pageSize: '25',
      search: 'john',
      'filter[status]': 'in:Hot,Warm',
      'filter[source]': 'in:Website,Referral',
      'filter[assignedUserId]': 'in:user-a,user-b',
    };

    const allowed = new Set(['status', 'source', 'assignedUserId']);
    const parsed  = parseFilterParams(query);
    const clauses = buildPrismaFilters(parsed, allowed);

    expect(clauses).toHaveLength(3);

    const statusClause = clauses.find((c) => 'status' in c);
    expect(statusClause).toEqual({ status: { in: ['Hot', 'Warm'] } });

    const sourceClause = clauses.find((c) => 'source' in c);
    expect(sourceClause).toEqual({ source: { in: ['Website', 'Referral'] } });

    const ownerClause = clauses.find((c) => 'assignedUserId' in c);
    expect(ownerClause).toEqual({ assignedUserId: { in: ['user-a', 'user-b'] } });
  });

  it('accounts filter: industry + type (aliased) + owner', () => {
    const query = {
      'filter[industry]': 'in:IT Services,Telecom',
      'filter[type]': 'in:Enterprise,SMB',
      'filter[assignedUserId]': 'in:user-x',
    };

    const allowed = new Set(['industry', 'type', 'assignedUserId']);
    const aliases: Record<string, string> = { type: 'size' };
    const parsed  = parseFilterParams(query);
    const clauses = buildPrismaFilters(parsed, allowed, aliases);

    expect(clauses).toHaveLength(3);

    // 'type' should be aliased to 'size' in the Prisma clause
    const sizeClause = clauses.find((c) => 'size' in c);
    expect(sizeClause).toEqual({ size: { in: ['Enterprise', 'SMB'] } });
  });

  it('injection attempt: disallowed field is silently dropped', () => {
    const query = {
      'filter[status]': 'in:Hot',
      'filter[tenantId]': 'equals:other-tenant-id',  // injection attempt
      'filter[AND]': 'is_not_null',                    // Prisma operator injection
    };

    const allowed = new Set(['status']); // only status is allowed
    const parsed  = parseFilterParams(query);
    const clauses = buildPrismaFilters(parsed, allowed);

    // Only status clause produced — tenant and AND fields dropped
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toEqual({ status: { in: ['Hot'] } });
  });
});
