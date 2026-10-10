import { afterEach, expect, it, vi } from 'vitest';
import { errorMiddleware } from '../../../api/middleware/error.middleware';

afterEach(() => vi.restoreAllMocks());
it('does not log raw import arguments, Prisma metadata or source contents', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const marker = 'private-customer@example.test,confidential CSV';
  const error = Object.assign(new Error(marker), { code: 'P2003', meta: { content: marker } });
  const json = vi.fn(), response = { status: vi.fn().mockReturnThis(), json };
  errorMiddleware(error, { path: '/api/v1/crm/leads/imports/upload', method: 'POST' } as never, response as never, vi.fn());
  expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  expect(JSON.stringify(log.mock.calls)).toContain('P2003');
  expect(JSON.stringify(json.mock.calls)).not.toContain(marker);
});
