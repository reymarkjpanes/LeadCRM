import type { Prisma } from '@prisma/client';

export const WORKFLOW_PREPARATION_ATTEMPTS = 5;
const retryableCodes = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);
const retryableSqlCodes = new Set(['40001', '40P01', '55P03']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function preparationAttempts(context: Prisma.JsonValue | null): number {
  const attempts = object(context) && object(context.preparation) ? context.preparation.attempts : undefined;
  return typeof attempts === 'number' && Number.isSafeInteger(attempts) && attempts >= 0
    ? Math.min(attempts, WORKFLOW_PREPARATION_ATTEMPTS) : 0;
}

export function preparationContext(context: Prisma.JsonValue | null, attempts: number, failureClass?: string): Prisma.InputJsonObject {
  return { ...(object(context) ? context : {}), preparation: { attempts,
    ...(failureClass ? { failureClass, failedAt: new Date().toISOString() } : {}) } } as Prisma.InputJsonObject;
}

/** Retry known infrastructure conflicts only, never arbitrary application errors. */
export function preparationFailure(error: unknown): { retryable: boolean; failureClass: string } {
  if (!object(error)) return { retryable: false, failureClass: 'UNKNOWN' };
  const code = typeof error.code === 'string' ? error.code : typeof error.errorCode === 'string' ? error.errorCode : '';
  const sqlCode = object(error.meta) && typeof error.meta.code === 'string' ? error.meta.code : '';
  const recognized = retryableCodes.has(code) ? code : code === 'P2010' && retryableSqlCodes.has(sqlCode) ? sqlCode : undefined;
  return { retryable: !!recognized, failureClass: recognized ?? 'PERMANENT' };
}

export function preparationRetryAt(attempt: number, now = Date.now(), random = Math.random): Date {
  const delay = 30000 * 2 ** Math.min(3, Math.max(0, attempt - 1));
  // Bounded positive jitter avoids retry bursts without retrying earlier than the policy.
  return new Date(now + delay + Math.floor(delay * 0.1 * random()));
}
