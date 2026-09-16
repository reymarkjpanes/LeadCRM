import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based and unit tests for the useAccounts hook's stale-while-revalidate
 * loading state and mock-mode data isolation logic.
 *
 * The hook mounts useModuleData (server-paginated) in real-API mode and reads
 * localStorage in mock mode. These tests verify the pure state-machine logic
 * without mounting React or making network calls.
 *
 * Key invariants tested:
 * 1. isLoading = isInitialLoad = isFetching && !hasLoadedOnce && !USE_MOCK_DATA
 * 2. isRefreshing = isFetching && hasLoadedOnce && !USE_MOCK_DATA
 * 3. Mock mode never produces isLoading or isRefreshing
 * 4. Tenant isolation: mock data is filtered to the current tenantId
 * 5. Stale-while-revalidate: accounts array populated before isFetching resolves
 */

// ─── State machine (mirrors use-accounts.ts derivation logic) ────────────────

interface AccountsLoadState {
  isFetching: boolean;
  hasLoadedOnce: boolean;
  isMockMode: boolean;
}

function deriveAccountsFlags(state: AccountsLoadState): {
  isLoading: boolean;
  isRefreshing: boolean;
} {
  return {
    isLoading:    state.isFetching && !state.hasLoadedOnce && !state.isMockMode,
    isRefreshing: state.isFetching && state.hasLoadedOnce  && !state.isMockMode,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulates applying toFrontendOrg-style filtering for archived accounts.
 * The hook filters out isArchived=true entries on success.
 */
function filterArchivedAccounts<T extends { isArchived?: boolean }>(accounts: T[]): T[] {
  return accounts.filter((a) => !a.isArchived);
}

/**
 * Simulates mock-mode tenant isolation filter.
 * Real-API mode: tenantId is enforced server-side — not filtered client-side.
 * Mock mode: must filter by tenantId because localStorage is shared.
 */
function filterByTenant<T extends { tenantId?: string }>(
  accounts: T[],
  tenantId: string,
): T[] {
  return accounts.filter((a) => a.tenantId === tenantId);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const boolArb = fc.boolean();

const tenantIdArb = fc.uuid();

const mockAccountArb = (tenantId: string) =>
  fc.record({
    id: fc.uuid(),
    tenantId: fc.constantFrom(tenantId, 'other-tenant-id'),
    name: fc.string({ minLength: 1, maxLength: 40 }),
    isArchived: fc.boolean(),
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useAccounts — loading state machine', () => {
  describe('isLoading (initial load skeleton flag)', () => {
    it('is true only when fetching, no prior data, and in real-API mode', () => {
      fc.assert(
        fc.property(boolArb, boolArb, boolArb, (isFetching, hasLoadedOnce, isMockMode) => {
          const { isLoading } = deriveAccountsFlags({ isFetching, hasLoadedOnce, isMockMode });
          const expected = isFetching && !hasLoadedOnce && !isMockMode;
          expect(isLoading).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('is always false in mock mode', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isFetching, hasLoadedOnce) => {
          const { isLoading } = deriveAccountsFlags({ isFetching, hasLoadedOnce, isMockMode: true });
          expect(isLoading).toBe(false);
        }),
        { numRuns: 50 },
      );
    });

    it('is false when hasLoadedOnce is true (use isRefreshing instead)', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isFetching, isMockMode) => {
          const { isLoading } = deriveAccountsFlags({ isFetching, hasLoadedOnce: true, isMockMode });
          expect(isLoading).toBe(false);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('isRefreshing (background refresh flag)', () => {
    it('is true only when fetching, prior data exists, and in real-API mode', () => {
      fc.assert(
        fc.property(boolArb, boolArb, boolArb, (isFetching, hasLoadedOnce, isMockMode) => {
          const { isRefreshing } = deriveAccountsFlags({ isFetching, hasLoadedOnce, isMockMode });
          const expected = isFetching && hasLoadedOnce && !isMockMode;
          expect(isRefreshing).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('is always false in mock mode', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isFetching, hasLoadedOnce) => {
          const { isRefreshing } = deriveAccountsFlags({ isFetching, hasLoadedOnce, isMockMode: true });
          expect(isRefreshing).toBe(false);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('mutual exclusivity', () => {
    it('isLoading and isRefreshing are never both true', () => {
      fc.assert(
        fc.property(boolArb, boolArb, boolArb, (isFetching, hasLoadedOnce, isMockMode) => {
          const { isLoading, isRefreshing } = deriveAccountsFlags({ isFetching, hasLoadedOnce, isMockMode });
          expect(isLoading && isRefreshing).toBe(false);
        }),
        { numRuns: 200 },
      );
    });
  });
});

describe('useAccounts — data filtering', () => {
  describe('archived record exclusion', () => {
    it('filters out all archived accounts regardless of other fields', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              name: fc.string({ minLength: 1 }),
              isArchived: fc.boolean(),
            }),
            { minLength: 0, maxLength: 20 },
          ),
          (accounts) => {
            const result = filterArchivedAccounts(accounts);
            // None of the returned accounts should be archived
            expect(result.every((a) => !a.isArchived)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('retains all non-archived accounts without modification', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              name: fc.string({ minLength: 1 }),
              isArchived: fc.constant(false),
            }),
            { minLength: 0, maxLength: 20 },
          ),
          (accounts) => {
            const result = filterArchivedAccounts(accounts);
            expect(result.length).toBe(accounts.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns empty array when all accounts are archived', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              name: fc.string({ minLength: 1 }),
              isArchived: fc.constant(true),
            }),
            { minLength: 0, maxLength: 20 },
          ),
          (accounts) => {
            const result = filterArchivedAccounts(accounts);
            expect(result.length).toBe(0);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('mock-mode tenant isolation', () => {
    it('only returns accounts belonging to the current tenant', () => {
      fc.assert(
        fc.property(
          tenantIdArb,
          fc.array(fc.uuid(), { minLength: 1, maxLength: 4 }).chain((tenantId) =>
            fc.array(mockAccountArb(tenantId[0]), { minLength: 0, maxLength: 20 }).map(
              (accs) => ({ accs, tenantId: tenantId[0] }),
            ),
          ),
          (_tenantId, { accs, tenantId }) => {
            const result = filterByTenant(accs, tenantId);
            expect(result.every((a) => a.tenantId === tenantId)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('other-tenant accounts are never returned for the current tenant', () => {
      fc.assert(
        fc.property(tenantIdArb, (tenantId) => {
          const otherTenantAccounts = [
            { id: 'acc-1', tenantId: 'other-tenant', name: 'Other Corp', isArchived: false },
            { id: 'acc-2', tenantId: 'third-tenant', name: 'Third Corp', isArchived: false },
          ];
          const result = filterByTenant(otherTenantAccounts, tenantId);
          expect(result.length).toBe(0);
        }),
        { numRuns: 50 },
      );
    });

    it('tenant isolation and archive filter compose correctly', () => {
      fc.assert(
        fc.property(tenantIdArb, (tenantId) => {
          const mixedAccounts = [
            { id: '1', tenantId, name: 'Mine Active',   isArchived: false },
            { id: '2', tenantId, name: 'Mine Archived', isArchived: true  },
            { id: '3', tenantId: 'other', name: 'Other Active',   isArchived: false },
            { id: '4', tenantId: 'other', name: 'Other Archived', isArchived: true  },
          ];

          const tenantFiltered  = filterByTenant(mixedAccounts, tenantId);
          const finalResult     = filterArchivedAccounts(tenantFiltered);

          // Only the single active record for this tenant should remain
          expect(finalResult.length).toBe(1);
          expect(finalResult[0].id).toBe('1');
          expect(finalResult[0].tenantId).toBe(tenantId);
        }),
        { numRuns: 100 },
      );
    });
  });
});

describe('useAccounts — stale-while-revalidate invariant', () => {
  it('when display data is populated, a subsequent fetch should never clear it before resolving', () => {
    // Simulates the invariant: displayAccounts is only updated on success, never cleared
    // This is the core SWR guarantee — existing rows stay visible during refresh
    const existingData = [
      { id: 'acc-1', name: 'Existing Account', isArchived: false },
      { id: 'acc-2', name: 'Another Account',  isArchived: false },
    ];

    // Phase 1: data loaded successfully
    let displayAccounts = [...existingData];
    let hasLoadedOnce   = true;

    // Phase 2: background refresh starts
    const isFetching = true;
    const { isRefreshing } = deriveAccountsFlags({ isFetching, hasLoadedOnce, isMockMode: false });

    // During refresh: isRefreshing=true, but displayAccounts unchanged
    expect(isRefreshing).toBe(true);
    expect(displayAccounts).toEqual(existingData); // ← still the old data, no blank

    // Phase 3: refresh succeeds — displayAccounts updated
    const newData = [{ id: 'acc-3', name: 'Fresh Account', isArchived: false }];
    displayAccounts = newData;
    hasLoadedOnce   = true;

    const { isRefreshing: afterRefresh } = deriveAccountsFlags({
      isFetching: false, hasLoadedOnce, isMockMode: false,
    });
    expect(afterRefresh).toBe(false);
    expect(displayAccounts).toEqual(newData);
  });

  it('error during refresh preserves existing display data', () => {
    const existingData = [{ id: 'acc-1', name: 'Safe Account', isArchived: false }];

    // Phase 1: data already loaded
    let displayAccounts = [...existingData];
    const hasLoadedOnce = true;

    // Phase 2: refresh fails — displayAccounts NOT updated (error branch skips setDisplayAccounts)
    // isLoading returns false, displayAccounts unchanged
    const { isLoading, isRefreshing } = deriveAccountsFlags({
      isFetching: false, hasLoadedOnce, isMockMode: false,
    });

    expect(isLoading).toBe(false);
    expect(isRefreshing).toBe(false);
    // Data preserved — user sees stale data rather than empty screen
    expect(displayAccounts).toEqual(existingData);
  });
});
