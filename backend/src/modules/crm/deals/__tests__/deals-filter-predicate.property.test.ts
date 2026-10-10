import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based test for filter predicate invariant.
 *
 * **Property 4: Filter Predicate Invariant**
 * For any combination of valid filter parameters (stageId, priority, pipelineId,
 * assignedUserId, dateFrom, dateTo), every deal in the response SHALL satisfy ALL
 * provided filter predicates simultaneously (logical AND).
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

// Mock prisma before importing the repository
vi.mock('../../../../config/database.config', () => {
  return {
    default: {
      deal: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    },
  };
});

// Import after mocking
import prisma from '../../../../config/database.config';
import { findAllDeals } from '../deals.repository';
import { DealsQuerySchema, type DealsQueryParams } from '../deals.dto';

// ─────────────────────────────────────────────────────
// GENERATORS
// ─────────────────────────────────────────────────────

const tenantIdArb = fc.uuid();

const priorityArb = fc.constantFrom('LOW' as const, 'MEDIUM' as const, 'HIGH' as const);

const optionalStringArb = fc.option(fc.uuid(), { nil: undefined });

const optionalPriorityArb = fc.option(priorityArb, { nil: undefined });

const optionalDateArb = fc.option(
  fc.integer({ min: new Date('2020-01-01T00:00:00.000Z').getTime(), max: new Date('2030-12-31T23:59:59.999Z').getTime() })
    .map((t) => new Date(t).toISOString()),
  { nil: undefined },
);

/**
 * Generate random filter combinations for the deals query.
 * All filter fields are optional — any combination may be present.
 */
const filterParamsArb = fc.record({
  stageId: optionalStringArb,
  pipelineId: optionalStringArb,
  priority: optionalPriorityArb,
  assignedUserId: optionalStringArb,
  dateFrom: optionalDateArb,
  dateTo: optionalDateArb,
});

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────

/**
 * Build a DealsQueryParams object from generated filter params.
 * Uses defaults for non-filter fields (page, limit, sortOrder, archived).
 */
function buildQueryParams(filters: {
  stageId?: string;
  pipelineId?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  assignedUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}): DealsQueryParams {
  return {
    page: 1,
    limit: 25,
    sortOrder: 'desc',
    archived: 'false',
    ...(filters.stageId ? { stageId: filters.stageId } : {}),
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
  } as DealsQueryParams;
}

/**
 * Call findAllDeals and capture the where clause passed to prisma.deal.findMany.
 * Resets mock call history before each call to ensure clean capture.
 */
