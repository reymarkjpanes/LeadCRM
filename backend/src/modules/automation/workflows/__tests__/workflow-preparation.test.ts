import { Prisma } from '@prisma/client';
import { expect, it } from 'vitest';
import { preparationAttempts, preparationContext, preparationFailure, preparationRetryAt } from '../workflow-preparation';

it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034'])('retries the known pre-dispatch infrastructure error %s', code => {
  expect(preparationFailure(new Prisma.PrismaClientKnownRequestError('private connection details', { code, clientVersion: '5' })))
    .toEqual({ retryable: true, failureClass: code });
});
it.each(['40001', '40P01', '55P03'])('recognizes a transient raw SQL conflict %s', code => {
  expect(preparationFailure(new Prisma.PrismaClientKnownRequestError('private SQL', { code: 'P2010', meta: { code }, clientVersion: '5' })).retryable).toBe(true);
});
it('does not retry application, configuration, or unknown errors and never exposes their messages', () => {
  for (const error of [new Error('secret'), new TypeError('secret'), { code: 'P2002', message: 'secret' }, null]) {
    expect(preparationFailure(error).retryable).toBe(false);
    expect(JSON.stringify(preparationFailure(error))).not.toContain('secret');
  }
});
it('preserves dispatch evidence and reads bounded preparation attempts from older and malformed payloads', () => {
  for (const input of [null, {}, { preparation: { attempts: -1 } }, { preparation: { attempts: '1' } }]) expect(preparationAttempts(input)).toBe(0);
  expect(preparationAttempts({ preparation: { attempts: 50 } })).toBe(5);
  const context = { version: 1, context: { 'event.newStatus': 'HOT' }, eventContext: { 'lead.firstName': 'Saved' } };
  expect(preparationContext(context, 2, 'P1001')).toMatchObject({ ...context, preparation: { attempts: 2, failureClass: 'P1001' } });
});
it.each([1, 2, 3, 4])('delays preparation retry %s with bounded positive jitter', attempt => {
  const expected = 30000 * 2 ** (attempt - 1);
  expect(+preparationRetryAt(attempt, 1000, () => 0)).toBe(1000 + expected);
  const upper = +preparationRetryAt(attempt, 1000, () => 0.999);
  expect(upper).toBeGreaterThanOrEqual(1000 + expected);
  expect(upper).toBeLessThan(1000 + expected * 1.1);
});
