import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { errorMiddleware } from '../error.middleware';

const require = createRequire(__filename);
const commonJsZod = require('zod') as typeof import('zod');

function respond(error: Error) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  errorMiddleware(error, { path: '/api/v1/marketing/campaigns', method: 'POST' } as Request, response as unknown as Response, vi.fn());
  return response;
}
afterEach(() => vi.restoreAllMocks());

it.each(['forgot-password', 'reset-password'])('redacts recovery %s operational errors and metadata', endpoint => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  errorMiddleware(Object.assign(new Error('token-and-password-secret'), { meta: { token: 'secret' } }),
    { path: `/api/v1/auth/${endpoint}`, method: 'POST' } as Request, response as unknown as Response, vi.fn());
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret');
});

describe('validation errors across module formats', () => {
  it.each([['ESM', z], ['CommonJS', commonJsZod.z]] as const)('returns 400 and field errors for %s schemas', (_format, validator) => {
    const result = validator.object({ name: validator.string().min(1) }).strict().safeParse({ name: '', tenantId: 'forbidden' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Fixture must fail validation');
    const response = respond(result.error);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: expect.any(String), fieldErrors: { name: [expect.any(String)] } });
  });

  it('handles a Zod error with a different constructor identity', () => {
    const result = commonJsZod.z.string().min(1).safeParse('');
    if (result.success) throw new Error('Fixture must fail validation');
    expect(result.error).not.toBeInstanceOf(ZodError);
    expect(respond(result.error).status).toHaveBeenCalledWith(400);
  });

  it.each([new Error('private failure details'), Object.assign(new Error('private failure details'), { name: 'ZodError', issues: [{ message: 'malformed' }] })])('keeps unrelated or malformed errors private', error => {
    const response = respond(error);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'An unexpected error occurred. Please try again.' });
  });
});
