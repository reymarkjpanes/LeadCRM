import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  isNoSessionError,
  buildTenantFromApiUser,
} from '../AuthContext';

/**
 * Unit tests for the exported pure helpers in AuthContext.
 *
 * Both helpers are deterministic pure functions — no React, no I/O.
 * Testing them in isolation verifies the most critical decision points
 * in the auth flow without needing to mount a provider.
 *
 * Tests are grouped into two suites:
 *   1. isNoSessionError   — controls the 401 vs network-failure branch
 *   2. buildTenantFromApiUser — controls what the Tenant state contains
 */

// ═════════════════════════════════════════════════════════════════════════════
// isNoSessionError
// ═════════════════════════════════════════════════════════════════════════════

describe('isNoSessionError', () => {
  /**
   * Returns true for errors that indicate "not authenticated" —
   * the user was logged out or their session expired.
   * The auth state should be cleared silently (no error banner shown).
   */
  describe('returns true for unauthenticated / 401 errors', () => {
    it('matches "authentication required" (backend auth middleware)', () => {
      expect(isNoSessionError(new Error('Authentication required'))).toBe(true);
    });

    it('matches "invalid or expired token"', () => {
      expect(isNoSessionError(new Error('Invalid or expired token'))).toBe(true);
    });

    it('matches "unauthorized"', () => {
      expect(isNoSessionError(new Error('Unauthorized'))).toBe(true);
    });

    it('matches a message containing "401"', () => {
      expect(isNoSessionError(new Error('Request failed with status 401'))).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isNoSessionError(new Error('AUTHENTICATION REQUIRED'))).toBe(true);
      expect(isNoSessionError(new Error('UNAUTHORIZED'))).toBe(true);
      expect(isNoSessionError(new Error('Invalid Or Expired Token'))).toBe(true);
    });
  });

  /**
   * Returns false for transport failures — network down, server error, CORS.
   * These should surface an explicit error state with a retry button.
   */
  describe('returns false for transport / server errors', () => {
    it('returns false for a network failure (TypeError: Failed to fetch)', () => {
      expect(isNoSessionError(new TypeError('Failed to fetch'))).toBe(false);
    });

    it('returns false for a 500 Internal Server Error', () => {
      expect(isNoSessionError(new Error('Internal Server Error'))).toBe(false);
    });

    it('returns false for a 503 Service Unavailable', () => {
      expect(isNoSessionError(new Error('Service Unavailable'))).toBe(false);
    });

    it('returns false for a CORS error', () => {
      expect(isNoSessionError(new Error('CORS error: blocked by browser'))).toBe(false);
    });

    it('returns false for a generic Error with no auth message', () => {
      expect(isNoSessionError(new Error('Something went wrong'))).toBe(false);
    });

    it('returns false for an empty Error', () => {
      expect(isNoSessionError(new Error(''))).toBe(false);
    });
  });

  /**
   * Handles non-Error inputs safely — the function never throws.
   */
  describe('handles non-Error inputs safely', () => {
    it('returns false for null', () => {
      expect(isNoSessionError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isNoSessionError(undefined)).toBe(false);
    });

    it('returns false for an empty object', () => {
      expect(isNoSessionError({})).toBe(false);
    });

    it('returns true for a raw "401" string', () => {
      expect(isNoSessionError('401')).toBe(true);
    });

    it('returns true for a string "unauthorized"', () => {
      expect(isNoSessionError('unauthorized access')).toBe(true);
    });

    it('returns false for a number', () => {
      expect(isNoSessionError(500)).toBe(false);
    });
  });

  /**
   * Property: isNoSessionError never throws for any input.
   */
  it('Property: never throws for any input value', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => isNoSessionError(input)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property: always returns a boolean.
   */
  it('Property: always returns a boolean', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result = isNoSessionError(input);
        expect(typeof result).toBe('boolean');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property: error messages that contain none of the auth-indicator substrings
   * must always return false.
   */
  it('Property: messages with no auth indicators always return false', () => {
    const AUTH_INDICATORS = ['authentication required', 'invalid or expired token', 'unauthorized', '401'];

    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          const lower = s.toLowerCase();
          return !AUTH_INDICATORS.some((indicator) => lower.includes(indicator));
        }),
        (message) => {
          expect(isNoSessionError(new Error(message))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildTenantFromApiUser
// ═════════════════════════════════════════════════════════════════════════════

describe('buildTenantFromApiUser', () => {
  function makeApiUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tenantId:           'tenant-abc',
      tenantName:         'Acme Corp',
      tenantStatus:       'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      plan:               'PRO',
      industry:           'IT Services',
      currency:           'USD',
      ...overrides,
    };
  }

  describe('id and name mapping', () => {
    it('maps tenantId → id', () => {
      const result = buildTenantFromApiUser(makeApiUser({ tenantId: 'tenant-xyz' }));
      expect(result.id).toBe('tenant-xyz');
    });

    it('maps tenantName → name', () => {
      const result = buildTenantFromApiUser(makeApiUser({ tenantName: 'Beta LLC' }));
      expect(result.name).toBe('Beta LLC');
    });

    it('defaults name to empty string when tenantName is null', () => {
      const result = buildTenantFromApiUser(makeApiUser({ tenantName: null }));
      expect(result.name).toBe('');
    });

    it('defaults name to empty string when tenantName is absent', () => {
      const user = makeApiUser();
      delete user.tenantName;
      const result = buildTenantFromApiUser(user);
      expect(result.name).toBe('');
    });
  });

  describe('environment derivation', () => {
    it('sets environment to "sandbox" when tenantStatus is SANDBOX', () => {
      const result = buildTenantFromApiUser(makeApiUser({ tenantStatus: 'SANDBOX' }));
      expect(result.environment).toBe('sandbox');
    });

    it('sets environment to "production" when tenantStatus is ACTIVE', () => {
      const result = buildTenantFromApiUser(makeApiUser({ tenantStatus: 'ACTIVE' }));
      expect(result.environment).toBe('production');
    });

    it('sets environment to "production" when tenantStatus is null', () => {
      const result = buildTenantFromApiUser(makeApiUser({ tenantStatus: null }));
      expect(result.environment).toBe('production');
    });

    it('sets environment to "production" for any non-SANDBOX status', () => {
      for (const status of ['PAST_DUE', 'CANCELLED', 'EXPIRED', 'NONE', '']) {
        const result = buildTenantFromApiUser(makeApiUser({ tenantStatus: status }));
        expect(result.environment).toBe('production');
      }
    });
  });

  describe('currency field (Wave 2)', () => {
    it('maps currency from API user', () => {
      const result = buildTenantFromApiUser(makeApiUser({ currency: 'EUR' }));
      expect(result.currency).toBe('EUR');
    });

    it('returns null when currency is null', () => {
      const result = buildTenantFromApiUser(makeApiUser({ currency: null }));
      expect(result.currency).toBeNull();
    });

    it('returns null when currency is absent', () => {
      const user = makeApiUser();
      delete user.currency;
      const result = buildTenantFromApiUser(user);
      expect(result.currency).toBeNull();
    });

    it('preserves PHP as a valid currency code', () => {
      const result = buildTenantFromApiUser(makeApiUser({ currency: 'PHP' }));
      expect(result.currency).toBe('PHP');
    });
  });

  describe('subscription fields', () => {
    it('maps subscriptionStatus', () => {
      const result = buildTenantFromApiUser(makeApiUser({ subscriptionStatus: 'PAST_DUE' })) as unknown as Record<string, unknown>;
      expect(result.subscriptionStatus).toBe('PAST_DUE');
    });

    it('returns null subscriptionStatus when absent', () => {
      const user = makeApiUser();
      delete user.subscriptionStatus;
      const result = buildTenantFromApiUser(user) as unknown as Record<string, unknown>;
      expect(result.subscriptionStatus).toBeNull();
    });

    it('maps plan', () => {
      const result = buildTenantFromApiUser(makeApiUser({ plan: 'ENTERPRISE' })) as unknown as Record<string, unknown>;
      expect(result.plan).toBe('ENTERPRISE');
    });

    it('returns null plan when absent', () => {
      const user = makeApiUser();
      delete user.plan;
      const result = buildTenantFromApiUser(user) as unknown as Record<string, unknown>;
      expect(result.plan).toBeNull();
    });
  });

  /**
   * Property: environment is always exactly "sandbox" or "production".
   */
  it('Property: environment is always "sandbox" or "production"', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: null }),
        (tenantStatus) => {
          const result = buildTenantFromApiUser(makeApiUser({ tenantStatus }));
          expect(['sandbox', 'production']).toContain(result.environment);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property: output id always matches the input tenantId.
   */
  it('Property: result.id always equals the input tenantId', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 36 }),
        (tenantId) => {
          const result = buildTenantFromApiUser(makeApiUser({ tenantId }));
          expect(result.id).toBe(tenantId);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property: function never throws regardless of input shape.
   */
  it('Property: never throws for any record input', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.anything()),
        (apiUser) => {
          expect(() => buildTenantFromApiUser(apiUser as Record<string, unknown>)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});
