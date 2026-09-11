import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Unit tests for the Reporting service.
 *
 * Design rules:
 * - All Prisma calls are mocked — no real DB connection required.
 * - Every test verifies:
 *     a) tenantId is always passed to the Prisma where clause (tenant isolation).
 *     b) The return shape matches the TypeScript interface.
 *     c) Edge cases (empty data, zero values) are handled gracefully.
 *
 * Property-based tests confirm invariants hold across arbitrary inputs.
 */

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockPipelineFindMany   = vi.fn();
const mockDealFindMany       = vi.fn();
const mockLeadGroupBy        = vi.fn();
const mockTaskCount          = vi.fn();
const mockCampaignFindMany   = vi.fn();

vi.mock('../../../../config/database.config', () => ({
  default: {
    pipeline: { findMany:  (...args: unknown[]) => mockPipelineFindMany(...args) },
    deal:     { findMany:  (...args: unknown[]) => mockDealFindMany(...args) },
    lead:     { groupBy:   (...args: unknown[]) => mockLeadGroupBy(...args) },
    task:     { count:     (...args: unknown[]) => mockTaskCount(...args) },
    campaign: { findMany:  (...args: unknown[]) => mockCampaignFindMany(...args) },
  },
  enforcePlanLimit: vi.fn(),
}));

import {
  getPipelineSummary,
  getDealVelocity,
  getContactStatusBreakdown,
  getTaskCompletion,
  getCampaignSummary,
} from '../reports.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-reports-001';

function makePipeline(overrides: Record<string, unknown> = {}) {
  return {
    id:       'pipeline-1',
    name:     'Sales Pipeline',
    tenantId: TENANT_ID,
    stages: [
      { id: 'stage-1', name: 'Lead',   order: 1, probability: 10, isWon: false, isLost: false, _count: { deals: 5 } },
      { id: 'stage-2', name: 'Won',    order: 4, probability: 100, isWon: true,  isLost: false, _count: { deals: 2 } },
      { id: 'stage-3', name: 'Lost',   order: 5, probability: 0,  isWon: false, isLost: true,  _count: { deals: 1 } },
    ],
    ...overrides,
  };
}

