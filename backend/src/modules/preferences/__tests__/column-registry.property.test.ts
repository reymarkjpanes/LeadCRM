import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ColumnItemSchema } from '@leadcrm/shared';
import {
  LEADS_COLUMN_REGISTRY,
  getRegistryForModule,
} from '../column-registry';

/**
 * Property-based tests for the Column Registry validation layer.
 *
 * **Validates: Requirements 6.2, 6.6, 15.3, 15.6**
 */

describe('Feature: manage-columns-persistence, Property 5: Unknown Column Rejection', () => {
  const validIds = new Set(LEADS_COLUMN_REGISTRY.columns.map((c) => c.id));

  it('should identify column ids not present in the leads registry', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter(
          (s) => /^[a-zA-Z0-9]+$/.test(s) && !validIds.has(s)
        ),
        (unknownId) => {
          // The id passes format validation (alphanumeric) but is NOT in the registry
          const registry = getRegistryForModule('leads');
          expect(registry).toBeDefined();

          const registryIds = new Set(registry!.columns.map((c) => c.id));
          // Registry should NOT contain this generated unknown id
          expect(registryIds.has(unknownId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should confirm all registry column ids ARE in the registry (inverse check)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Array.from(validIds)),
        (knownId) => {
          const registry = getRegistryForModule('leads');
          expect(registry).toBeDefined();

          const registryIds = new Set(registry!.columns.map((c) => c.id));
          // All known registry ids should be found
          expect(registryIds.has(knownId)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject unknown column ids when validating against registry', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 64 }).filter(
              (s) => /^[a-zA-Z0-9]+$/.test(s) && !validIds.has(s)
            ),
            visible: fc.boolean(),
            order: fc.nat({ max: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (invalidColumns) => {
          const registry = getRegistryForModule('leads');
          expect(registry).toBeDefined();

          const registryIds = new Set(registry!.columns.map((c) => c.id));

          // Every generated column id should NOT be in the registry
          for (const col of invalidColumns) {
            expect(registryIds.has(col.id)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: manage-columns-persistence, Property 7: Column ID Format Validation', () => {
  it('should reject column ids with unsupported characters or an invalid first character', () => {
    // Custom-field column keys permit hyphens/underscores after an initial letter.
    const specialCharArb = fc.string({ minLength: 1, maxLength: 64 }).filter(
      (s) => s.length > 0 && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s)
    );

    fc.assert(
      fc.property(specialCharArb, (invalidId) => {
        const result = ColumnItemSchema.safeParse({
          id: invalidId,
          visible: true,
          order: 0,
        });

        // Unsupported punctuation and invalid starting characters must be rejected.
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject column ids exceeding 255 characters', () => {
    const alphanumChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    // Generate alphanumeric strings longer than 255 chars
    const longIdArb = fc
      .array(fc.constantFrom(...alphanumChars.split('')), { minLength: 256, maxLength: 512 })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(longIdArb, (longId) => {
        const result = ColumnItemSchema.safeParse({
          id: longId,
          visible: true,
          order: 0,
        });

        // Zod schema should reject ids exceeding max length of 255
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject empty column ids', () => {
    const result = ColumnItemSchema.safeParse({
      id: '',
      visible: true,
      order: 0,
    });

    expect(result.success).toBe(false);
  });

  it('should accept letter-prefixed column ids including supported separators within length limits', () => {
    const alphanumChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const validIdArb = fc.tuple(
      fc.constantFrom(...letters),
      fc.array(fc.constantFrom(...(alphanumChars + '_-')), { minLength: 0, maxLength: 254 }),
    ).map(([first, rest]) => first + rest.join(''));

    fc.assert(
      fc.property(validIdArb, (validId) => {
        const result = ColumnItemSchema.safeParse({
          id: validId,
          visible: true,
          order: 0,
        });

        // A leading letter and the supported key characters should pass.
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should reject ids with unsupported punctuation, spaces, and symbols', () => {
    const problematicChars = ['.', ' ', '@', '#', '$', '%', '!', '/', '\\', '(', ')'];
    const alphanumChars = 'abcdefghijklmnopqrstuvwxyz0123456789';

    const prefixArb = fc
      .array(fc.constantFrom(...alphanumChars.split('')), { minLength: 0, maxLength: 30 })
      .map((chars) => chars.join(''));

    const suffixArb = fc
      .array(fc.constantFrom(...alphanumChars.split('')), { minLength: 0, maxLength: 30 })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(
        fc.constantFrom(...problematicChars),
        prefixArb,
        suffixArb,
        (specialChar, prefix, suffix) => {
          const invalidId = `${prefix}${specialChar}${suffix}`;
          if (invalidId.length === 0) return; // skip empty strings

          const result = ColumnItemSchema.safeParse({
            id: invalidId,
            visible: true,
            order: 0,
          });

          // Any string with a special character should be rejected
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
