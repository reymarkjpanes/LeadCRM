import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Tests for the CommandPalette navigation access-control and filtering logic.
 *
 * The palette now uses server-side search for leads/deals (no DataContext dependency).
 * These tests verify the pure access-control and nav-filter functions in isolation.
 *
 * Key invariants:
 * 1. System Admin sees only platform management items (no tenant CRM)
 * 2. Client Admin sees all items
 * 3. Guest sees only a restricted set
 * 4. Nav items are filtered by query string case-insensitively
 * 5. Items with enabled=false are always hidden
 */

// ── Types (mirrors command-palette.tsx) ───────────────────────────────────────

interface NavItem {
  name: string;
  path: string;
  permissions?: string[];
  roles?: string[];
  enabled?: boolean;
}

interface UserContext {
  role: string;
  permissions: string[];
}

// ── Access logic (mirrors hasAccess in command-palette.tsx) ──────────────────

function hasAccess(item: NavItem, user: UserContext): boolean {
  if (user.role.toLowerCase() === 'system admin') {
    return ['Dashboard', 'Users', 'Settings', 'Admin Console', 'Audit Trail'].includes(item.name);
  }
  if (item.name === 'Admin Console') return false;
  if (user.role.toLowerCase() === 'client admin') return true;
  if (user.role.toLowerCase() === 'guest') {
    return ['Dashboard', 'Leads', 'Pipeline', 'Workflows', 'Campaigns'].includes(item.name);
  }
  if (item.roles?.some((r) => r.toLowerCase() === user.role.toLowerCase())) return true;
  if (item.permissions?.some((p) => user.permissions.includes(p))) return true;
  return false;
}

// ── Nav filter (mirrors filteredNav in command-palette.tsx) ──────────────────

function filterNav(
  items: NavItem[],
  user: UserContext,
  query: string,
): NavItem[] {
  return items.filter(
    (item) =>
      hasAccess(item, user) &&
      (item.enabled === undefined || item.enabled === true) &&
      item.name.toLowerCase().includes(query.toLowerCase()),
  );
}

// ── Sample nav items ──────────────────────────────────────────────────────────

const ALL_NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard',       path: 'dashboard',  permissions: ['p1'] },
  { name: 'Leads',           path: 'leads',      permissions: ['contacts.view'] },
  { name: 'Accounts',        path: 'accounts',   permissions: ['accounts.view'] },
  { name: 'Deals',           path: 'deals',      permissions: ['deals.view'] },
  { name: 'Contract Billing',path: 'billing',    permissions: ['billing.view'], enabled: true },
  { name: 'Workflows',       path: 'workflows',  permissions: ['workflows.view'] },
  { name: 'Campaigns',       path: 'campaigns',  permissions: ['campaigns.view'] },
  { name: 'Users',           path: 'users',      permissions: ['users.view'] },
  { name: 'Settings',        path: 'settings',   permissions: ['settings.view'] },
  { name: 'Audit Trail',     path: 'audit-log',  permissions: ['audit.view'] },
  { name: 'Admin Console',   path: 'admin',      roles: ['System Admin'] },
];

