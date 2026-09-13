import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildAuthUserResponse } from '../auth.service';
import type { AuthUserSource, AuthUserResponse } from '../auth.service';

/**
 * Unit tests for buildAuthUserResponse.
 *
 * This is the single function that controls what user data is sent to every
 * frontend client after login and session restore. A field addition or removal
 * here has an immediate security or UX impact, so coverage must be thorough.
 *
 * Invariants verified:
 *   1. Output contains exactly the canonical AuthUserResponse fields — no more.
 *   2. No credential or sensitive field (passwordHash, tokenHash, etc.) leaks.
 *   3. Tenant fields are correctly flattened onto the user object.
 *   4. The `currency` field introduced in Wave 2 is always present.
 *   5. Null/undefined inputs produce safe defaults — never throw.
 *   6. Properties hold across arbitrary user + tenant combinations.
 */

// ─── Canonical field set ─────────────────────────────────────────────────────
// This is the source of truth. If a field is added to AuthUserResponse,
// add it here too. If it's not here, it must not appear in the output.
const CANONICAL_USER_KEYS: Array<keyof AuthUserResponse> = [
  'id',
  'email',
  'role',
  'firstName',
  'lastName',
  'tenantId',
  'status',
  'emailVerified',
  'tenantName',
  'tenantStatus',
  'subscriptionStatus',
  'plan',
  'industry',
  'companySize',
  'currency',
  'onboardingStep',
  'onboardingCompletedAt',
];

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<AuthUserSource> = {}): AuthUserSource {
  return {
    id:           'user-1',
    email:        'alice@example.com',
    role:         'Client Admin',
    firstName:    'Alice',
    lastName:     'Admin',
    tenantId:     'tenant-1',
    status:       'ACTIVE',
    emailVerified: new Date('2026-01-01T00:00:00.000Z'),
    tenant: {
      name:                  'Acme Corp',
      status:                'ACTIVE',
      subscriptionStatus:    'ACTIVE',
      plan:                  'PRO',
      industry:              'IT Services',
      companySize:           '11-50',
      currency:              'USD',
      onboardingStep:        3,
      onboardingCompletedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    ...overrides,
  };
}

// ─── Field completeness ───────────────────────────────────────────────────────

describe('buildAuthUserResponse — field completeness', () => {
  it('output contains exactly the canonical AuthUserResponse keys', () => {
    const result = buildAuthUserResponse(makeUser());
    const outputKeys = Object.keys(result).sort();
    expect(outputKeys).toEqual([...CANONICAL_USER_KEYS].sort());
  });

  it('all canonical fields are present in the output', () => {
    const result = buildAuthUserResponse(makeUser());
    CANONICAL_USER_KEYS.forEach((key) => {
      expect(result).toHaveProperty(key);
    });
  });
});

// ─── Credential safety ────────────────────────────────────────────────────────

describe('buildAuthUserResponse — credential safety', () => {
  const SENSITIVE_FIELDS = [
    'passwordHash',
    'password',
    'tokenHash',
    'token',
    'secret',
    'apiKey',
    'refreshToken',
    'sessionId',
    'encryptionKey',
  ] as const;

  it('never includes passwordHash in the output', () => {
    const source = makeUser() as AuthUserSource & { passwordHash?: string };
    source.passwordHash = '$2a$10$examplehash';
    const result = buildAuthUserResponse(source);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it.each(SENSITIVE_FIELDS)(
    'never leaks the sensitive field "%s" even if present on input',
    (field) => {
      const source = { ...makeUser(), [field]: 'should-never-appear' } as AuthUserSource;
      const result = buildAuthUserResponse(source);
      expect(result).not.toHaveProperty(field);
      expect(Object.values(result)).not.toContain('should-never-appear');
    },
  );
});

// ─── Tenant field flattening ──────────────────────────────────────────────────

describe('buildAuthUserResponse — tenant field flattening', () => {
  it('flattens tenant.name → tenantName', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.tenantName).toBe('Acme Corp');
  });

  it('flattens tenant.status → tenantStatus', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.tenantStatus).toBe('ACTIVE');
  });

  it('flattens tenant.subscriptionStatus', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.subscriptionStatus).toBe('ACTIVE');
  });

  it('flattens tenant.plan', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.plan).toBe('PRO');
  });

  it('flattens tenant.industry', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.industry).toBe('IT Services');
  });

  it('flattens tenant.companySize', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.companySize).toBe('11-50');
  });

  it('flattens tenant.currency (Wave 2 field)', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.currency).toBe('USD');
  });

  it('flattens tenant.onboardingStep', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.onboardingStep).toBe(3);
  });

  it('flattens tenant.onboardingCompletedAt', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.onboardingCompletedAt).toEqual(new Date('2026-01-02T00:00:00.000Z'));
  });
});

// ─── Currency field (Wave 2) ──────────────────────────────────────────────────

describe('buildAuthUserResponse — currency (Wave 2)', () => {
  it('returns the tenant currency when set', () => {
    const result = buildAuthUserResponse(makeUser({ tenant: { ...makeUser().tenant!, currency: 'EUR' } }));
    expect(result.currency).toBe('EUR');
  });

  it('returns null when tenant currency is null', () => {
    const result = buildAuthUserResponse(makeUser({ tenant: { ...makeUser().tenant!, currency: null } }));
    expect(result.currency).toBeNull();
  });

  it('returns null when tenant is absent', () => {
    const result = buildAuthUserResponse(makeUser({ tenant: null }));
    expect(result.currency).toBeNull();
  });

  it('returns null when tenant has no currency field (pre-Wave-2 tenant)', () => {
    const tenant = { ...makeUser().tenant! };
    delete (tenant as Partial<typeof tenant>).currency;
    const result = buildAuthUserResponse(makeUser({ tenant }));
    expect(result.currency).toBeNull();
  });
});

