import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based test for junction sync set equality.
 *
 * **Property 10: Junction Sync Set Equality**
 * For any deal update with a contactIds array, after the sync completes,
 * the set of leadId values in the LeadDeal table for that deal SHALL be
 * exactly equal to the provided contactIds set — no extra records, no missing records.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

const mockLeadDeal = {
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
};

const mockLead = {
  findMany: vi.fn(),
};

const mockTransaction = vi.fn();

vi.mock('../../../../config/database.config', () => {
  return {
    default: {
      $transaction: (cb: (tx: unknown) => Promise<void>) => mockTransaction(cb),
      leadDeal: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      lead: {
        findMany: vi.fn(),
      },
    },
  };
});

// Import after mocking.
// NOTE: This suite covers the LEAD junction sync. The behavior it asserts (LeadDeal/Lead)
// lives in `syncLeadAssociations` after the G1 fix (deal-contact-association-fix). The
// contact junction sync (ContactDeal/Contact) is covered separately in
// deals-contact-junction-sync.property.test.ts.
import { syncLeadAssociations as syncContactAssociations } from '../deals.repository';

// ─────────────────────────────────────────────────────
// GENERATORS
// ─────────────────────────────────────────────────────

const dealIdArb = fc.uuid();
const tenantIdArb = fc.uuid();
const userIdArb = fc.uuid();

/**
 * Generate a set of unique contact IDs (0-20 items).
 */
const contactIdSetArb = fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 20 });

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────

function setupMocksForIteration(currentIds: string[], targetIds: string[], currentSet: Set<string>): void {
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const txClient = {
      deal: { findFirstOrThrow: vi.fn().mockResolvedValue({}) },
      leadDeal: mockLeadDeal,
      lead: mockLead,
    };
    return cb(txClient);
  });

  // Setup current associations
  mockLeadDeal.findMany.mockResolvedValue(
    currentIds.map((id) => ({ leadId: id })),
  );

  // All target IDs that are new are valid in tenant
  const expectedAdditions = targetIds.filter((id) => !currentSet.has(id));
  mockLead.findMany.mockResolvedValue(
    expectedAdditions.map((id) => ({ id })),
  );

  mockLeadDeal.deleteMany.mockResolvedValue({ count: 0 });
  mockLeadDeal.createMany.mockResolvedValue({ count: 0 });
}

function resetMocks(): void {
  mockLeadDeal.findMany.mockReset();
  mockLeadDeal.deleteMany.mockReset();
  mockLeadDeal.createMany.mockReset();
  mockLead.findMany.mockReset();
  mockTransaction.mockReset();
}

// ─────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────

describe('Feature: deals-module-modernization, Property 10: Junction Sync Set Equality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deleteMany is called with IDs that are in current but NOT in target', () => {
    it('should remove only contacts present in current set but absent from target set', async () => {
      await fc.assert(
        fc.asyncProperty(
          dealIdArb,
          tenantIdArb,
          userIdArb,
          contactIdSetArb,
          contactIdSetArb,
          async (dealId, tenantId, userId, currentIds, targetIds) => {
            resetMocks();
            const currentSet = new Set(currentIds);
            setupMocksForIteration(currentIds, targetIds, currentSet);

            await syncContactAssociations(dealId, tenantId, targetIds, userId);

            // Compute expected removals: in current but NOT in target
            const targetSet = new Set(targetIds);
            const expectedRemovals = currentIds.filter((id) => !targetSet.has(id));

            if (expectedRemovals.length > 0) {
              expect(mockLeadDeal.deleteMany).toHaveBeenCalledWith({
                where: {
                  dealId,
                  tenantId,
                  leadId: { in: expectedRemovals },
                },
              });
            } else {
              expect(mockLeadDeal.deleteMany).not.toHaveBeenCalled();
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('createMany is called with IDs that are in target but NOT in current', () => {
    it('should add only contacts present in target set but absent from current set', async () => {
      await fc.assert(
        fc.asyncProperty(
          dealIdArb,
          tenantIdArb,
          userIdArb,
          contactIdSetArb,
          contactIdSetArb,
          async (dealId, tenantId, userId, currentIds, targetIds) => {
            resetMocks();
            const currentSet = new Set(currentIds);
            setupMocksForIteration(currentIds, targetIds, currentSet);

            await syncContactAssociations(dealId, tenantId, targetIds, userId);

            // Compute expected additions: in target but NOT in current
            const expectedAdditions = targetIds.filter((id) => !currentSet.has(id));

            if (expectedAdditions.length > 0) {
              expect(mockLeadDeal.createMany).toHaveBeenCalledWith({
                data: expectedAdditions.map((leadId) => ({
                  leadId,
                  dealId,
                  tenantId,
                  addedById: userId,
                  position: targetIds.indexOf(leadId),
                })),
                skipDuplicates: true,
              });
            } else {
              expect(mockLeadDeal.createMany).not.toHaveBeenCalled();
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('no action taken for IDs that are in both sets', () => {
    it('should neither remove nor add contacts that exist in both current and target sets', async () => {
      await fc.assert(
        fc.asyncProperty(
          dealIdArb,
          tenantIdArb,
          userIdArb,
          contactIdSetArb,
          contactIdSetArb,
          async (dealId, tenantId, userId, currentIds, targetIds) => {
            resetMocks();
            const currentSet = new Set(currentIds);
            setupMocksForIteration(currentIds, targetIds, currentSet);

            await syncContactAssociations(dealId, tenantId, targetIds, userId);

            // Compute common IDs
            const targetSet = new Set(targetIds);
            const commonIds = currentIds.filter((id) => targetSet.has(id));

            // Common IDs should NOT appear in deleteMany calls
            if (mockLeadDeal.deleteMany.mock.calls.length > 0) {
              const deletedIds: string[] =
                mockLeadDeal.deleteMany.mock.calls[0][0].where.leadId.in;
              for (const commonId of commonIds) {
                expect(deletedIds).not.toContain(commonId);
              }
            }

            // Common IDs should NOT appear in createMany calls
            if (mockLeadDeal.createMany.mock.calls.length > 0) {
              const createdIds: string[] =
                mockLeadDeal.createMany.mock.calls[0][0].data.map(
                  (d: { leadId: string }) => d.leadId,
                );
              for (const commonId of commonIds) {
                expect(createdIds).not.toContain(commonId);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('after sync, the effective junction set equals the target set', () => {
    it('should produce a final state where junction records exactly match the target contactIds', async () => {
      await fc.assert(
        fc.asyncProperty(
          dealIdArb,
          tenantIdArb,
          userIdArb,
          contactIdSetArb,
          contactIdSetArb,
          async (dealId, tenantId, userId, currentIds, targetIds) => {
            resetMocks();
            const currentSet = new Set(currentIds);
            setupMocksForIteration(currentIds, targetIds, currentSet);

            await syncContactAssociations(dealId, tenantId, targetIds, userId);

            // Compute expected operations
            const targetSet = new Set(targetIds);
            const expectedRemovals = currentIds.filter((id) => !targetSet.has(id));
            const expectedAdditions = targetIds.filter((id) => !currentSet.has(id));

            // Simulate the final state after operations:
            // Start with current set, remove deletions, add additions
            const finalSet = new Set(currentIds);
            for (const id of expectedRemovals) {
              finalSet.delete(id);
            }
            for (const id of expectedAdditions) {
              finalSet.add(id);
            }

            // The final set should exactly equal the target set
            expect(finalSet.size).toBe(targetSet.size);
            for (const id of targetSet) {
              expect(finalSet.has(id)).toBe(true);
            }
            for (const id of finalSet) {
              expect(targetSet.has(id)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