function makeClosedDeal(daysToClose: number, isWon: boolean) {
  const createdAt = new Date(Date.now() - daysToClose * 86400000);
  const closedAt  = new Date();
  return {
    createdAt,
    closedAt,
    stage: { isWon, isLost: !isWon },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// getPipelineSummary
// ═════════════════════════════════════════════════════════════════════════════

describe('getPipelineSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always passes tenantId to pipeline query', async () => {
    mockPipelineFindMany.mockResolvedValue([makePipeline()]);

    await getPipelineSummary(TENANT_ID);

    const [call] = mockPipelineFindMany.mock.calls;
    expect((call[0] as { where: { tenantId: string } }).where.tenantId).toBe(TENANT_ID);
  });

  it('filters by pipelineId when provided', async () => {
    mockPipelineFindMany.mockResolvedValue([makePipeline()]);

    await getPipelineSummary(TENANT_ID, 'pipeline-1');

    const [call] = mockPipelineFindMany.mock.calls;
    expect((call[0] as { where: { id?: string } }).where.id).toBe('pipeline-1');
  });

  it('does NOT filter by pipelineId when omitted', async () => {
    mockPipelineFindMany.mockResolvedValue([]);

    await getPipelineSummary(TENANT_ID);

    const [call] = mockPipelineFindMany.mock.calls;
    expect((call[0] as { where: { id?: string } }).where.id).toBeUndefined();
  });

  it('maps pipeline stages to the expected summary shape', async () => {
    mockPipelineFindMany.mockResolvedValue([makePipeline()]);

    const result = await getPipelineSummary(TENANT_ID);

    expect(result).toHaveLength(1);
    const [pipeline] = result;
    expect(pipeline.pipelineId).toBe('pipeline-1');
    expect(pipeline.name).toBe('Sales Pipeline');
    expect(pipeline.stages).toHaveLength(3);

    const [lead, won] = pipeline.stages;
    expect(lead.stageId).toBe('stage-1');
    expect(lead.dealCount).toBe(5);
    expect(won.isWon).toBe(true);
    expect(won.dealCount).toBe(2);
  });

  it('returns an empty array when no pipelines exist for the tenant', async () => {
    mockPipelineFindMany.mockResolvedValue([]);

    const result = await getPipelineSummary(TENANT_ID);

    expect(result).toEqual([]);
  });

  it('filters out archived pipelines', async () => {
    mockPipelineFindMany.mockResolvedValue([]);

    await getPipelineSummary(TENANT_ID);

    const [call] = mockPipelineFindMany.mock.calls;
    expect((call[0] as { where: { isArchived: boolean } }).where.isArchived).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getDealVelocity
// ═════════════════════════════════════════════════════════════════════════════

describe('getDealVelocity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always passes tenantId to deal query', async () => {
    mockDealFindMany.mockResolvedValue([]);

    await getDealVelocity(TENANT_ID);

    const [call] = mockDealFindMany.mock.calls;
    expect((call[0] as { where: { tenantId: string } }).where.tenantId).toBe(TENANT_ID);
  });

  it('returns nulls for avgDays when no closed deals exist', async () => {
    mockDealFindMany.mockResolvedValue([]);

    const result = await getDealVelocity(TENANT_ID);

    expect(result.totalClosed).toBe(0);
    expect(result.totalWon).toBe(0);
    expect(result.totalLost).toBe(0);
    expect(result.avgDaysToCloseWon).toBeNull();
    expect(result.avgDaysToCloseLost).toBeNull();
  });

  it('correctly computes avgDaysToCloseWon for won deals', async () => {
    // Two won deals: one closed in 10 days, one in 20 days → avg 15
    mockDealFindMany.mockResolvedValue([
      makeClosedDeal(10, true),
      makeClosedDeal(20, true),
    ]);

    const result = await getDealVelocity(TENANT_ID);

    expect(result.totalWon).toBe(2);
    expect(result.totalLost).toBe(0);
    expect(result.avgDaysToCloseWon).toBe(15);
    expect(result.avgDaysToCloseLost).toBeNull();
  });

  it('correctly computes avgDaysToCloseLost for lost deals', async () => {
    mockDealFindMany.mockResolvedValue([
      makeClosedDeal(5, false),
      makeClosedDeal(15, false),
    ]);

    const result = await getDealVelocity(TENANT_ID);

    expect(result.totalLost).toBe(2);
    expect(result.avgDaysToCloseLost).toBe(10);
    expect(result.avgDaysToCloseWon).toBeNull();
  });

  it('handles a mix of won and lost deals correctly', async () => {
    mockDealFindMany.mockResolvedValue([
      makeClosedDeal(10, true),
      makeClosedDeal(8, false),
      makeClosedDeal(12, false),
    ]);

    const result = await getDealVelocity(TENANT_ID);

    expect(result.totalClosed).toBe(3);
    expect(result.totalWon).toBe(1);
    expect(result.totalLost).toBe(2);
    expect(result.avgDaysToCloseWon).toBe(10);
    expect(result.avgDaysToCloseLost).toBe(10); // (8 + 12) / 2
  });

  it('only queries deals with a non-null closedAt', async () => {
    mockDealFindMany.mockResolvedValue([]);

    await getDealVelocity(TENANT_ID);

    const [call] = mockDealFindMany.mock.calls;
    const where = (call[0] as { where: { closedAt?: unknown } }).where;
    expect(where.closedAt).toEqual({ not: null });
  });

  /**
   * Property: avgDaysToCloseWon is always a non-negative integer (or null).
   */
  it('Property: avgDaysToCloseWon is always non-negative when deals exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 365 }), { minLength: 1, maxLength: 20 }),
        async (daysList) => {
          vi.clearAllMocks();
          mockDealFindMany.mockResolvedValue(
            daysList.map((d) => makeClosedDeal(d, true)),
          );

          const result = await getDealVelocity(TENANT_ID);

          expect(result.avgDaysToCloseWon).not.toBeNull();
          expect(result.avgDaysToCloseWon!).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(result.avgDaysToCloseWon!)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getContactStatusBreakdown
// ═════════════════════════════════════════════════════════════════════════════

describe('getContactStatusBreakdown', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always passes tenantId to the groupBy query', async () => {
    mockLeadGroupBy.mockResolvedValue([]);

    await getContactStatusBreakdown(TENANT_ID);

    const [call] = mockLeadGroupBy.mock.calls;
    expect((call[0] as { where: { tenantId: string } }).where.tenantId).toBe(TENANT_ID);
  });

  it('maps groupBy results to { status, count } shape', async () => {
    mockLeadGroupBy.mockResolvedValue([
      { status: 'HOT',  _count: { status: 10 } },
      { status: 'WARM', _count: { status: 5 } },
      { status: 'COLD', _count: { status: 3 } },
    ]);

    const result = await getContactStatusBreakdown(TENANT_ID);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: 'HOT',  count: 10 });
    expect(result[1]).toEqual({ status: 'WARM', count: 5 });
    expect(result[2]).toEqual({ status: 'COLD', count: 3 });
  });

  it('returns an empty array when no contacts exist', async () => {
    mockLeadGroupBy.mockResolvedValue([]);

    const result = await getContactStatusBreakdown(TENANT_ID);

    expect(result).toEqual([]);
  });

  /**
   * Property: all returned counts are non-negative integers.
   */
  it('Property: all status counts are always non-negative integers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            status: fc.constantFrom('HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED'),
            count:  fc.nat({ max: 10000 }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        async (items) => {
          vi.clearAllMocks();
          mockLeadGroupBy.mockResolvedValue(
            items.map((item) => ({ status: item.status, _count: { status: item.count } })),
          );

          const result = await getContactStatusBreakdown(TENANT_ID);

          expect(result).toHaveLength(items.length);
          result.forEach((r) => {
            expect(r.count).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(r.count)).toBe(true);
          });
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getTaskCompletion
// ═════════════════════════════════════════════════════════════════════════════

describe('getTaskCompletion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always passes tenantId to all task count queries', async () => {
    mockTaskCount.mockResolvedValue(0);

    await getTaskCompletion(TENANT_ID);

    expect(mockTaskCount).toHaveBeenCalledTimes(3);
    mockTaskCount.mock.calls.forEach((call) => {
      expect((call[0] as { where: { tenantId: string } }).where.tenantId).toBe(TENANT_ID);
    });
  });

  it('returns correct totals for a standard scenario', async () => {
    // Call order: total, completed, overdue
    mockTaskCount
      .mockResolvedValueOnce(20)  // total
      .mockResolvedValueOnce(12)  // completed
      .mockResolvedValueOnce(3);  // overdue

    const result = await getTaskCompletion(TENANT_ID);

    expect(result.total).toBe(20);
    expect(result.completed).toBe(12);
    expect(result.overdue).toBe(3);
    expect(result.pending).toBe(8); // 20 - 12
  });

  it('returns zero for all metrics when no tasks exist', async () => {
    mockTaskCount.mockResolvedValue(0);

    const result = await getTaskCompletion(TENANT_ID);

    expect(result.total).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.overdue).toBe(0);
    expect(result.pending).toBe(0);
  });

  it('excludes archived tasks from all counts', async () => {
    mockTaskCount.mockResolvedValue(0);

    await getTaskCompletion(TENANT_ID);

    mockTaskCount.mock.calls.forEach((call) => {
      expect((call[0] as { where: { isArchived: boolean } }).where.isArchived).toBe(false);
    });
  });

  it('overdue query filters by dueDate < now and non-terminal statuses', async () => {
    mockTaskCount.mockResolvedValue(0);

    await getTaskCompletion(TENANT_ID);

    // Third call is the overdue query
    const overdueCall = mockTaskCount.mock.calls[2][0] as {
      where: { dueDate?: { lt: Date }; status?: { notIn: string[] } };
    };
    expect(overdueCall.where.dueDate?.lt).toBeInstanceOf(Date);
    expect(overdueCall.where.status?.notIn).toContain('completed');
    expect(overdueCall.where.status?.notIn).toContain('cancelled');
  });

  /**
   * Property: pending = total - completed, always.
   */
  it('Property: pending always equals total - completed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        async (total, completed, overdue) => {
          vi.clearAllMocks();
          mockTaskCount
            .mockResolvedValueOnce(total)
            .mockResolvedValueOnce(completed)
            .mockResolvedValueOnce(overdue);

          const result = await getTaskCompletion(TENANT_ID);

          expect(result.pending).toBe(result.total - result.completed);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getCampaignSummary
// ═════════════════════════════════════════════════════════════════════════════

describe('getCampaignSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  const makeCampaign = (overrides: Record<string, unknown> = {}) => ({
    id:           'camp-1',
    name:         'Q4 Outreach',
    type:         'EMAIL',
    status:       'COMPLETED',
    sentCount:    100,
    openedCount:  35,
    clickedCount: 12,
    engagement:   0.35,
    sentAt:       new Date().toISOString(),
    ...overrides,
  });

  it('always passes tenantId to campaign query', async () => {
    mockCampaignFindMany.mockResolvedValue([]);

    await getCampaignSummary(TENANT_ID);

    const [call] = mockCampaignFindMany.mock.calls;
    expect((call[0] as { where: { tenantId: string } }).where.tenantId).toBe(TENANT_ID);
  });

  it('limits results to the 10 most recent campaigns', async () => {
    mockCampaignFindMany.mockResolvedValue([]);

    await getCampaignSummary(TENANT_ID);

    const [call] = mockCampaignFindMany.mock.calls;
    expect((call[0] as { take: number }).take).toBe(10);
  });

  it('orders campaigns by sentAt descending', async () => {
    mockCampaignFindMany.mockResolvedValue([]);

    await getCampaignSummary(TENANT_ID);

    const [call] = mockCampaignFindMany.mock.calls;
    expect((call[0] as { orderBy: { sentAt: string } }).orderBy).toEqual({ sentAt: 'desc' });
  });

  it('excludes archived campaigns', async () => {
    mockCampaignFindMany.mockResolvedValue([]);

    await getCampaignSummary(TENANT_ID);

    const [call] = mockCampaignFindMany.mock.calls;
    expect((call[0] as { where: { isArchived: boolean } }).where.isArchived).toBe(false);
  });

  it('returns campaigns with the expected fields', async () => {
    mockCampaignFindMany.mockResolvedValue([makeCampaign()]);

    const result = await getCampaignSummary(TENANT_ID);

    expect(result).toHaveLength(1);
    const [camp] = result;
    expect(camp).toHaveProperty('id');
    expect(camp).toHaveProperty('name');
    expect(camp).toHaveProperty('sentCount');
    expect(camp).toHaveProperty('openedCount');
    expect(camp).toHaveProperty('clickedCount');
    expect(camp).toHaveProperty('engagement');
  });

  it('returns an empty array when no campaigns exist', async () => {
    mockCampaignFindMany.mockResolvedValue([]);

    const result = await getCampaignSummary(TENANT_ID);

    expect(result).toEqual([]);
  });

  /**
   * Property: engagement is always a number between 0 and 1 for each returned campaign.
   */
  it('Property: engagement values are always in the range [0, 1]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.float({ min: 0, max: 1 }), { minLength: 0, maxLength: 10 }),
        async (engagements) => {
          vi.clearAllMocks();
          mockCampaignFindMany.mockResolvedValue(
            engagements.map((e, i) => makeCampaign({ id: `camp-${i}`, engagement: e })),
          );

          const result = await getCampaignSummary(TENANT_ID);

          result.forEach((camp) => {
            expect(camp.engagement).toBeGreaterThanOrEqual(0);
            expect(camp.engagement).toBeLessThanOrEqual(1);
          });
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cross-cutting: Tenant isolation
// ═════════════════════════════════════════════════════════════════════════════

describe('Tenant isolation — all service functions', () => {
  /**
   * Property: for any two different tenantIds, every service function
   * always passes the correct tenantId to its Prisma query — never confusing
   * one tenant's data for another.
   */
  it('Property: all functions always use the exact provided tenantId in queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0),
        async (tenantId) => {
          vi.clearAllMocks();
          mockPipelineFindMany.mockResolvedValue([]);
          mockDealFindMany.mockResolvedValue([]);
          mockLeadGroupBy.mockResolvedValue([]);
          mockTaskCount.mockResolvedValue(0);
          mockCampaignFindMany.mockResolvedValue([]);

          // Call all five service functions with the same tenantId
          await Promise.all([
            getPipelineSummary(tenantId),
            getDealVelocity(tenantId),
            getContactStatusBreakdown(tenantId),
            getTaskCompletion(tenantId),
            getCampaignSummary(tenantId),
          ]);

          // Every Prisma call must have used the correct tenantId
          const allCalls = [
            ...mockPipelineFindMany.mock.calls,
            ...mockDealFindMany.mock.calls,
            ...mockLeadGroupBy.mock.calls,
            ...mockTaskCount.mock.calls,
            ...mockCampaignFindMany.mock.calls,
          ];

          allCalls.forEach((call) => {
            const where = (call[0] as { where?: { tenantId?: string } }).where;
            expect(where?.tenantId).toBe(tenantId);
          });
        },
      ),
      { numRuns: 20 },
    );
  });
});
