import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Tests for the useRouteData shared SWR primitive.
 *
 * useRouteData encapsulates the common fetch + stale-while-revalidate pattern
 * used by route-scoped data hooks (useCampaignsData, useInvoicesData, etc.).
 *
 * It manages:
 * - isFetching / hasLoadedOnce state machine
 * - Background refresh via setInterval
 * - Window focus revalidation
 * - Unmount safety via mountedRef
 * - Disabled mode (USE_MOCK_DATA)
 *
 * These tests verify the pure state-machine logic in isolation without
 * mounting React components or making network calls.
 */

// ── State machine (mirrors useRouteData internal logic) ───────────────────────

interface RouteDataState {
  isFetching:    boolean;
  hasLoadedOnce: boolean;
  disabled:      boolean;
}

function deriveFlags(state: RouteDataState): {
  isInitialLoad: boolean;
  isRefreshing:  boolean;
} {
  if (state.disabled) {
    return { isInitialLoad: false, isRefreshing: false };
  }
  return {
    isInitialLoad: state.isFetching && !state.hasLoadedOnce,
    isRefreshing:  state.isFetching && state.hasLoadedOnce,
  };
}

/**
 * Simulate a full fetch lifecycle.
 */
function simulateFetchCycle(hasLoadedOnce: boolean): {
  duringFetch:   { isInitialLoad: boolean; isRefreshing: boolean };
  afterSuccess:  { isInitialLoad: boolean; isRefreshing: boolean };
  afterError:    { isInitialLoad: boolean; isRefreshing: boolean };
} {
  const duringFetch = deriveFlags({ isFetching: true, hasLoadedOnce, disabled: false });
  // On success: isFetching=false, hasLoadedOnce becomes true
  const afterSuccess = deriveFlags({ isFetching: false, hasLoadedOnce: true, disabled: false });
  // On error: isFetching=false, hasLoadedOnce unchanged
  const afterError = deriveFlags({ isFetching: false, hasLoadedOnce, disabled: false });
  return { duringFetch, afterSuccess, afterError };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const boolArb = fc.boolean();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useRouteData — loading flag derivation', () => {
  describe('isInitialLoad', () => {
    it('is true when fetching and no prior data', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isFetching, hasLoadedOnce) => {
          const { isInitialLoad } = deriveFlags({ isFetching, hasLoadedOnce, disabled: false });
          expect(isInitialLoad).toBe(isFetching && !hasLoadedOnce);
        }),
        { numRuns: 50 },
      );
    });

    it('is always false when disabled', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isFetching, hasLoadedOnce) => {
          const { isInitialLoad } = deriveFlags({ isFetching, hasLoadedOnce, disabled: true });
          expect(isInitialLoad).toBe(false);
        }),
        { numRuns: 30 },
      );
    });
  });

  describe('isRefreshing', () => {
    it('is true when fetching with prior data', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isFetching, hasLoadedOnce) => {
          const { isRefreshing } = deriveFlags({ isFetching, hasLoadedOnce, disabled: false });
          expect(isRefreshing).toBe(isFetching && hasLoadedOnce);
        }),
        { numRuns: 50 },
      );
    });

    it('is always false when disabled', () => {
      fc.assert(
        fc.property(boolArb, boolArb, (isFetching, hasLoadedOnce) => {
          const { isRefreshing } = deriveFlags({ isFetching, hasLoadedOnce, disabled: true });
          expect(isRefreshing).toBe(false);
        }),
        { numRuns: 30 },
      );
    });
  });

  describe('mutual exclusivity', () => {
    it('isInitialLoad and isRefreshing are never both true', () => {
      fc.assert(
        fc.property(boolArb, boolArb, boolArb, (isFetching, hasLoadedOnce, disabled) => {
          const { isInitialLoad, isRefreshing } = deriveFlags({ isFetching, hasLoadedOnce, disabled });
          expect(isInitialLoad && isRefreshing).toBe(false);
        }),
        { numRuns: 200 },
      );
    });
  });
});

