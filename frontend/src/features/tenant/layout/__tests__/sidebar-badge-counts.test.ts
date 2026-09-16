import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Tests for the sidebar badge count derivation logic in SidebarNav.
 *
 * In real-API mode: badge counts come from useModuleCounts (lightweight API fetch).
 * In mock mode: badge counts come from DataContext arrays (full in-memory dataset).
 *
 * These tests verify the pure derivation logic for both modes without mounting React.
 *
 * Key invariants:
 * 1. A count of 0 results in `undefined` (badge is hidden, not shown as "0")
 * 2. Archived records are excluded from mock-mode counts
 * 3. Real-API mode uses server total directly, with no client-side filtering
 * 4. Badge path mapping is consistent across leads/contacts/accounts/pipeline
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecordCounts {
  leads:    number;
  accounts: number;
  pipeline: number;
}

// ── Derivation logic (mirrors sidebar-nav.tsx getBadgeCount) ──────────────────

function getBadgeCount(path: string, counts: RecordCounts): number | undefined {
  const map: Record<string, number | undefined> = {
    leads:    counts.leads    || undefined,
    contacts: counts.leads    || undefined, // contacts shares same count as leads
    accounts: counts.accounts || undefined,
    pipeline: counts.pipeline || undefined,
  };
  return map[path];
}

function deriveRealApiCounts(apiCounts: Record<string, number>): RecordCounts {
  return {
    leads:    apiCounts['leads']    ?? 0,
    accounts: apiCounts['accounts'] ?? 0,
    pipeline: apiCounts['deals']    ?? 0,
  };
}

