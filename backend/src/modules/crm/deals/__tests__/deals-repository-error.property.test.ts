import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Prisma } from '@prisma/client';

/**
 * Property-based test for repository error classification.
 *
 * **Property 1: Repository Error Classification**
 * For any Prisma error thrown by a database query, the repository SHALL return `null`
 * if and only if the error code is `P2025` (record not found). For all other error codes,
 * the repository SHALL propagate the error to the caller unchanged.
 *
 * **Validates: Requirements 1.1, 1.2**
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

// Mock prisma before importing the repository
vi.mock('../../../../config/database.config', () => {
  const client = {
    deal: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(work => work(client));
  return {
    default: client,
  };
});

// Import after mocking
import prisma from '../../../../config/database.config';
import { updateDeal, archiveDeal } from '../deals.repository';

// ─────────────────────────────────────────────────────
// GENERATORS
// ─────────────────────────────────────────────────────

/**
 * All known Prisma error codes (subset used in real scenarios).
 * P2025 is "record not found" — this is the ONLY code that should return null.
 */
const PRISMA_ERROR_CODES = [
  'P2000', // Value too long
  'P2001', // Record does not exist (different from P2025)
  'P2002', // Unique constraint violation
  'P2003', // Foreign key constraint violation
  'P2004', // Constraint failed
  'P2005', // Invalid value stored in database
  'P2006', // Invalid value provided
  'P2007', // Data validation error
  'P2008', // Failed to parse query
  'P2009', // Failed to validate query
  'P2010', // Raw query failed
  'P2011', // Null constraint violation
  'P2012', // Missing required value
  'P2013', // Missing required argument
  'P2014', // Relation violation
  'P2015', // Related record not found
  'P2016', // Query interpretation error
  'P2017', // Records for relation not connected
  'P2018', // Required connected records not found
  'P2019', // Input error
  'P2020', // Value out of range
  'P2021', // Table does not exist
  'P2022', // Column does not exist
  'P2023', // Inconsistent column data
  'P2024', // Timed out
  'P2025', // Record not found — THE special case
  'P2026', // Unsupported feature
  'P2027', // Multiple errors on database
  'P2028', // Transaction API error
  'P2030', // Fulltext index not found
  'P2033', // Number overflow
  'P2034', // Transaction conflict or deadlock
];

const NON_P2025_CODES = PRISMA_ERROR_CODES.filter((code) => code !== 'P2025');

/**
 * Generate a random Prisma error code that is NOT P2025.
 */
const nonP2025CodeArb = fc.constantFrom(...NON_P2025_CODES);

/**
 * Generate random test input parameters (id, tenantId).
 */
const dealIdArb = fc.uuid();
const tenantIdArb = fc.uuid();

/**
 * Helper to create a PrismaClientKnownRequestError with a given code.
 */
function createPrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Error with code ${code}`,
    { code, clientVersion: '5.0.0' },
  );
}

// ─────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────

describe('Feature: deals-module-modernization, Property 1: Repository Error Classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({
      productInterestIds: [], productInterestId: null, productInterests: [],
    } as Awaited<ReturnType<typeof prisma.deal.findFirst>>);
  });

  describe('updateDeal — P2025 returns null', () => {
    it('should return null when Prisma throws P2025 for any dealId/tenantId combination', async () => {
      await fc.assert(
        fc.asyncProperty(dealIdArb, tenantIdArb, async (dealId, tenantId) => {
          const prismaError = createPrismaError('P2025');
          vi.mocked(prisma.deal.update).mockRejectedValue(prismaError);

          const result = await updateDeal(dealId, tenantId, { title: 'test' });

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('updateDeal — non-P2025 re-throws error', () => {
    it('should re-throw the original error for any Prisma error code other than P2025', async () => {
      await fc.assert(
        fc.asyncProperty(nonP2025CodeArb, dealIdArb, tenantIdArb, async (errorCode, dealId, tenantId) => {
          const prismaError = createPrismaError(errorCode);
          vi.mocked(prisma.deal.update).mockRejectedValue(prismaError);

          await expect(updateDeal(dealId, tenantId, { title: 'test' })).rejects.toThrow(
            prismaError,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('archiveDeal — P2025 returns null', () => {
    it('should return null when Prisma throws P2025 for any dealId/tenantId combination', async () => {
      await fc.assert(
        fc.asyncProperty(dealIdArb, tenantIdArb, async (dealId, tenantId) => {
          const prismaError = createPrismaError('P2025');
          vi.mocked(prisma.deal.update).mockRejectedValue(prismaError);

          const result = await archiveDeal(dealId, tenantId, 'test reason');

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('archiveDeal — non-P2025 re-throws error', () => {
    it('should re-throw the original error for any Prisma error code other than P2025', async () => {
      await fc.assert(
        fc.asyncProperty(nonP2025CodeArb, dealIdArb, tenantIdArb, async (errorCode, dealId, tenantId) => {
          const prismaError = createPrismaError(errorCode);
          vi.mocked(prisma.deal.update).mockRejectedValue(prismaError);

          await expect(archiveDeal(dealId, tenantId, 'reason')).rejects.toThrow(prismaError);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('error identity — re-thrown errors are unchanged', () => {
    it('should preserve the original error object identity (not wrap or modify it)', async () => {
      await fc.assert(
        fc.asyncProperty(nonP2025CodeArb, dealIdArb, tenantIdArb, async (errorCode, dealId, tenantId) => {
          const prismaError = createPrismaError(errorCode);
          vi.mocked(prisma.deal.update).mockRejectedValue(prismaError);

          try {
            await updateDeal(dealId, tenantId, { title: 'test' });
            // Should not reach here
            expect.fail('Expected error to be thrown');
          } catch (caughtError) {
            // The caught error should be the exact same object reference
            expect(caughtError).toBe(prismaError);
            // The error code should be preserved
            expect((caughtError as Prisma.PrismaClientKnownRequestError).code).toBe(errorCode);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('P2025 is the only code that returns null', () => {
    it('should return null if and only if error code is P2025 (exhaustive code variation)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...PRISMA_ERROR_CODES),
          dealIdArb,
          tenantIdArb,
          async (errorCode, dealId, tenantId) => {
            const prismaError = createPrismaError(errorCode);
            vi.mocked(prisma.deal.update).mockRejectedValue(prismaError);

            if (errorCode === 'P2025') {
              const result = await updateDeal(dealId, tenantId, { title: 'test' });
              expect(result).toBeNull();
            } else {
              await expect(updateDeal(dealId, tenantId, { title: 'test' })).rejects.toThrow(
                prismaError,
              );
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
