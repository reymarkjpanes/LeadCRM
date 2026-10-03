import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CreateDealSchema, UpdateDealSchema } from '../deals.dto';

/**
 * Property-based tests for deal value bound validation.
 *
 * Property 11: Value Bound Validation
 * For any numeric value > 999,999,999,999, the CreateDealSchema and UpdateDealSchema
 * SHALL reject the input with a validation error. For any nonnegative value ≤ 999,999,999,999,
 * the schema SHALL accept it.
 *
 * **Validates: Requirements 14.1, 14.2, 14.3**
 */

const VALUE_UPPER_BOUND = 999_999_999_999;

/** Base valid deal object for CreateDealSchema (all required fields present) */
const validCreateDealBase = {
  pipelineId: 'pipeline-1',
  stageId: 'stage-1',
  title: 'Test Deal',
};

describe('Feature: deals-module-modernization, Property 11: Value Bound Validation', () => {
  describe('CreateDealSchema', () => {
    it('accepts positive values ≤ 999,999,999,999', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: VALUE_UPPER_BOUND, noNaN: true }),
          (value) => {
            const result = CreateDealSchema.safeParse({
              ...validCreateDealBase,
              value,
            });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts the exact boundary value 999,999,999,999', () => {
      const result = CreateDealSchema.safeParse({
        ...validCreateDealBase,
        value: VALUE_UPPER_BOUND,
      });

      expect(result.success).toBe(true);
    });

    it('rejects values > 999,999,999,999', () => {
      fc.assert(
        fc.property(
          fc.double({
            min: VALUE_UPPER_BOUND + 0.01,
            max: VALUE_UPPER_BOUND * 100,
            noNaN: true,
          }),
          (value) => {
            const result = CreateDealSchema.safeParse({
              ...validCreateDealBase,
              value,
            });

            expect(result.success).toBe(false);
            if (!result.success) {
              const valueErrors = result.error.issues.filter(
                (issue) => issue.path.includes('value')
              );
              expect(valueErrors.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts zero-value deals', () => {
      expect(CreateDealSchema.safeParse({ ...validCreateDealBase, value: 0 }).success).toBe(true);
    });

    it('rejects negative values', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1_000_000, max: -Number.MIN_VALUE, noNaN: true }),
          (value) => {
            const result = CreateDealSchema.safeParse({
              ...validCreateDealBase,
              value,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts when value is omitted (optional field)', () => {
      const result = CreateDealSchema.safeParse(validCreateDealBase);

      expect(result.success).toBe(true);
    });
  });

  describe('UpdateDealSchema', () => {
    it('accepts positive values ≤ 999,999,999,999', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: VALUE_UPPER_BOUND, noNaN: true }),
          (value) => {
            const result = UpdateDealSchema.safeParse({ value });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts the exact boundary value 999,999,999,999', () => {
      const result = UpdateDealSchema.safeParse({ value: VALUE_UPPER_BOUND });

      expect(result.success).toBe(true);
    });

    it('rejects values > 999,999,999,999', () => {
      fc.assert(
        fc.property(
          fc.double({
            min: VALUE_UPPER_BOUND + 0.01,
            max: VALUE_UPPER_BOUND * 100,
            noNaN: true,
          }),
          (value) => {
            const result = UpdateDealSchema.safeParse({ value });

            expect(result.success).toBe(false);
            if (!result.success) {
              const valueErrors = result.error.issues.filter(
                (issue) => issue.path.includes('value')
              );
              expect(valueErrors.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts zero-value deals', () => {
      expect(UpdateDealSchema.safeParse({ value: 0 }).success).toBe(true);
    });

    it('rejects negative values', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1_000_000, max: -Number.MIN_VALUE, noNaN: true }),
          (value) => {
            const result = UpdateDealSchema.safeParse({ value });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accepts when value is omitted (partial schema)', () => {
      const result = UpdateDealSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it('accepts other fields alongside a valid value', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: VALUE_UPPER_BOUND, noNaN: true }),
          fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 1, maxLength: 50 }).map(chars => chars.join('')),
          (value, title) => {
            const result = UpdateDealSchema.safeParse({ value, title });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Boundary precision tests', () => {
    it('values just below the boundary are accepted', () => {
      fc.assert(
        fc.property(
          fc.double({
            min: VALUE_UPPER_BOUND - 1000,
            max: VALUE_UPPER_BOUND,
            noNaN: true,
          }),
          (value) => {
            const result = CreateDealSchema.safeParse({
              ...validCreateDealBase,
              value,
            });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('values just above the boundary are rejected', () => {
      fc.assert(
        fc.property(
          fc.double({
            min: VALUE_UPPER_BOUND + 0.01,
            max: VALUE_UPPER_BOUND + 1000,
            noNaN: true,
          }),
          (value) => {
            const result = CreateDealSchema.safeParse({
              ...validCreateDealBase,
              value,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