function deriveMockCounts(
  contacts:      Array<{ isArchived?: boolean }>,
  organizations: Array<{ isArchived?: boolean }>,
  deals:         Array<{ isArchived?: boolean }>,
): RecordCounts {
  return {
    leads:    contacts.filter((c) => !c.isArchived).length,
    accounts: organizations.filter((o) => !o.isArchived).length,
    pipeline: deals.filter((d) => !d.isArchived).length,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const countArb       = fc.nat({ max: 10_000 });
const posCountArb    = fc.integer({ min: 1, max: 10_000 });
const pathArb        = fc.constantFrom<string>('leads', 'contacts', 'accounts', 'pipeline');
const unknownPathArb = fc.constantFrom<string>(
  'dashboard', 'tasks', 'workflows', 'campaigns', 'billing',
  'settings', 'reports', 'admin', 'inbox', 'notifications',
);
const recordArb  = fc.record({ isArchived: fc.boolean() });
const recordsArb = fc.array(recordArb, { minLength: 0, maxLength: 50 });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SidebarNav — badge count visibility rule', () => {
  it('returns undefined (hide badge) when count is 0', () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        const counts: RecordCounts = { leads: 0, accounts: 0, pipeline: 0 };
        expect(getBadgeCount(path, counts)).toBeUndefined();
      }),
      { numRuns: 40 },
    );
  });

  it('returns a positive number (show badge) when the relevant count is positive', () => {
    // Test each path individually with the correct non-zero field
    const cases: Array<[string, RecordCounts]> = [
      ['leads',    { leads: 5, accounts: 0, pipeline: 0 }],
      ['contacts', { leads: 5, accounts: 0, pipeline: 0 }],
      ['accounts', { leads: 0, accounts: 5, pipeline: 0 }],
      ['pipeline', { leads: 0, accounts: 0, pipeline: 5 }],
    ];
    for (const [path, counts] of cases) {
      const result = getBadgeCount(path, counts);
      expect(typeof result, `path=${path}`).toBe('number');
      expect((result as number) > 0, `path=${path}`).toBe(true);
    }
  });

  it('for any positive count on the correct field, badge is shown', () => {
    fc.assert(
      fc.property(posCountArb, posCountArb, posCountArb, (leads, accounts, pipeline) => {
        expect(getBadgeCount('leads',    { leads, accounts, pipeline })).toBe(leads);
        expect(getBadgeCount('contacts', { leads, accounts, pipeline })).toBe(leads);
        expect(getBadgeCount('accounts', { leads, accounts, pipeline })).toBe(accounts);
        expect(getBadgeCount('pipeline', { leads, accounts, pipeline })).toBe(pipeline);
      }),
      { numRuns: 100 },
    );
  });

  it('returns undefined for unknown/unregistered nav paths', () => {
    fc.assert(
      fc.property(unknownPathArb, countArb, (path, n) => {
        const counts: RecordCounts = { leads: n, accounts: n, pipeline: n };
        expect(getBadgeCount(path, counts)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});

describe('SidebarNav — contacts/leads badge alias', () => {
  it('contacts and leads always return the same badge count', () => {
    fc.assert(
      fc.property(countArb, (leadsCount) => {
        const counts: RecordCounts = { leads: leadsCount, accounts: 0, pipeline: 0 };
        expect(getBadgeCount('leads', counts)).toBe(getBadgeCount('contacts', counts));
      }),
      { numRuns: 100 },
    );
  });
});

describe('SidebarNav — path routing', () => {
  it('pipeline badge uses pipeline count (deals)', () => {
    expect(getBadgeCount('pipeline', { leads: 0, accounts: 0, pipeline: 42 })).toBe(42);
  });

  it('accounts badge uses accounts count', () => {
    expect(getBadgeCount('accounts', { leads: 0, accounts: 15, pipeline: 0 })).toBe(15);
  });

  it('leads badge uses leads count', () => {
    expect(getBadgeCount('leads', { leads: 99, accounts: 0, pipeline: 0 })).toBe(99);
  });

  it('each path reads only its own count field', () => {
    fc.assert(
      fc.property(posCountArb, posCountArb, posCountArb, (leads, accounts, pipeline) => {
        // Leads/contacts only affected by leads field
        const leadsOnly: RecordCounts = { leads, accounts: 0, pipeline: 0 };
        expect(getBadgeCount('leads',    leadsOnly)).toBe(leads);
        expect(getBadgeCount('contacts', leadsOnly)).toBe(leads);
        expect(getBadgeCount('accounts', leadsOnly)).toBeUndefined();
        expect(getBadgeCount('pipeline', leadsOnly)).toBeUndefined();

        // Accounts only affected by accounts field
        const accountsOnly: RecordCounts = { leads: 0, accounts, pipeline: 0 };
        expect(getBadgeCount('accounts', accountsOnly)).toBe(accounts);
        expect(getBadgeCount('leads',    accountsOnly)).toBeUndefined();
        expect(getBadgeCount('pipeline', accountsOnly)).toBeUndefined();

        // Pipeline only affected by pipeline field
        const pipelineOnly: RecordCounts = { leads: 0, accounts: 0, pipeline };
        expect(getBadgeCount('pipeline', pipelineOnly)).toBe(pipeline);
        expect(getBadgeCount('leads',    pipelineOnly)).toBeUndefined();
        expect(getBadgeCount('accounts', pipelineOnly)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});

describe('SidebarNav — real-API mode count derivation', () => {
  it('maps leads → leads, accounts → accounts, deals → pipeline', () => {
    fc.assert(
      fc.property(countArb, countArb, countArb, (leads, accounts, deals) => {
        const derived = deriveRealApiCounts({ leads, accounts, deals });
        expect(derived.leads).toBe(leads);
        expect(derived.accounts).toBe(accounts);
        expect(derived.pipeline).toBe(deals);
      }),
      { numRuns: 100 },
    );
  });

  it('defaults to 0 when API count key is missing', () => {
    const counts = deriveRealApiCounts({});
    expect(counts.leads).toBe(0);
    expect(counts.accounts).toBe(0);
    expect(counts.pipeline).toBe(0);
  });

  it('partial API response fills missing keys with 0', () => {
    fc.assert(
      fc.property(posCountArb, (leadsCount) => {
        const derived = deriveRealApiCounts({ leads: leadsCount });
        expect(derived.leads).toBe(leadsCount);
        expect(derived.accounts).toBe(0);
        expect(derived.pipeline).toBe(0);
      }),
      { numRuns: 50 },
    );
  });
});

describe('SidebarNav — mock-mode archived record exclusion', () => {
  it('archived contacts are excluded from leads badge count', () => {
    fc.assert(
      fc.property(recordsArb, recordsArb, recordsArb, (contacts, orgs, deals) => {
        const counts   = deriveMockCounts(contacts, orgs, deals);
        const expected = contacts.filter((c) => !c.isArchived).length;
        expect(counts.leads).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('archived organizations are excluded from accounts badge count', () => {
    fc.assert(
      fc.property(recordsArb, recordsArb, recordsArb, (contacts, orgs, deals) => {
        const counts   = deriveMockCounts(contacts, orgs, deals);
        const expected = orgs.filter((o) => !o.isArchived).length;
        expect(counts.accounts).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('archived deals are excluded from pipeline badge count', () => {
    fc.assert(
      fc.property(recordsArb, recordsArb, recordsArb, (contacts, orgs, deals) => {
        const counts   = deriveMockCounts(contacts, orgs, deals);
        const expected = deals.filter((d) => !d.isArchived).length;
        expect(counts.pipeline).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('empty arrays yield zero counts', () => {
    const counts = deriveMockCounts([], [], []);
    expect(counts.leads).toBe(0);
    expect(counts.accounts).toBe(0);
    expect(counts.pipeline).toBe(0);
  });

  it('all-archived arrays yield zero counts', () => {
    const archived = [{ isArchived: true }, { isArchived: true }];
    const counts   = deriveMockCounts(archived, archived, archived);
    expect(counts.leads).toBe(0);
    expect(counts.accounts).toBe(0);
    expect(counts.pipeline).toBe(0);
  });

  it('all-active arrays yield full counts', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant({ isArchived: false as boolean }), { minLength: 0, maxLength: 30 }),
        fc.array(fc.constant({ isArchived: false as boolean }), { minLength: 0, maxLength: 30 }),
        fc.array(fc.constant({ isArchived: false as boolean }), { minLength: 0, maxLength: 30 }),
        (contacts, orgs, deals) => {
          const counts = deriveMockCounts(contacts, orgs, deals);
          expect(counts.leads).toBe(contacts.length);
          expect(counts.accounts).toBe(orgs.length);
          expect(counts.pipeline).toBe(deals.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});
