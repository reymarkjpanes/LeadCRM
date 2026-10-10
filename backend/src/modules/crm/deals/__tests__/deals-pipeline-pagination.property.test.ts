import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based test for pipeline pagination metadata correctness.
 *
 * **Property 15: Pipeline Pagination Metadata Correctness**
 * For any stage with N total deals and a page size of 20, `hasMore` SHALL be `true`
 * if and only if `N > page × 20`. The `total` field SHALL always equal the actual
 * count of deals in that stage.
 *
 * **Validates: Requirements 17.3, 17.4**
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

vi.mock('../../../../config/database.config', () => {
  return {
    default: {
      stage: {
        findMany: vi.fn(),
      },
      deal: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
    },
  };
});

// Import after mocking
import prisma from '../../../../config/database.config';
import { findDealsGroupedByStage } from '../deals.repository';

// ─────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────
// GENERATORS
// ─────────────────────────────────────────────────────

/** Generate a random tenant ID */
const tenantIdArb = fc.uuid();

/** Generate a random pipeline ID */
const pipelineIdArb = fc.uuid();

/** Generate a stage with a unique ID */
const stageIdArb = fc.uuid();

/**
 * Generate an array of 1–6 stages, each with a random deal count (0–100)
 * and a page number (1–5).
 */
const stageConfigArb = fc.array(
  fc.record({
    stageId: stageIdArb,
    dealCount: fc.integer({ min: 0, max: 100 }),
    page: fc.integer({ min: 1, max: 5 }),
  }),
  { minLength: 1, maxLength: 6 },
);

// ─────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────