// ─── Null / undefined safety ─────────────────────────────────────────────────

describe('buildAuthUserResponse — null/undefined safety', () => {
  it('handles null tenant gracefully — tenant fields default to null/0', () => {
    const result = buildAuthUserResponse(makeUser({ tenant: null }));
    expect(result.tenantName).toBeNull();
    expect(result.tenantStatus).toBeNull();
    expect(result.subscriptionStatus).toBeNull();
    expect(result.plan).toBeNull();
    expect(result.industry).toBeNull();
    expect(result.companySize).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.onboardingStep).toBe(0);
    expect(result.onboardingCompletedAt).toBeNull();
  });

  it('handles undefined tenant gracefully', () => {
    const user = makeUser();
    delete (user as Partial<AuthUserSource>).tenant;
    const result = buildAuthUserResponse(user);
    expect(result.tenantName).toBeNull();
    expect(result.onboardingStep).toBe(0);
    expect(result.currency).toBeNull();
  });

  it('handles null emailVerified — returns null, not undefined', () => {
    const result = buildAuthUserResponse(makeUser({ emailVerified: null }));
    expect(result.emailVerified).toBeNull();
  });

  it('handles null status — returns null, not undefined', () => {
    const result = buildAuthUserResponse(makeUser({ status: undefined }));
    expect(result.status).toBeNull();
  });

  it('onboardingStep defaults to 0 when tenant.onboardingStep is null', () => {
    const result = buildAuthUserResponse(makeUser({ tenant: { ...makeUser().tenant!, onboardingStep: null } }));
    expect(result.onboardingStep).toBe(0);
  });
});

// ─── Core user field pass-through ────────────────────────────────────────────

describe('buildAuthUserResponse — core user field pass-through', () => {
  it('preserves id, email, role, firstName, lastName, tenantId', () => {
    const result = buildAuthUserResponse(makeUser());
    expect(result.id).toBe('user-1');
    expect(result.email).toBe('alice@example.com');
    expect(result.role).toBe('Client Admin');
    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBe('Admin');
    expect(result.tenantId).toBe('tenant-1');
  });

  it('preserves status directly from user', () => {
    const result = buildAuthUserResponse(makeUser({ status: 'PENDING' }));
    expect(result.status).toBe('PENDING');
  });

  it('preserves emailVerified directly from user', () => {
    const ts = new Date('2025-06-15T10:00:00Z');
    const result = buildAuthUserResponse(makeUser({ emailVerified: ts }));
    expect(result.emailVerified).toEqual(ts);
  });
});

// ─── Property-based tests ─────────────────────────────────────────────────────

describe('buildAuthUserResponse — property-based invariants', () => {
  /**
   * Property 1: Output key set is always exactly CANONICAL_USER_KEYS.
   * Holds regardless of what extra fields might be present on the input.
   */
  it('Property 1: output always contains exactly the canonical key set', () => {
    const sortedCanonical = [...CANONICAL_USER_KEYS].sort();

    fc.assert(
      fc.property(
        fc.record({
          id:        fc.string({ minLength: 1, maxLength: 36 }),
          email:     fc.emailAddress(),
          role:      fc.constantFrom('Client Admin', 'Sales Rep', 'Viewer', 'Technician'),
          firstName: fc.string({ minLength: 1, maxLength: 50 }),
          lastName:  fc.string({ minLength: 1, maxLength: 50 }),
          tenantId:  fc.string({ minLength: 1, maxLength: 36 }),
        }),
        (base) => {
          const source: AuthUserSource = {
            ...base,
            status:       'ACTIVE',
            emailVerified: new Date(),
            tenant: {
              name:                  'Test Co',
              status:                'ACTIVE',
              subscriptionStatus:    'ACTIVE',
              plan:                  'STARTER',
              industry:              'Tech',
              companySize:           '1-10',
              currency:              'PHP',
              onboardingStep:        1,
              onboardingCompletedAt: new Date(),
            },
          };
          const result = buildAuthUserResponse(source);
          expect(Object.keys(result).sort()).toEqual(sortedCanonical);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property 2: passwordHash never appears in output — for any input.
   */
  it('Property 2: passwordHash never appears in output regardless of input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (hash) => {
          const source = {
            ...makeUser(),
            passwordHash: hash,
          } as AuthUserSource & { passwordHash: string };
          const result = buildAuthUserResponse(source);
          expect(result).not.toHaveProperty('passwordHash');
          expect(Object.values(result as Record<string, unknown>)).not.toContain(hash);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property 3: currency is always null when tenant is null/undefined.
   */
  it('Property 3: currency is always null when tenant is absent', () => {
    fc.assert(
      fc.property(
        fc.option(fc.constant(null), { nil: undefined }),
        (tenant) => {
          const result = buildAuthUserResponse(makeUser({ tenant: tenant ?? undefined }));
          expect(result.currency).toBeNull();
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * Property 4: onboardingStep is always a non-negative integer.
   */
  it('Property 4: onboardingStep is always a non-negative integer', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
        (step) => {
          const tenant = { ...makeUser().tenant!, onboardingStep: step };
          const result = buildAuthUserResponse(makeUser({ tenant }));
          expect(result.onboardingStep).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(result.onboardingStep)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