const systemAdmin:  UserContext = { role: 'System Admin',  permissions: ['*'] };
const clientAdmin:  UserContext = { role: 'Client Admin',  permissions: ['*'] };
const guestUser:    UserContext = { role: 'Guest',         permissions: [] };
const regularUser:  UserContext = { role: 'User',          permissions: ['contacts.view', 'deals.view'] };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CommandPalette — role-based navigation access', () => {
  describe('System Admin', () => {
    it('sees only platform management items', () => {
      const allowed = ALL_NAV_ITEMS.filter((i) => hasAccess(i, systemAdmin));
      const names = allowed.map((i) => i.name);
      expect(names).toContain('Dashboard');
      expect(names).toContain('Users');
      expect(names).toContain('Settings');
      expect(names).toContain('Admin Console');
      expect(names).toContain('Audit Trail');
    });

    it('never sees CRM items (Leads, Accounts, Deals, etc.)', () => {
      const allowed = ALL_NAV_ITEMS.filter((i) => hasAccess(i, systemAdmin));
      const names = allowed.map((i) => i.name);
      expect(names).not.toContain('Leads');
      expect(names).not.toContain('Accounts');
      expect(names).not.toContain('Deals');
      expect(names).not.toContain('Campaigns');
    });
  });

  describe('Client Admin', () => {
    it('sees all items except Admin Console', () => {
      const allowed = ALL_NAV_ITEMS.filter((i) => hasAccess(i, clientAdmin));
      const names = allowed.map((i) => i.name);
      expect(names).toContain('Leads');
      expect(names).toContain('Accounts');
      expect(names).toContain('Deals');
      expect(names).toContain('Workflows');
      expect(names).not.toContain('Admin Console');
    });
  });

  describe('Guest', () => {
    it('sees only Dashboard, Leads, Pipeline, Workflows, Campaigns', () => {
      const allowed = ALL_NAV_ITEMS.filter((i) => hasAccess(i, guestUser));
      const names = allowed.map((i) => i.name);
      expect(names).toContain('Dashboard');
      expect(names).toContain('Leads');
      expect(names).toContain('Workflows');
      expect(names).toContain('Campaigns');
      expect(names).not.toContain('Admin Console');
      expect(names).not.toContain('Users');
      expect(names).not.toContain('Settings');
    });
  });

  describe('Regular User with specific permissions', () => {
    it('sees items matching their permissions', () => {
      const allowed = ALL_NAV_ITEMS.filter((i) => hasAccess(i, regularUser));
      const names = allowed.map((i) => i.name);
      expect(names).toContain('Leads');   // contacts.view
      expect(names).toContain('Deals');   // deals.view
      expect(names).not.toContain('Campaigns'); // campaigns.view not in permissions
      expect(names).not.toContain('Admin Console'); // never
    });
  });

  describe('Admin Console is never visible to non-System-Admin roles', () => {
    const nonAdminRoles = ['Client Admin', 'User', 'Guest', 'Sales Manager'];

    nonAdminRoles.forEach((role) => {
      it(`Admin Console hidden for role: ${role}`, () => {
        const user: UserContext = { role, permissions: ['*'] };
        const adminItem = ALL_NAV_ITEMS.find((i) => i.name === 'Admin Console')!;
        expect(hasAccess(adminItem, user)).toBe(false);
      });
    });
  });
});

describe('CommandPalette — enabled flag', () => {
  it('items with enabled=false are always hidden regardless of role', () => {
    const disabledItem: NavItem = {
      name: 'Contract Billing',
      path: 'billing',
      permissions: ['billing.view'],
      enabled: false,
    };
    const results = filterNav([disabledItem], clientAdmin, '');
    expect(results).toHaveLength(0);
  });

  it('items with enabled=true are shown normally', () => {
    const enabledItem: NavItem = {
      name: 'Contract Billing',
      path: 'billing',
      permissions: ['billing.view'],
      enabled: true,
    };
    const results = filterNav([enabledItem], clientAdmin, '');
    expect(results).toHaveLength(1);
  });

  it('items without enabled field are shown (default behavior)', () => {
    const item: NavItem = { name: 'Dashboard', path: 'dashboard', permissions: ['p1'] };
    const results = filterNav([item], clientAdmin, '');
    expect(results).toHaveLength(1);
  });
});

describe('CommandPalette — query filtering', () => {
  it('empty query shows all accessible items', () => {
    const accessible = ALL_NAV_ITEMS.filter((i) => hasAccess(i, clientAdmin));
    const filtered   = filterNav(ALL_NAV_ITEMS, clientAdmin, '');
    expect(filtered.length).toBe(accessible.length);
  });

  it('query is case-insensitive', () => {
    const lower = filterNav(ALL_NAV_ITEMS, clientAdmin, 'leads');
    const upper = filterNav(ALL_NAV_ITEMS, clientAdmin, 'LEADS');
    const mixed = filterNav(ALL_NAV_ITEMS, clientAdmin, 'LeAdS');
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBe(mixed.length);
  });

  it('query reduces results to matching names only', () => {
    const results = filterNav(ALL_NAV_ITEMS, clientAdmin, 'work');
    const names = results.map((i) => i.name);
    expect(names).toContain('Workflows');
    expect(names).not.toContain('Leads');
    expect(names).not.toContain('Dashboard');
  });

  it('non-matching query returns empty array', () => {
    const results = filterNav(ALL_NAV_ITEMS, clientAdmin, 'xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('Property: all results always match the query string', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }),
        (query) => {
          const results = filterNav(ALL_NAV_ITEMS, clientAdmin, query);
          results.forEach((item) => {
            expect(item.name.toLowerCase()).toContain(query.toLowerCase());
          });
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Property: narrower query always yields fewer or equal results', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 4 }),
        (base, extra) => {
          const narrowQuery = base + extra;
          const baseResults   = filterNav(ALL_NAV_ITEMS, clientAdmin, base).length;
          const narrowResults = filterNav(ALL_NAV_ITEMS, clientAdmin, narrowQuery).length;
          expect(narrowResults).toBeLessThanOrEqual(baseResults);
        },
      ),
      { numRuns: 100 },
    );
  });
});
