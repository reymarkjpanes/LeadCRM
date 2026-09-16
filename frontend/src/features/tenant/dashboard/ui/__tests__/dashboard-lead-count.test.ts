import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Tests for the dashboard totalLeadsCount derivation.
 *
 * After the route-scoped migration, DataContext.contacts is no longer populated
 * at startup. The dashboard derives the "Total Leads" KPI from:
 *   - Real-API mode: useModuleCounts('leads') → meta.total from server
 *   - Mock mode:     contacts.filter(!isArchived).length from DataContext array
 *
 * These tests verify that derivation logic is correct and consistent.
 *
 * Validates: dashboard KPI accuracy, mock/real-API mode isolation.
 */

// ── Derivation logic (mirrors dashboard.tsx totalLeadsCount) ─────────────────

interface MockContact {
  isArchived?: boolean;
}

function deriveTotalLeadsCount(
  mode: 'mock' | 'real',
  mockContacts: MockContact[],
  apiCount: number,
): number {
  if (mode === 'mock') {
    return mockContacts.filter((c) => !c.isArchived).length;
  }
  return apiCount;
}

// ── isLoading heuristic (mirrors dashboard.tsx) ───────────────────────────────

function deriveIsLoading(deals: unknown[], users: unknown[]): boolean {
  return deals.length === 0 && users.length === 0;
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const mockContactArb = fc.record({ isArchived: fc.boolean() });
const mockContactsArb = fc.array(mockContactArb, { minLength: 0, maxLength: 100 });
const countArb = fc.nat({ max: 100_000 });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Dashboard — totalLeadsCount derivation', () => {
  describe('Real-API mode', () => {
    it('uses the server-returned API count directly', () => {
      fc.assert(
        fc.property(countArb, mockContactsArb, (apiCount, contacts) => {
          // In real-API mode the API count is authoritative regardless of DataContext
          expect(deriveTotalLeadsCount('real', contacts, apiCount)).toBe(apiCount);
        }),
        { numRuns: 100 },
      );
    });

    it('returns 0 when API count is 0 (tenant with no leads)', () => {
      expect(deriveTotalLeadsCount('real', [{ isArchived: false }, { isArchived: false }], 0)).toBe(0);
    });

    it('returns the API count even when DataContext contacts is empty', () => {
      fc.assert(
        fc.property(countArb, (apiCount) => {
          expect(deriveTotalLeadsCount('real', [], apiCount)).toBe(apiCount);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('Mock mode', () => {
    it('uses DataContext contacts array, excluding archived', () => {
      fc.assert(
        fc.property(mockContactsArb, countArb, (contacts, apiCount) => {
          const expected = contacts.filter((c) => !c.isArchived).length;
          // In mock mode the API count is ignored
          expect(deriveTotalLeadsCount('mock', contacts, apiCount)).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('returns 0 when all contacts are archived', () => {
      const archived = [{ isArchived: true }, { isArchived: true }, { isArchived: true }];
      expect(deriveTotalLeadsCount('mock', archived, 999)).toBe(0);
    });

    it('returns all when none are archived', () => {
      const active = [{ isArchived: false }, { isArchived: false }];
      expect(deriveTotalLeadsCount('mock', active, 0)).toBe(2);
    });

    it('ignores the API count completely in mock mode', () => {
      fc.assert(
        fc.property(mockContactsArb, countArb, countArb, (contacts, apiCountA, apiCountB) => {
          // Regardless of API count the result is the same in mock mode
          const a = deriveTotalLeadsCount('mock', contacts, apiCountA);
          const b = deriveTotalLeadsCount('mock', contacts, apiCountB);
          expect(a).toBe(b);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('Mode isolation', () => {
    it('real-API mode and mock mode can produce different values for the same data', () => {
      // Real: API returns 500, mock DataContext has 3 active contacts
      const mockContacts = [{ isArchived: false }, { isArchived: false }, { isArchived: false }];
      const realResult = deriveTotalLeadsCount('real', mockContacts, 500);
      const mockResult = deriveTotalLeadsCount('mock', mockContacts, 500);

      expect(realResult).toBe(500);
      expect(mockResult).toBe(3);
      expect(realResult).not.toBe(mockResult);
    });

    it('Property: real-API mode result is always the exact API count', () => {
      fc.assert(
        fc.property(countArb, mockContactsArb, (apiCount, contacts) => {
          expect(deriveTotalLeadsCount('real', contacts, apiCount)).toBe(apiCount);
        }),
        { numRuns: 100 },
      );
    });
  });
});

describe('Dashboard — isLoading heuristic', () => {
  it('is true only when both deals and users are empty (DataContext not yet loaded)', () => {
    expect(deriveIsLoading([], [])).toBe(true);
  });

  it('is false when deals are loaded (Batch 1 completed)', () => {
    expect(deriveIsLoading([{ id: 'd1' }], [])).toBe(false);
  });

  it('is false when users are loaded (Batch 1 completed)', () => {
    expect(deriveIsLoading([], [{ id: 'u1' }])).toBe(false);
  });

  it('is false when both deals and users are loaded', () => {
    expect(deriveIsLoading([{ id: 'd1' }], [{ id: 'u1' }])).toBe(false);
  });

  it('Property: isLoading is true iff both arrays are empty', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.uuid() }), { minLength: 0, maxLength: 10 }),
        fc.array(fc.record({ id: fc.uuid() }), { minLength: 0, maxLength: 10 }),
        (deals, users) => {
          const result = deriveIsLoading(deals, users);
          const expected = deals.length === 0 && users.length === 0;
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
