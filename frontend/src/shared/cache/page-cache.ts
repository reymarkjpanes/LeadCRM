'use client';

/**
 * page-cache.ts — Cross-route client-side data cache.
 *
 * Plain TypeScript module (NOT a React hook). Stores the last successful fetch
 * result for each module+params combination in a module-level Map that survives
 * React component mount/unmount cycles.
 *
 * Usage pattern:
 *   On mount:    const cached = getPageCache('leads', tenantId, params)
 *                if cached → show immediately, trigger background refresh if isStale
 *   On success:  setPageCache('leads', tenantId, params, data)
 *   On mutation: invalidatePageCache('leads', tenantId)
 *   On logout:   clearPageCache()
 *
 * Security note: tenantId in the cache key prevents accidental cross-tenant
 * data mixing in the client-side cache. This is NOT an authorization mechanism —
 * all authorization and tenant isolation must continue to be enforced by the
 * backend/API on every request.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  module: string;
  expiresAt: number;
  data:      T;
  fetchedAt: number;  // Date.now() when written
  staleAt:   number;  // Date.now() when background refresh should fire
  tenantId:  string;  // double-checked on read for safety
}

interface ModuleCacheConfig {
  /** How long data remains usable before eviction (milliseconds). */
  ttlMs:   number;
  /** How soon after writing a background refresh should fire (milliseconds). */
  staleMs: number;
}

export interface CacheResult<T> {
  data:    T;
  /** true → data is shown but a background refresh should fire immediately. */
  isStale: boolean;
}

// ── Per-module configuration ──────────────────────────────────────────────────
// Class A — server-list data (cache strongly)
// Class B — dashboard/reporting (cache briefly)
// Class C — highly dynamic (shorter freshness)

const MODULE_CONFIG: Readonly<Record<string, ModuleCacheConfig>> = {
  // Class A
  leads:         { ttlMs: 5 * 60_000, staleMs:      60_000 },
  accounts:      { ttlMs: 5 * 60_000, staleMs:      60_000 },
  contacts:      { ttlMs: 5 * 60_000, staleMs:      60_000 },
  campaigns:     { ttlMs: 5 * 60_000, staleMs: 2 * 60_000 },
  // Class B
  reports:       { ttlMs: 2 * 60_000, staleMs: 2 * 60_000 },
  pipeline:      { ttlMs: 2 * 60_000, staleMs:      60_000 },
  // Class C
  activities:    { ttlMs:      60_000, staleMs:      60_000 },
  notifications: { ttlMs:      60_000, staleMs:      30_000 },
};

const DEFAULT_CONFIG: ModuleCacheConfig = { ttlMs: 5 * 60_000, staleMs: 60_000 };

// ── Module-level storage ──────────────────────────────────────────────────────
// Survives React re-renders and component unmounts.
// Cleared atomically on logout to prevent cross-tenant leakage.

const pageCache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 100;
let generation = 0;
const invalidationListeners = new Set<(module: string, tenantId?: string) => void>();
export function subscribePageCacheInvalidation(listener: (module: string, tenantId?: string) => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}
const moduleVersions = new Map<string, number>();

/** Reject responses started before logout or a mutation invalidated this module. */
export function createPageCacheGuard(module: string): () => boolean {
  const startedGeneration = generation;
  const version = moduleVersions.get(module) ?? 0;
  return () => generation === startedGeneration && (moduleVersions.get(module) ?? 0) === version;
}

// ── Deterministic recursive serializer ───────────────────────────────────────
// Handles nested objects (e.g. FilterCondition[]) without ambiguity.
// Arrays preserve order — filter arrays are ordered.
// Object keys are sorted alphabetically at every nesting level.

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const sorted = (Object.entries(value as Record<string, unknown>))
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return '{' + sorted.join(',') + '}';
}

/**
 * Build a deterministic, tenant-scoped cache key.
 * Modules must never construct keys manually — use this function only.
 */
export function buildCacheKey(
  module:   string,
  tenantId: string,
  params:   Record<string, unknown>,
): string {
  return JSON.stringify([tenantId, module, stableStringify(params)]);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read a cached result. Returns null on cache miss or TTL expiry.
 * The `isStale` flag indicates a background refresh should fire even though
 * data is present and will be shown immediately.
 */
export function getPageCache<T>(
  module:   string,
  tenantId: string,
  params:   Record<string, unknown>,
): CacheResult<T> | null {
  if (!tenantId || typeof window === 'undefined') return null;
  const key   = buildCacheKey(module, tenantId, params);
  const entry = pageCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  // Belt-and-suspenders: reject entry if tenantId mismatches
  if (entry.tenantId !== tenantId) { pageCache.delete(key); return null; }
  const now    = Date.now();
  // Evict on TTL expiry
  if (now >= entry.expiresAt) { pageCache.delete(key); return null; }
  return { data: entry.data, isStale: now >= entry.staleAt };
}

/**
 * Write a successful fetch result to cache.
 * Silently no-ops if tenantId is empty (unauthenticated state).
 */
export function setPageCache<T>(
  module:   string,
  tenantId: string,
  params:   Record<string, unknown>,
  data:     T,
): void {
  if (!tenantId || typeof window === 'undefined') return;
  const key    = buildCacheKey(module, tenantId, params);
  const config = MODULE_CONFIG[module] ?? DEFAULT_CONFIG;
  const now = Date.now();
  // Expired search/filter entries must not accumulate for the lifetime of the tab.
  for (const [entryKey, entry] of pageCache) {
    if (now >= entry.expiresAt) pageCache.delete(entryKey);
  }
  pageCache.delete(key);
  if (pageCache.size >= MAX_ENTRIES) pageCache.delete(pageCache.keys().next().value!);
  pageCache.set(key, {
    module,
    expiresAt: now + config.ttlMs,
    data,
    fetchedAt: now,
    staleAt:   now + config.staleMs,
    tenantId,
  });
}

/**
 * Evict all cache entries for a specific module + tenant.
 * Call after mutations that affect a module's list view.
 */
export function invalidatePageCache(module: string, tenantId?: string, notify = true): void {
  if (tenantId === '') return;
  moduleVersions.set(module, (moduleVersions.get(module) ?? 0) + 1);
  for (const [key, entry] of pageCache) {
    if (entry.module === module && (tenantId === undefined || entry.tenantId === tenantId)) pageCache.delete(key);
  }
  if (notify) invalidationListeners.forEach(listener => listener(module, tenantId));
}

/**
 * Clear all cached data across all modules and tenants.
 * Called on logout to prevent cross-session data leakage. Auth refreshes can
 * notify mounted pages to discard old data and request the current scope again.
 */
export function clearPageCache(notify = false): void {
  generation++;
  moduleVersions.clear();
  pageCache.clear();
  if (notify) invalidationListeners.forEach(listener => listener('*'));
}

/** Diagnostic helper — used in tests only. */
export function getPageCacheSize(): number {
  return pageCache.size;
}
