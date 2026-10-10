import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based test for restore precondition.
 *
 * **Property 16: Restore Precondition**
 * For any deal that is NOT currently archived, the restore endpoint SHALL return HTTP 400.
 * For any deal that IS archived, the restore SHALL set `isArchived` to `false` and
 * `archiveReason` to `null`.
 *
 * **Validates: Requirements 9.1, 9.3**
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

vi.mock('../../../../config/database.config', () => {
  return {
    default: {
      deal: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('../../../../core/audit/audit.service', () => {
  return {
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    buildChangeset: vi.fn().mockReturnValue({ before: {}, after: {} }),
  };
});

// Mock automation triggers (imported by deals.service.ts)
vi.mock('../../../automation/triggers/triggers.service', () => ({
  fireDealCreated: vi.fn().mockResolvedValue(undefined),
  fireDealStageChanged: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../../config/database.config';
import { restoreDeal } from '../deals.service';
import { ValidationError } from '../../../../shared/errors/http-error';

// ─────────────────────────────────────────────────────
// GENERATORS
// ─────────────────────────────────────────────────────

const dealIdArb = fc.uuid();
const tenantIdArb = fc.uuid();
const userIdArb = fc.uuid();

/**
 * Generate a deal object in an archived state (isArchived: true)
 * with a random archiveReason string.
 */
const archivedDealArb = fc.record({ leadDeals: fc.constant([]), contactDeals: fc.constant([]),
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  isArchived: fc.constant(true),
  archiveReason: fc.oneof(
    fc.string({ minLength: 1, maxLength: 200 }),
    fc.constant(null),
  ),
  tenantId: fc.uuid(),
  stageId: fc.uuid(),
  pipelineId: fc.uuid(),
  value: fc.oneof(fc.double({ min: 0, max: 999_999_999_999, noNaN: true }), fc.constant(null)),
  createdAt: fc.date(),
  updatedAt: fc.date(),
});

/**
 * Generate a deal object in a non-archived state (isArchived: false).
 */
const nonArchivedDealArb = fc.record({ leadDeals: fc.constant([]), contactDeals: fc.constant([]),
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  isArchived: fc.constant(false),
  archiveReason: fc.constant(null),
  tenantId: fc.uuid(),
  stageId: fc.uuid(),
  pipelineId: fc.uuid(),
  value: fc.oneof(fc.double({ min: 0, max: 999_999_999_999, noNaN: true }), fc.constant(null)),
  createdAt: fc.date(),
  updatedAt: fc.date(),
});

// ─────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────

describe('Feature: deals-module-modernization, Property 16: Restore Precondition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-archived deal → throws ValidationError (400)', () => {
    it('should throw ValidationError when deal.isArchived is false for any deal/tenant/user combination', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonArchivedDealArb,
          dealIdArb,
          tenantIdArb,
          userIdArb,
          async (deal, dealId, tenantId, userId) => {
            // findDealById uses prisma.deal.findFirst
            vi.mocked(prisma.deal.findFirst).mockResolvedValue(deal as never);

            await expect(restoreDeal(dealId, tenantId, userId)).rejects.toThrow(ValidationError);
            await expect(restoreDeal(dealId, tenantId, userId)).rejects.toThrow('Deal is not archived');
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('archived deal → restores successfully with correct field clearing', () => {
    it('should set isArchived=false and archiveReason=null when deal is archived', async () => {
      await fc.assert(
        fc.asyncProperty(
          archivedDealArb,
          dealIdArb,
          tenantIdArb,
          userIdArb,
          async (deal, dealId, tenantId, userId) => {
            // findDealById returns the archived deal
            vi.mocked(prisma.deal.findFirst).mockResolvedValue(deal as never);

            // prisma.deal.update should be called with the restore data
            const restoredDeal = { ...deal, isArchived: false, archiveReason: null };
            vi.mocked(prisma.deal.update).mockResolvedValue(restoredDeal as never);

            const result = await restoreDeal(dealId, tenantId, userId);

            // Verify update was called with correct arguments
            expect(prisma.deal.update).toHaveBeenCalledWith({
              where: { id: dealId },
              data: { isArchived: false, archiveReason: null },
            });

            // Verify the returned result has isArchived=false and archiveReason=null
            expect(result.isArchived).toBe(false);
            expect(result.archiveReason).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('archived deal — isArchived is always set to false regardless of previous archiveReason', () => {
    it('should clear archiveReason to null regardless of its original value', async () => {
      await fc.assert(
        fc.asyncProperty(
          archivedDealArb,
          dealIdArb,
          tenantIdArb,
          userIdArb,
          async (deal, dealId, tenantId, userId) => {
            vi.mocked(prisma.deal.findFirst).mockResolvedValue(deal as never);
            vi.mocked(prisma.deal.update).mockResolvedValue({
              ...deal,
              isArchived: false,
              archiveReason: null,
            } as never);

            const result = await restoreDeal(dealId, tenantId, userId);

            // Whether the original had an archiveReason or null,
            // after restore it MUST be null
            expect(result.archiveReason).toBeNull();
            expect(result.isArchived).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('isArchived state determines behavior — combined property', () => {
    it('should reject non-archived and accept archived for any random isArchived state', async () => {
      const dealWithRandomArchiveState = fc.record({ leadDeals: fc.constant([]), contactDeals: fc.constant([]),
        id: fc.uuid(),
        title: fc.string({ minLength: 1, maxLength: 100 }),
        isArchived: fc.boolean(),
        archiveReason: fc.oneof(fc.string({ minLength: 1, maxLength: 200 }), fc.constant(null)),
        tenantId: fc.uuid(),
        stageId: fc.uuid(),
        pipelineId: fc.uuid(),
        value: fc.oneof(fc.double({ min: 0, max: 999_999_999_999, noNaN: true }), fc.constant(null)),
        createdAt: fc.date(),
        updatedAt: fc.date(),
      });

      await fc.assert(
        fc.asyncProperty(
          dealWithRandomArchiveState,
          dealIdArb,
          tenantIdArb,
          userIdArb,
          async (deal, dealId, tenantId, userId) => {
            vi.mocked(prisma.deal.findFirst).mockResolvedValue(deal as never);
            vi.mocked(prisma.deal.update).mockResolvedValue({
              ...deal,
              isArchived: false,
              archiveReason: null,
            } as never);

            if (deal.isArchived) {
              // Archived deals should be restored successfully
              const result = await restoreDeal(dealId, tenantId, userId);
              expect(result.isArchived).toBe(false);
              expect(result.archiveReason).toBeNull();
            } else {
              // Non-archived deals should throw ValidationError
              await expect(restoreDeal(dealId, tenantId, userId)).rejects.toThrow(ValidationError);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
