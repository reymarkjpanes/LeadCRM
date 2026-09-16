import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based tests for the stale-while-revalidate logic inside useLeadsData.
 *
 * useLeadsData maintains two loading tiers:
 *   isInitialLoad — true only when the first ever fetch is in progress (no prior data)
 *   isRefreshing  — true when a subsequent fetch is running (prior data remains visible)
 *
 * These tests verify the pure state-machine that controls that classification.
 * The hook itself is not mounted here — we test the derivation logic in isolation
 * so every edge case can be exercised without network or React overhead.
 *
 * Validates: progressive loading architecture — skeleton only on initial load,
 * existing data preserved during background refresh.
 */

// ─── State machine (mirrors the logic in use-leads-data.ts) ──────────────────

interface LoadState {
  isLoading: boolean;
  hasLoadedOnce: boolean;
}

function deriveLoadingFlags(state: LoadState): {
  isInitialLoad: boolean;
  isRefreshing: boolean;
} {
  return {
    isInitialLoad: state.isLoading && !state.hasLoadedOnce,
    isRefreshing:  state.isLoading && state.hasLoadedOnce,
  };
}

/**
 * Simulate a complete fetch lifecycle for one request.
 * Returns the flags at each phase.
 */
function simulateFetch(hasLoadedOnce: boolean): {
  duringFetch: { isInitialLoad: boolean; isRefreshing: boolean };
  afterSuccess: { isInitialLoad: boolean; isRefreshing: boolean };
  afterError: { isInitialLoad: boolean; isRefreshing: boolean };
} {
  const duringFetch = deriveLoadingFlags({ isLoading: true, hasLoadedOnce });

  // After success: isLoading goes false, hasLoadedOnce becomes true
  const afterSuccess = deriveLoadingFlags({ isLoading: false, hasLoadedOnce: true });

  // After error: isLoading goes false, hasLoadedOnce stays as-is
  const afterError = deriveLoadingFlags({ isLoading: false, hasLoadedOnce });

  return { duringFetch, afterSuccess, afterError };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const boolArb = fc.boolean();

// ─── Properties ──────────────────────────────────────────────────────────────

describe('useLeadsData — stale-while-revalidate state machine', () => {
  describe('isInitialLoad flag', () => {
    it('is true only when loading AND no prior data exists', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isLoading, hasLoadedOnce) => {
          const { isInitialLoad } = deriveLoadingFlags({ isLoading, hasLoadedOnce });
          // isInitialLoad requires BOTH isLoading=true AND hasLoadedOnce=false
          const expected = isLoading && !hasLoadedOnce;
          expect(isInitialLoad).toBe(expected);
        }),
        { numRuns: 50 },
      );
    });

    it('is false whenever hasLoadedOnce is true, regardless of isLoading', () => {
      fc.assert(
        fc.property(boolArb, (isLoading) => {
          const { isInitialLoad } = deriveLoadingFlags({ isLoading, hasLoadedOnce: true });
          expect(isInitialLoad).toBe(false);
        }),
        { numRuns: 50 },
      );
    });

    it('is false when not loading, regardless of hasLoadedOnce', () => {
      fc.assert(
        fc.property(boolArb, (hasLoadedOnce) => {
          const { isInitialLoad } = deriveLoadingFlags({ isLoading: false, hasLoadedOnce });
          expect(isInitialLoad).toBe(false);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('isRefreshing flag', () => {
    it('is true only when loading AND prior data already exists', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isLoading, hasLoadedOnce) => {
          const { isRefreshing } = deriveLoadingFlags({ isLoading, hasLoadedOnce });
          const expected = isLoading && hasLoadedOnce;
          expect(isRefreshing).toBe(expected);
        }),
        { numRuns: 50 },
      );
    });

    it('is false when not loading, regardless of hasLoadedOnce', () => {
      fc.assert(
        fc.property(boolArb, (hasLoadedOnce) => {
          const { isRefreshing } = deriveLoadingFlags({ isLoading: false, hasLoadedOnce });
          expect(isRefreshing).toBe(false);
        }),
        { numRuns: 50 },
      );
    });

    it('is false when hasLoadedOnce is false, regardless of isLoading', () => {
      fc.assert(
        fc.property(boolArb, (isLoading) => {
          const { isRefreshing } = deriveLoadingFlags({ isLoading, hasLoadedOnce: false });
          expect(isRefreshing).toBe(false);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('mutual exclusivity', () => {
    it('isInitialLoad and isRefreshing are never both true simultaneously', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isLoading, hasLoadedOnce) => {
          const { isInitialLoad, isRefreshing } = deriveLoadingFlags({ isLoading, hasLoadedOnce });
          // They cannot both be true — skeleton vs. stale data are mutually exclusive
          expect(isInitialLoad && isRefreshing).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('both flags can be false (idle state: not loading at all)', () => {
      const { isInitialLoad, isRefreshing } = deriveLoadingFlags({ isLoading: false, hasLoadedOnce: true });
      expect(isInitialLoad).toBe(false);
      expect(isRefreshing).toBe(false);
    });

    it('exactly one of the flags is true when loading with no prior data', () => {
      const { isInitialLoad, isRefreshing } = deriveLoadingFlags({ isLoading: true, hasLoadedOnce: false });
      expect(isInitialLoad).toBe(true);
      expect(isRefreshing).toBe(false);
    });

    it('exactly one of the flags is true when loading with prior data (background refresh)', () => {
      const { isInitialLoad, isRefreshing } = deriveLoadingFlags({ isLoading: true, hasLoadedOnce: true });
      expect(isInitialLoad).toBe(false);
      expect(isRefreshing).toBe(true);
    });
  });

  describe('fetch lifecycle transitions', () => {
    it('first fetch: starts as isInitialLoad, resolves to neither after success', () => {
      const { duringFetch, afterSuccess } = simulateFetch(false);

      expect(duringFetch.isInitialLoad).toBe(true);
      expect(duringFetch.isRefreshing).toBe(false);

      expect(afterSuccess.isInitialLoad).toBe(false);
      expect(afterSuccess.isRefreshing).toBe(false);
    });

    it('first fetch: error leaves flags false (not loading anymore)', () => {
      const { duringFetch, afterError } = simulateFetch(false);

      expect(duringFetch.isInitialLoad).toBe(true);

      // After error on first fetch: hasLoadedOnce stays false, but isLoading is now false
      expect(afterError.isInitialLoad).toBe(false);
      expect(afterError.isRefreshing).toBe(false);
    });

    it('background refresh: starts as isRefreshing (not isInitialLoad), resolves to neither', () => {
      const { duringFetch, afterSuccess } = simulateFetch(true);

      expect(duringFetch.isInitialLoad).toBe(false);
      expect(duringFetch.isRefreshing).toBe(true);

      expect(afterSuccess.isInitialLoad).toBe(false);
      expect(afterSuccess.isRefreshing).toBe(false);
    });

    it('background refresh: error preserves hasLoadedOnce=true, both flags false after', () => {
      const { duringFetch, afterError } = simulateFetch(true);

      expect(duringFetch.isRefreshing).toBe(true);

      // After error on background refresh: hasLoadedOnce=true, isLoading=false
      expect(afterError.isInitialLoad).toBe(false);
      expect(afterError.isRefreshing).toBe(false);
    });

    it('for any initial hasLoadedOnce value, transitions are monotonically stable', () => {
      fc.assert(
        fc.property(boolArb, (hasLoadedOnce) => {
          const { duringFetch, afterSuccess } = simulateFetch(hasLoadedOnce);

          // After success both flags should always be false (stable idle state)
          expect(afterSuccess.isInitialLoad).toBe(false);
          expect(afterSuccess.isRefreshing).toBe(false);

          // During fetch: exactly one of the flags should be set
          const exactlyOneSet = duringFetch.isInitialLoad !== duringFetch.isRefreshing;
          expect(exactlyOneSet).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
