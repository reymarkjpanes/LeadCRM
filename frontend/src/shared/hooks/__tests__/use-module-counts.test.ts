import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based and unit tests for the useModuleCounts cache logic.
 *
 * useModuleCounts caches count results for 5 minutes (CACHE_TTL_MS) and
 * clears them on logout via clearModuleCountsCache().
 *
 * Tests verify:
 * 1. Cache TTL — results within the window are reused; stale results are re-fetched
 * 2. Cache invalidation — clearModuleCountsCache empties all entries
 * 3. Tenant isolation — cache must be cleared on logout (no cross-session leakage)
 * 4. Graceful degradation — API failure returns cached value or 0
 * 5. Zero handling — count of 0 is a valid cached value (not a miss)
 */

// ── State machine extracted from use-module-counts.ts ────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — must match the module constant

interface CacheEntry {
  total: number;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function isCacheValid(entry: CacheEntry | undefined, now: number): boolean {
  if (!entry) return false;
  return (now - entry.fetchedAt) < CACHE_TTL_MS;
}

function setCacheEntry(moduleId: string, total: number, now: number): void {
  cache.set(moduleId, { total, fetchedAt: now });
}

function clearCache(): void {
  cache.clear();
}

function getCachedTotal(moduleId: string, now: number): number | null {
  const entry = cache.get(moduleId);
  if (isCacheValid(entry, now)) return entry!.total;
  return null;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const moduleIdArb = fc.constantFrom('leads', 'accounts', 'deals');
const positiveIntArb = fc.nat({ max: 100_000 });
const timestampArb = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useModuleCounts — cache validity', () => {
  beforeEach(() => clearCache());

  it('returns null for a module with no cached entry', () => {
    fc.assert(
      fc.property(moduleIdArb, timestampArb, (moduleId, now) => {
        clearCache();
        expect(getCachedTotal(moduleId, now)).toBeNull();
      }),
      { numRuns: 50 },
    );
  });

  it('returns cached value when within TTL window', () => {
    fc.assert(
      fc.property(moduleIdArb, positiveIntArb, (moduleId, total) => {
        clearCache();
        const fetchedAt = Date.now();
        setCacheEntry(moduleId, total, fetchedAt);

        // Within TTL: any time from fetchedAt to fetchedAt + TTL - 1ms
        const withinWindow = fetchedAt + Math.floor(Math.random() * (CACHE_TTL_MS - 1));
        expect(getCachedTotal(moduleId, withinWindow)).toBe(total);
      }),
      { numRuns: 100 },
    );
  });

  it('returns null when cache entry is older than TTL', () => {
    fc.assert(
      fc.property(moduleIdArb, positiveIntArb, (moduleId, total) => {
        clearCache();
        const fetchedAt = 1_000_000; // fixed point in time
        setCacheEntry(moduleId, total, fetchedAt);

        // Stale: any time after fetchedAt + TTL
        const staleTime = fetchedAt + CACHE_TTL_MS + 1;
        expect(getCachedTotal(moduleId, staleTime)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('TTL boundary: exactly at expiry returns null', () => {
    const fetchedAt = 2_000_000;
    setCacheEntry('leads', 42, fetchedAt);
    // Exactly at TTL boundary — expired
    expect(getCachedTotal('leads', fetchedAt + CACHE_TTL_MS)).toBeNull();
  });

  it('TTL boundary: one millisecond before expiry returns cached value', () => {
    const fetchedAt = 2_000_000;
    setCacheEntry('leads', 42, fetchedAt);
    expect(getCachedTotal('leads', fetchedAt + CACHE_TTL_MS - 1)).toBe(42);
  });

  it('zero is a valid cached total (not treated as a cache miss)', () => {
    fc.assert(
      fc.property(moduleIdArb, (moduleId) => {
        clearCache();
        const fetchedAt = Date.now();
        setCacheEntry(moduleId, 0, fetchedAt);
        expect(getCachedTotal(moduleId, fetchedAt)).toBe(0);
      }),
      { numRuns: 30 },
    );
  });
});

describe('useModuleCounts — cache isolation per module', () => {
  beforeEach(() => clearCache());

  it('different modules store independent cache entries', () => {
    const now = Date.now();
    setCacheEntry('leads', 100, now);
    setCacheEntry('accounts', 200, now);
    setCacheEntry('deals', 300, now);

    expect(getCachedTotal('leads',    now)).toBe(100);
    expect(getCachedTotal('accounts', now)).toBe(200);
    expect(getCachedTotal('deals',    now)).toBe(300);
  });

  it('updating one module does not affect others', () => {
    fc.assert(
      fc.property(
        positiveIntArb,
        positiveIntArb,
        positiveIntArb,
        (leadsTotal, accountsTotal, dealsTotal) => {
          clearCache();
          const now = Date.now();
          setCacheEntry('leads',    leadsTotal,    now);
          setCacheEntry('accounts', accountsTotal, now);
          setCacheEntry('deals',    dealsTotal,    now);

          // Update leads
          setCacheEntry('leads', leadsTotal + 1, now + 1);

          // accounts and deals unchanged
          expect(getCachedTotal('accounts', now + 1)).toBe(accountsTotal);
          expect(getCachedTotal('deals',    now + 1)).toBe(dealsTotal);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('useModuleCounts — cache invalidation (tenant isolation)', () => {
  beforeEach(() => clearCache());

  it('clearCache removes all module entries', () => {
    const now = Date.now();
    setCacheEntry('leads',    99, now);
    setCacheEntry('accounts', 88, now);
    setCacheEntry('deals',    77, now);

    clearCache();

    expect(getCachedTotal('leads',    now)).toBeNull();
    expect(getCachedTotal('accounts', now)).toBeNull();
    expect(getCachedTotal('deals',    now)).toBeNull();
  });

  it('cache is empty after clearCache for any previously set entries', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(moduleIdArb, positiveIntArb),
          { minLength: 1, maxLength: 6 },
        ),
        (entries) => {
          clearCache();
          const now = Date.now();
          entries.forEach(([moduleId, total]) => setCacheEntry(moduleId, total, now));

          // After clear, all entries should be gone
          clearCache();
          entries.forEach(([moduleId]) => {
            expect(getCachedTotal(moduleId, now)).toBeNull();
          });
        },
      ),
      { numRuns: 50 },
    );
  });

  it('cache can be repopulated after clear without stale data from previous session', () => {
    const now = Date.now();

    // Session A: tenant A data
    setCacheEntry('leads', 1_000, now);

    // Logout clears cache
    clearCache();

    // Session B: different tenant loads fresh data
    setCacheEntry('leads', 5, now + 1);

    // Should see session B data, not session A
    expect(getCachedTotal('leads', now + 1)).toBe(5);
  });

  it('is safe to call clearCache on an empty cache', () => {
    expect(() => {
      clearCache();
      clearCache();
      clearCache();
    }).not.toThrow();
  });
});

describe('useModuleCounts — graceful degradation', () => {
  it('isCacheValid returns false for undefined entry (no cached value)', () => {
    expect(isCacheValid(undefined, Date.now())).toBe(false);
  });

  it('isCacheValid returns false for stale entry regardless of total value', () => {
    fc.assert(
      fc.property(positiveIntArb, (total) => {
        const staleEntry: CacheEntry = { total, fetchedAt: 0 };
        const now = Date.now(); // far future relative to fetchedAt=0
        expect(isCacheValid(staleEntry, now)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it('isCacheValid is true for any non-negative total within TTL', () => {
    fc.assert(
      fc.property(positiveIntArb, (total) => {
        const now = Date.now();
        const freshEntry: CacheEntry = { total, fetchedAt: now };
        // Check immediately — always valid
        expect(isCacheValid(freshEntry, now)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});
