import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based test for deal duplication field preservation.
 *
 * **Property 13: Deal Duplication Field Preservation**
 * Preserve sales context while starting a new opportunity at the current Product price.
 * Identity, lifecycle, owner, price and currency are deliberately reset.
 * The duplicated deal's `title` SHALL equal the source title suffixed with ` (Copy)`.
 *
 * **Validates: Requirements 16.1, 16.2, 16.3**
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

const mockDealCreate = vi.fn();
const mockLeadDealFindMany = vi.fn();
const mockLeadDealCreateMany = vi.fn();
const mockContactDealFindMany = vi.fn();
const mockContactDealCreateMany = vi.fn();

vi.mock('../../../../config/database.config', () => {
  const client = {
      $transaction: async (work: (tx: unknown) => unknown) => work(client),
      productInterest: { findMany: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'CCTV', dealValue: 30000, active: true }] },
      stage: { findFirst: async () => ({ id: "initial-lead-stage" }) },
      deal: {
        create: (...args: unknown[]) => mockDealCreate(...args),
      },
      leadDeal: {
        findMany: (...args: unknown[]) => mockLeadDealFindMany(...args),
        createMany: (...args: unknown[]) => mockLeadDealCreateMany(...args),
      },
      contactDeal: {
        findMany: (...args: unknown[]) => mockContactDealFindMany(...args),
        createMany: (...args: unknown[]) => mockContactDealCreateMany(...args),
      },
    };
  return { default: client };
});

vi.mock('../../../../core/audit/audit.service', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  buildChangeset: vi.fn().mockReturnValue({ before: {}, after: {} }),
}));

vi.mock('../deals.repository', () => ({
  findDealById: vi.fn(),
}));
vi.mock('../../../automation/triggers/triggers.service', () => ({
  fireDealCreated: vi.fn().mockResolvedValue(undefined),
  fireDealStageChanged: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import * as repo from '../deals.repository';
import { duplicateDeal } from '../deals.service';

// ─────────────────────────────────────────────────────
// GENERATORS
// ─────────────────────────────────────────────────────

/** Relation fields that Prisma returns from findDealById but can't be in create data */
const RELATION_FIELDS = [
  'stage', 'pipeline', 'organization', 'assignedUser', 'owner', 'leadDeals', 'stageHistories',
] as const;

/** Generator for a UUID-like string */
const uuidArb = fc.uuid();

/** Generator for deal title (non-empty, no trailing/leading spaces that could trip up) */
const titleArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.trim().length > 0 && !s.includes('(Copy)'),
);

/** Generator for priority enum */
const priorityArb = fc.constantFrom('LOW', 'MEDIUM', 'HIGH');

/** Generator for a deal value (nullable) */
const valueArb = fc.oneof(
  fc.constant(null),
  fc.double({ min: 0.01, max: 999_999_999_999, noNaN: true, noDefaultInfinity: true }),
);

/** Generator for a date string (ISO format) */
const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') });

/** Generator for a full deal object as returned by repo.findDealById */
const sourceDealArb = fc.record({
  // Fields that should be EXCLUDED from duplicate
  id: uuidArb,
  createdAt: dateArb,
  updatedAt: dateArb,
  closedAt: fc.oneof(fc.constant(null), dateArb),
  lostReason: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  isArchived: fc.boolean(),
  deletedAt: fc.oneof(fc.constant(null), dateArb),

  // Fields that SHOULD be preserved
  title: titleArb,
  value: valueArb,
  priority: priorityArb,
  stageId: uuidArb,
  pipelineId: uuidArb,
  assignedUserId: fc.oneof(fc.constant(null), uuidArb),
  accountId: fc.oneof(fc.constant(null), uuidArb),
  tenantId: uuidArb,
  ownerId: uuidArb,
  expectedCloseDate: fc.oneof(fc.constant(null), dateArb),
  probability: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 100 })),
  source: fc.oneof(fc.constant(null), fc.constantFrom('Inbound', 'Outbound', 'Referral')),
  productInterests: fc.constant(['CCTV']),
  productInterestIds: fc.constant(['11111111-1111-4111-8111-111111111111']),
  currency: fc.oneof(fc.constant(null), fc.constantFrom('PHP', 'USD', 'EUR', 'GBP')),

  // Relation fields (returned by findDealById include but excluded from create)
  stage: fc.constant({ id: 'stg-1', name: 'Discovery', isWon: false, isLost: false, color: '#fff' }),
  pipeline: fc.constant({ id: 'pip-1', name: 'Sales', tenantId: 'tenant-1' }),
  organization: fc.constant(null),
  assignedUser: fc.constant({ id: 'user-1', firstName: 'John', lastName: 'Doe', email: 'j@x.com' }),
  owner: fc.constant({ id: 'user-2', firstName: 'Jane', lastName: 'Smith', email: 's@x.com' }),
  leadDeals: fc.constant([]),
  stageHistories: fc.constant([]),
});

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test-123';
const USER_ID = 'user-test-456';
const NEW_DEAL_ID = 'new-deal-id-789';

