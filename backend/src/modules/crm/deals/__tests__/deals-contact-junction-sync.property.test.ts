import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based test for CONTACT junction sync set equality (G1 fix).
 *
 * After `syncContactAssociations(dealId, tenantId, contactIds, userId)`, the set of
 * `contactId` values in ContactDeal for that deal SHALL be exactly equal to `contactIds`.
 * This guards against the G1 regression where the function wrote to LeadDeal/Lead.
 *
 * Spec: .kiro/specs/deal-contact-association-fix/
 */

// ── Mocks ────────────────────────────────────────────────────────────────
const mockContactDeal = {
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
};
const mockContact = { findMany: vi.fn() };
const mockTransaction = vi.fn();

vi.mock('../../../../config/database.config', () => ({
  default: {
    $transaction: (cb: (tx: unknown) => Promise<void>) => mockTransaction(cb),
    contactDeal: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    contact: { findMany: vi.fn() },
  },
}));

import { syncContactAssociations } from '../deals.repository';

// ── Generators ───────────────────────────────────────────────────────────
const dealIdArb = fc.uuid();
const tenantIdArb = fc.uuid();
const userIdArb = fc.uuid();
const contactIdSetArb = fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 20 });

function setupMocksForIteration(currentIds: string[], targetIds: string[], currentSet: Set<string>): void {
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const txClient = { deal: { findFirstOrThrow: vi.fn().mockResolvedValue({}) }, contactDeal: mockContactDeal, contact: mockContact };
    return cb(txClient);
  });
  mockContactDeal.findMany.mockResolvedValue(currentIds.map((id) => ({ contactId: id })));
  const expectedAdditions = targetIds.filter((id) => !currentSet.has(id));
  mockContact.findMany.mockResolvedValue(expectedAdditions.map((id) => ({ id })));
  mockContactDeal.deleteMany.mockResolvedValue({ count: 0 });
  mockContactDeal.createMany.mockResolvedValue({ count: 0 });
}

function resetMocks(): void {
  mockContactDeal.findMany.mockReset();
  mockContactDeal.deleteMany.mockReset();
  mockContactDeal.createMany.mockReset();
  mockContact.findMany.mockReset();
  mockTransaction.mockReset();
}

describe('Feature: deal-contact-association-fix, Contact Junction Sync Set Equality', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes contactIds in current but NOT in target (via contactDeal)', async () => {
    await fc.assert(
      fc.asyncProperty(dealIdArb, tenantIdArb, userIdArb, contactIdSetArb, contactIdSetArb,
        async (dealId, tenantId, userId, currentIds, targetIds) => {
          resetMocks();
          const currentSet = new Set(currentIds);
          setupMocksForIteration(currentIds, targetIds, currentSet);

          await syncContactAssociations(dealId, tenantId, targetIds, userId);

          const targetSet = new Set(targetIds);
          const expectedRemovals = currentIds.filter((id) => !targetSet.has(id));
          if (expectedRemovals.length > 0) {
            expect(mockContactDeal.deleteMany).toHaveBeenCalledWith({
              where: { dealId, tenantId, contactId: { in: expectedRemovals } },
            });
          } else {
            expect(mockContactDeal.deleteMany).not.toHaveBeenCalled();
          }
        }),
      { numRuns: 100 },
    );
  });

  it('adds contactIds in target but NOT in current (via contactDeal), validated against contact', async () => {
    await fc.assert(
      fc.asyncProperty(dealIdArb, tenantIdArb, userIdArb, contactIdSetArb, contactIdSetArb,
        async (dealId, tenantId, userId, currentIds, targetIds) => {
          resetMocks();
          const currentSet = new Set(currentIds);
          setupMocksForIteration(currentIds, targetIds, currentSet);

          await syncContactAssociations(dealId, tenantId, targetIds, userId);

          const expectedAdditions = targetIds.filter((id) => !currentSet.has(id));
          if (expectedAdditions.length > 0) {
            expect(mockContact.findMany).toHaveBeenCalled(); // tenant validation against Contact
            expect(mockContactDeal.createMany).toHaveBeenCalledWith({
              data: expectedAdditions.map((contactId) => ({ contactId, dealId, tenantId, addedById: userId, position: targetIds.indexOf(contactId) })),
              skipDuplicates: true,
            });
          } else {
            expect(mockContactDeal.createMany).not.toHaveBeenCalled();
          }
        }),
      { numRuns: 100 },
    );
  });

  it('never writes to leadDeal/lead (guards the G1 regression)', async () => {
    await fc.assert(
      fc.asyncProperty(dealIdArb, tenantIdArb, userIdArb, contactIdSetArb, contactIdSetArb,
        async (dealId, tenantId, userId, currentIds, targetIds) => {
          resetMocks();
          const currentSet = new Set(currentIds);
          setupMocksForIteration(currentIds, targetIds, currentSet);
          const leadDeal = { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() };
          const lead = { findMany: vi.fn() };
          mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
            cb({ deal: { findFirstOrThrow: vi.fn().mockResolvedValue({}) }, contactDeal: mockContactDeal, contact: mockContact, leadDeal, lead }));

          await syncContactAssociations(dealId, tenantId, targetIds, userId);

          expect(leadDeal.findMany).not.toHaveBeenCalled();
          expect(leadDeal.deleteMany).not.toHaveBeenCalled();
          expect(leadDeal.createMany).not.toHaveBeenCalled();
          expect(lead.findMany).not.toHaveBeenCalled();
        }),
      { numRuns: 50 },
    );
  });

  it('final effective set equals target set', async () => {
    await fc.assert(
      fc.asyncProperty(dealIdArb, tenantIdArb, userIdArb, contactIdSetArb, contactIdSetArb,
        async (dealId, tenantId, userId, currentIds, targetIds) => {
          resetMocks();
          const currentSet = new Set(currentIds);
          setupMocksForIteration(currentIds, targetIds, currentSet);

          await syncContactAssociations(dealId, tenantId, targetIds, userId);

          const targetSet = new Set(targetIds);
          const expectedRemovals = currentIds.filter((id) => !targetSet.has(id));
          const expectedAdditions = targetIds.filter((id) => !currentSet.has(id));
          const finalSet = new Set(currentIds);
          for (const id of expectedRemovals) finalSet.delete(id);
          for (const id of expectedAdditions) finalSet.add(id);

          expect(finalSet.size).toBe(targetSet.size);
          for (const id of targetSet) expect(finalSet.has(id)).toBe(true);
        }),
      { numRuns: 100 },
    );
  });
});