async function callAndCaptureWhere(tenantId: string, params: DealsQueryParams): Promise<Record<string, unknown>> {
  vi.mocked(prisma.deal.findMany).mockClear();
  vi.mocked(prisma.deal.count).mockClear();
  vi.mocked(prisma.deal.findMany).mockResolvedValue([]);
  vi.mocked(prisma.deal.count).mockResolvedValue(0);

  await findAllDeals(tenantId, params);

  const findManyCall = vi.mocked(prisma.deal.findMany).mock.calls[0][0];
  return findManyCall?.where as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────

it('filters by the canonical Account ID and accepts only a matching legacy alias', async () => {
  for (const filter of [{ accountId: 'account-a' }, { organizationId: 'account-a' }, { accountId: 'account-a', organizationId: 'account-a' }]) {
    expect(await callAndCaptureWhere('tenant', DealsQuerySchema.parse(filter))).toMatchObject({ tenantId: 'tenant', accountId: 'account-a' });
  }
  expect(DealsQuerySchema.safeParse({ accountId: 'a', organizationId: 'b' }).success).toBe(false);
  await expect(findAllDeals('tenant', { ...buildQueryParams({}), accountId: 'a', organizationId: 'b' })).rejects.toThrow(/same Account/);
});

describe('Feature: deals-module-modernization, Property 4: Filter Predicate Invariant', () => {
  beforeEach(() => {
    vi.mocked(prisma.deal.findMany).mockClear();
    vi.mocked(prisma.deal.count).mockClear();
    vi.mocked(prisma.deal.findMany).mockResolvedValue([]);
    vi.mocked(prisma.deal.count).mockResolvedValue(0);
  });

  describe('tenantId is always present in where clause', () => {
    it('should always include tenantId in the where clause regardless of filter combination', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, filterParamsArb, async (tenantId, filters) => {
          const params = buildQueryParams(filters);
          const whereClause = await callAndCaptureWhere(tenantId, params);

          expect(whereClause).toBeDefined();
          expect(whereClause.tenantId).toBe(tenantId);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('stageId filter is applied correctly', () => {
    it('should include stageId in where clause when provided', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, fc.uuid(), async (tenantId, stageId) => {
          const params = buildQueryParams({ stageId });
          const whereClause = await callAndCaptureWhere(tenantId, params);

          expect(whereClause.stageId).toBe(stageId);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('priority filter is applied correctly', () => {
    it('should include priority in where clause when provided', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, priorityArb, async (tenantId, priority) => {
          const params = buildQueryParams({ priority });
          const whereClause = await callAndCaptureWhere(tenantId, params);

          expect(whereClause.priority).toBe(priority);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('pipelineId filter is applied correctly', () => {
    it('should include pipelineId in where clause when provided', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, fc.uuid(), async (tenantId, pipelineId) => {
          const params = buildQueryParams({ pipelineId });
          const whereClause = await callAndCaptureWhere(tenantId, params);

          expect(whereClause.pipelineId).toBe(pipelineId);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('assignedUserId filter is applied correctly', () => {
    it('should include assignedUserId in where clause when provided', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, fc.uuid(), async (tenantId, assignedUserId) => {
          const params = buildQueryParams({ assignedUserId });
          const whereClause = await callAndCaptureWhere(tenantId, params);

          expect(whereClause.assignedUserId).toBe(assignedUserId);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('dateFrom filter sets createdAt.gte', () => {
    it('should set createdAt.gte when dateFrom is provided', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          fc.integer({ min: new Date('2020-01-01T00:00:00.000Z').getTime(), max: new Date('2030-12-31T23:59:59.999Z').getTime() }).map((t) => new Date(t).toISOString()),
          async (tenantId, dateFrom) => {
            const params = buildQueryParams({ dateFrom });
            const whereClause = await callAndCaptureWhere(tenantId, params);

            const createdAtFilter = whereClause.createdAt as { gte?: Date; lte?: Date } | undefined;
            expect(createdAtFilter).toBeDefined();
            expect(createdAtFilter!.gte).toEqual(new Date(dateFrom));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('dateTo filter sets createdAt.lte', () => {
    it('should set createdAt.lte when dateTo is provided', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          fc.integer({ min: new Date('2020-01-01T00:00:00.000Z').getTime(), max: new Date('2030-12-31T23:59:59.999Z').getTime() }).map((t) => new Date(t).toISOString()),
          async (tenantId, dateTo) => {
            const params = buildQueryParams({ dateTo });
            const whereClause = await callAndCaptureWhere(tenantId, params);

            const createdAtFilter = whereClause.createdAt as { gte?: Date; lte?: Date } | undefined;
            expect(createdAtFilter).toBeDefined();
            expect(createdAtFilter!.lte).toEqual(new Date(dateTo));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('all filters are combined with logical AND in a single where object', () => {
    it('should include ALL provided filters simultaneously in the where clause', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          fc.uuid(),
          priorityArb,
          fc.uuid(),
          fc.uuid(),
          fc.integer({ min: new Date('2020-01-01T00:00:00.000Z').getTime(), max: new Date('2025-12-31T23:59:59.999Z').getTime() }).map((t) => new Date(t).toISOString()),
          fc.integer({ min: new Date('2026-01-01T00:00:00.000Z').getTime(), max: new Date('2030-12-31T23:59:59.999Z').getTime() }).map((t) => new Date(t).toISOString()),
          async (tenantId, stageId, priority, pipelineId, assignedUserId, dateFrom, dateTo) => {
            const params = buildQueryParams({
              stageId,
              priority,
              pipelineId,
              assignedUserId,
              dateFrom,
              dateTo,
            });
            const whereClause = await callAndCaptureWhere(tenantId, params);

            // All filters must be present simultaneously (AND logic)
            expect(whereClause.tenantId).toBe(tenantId);
            expect(whereClause.stageId).toBe(stageId);
            expect(whereClause.priority).toBe(priority);
            expect(whereClause.pipelineId).toBe(pipelineId);
            expect(whereClause.assignedUserId).toBe(assignedUserId);

            const createdAtFilter = whereClause.createdAt as { gte?: Date; lte?: Date };
            expect(createdAtFilter.gte).toEqual(new Date(dateFrom));
            expect(createdAtFilter.lte).toEqual(new Date(dateTo));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('absent filters are not included in where clause', () => {
    it('should NOT include filter fields in where clause when they are not provided', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, async (tenantId) => {
          // No filter params provided
          const params = buildQueryParams({});
          const whereClause = await callAndCaptureWhere(tenantId, params);

          // tenantId and isArchived should always be present
          expect(whereClause.tenantId).toBe(tenantId);
          expect(whereClause.isArchived).toBe(false);

          // Optional filter fields should NOT be present
          expect(whereClause).not.toHaveProperty('stageId');
          expect(whereClause).not.toHaveProperty('priority');
          expect(whereClause).not.toHaveProperty('pipelineId');
          expect(whereClause).not.toHaveProperty('assignedUserId');
          expect(whereClause).not.toHaveProperty('createdAt');
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('partial filter combinations are correctly applied', () => {
    it('should apply only the provided subset of filters and omit the rest', async () => {
      // Generator for a random subset of filters
      const partialFilterArb = fc.record(
        {
          stageId: fc.uuid(),
          pipelineId: fc.uuid(),
          priority: priorityArb,
          assignedUserId: fc.uuid(),
          dateFrom: fc.integer({ min: new Date('2020-01-01T00:00:00.000Z').getTime(), max: new Date('2030-12-31T23:59:59.999Z').getTime() }).map((t) => new Date(t).toISOString()),
          dateTo: fc.integer({ min: new Date('2020-01-01T00:00:00.000Z').getTime(), max: new Date('2030-12-31T23:59:59.999Z').getTime() }).map((t) => new Date(t).toISOString()),
        },
        { requiredKeys: [] },
      );

      await fc.assert(
        fc.asyncProperty(tenantIdArb, partialFilterArb, async (tenantId, filters) => {
          const params = buildQueryParams(filters);
          const whereClause = await callAndCaptureWhere(tenantId, params);

          // tenantId is always present
          expect(whereClause.tenantId).toBe(tenantId);

          // Each provided filter should be in the where clause
          if (filters.stageId) {
            expect(whereClause.stageId).toBe(filters.stageId);
          } else {
            expect(whereClause).not.toHaveProperty('stageId');
          }

          if (filters.pipelineId) {
            expect(whereClause.pipelineId).toBe(filters.pipelineId);
          } else {
            expect(whereClause).not.toHaveProperty('pipelineId');
          }

          if (filters.priority) {
            expect(whereClause.priority).toBe(filters.priority);
          } else {
            expect(whereClause).not.toHaveProperty('priority');
          }

          if (filters.assignedUserId) {
            expect(whereClause.assignedUserId).toBe(filters.assignedUserId);
          } else {
            expect(whereClause).not.toHaveProperty('assignedUserId');
          }

          if (filters.dateFrom || filters.dateTo) {
            const createdAtFilter = whereClause.createdAt as { gte?: Date; lte?: Date };
            expect(createdAtFilter).toBeDefined();
            if (filters.dateFrom) {
              expect(createdAtFilter.gte).toEqual(new Date(filters.dateFrom));
            }
            if (filters.dateTo) {
              expect(createdAtFilter.lte).toEqual(new Date(filters.dateTo));
            }
          } else {
            expect(whereClause).not.toHaveProperty('createdAt');
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