function setupMocks(): void {
  mockDealCreate.mockReset();
  mockLeadDealFindMany.mockReset();
  mockLeadDealCreateMany.mockReset();
  mockContactDealFindMany.mockReset();
  mockContactDealCreateMany.mockReset();
  vi.mocked(repo.findDealById).mockReset();

  mockDealCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...args.data,
    id: NEW_DEAL_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  mockLeadDealFindMany.mockResolvedValue([]);
  mockLeadDealCreateMany.mockResolvedValue({ count: 0 });
  mockContactDealFindMany.mockResolvedValue([]);
  mockContactDealCreateMany.mockResolvedValue({ count: 0 });
}

// ─────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────

describe('Feature: deals-module-modernization, Property 13: Deal Duplication Field Preservation', () => {
  beforeEach(() => {
    setupMocks();
  });

  describe('Field preservation on duplication', () => {
    it('duplicated deal title equals source title suffixed with " (Copy)"', async () => {
      await fc.assert(
        fc.asyncProperty(sourceDealArb, async (sourceDeal) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          expect(mockDealCreate).toHaveBeenCalledTimes(1);
          const createCallData = mockDealCreate.mock.calls[0][0].data;
          expect(createCallData.title).toBe(`${sourceDeal.title} (Copy)`);
        }),
        { numRuns: 100 },
      );
    });

    it('excluded fields (id, createdAt, updatedAt, closedAt, lostReason, isArchived, deletedAt) are NOT in create data', async () => {
      await fc.assert(
        fc.asyncProperty(sourceDealArb, async (sourceDeal) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          expect(mockDealCreate).toHaveBeenCalledTimes(1);
          const createCallData = mockDealCreate.mock.calls[0][0].data;

          // id must not be in create data (Prisma auto-generates)
          expect(createCallData).not.toHaveProperty('id');
          // createdAt/updatedAt are not passed (Prisma handles them)
          expect(createCallData).not.toHaveProperty('createdAt');
          expect(createCallData).not.toHaveProperty('updatedAt');
          expect(createCallData).not.toHaveProperty('deletedAt');

          // closedAt and lostReason are explicitly set to null (overridden)
          expect(createCallData.closedAt).toBeNull();
          expect(createCallData.lostReason).toBeNull();

          // isArchived is explicitly set to false
          expect(createCallData.isArchived).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('relation fields (stage, pipeline, organization, assignedUser, owner, leadDeals, stageHistories) are NOT in create data', async () => {
      await fc.assert(
        fc.asyncProperty(sourceDealArb, async (sourceDeal) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          expect(mockDealCreate).toHaveBeenCalledTimes(1);
          const createCallData = mockDealCreate.mock.calls[0][0].data;

          for (const relationField of RELATION_FIELDS) {
            expect(createCallData).not.toHaveProperty(relationField);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('preserves Deal fields and resets the stage to Lead', async () => {
      await fc.assert(
        fc.asyncProperty(sourceDealArb, async (sourceDeal) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          expect(mockDealCreate).toHaveBeenCalledTimes(1);
          const createCallData = mockDealCreate.mock.calls[0][0].data;

          // Duplicates start at Lead in the same pipeline.
          expect(createCallData.stageId).toBe("initial-lead-stage");
          expect(createCallData.pipelineId).toBe(sourceDeal.pipelineId);

          // A duplicate is a NEW Deal; the original historical value is untouched.
          expect(createCallData.value).toBe(30000);
          expect(createCallData.priority).toBe(sourceDeal.priority);

          // Other preserved fields
          expect(createCallData.assignedUserId).toBe(sourceDeal.assignedUserId);
          expect(createCallData.accountId).toBe(sourceDeal.accountId);
          expect(createCallData.expectedCloseDate).toEqual(sourceDeal.expectedCloseDate);
          expect(createCallData.probability).toBe(sourceDeal.probability);
          expect(createCallData.source).toBe(sourceDeal.source);
          expect(createCallData.currency).toBe('PHP');
        }),
        { numRuns: 100 },
      );
    });

    it('duplicated deal tenantId matches the provided tenantId parameter', async () => {
      await fc.assert(
        fc.asyncProperty(sourceDealArb, async (sourceDeal) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          expect(mockDealCreate).toHaveBeenCalledTimes(1);
          const createCallData = mockDealCreate.mock.calls[0][0].data;
          expect(createCallData.tenantId).toBe(TENANT_ID);
        }),
        { numRuns: 100 },
      );
    });

    it('duplicated deal ownerId is set to the authenticated userId', async () => {
      await fc.assert(
        fc.asyncProperty(sourceDealArb, async (sourceDeal) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          expect(mockDealCreate).toHaveBeenCalledTimes(1);
          const createCallData = mockDealCreate.mock.calls[0][0].data;
          expect(createCallData.ownerId).toBe(USER_ID);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('LeadDeal association duplication', () => {
    it('copies contact associations from source deal to new deal', async () => {
      const associationsArb = fc.array(
        fc.record({
          leadId: uuidArb,
          dealId: fc.constant('source-deal-id'),
          tenantId: fc.constant(TENANT_ID),
          addedById: uuidArb,
        }),
        { minLength: 1, maxLength: 10 },
      );

      await fc.assert(
        fc.asyncProperty(sourceDealArb, associationsArb, async (sourceDeal, associations) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);
          mockLeadDealFindMany.mockResolvedValue(associations);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          // Assert: createMany was called with the correct association data
          expect(mockLeadDealCreateMany).toHaveBeenCalledTimes(1);
          const createManyData = mockLeadDealCreateMany.mock.calls[0][0].data;

          // Each association should have the new deal ID and correct tenant/user
          expect(createManyData).toHaveLength(associations.length);
          for (let i = 0; i < associations.length; i++) {
            expect(createManyData[i].leadId).toBe(associations[i].leadId);
            expect(createManyData[i].dealId).toBe(NEW_DEAL_ID);
            expect(createManyData[i].tenantId).toBe(TENANT_ID);
            expect(createManyData[i].addedById).toBe(USER_ID);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('does not call createMany when source has no contact associations', async () => {
      await fc.assert(
        fc.asyncProperty(sourceDealArb, async (sourceDeal) => {
          setupMocks();
          vi.mocked(repo.findDealById).mockResolvedValue(sourceDeal as never);
          mockLeadDealFindMany.mockResolvedValue([]);

          await duplicateDeal(sourceDeal.id, TENANT_ID, USER_ID);

          // Assert: createMany should NOT be called when no associations exist
          expect(mockLeadDealCreateMany).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });
});