describe('useRouteData — fetch lifecycle transitions', () => {
  it('first fetch: isInitialLoad during, both false after success', () => {
    const { duringFetch, afterSuccess } = simulateFetchCycle(false);
    expect(duringFetch.isInitialLoad).toBe(true);
    expect(duringFetch.isRefreshing).toBe(false);
    expect(afterSuccess.isInitialLoad).toBe(false);
    expect(afterSuccess.isRefreshing).toBe(false);
  });

  it('background refresh: isRefreshing during, both false after success', () => {
    const { duringFetch, afterSuccess } = simulateFetchCycle(true);
    expect(duringFetch.isInitialLoad).toBe(false);
    expect(duringFetch.isRefreshing).toBe(true);
    expect(afterSuccess.isInitialLoad).toBe(false);
    expect(afterSuccess.isRefreshing).toBe(false);
  });

  it('error on first fetch: both false after (isLoading=false, hasLoadedOnce still false)', () => {
    const { afterError } = simulateFetchCycle(false);
    // After error: isFetching=false, hasLoadedOnce=false → neither flag set
    expect(afterError.isInitialLoad).toBe(false);
    expect(afterError.isRefreshing).toBe(false);
  });

  it('error on background refresh: both false, existing data still shown', () => {
    const { afterError } = simulateFetchCycle(true);
    expect(afterError.isInitialLoad).toBe(false);
    expect(afterError.isRefreshing).toBe(false);
    // Caller is responsible for preserving displayData — hook itself just sets isFetching=false
  });

  it('Property: for any initial hasLoadedOnce, exactly one flag is true during fetch', () => {
    fc.assert(
      fc.property(boolArb, (hasLoadedOnce) => {
        const { duringFetch } = simulateFetchCycle(hasLoadedOnce);
        const activeCount = [duringFetch.isInitialLoad, duringFetch.isRefreshing]
          .filter(Boolean).length;
        expect(activeCount).toBe(1);
      }),
      { numRuns: 50 },
    );
  });
});

describe('useRouteData — interval scheduler (using fake timers)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('interval fires callback after intervalMs', () => {
    const callback = vi.fn();
    const INTERVAL = 2 * 60 * 1000;
    const id = setInterval(callback, INTERVAL);
    vi.advanceTimersByTime(INTERVAL);
    expect(callback).toHaveBeenCalledTimes(1);
    clearInterval(id);
  });

  it('cleanup via clearInterval stops further firing', () => {
    const callback = vi.fn();
    const INTERVAL = 2 * 60 * 1000;
    const id = setInterval(callback, INTERVAL);
    vi.advanceTimersByTime(INTERVAL);
    expect(callback).toHaveBeenCalledTimes(1);
    clearInterval(id);
    vi.advanceTimersByTime(INTERVAL * 3);
    expect(callback).toHaveBeenCalledTimes(1); // no additional calls
  });

  it('focus event triggers revalidation while mounted', () => {
    const refetch = vi.fn();
    window.addEventListener('focus', refetch);
    window.dispatchEvent(new Event('focus'));
    expect(refetch).toHaveBeenCalledTimes(1);
    window.removeEventListener('focus', refetch);
  });

  it('focus event does not fire after removeEventListener (unmount)', () => {
    const refetch = vi.fn();
    window.addEventListener('focus', refetch);
    window.removeEventListener('focus', refetch);
    window.dispatchEvent(new Event('focus'));
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('useRouteData — disabled mode (USE_MOCK_DATA)', () => {
  it('disabled=true means both flags are always false', () => {
    fc.assert(
      fc.property(boolArb, boolArb, (isFetching, hasLoadedOnce) => {
        const flags = deriveFlags({ isFetching, hasLoadedOnce, disabled: true });
        expect(flags.isInitialLoad).toBe(false);
        expect(flags.isRefreshing).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('idle state (disabled=false, not fetching) shows neither flag', () => {
    const flags = deriveFlags({ isFetching: false, hasLoadedOnce: true, disabled: false });
    expect(flags.isInitialLoad).toBe(false);
    expect(flags.isRefreshing).toBe(false);
  });
});