describe('Feature: deals-module-modernization, Property 15: Pipeline Pagination Metadata Correctness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasMore is true iff total > page × 20', () => {
    it('should set hasMore correctly based on total deal count and current page', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          pipelineIdArb,
          stageConfigArb,
          async (tenantId, pipelineId, stageConfigs) => {
            // Mock stage.findMany to return stage IDs
            const mockStages = stageConfigs.map((sc) => ({ id: sc.stageId }));
            vi.mocked(prisma.stage.findMany).mockResolvedValue(mockStages as never);

            // Build stagePageMap from configs
            const stagePageMap: Record<string, number> = {};
            for (const sc of stageConfigs) {
              stagePageMap[sc.stageId] = sc.page;
            }

            // Mock deal.findMany and deal.count per stage (called sequentially)
            const mockFindMany = vi.mocked(prisma.deal.findMany);
            const mockCount = vi.mocked(prisma.deal.count);

            // Set up sequential mock responses for each stage
            for (let i = 0; i < stageConfigs.length; i++) {
              const sc = stageConfigs[i];
              const dealsInPage = Math.min(sc.dealCount - (sc.page - 1) * PAGE_SIZE, PAGE_SIZE);
              const actualDealsReturned = Math.max(dealsInPage, 0);

              // Create minimal deal objects for the page
              const deals = Array.from({ length: actualDealsReturned }, (_, idx) => ({
                id: `deal-${sc.stageId}-${idx}`, leadDeals: [], contactDeals: [],
                stageId: sc.stageId,
              }));

              mockFindMany.mockResolvedValueOnce(deals as never);
              mockCount.mockResolvedValueOnce(sc.dealCount);
            }

            const results = await findDealsGroupedByStage(tenantId, pipelineId, stagePageMap);

            // Verify each stage result
            for (let i = 0; i < stageConfigs.length; i++) {
              const sc = stageConfigs[i];
              const result = results[i];

              // Property: hasMore === (total > page * PAGE_SIZE)
              const expectedHasMore = sc.dealCount > sc.page * PAGE_SIZE;
              expect(result.hasMore).toBe(expectedHasMore);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('total equals mocked count value', () => {
    it('should set total to the actual count of deals in that stage', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          pipelineIdArb,
          stageConfigArb,
          async (tenantId, pipelineId, stageConfigs) => {
            // Mock stage.findMany
            const mockStages = stageConfigs.map((sc) => ({ id: sc.stageId }));
            vi.mocked(prisma.stage.findMany).mockResolvedValue(mockStages as never);

            // Build stagePageMap
            const stagePageMap: Record<string, number> = {};
            for (const sc of stageConfigs) {
              stagePageMap[sc.stageId] = sc.page;
            }

            const mockFindMany = vi.mocked(prisma.deal.findMany);
            const mockCount = vi.mocked(prisma.deal.count);

            for (let i = 0; i < stageConfigs.length; i++) {
              const sc = stageConfigs[i];
              const dealsInPage = Math.min(sc.dealCount - (sc.page - 1) * PAGE_SIZE, PAGE_SIZE);
              const actualDealsReturned = Math.max(dealsInPage, 0);

              const deals = Array.from({ length: actualDealsReturned }, (_, idx) => ({
                id: `deal-${sc.stageId}-${idx}`, leadDeals: [], contactDeals: [],
                stageId: sc.stageId,
              }));

              mockFindMany.mockResolvedValueOnce(deals as never);
              mockCount.mockResolvedValueOnce(sc.dealCount);
            }

            const results = await findDealsGroupedByStage(tenantId, pipelineId, stagePageMap);

            // Property: total === mocked count for each stage
            for (let i = 0; i < stageConfigs.length; i++) {
              const sc = stageConfigs[i];
              const result = results[i];
              expect(result.total).toBe(sc.dealCount);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('page value is correctly set from stagePageMap', () => {
    it('should use the provided page number per stage, defaulting to 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          tenantIdArb,
          pipelineIdArb,
          stageConfigArb,
          async (tenantId, pipelineId, stageConfigs) => {
            const mockStages = stageConfigs.map((sc) => ({ id: sc.stageId }));
            vi.mocked(prisma.stage.findMany).mockResolvedValue(mockStages as never);

            const stagePageMap: Record<string, number> = {};
            for (const sc of stageConfigs) {
              stagePageMap[sc.stageId] = sc.page;
            }

            const mockFindMany = vi.mocked(prisma.deal.findMany);
            const mockCount = vi.mocked(prisma.deal.count);

            for (let i = 0; i < stageConfigs.length; i++) {
              mockFindMany.mockResolvedValueOnce([] as never);
              mockCount.mockResolvedValueOnce(stageConfigs[i].dealCount);
            }

            const results = await findDealsGroupedByStage(tenantId, pipelineId, stagePageMap);

            for (let i = 0; i < stageConfigs.length; i++) {
              expect(results[i].page).toBe(stageConfigs[i].page);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('edge case: zero deals in a stage', () => {
    it('should set hasMore to false and total to 0 when a stage has no deals', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, pipelineIdArb, fc.integer({ min: 1, max: 5 }), async (tenantId, pipelineId, page) => {
          const stageId = 'stage-empty';

          vi.mocked(prisma.stage.findMany).mockResolvedValue([{ id: stageId }] as never);
          vi.mocked(prisma.deal.findMany).mockResolvedValueOnce([] as never);
          vi.mocked(prisma.deal.count).mockResolvedValueOnce(0);

          const results = await findDealsGroupedByStage(tenantId, pipelineId, { [stageId]: page });

          expect(results[0].total).toBe(0);
          expect(results[0].hasMore).toBe(false);
          expect(results[0].deals).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('boundary: total exactly equals page × 20', () => {
    it('should set hasMore to false when total === page × PAGE_SIZE (no more beyond current page)', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, pipelineIdArb, fc.integer({ min: 1, max: 5 }), async (tenantId, pipelineId, page) => {
          const stageId = 'stage-boundary';
          const total = page * PAGE_SIZE; // exactly fills current page scope

          vi.mocked(prisma.stage.findMany).mockResolvedValue([{ id: stageId }] as never);
          vi.mocked(prisma.deal.findMany).mockResolvedValueOnce(
            Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `deal-${i}`, leadDeals: [], contactDeals: [] })) as never,
          );
          vi.mocked(prisma.deal.count).mockResolvedValueOnce(total);

          const results = await findDealsGroupedByStage(tenantId, pipelineId, { [stageId]: page });

          // total === page * 20, so hasMore should be false (not strictly greater)
          expect(results[0].hasMore).toBe(false);
          expect(results[0].total).toBe(total);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('boundary: total is page × 20 + 1', () => {
    it('should set hasMore to true when total === page × PAGE_SIZE + 1', async () => {
      await fc.assert(
        fc.asyncProperty(tenantIdArb, pipelineIdArb, fc.integer({ min: 1, max: 5 }), async (tenantId, pipelineId, page) => {
          const stageId = 'stage-boundary-plus';
          const total = page * PAGE_SIZE + 1; // one more than current page scope

          vi.mocked(prisma.stage.findMany).mockResolvedValue([{ id: stageId }] as never);
          vi.mocked(prisma.deal.findMany).mockResolvedValueOnce(
            Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `deal-${i}`, leadDeals: [], contactDeals: [] })) as never,
          );
          vi.mocked(prisma.deal.count).mockResolvedValueOnce(total);

          const results = await findDealsGroupedByStage(tenantId, pipelineId, { [stageId]: page });

          expect(results[0].hasMore).toBe(true);
          expect(results[0].total).toBe(total);
        }),
        { numRuns: 100 },
      );
    });
  });
});
