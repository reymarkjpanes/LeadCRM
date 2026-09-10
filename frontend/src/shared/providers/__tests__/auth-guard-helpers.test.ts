import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isSandboxUser } from '../auth-guard';

/**
 * Unit tests for isSandboxUser.
 *
 * isSandboxUser is the UI-level predicate that controls whether the
 * SandboxBillingBanner renders in the CRM layout. It is NOT a security
 * boundary (the backend subscriptionGate is), but a false positive here
 * would display an unnecessary upgrade banner to paying customers, and
 * a false negative would hide it for sandbox users who need to subscribe.
 *
 * The function must return true ONLY when ALL of:
 *   - user is not null
 *   - tenantStatus === 'SANDBOX'
 *   - subscriptionStatus is null, undefined, or 'NONE'
 */

type UserLike = Parameters<typeof isSandboxUser>[0];

function makeSandboxUser(overrides: Partial<NonNullable<UserLike>> = {}): NonNullable<UserLike> {
  return {
    role:               'Restricted User',
    tenantStatus:       'SANDBOX',
    subscriptionStatus: 'NONE',
    ...overrides,
  };
}

// ─── True cases ──────────────────────────────────────────────────────────────

describe('isSandboxUser — returns true (sandbox state)', () => {
  it('returns true for SANDBOX + NONE subscriptionStatus', () => {
    expect(isSandboxUser(makeSandboxUser())).toBe(true);
  });

  it('returns true for SANDBOX + null subscriptionStatus', () => {
    expect(isSandboxUser(makeSandboxUser({ subscriptionStatus: null }))).toBe(true);
  });

  it('returns true for SANDBOX + undefined subscriptionStatus', () => {
    expect(isSandboxUser(makeSandboxUser({ subscriptionStatus: undefined }))).toBe(true);
  });

  it('is not role-dependent — any role with SANDBOX + NONE is a sandbox user', () => {
    for (const role of ['Restricted User', 'Client Admin', 'Sales Rep', 'Viewer']) {
      expect(isSandboxUser(makeSandboxUser({ role }))).toBe(true);
    }
  });
});

// ─── False cases ─────────────────────────────────────────────────────────────

describe('isSandboxUser — returns false (active / non-sandbox)', () => {
  it('returns false when user is null', () => {
    expect(isSandboxUser(null)).toBe(false);
  });

  it('returns false when tenantStatus is ACTIVE (paying customer)', () => {
    expect(isSandboxUser(makeSandboxUser({ tenantStatus: 'ACTIVE' }))).toBe(false);
  });

  it('returns false when tenantStatus is PAST_DUE', () => {
    expect(isSandboxUser(makeSandboxUser({ tenantStatus: 'PAST_DUE' }))).toBe(false);
  });

  it('returns false when tenantStatus is CANCELLED', () => {
    expect(isSandboxUser(makeSandboxUser({ tenantStatus: 'CANCELLED' }))).toBe(false);
  });

  it('returns false when tenantStatus is null (pre-auth state)', () => {
    expect(isSandboxUser(makeSandboxUser({ tenantStatus: null }))).toBe(false);
  });

  it('returns false when tenantStatus is undefined', () => {
    expect(isSandboxUser(makeSandboxUser({ tenantStatus: undefined }))).toBe(false);
  });

  it('returns false when subscriptionStatus is ACTIVE (even if tenantStatus is SANDBOX)', () => {
    // This covers the unlikely edge case where Stripe fires but tenantStatus
    // hasn't been synced yet — should not show the sandbox banner.
    expect(isSandboxUser(makeSandboxUser({ subscriptionStatus: 'ACTIVE' }))).toBe(false);
  });

  it('returns false when subscriptionStatus is PAST_DUE', () => {
    expect(isSandboxUser(makeSandboxUser({ subscriptionStatus: 'PAST_DUE' }))).toBe(false);
  });

  it('returns false when subscriptionStatus is TRIAL', () => {
    expect(isSandboxUser(makeSandboxUser({ subscriptionStatus: 'TRIAL' }))).toBe(false);
  });

  it('returns false when both tenantStatus and subscriptionStatus indicate active', () => {
    expect(isSandboxUser({ tenantStatus: 'ACTIVE', subscriptionStatus: 'ACTIVE' })).toBe(false);
  });
});

// ─── Property-based tests ─────────────────────────────────────────────────────

describe('isSandboxUser — property-based invariants', () => {
  /**
   * Property 1: Always returns a boolean — never throws.
   */
  it('Property 1: always returns a boolean for any input', () => {
    fc.assert(
      fc.property(
        fc.option(
          fc.record({
            role:               fc.option(fc.string(), { nil: undefined }),
            tenantStatus:       fc.option(fc.string(), { nil: null }),
            subscriptionStatus: fc.option(fc.string(), { nil: null }),
          }),
          { nil: null },
        ),
        (user) => {
          const result = isSandboxUser(user as UserLike);
          expect(typeof result).toBe('boolean');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 2: null user always returns false — no authenticated user, no sandbox.
   */
  it('Property 2: null user always returns false', () => {
    fc.assert(
      fc.property(fc.constant(null), (user) => {
        expect(isSandboxUser(user)).toBe(false);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * Property 3: Any non-SANDBOX tenantStatus always returns false.
   */
  it('Property 3: non-SANDBOX tenantStatus always returns false', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== 'SANDBOX'),
        fc.option(fc.string(), { nil: null }),
        (tenantStatus, subscriptionStatus) => {
          const user: NonNullable<UserLike> = { tenantStatus, subscriptionStatus };
          expect(isSandboxUser(user)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4: SANDBOX tenantStatus + non-empty/non-NONE subscriptionStatus
   * always returns false.
   */
  it('Property 4: SANDBOX + active subscription always returns false', () => {
    const activeStatuses = ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'TRIAL', 'EXPIRED'];
    fc.assert(
      fc.property(
        fc.constantFrom(...activeStatuses),
        (subscriptionStatus) => {
          const user = makeSandboxUser({ subscriptionStatus });
          expect(isSandboxUser(user)).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property 5: SANDBOX + null/undefined/NONE subscriptionStatus always returns true.
   */
  it('Property 5: SANDBOX + null/undefined/NONE always returns true', () => {
    const sandboxStatuses = [null, undefined, 'NONE'] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...sandboxStatuses),
        (subscriptionStatus) => {
          const user = makeSandboxUser({ subscriptionStatus: subscriptionStatus ?? undefined });
          expect(isSandboxUser(user)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
