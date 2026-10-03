import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from './client';

afterEach(() => vi.unstubAllGlobals());

it.each(['/crm/leads', '/crm/contacts', '/crm/accounts', '/crm/deals', '/administration/users', '/administration/users/user/permissions', '/automation/workflows'])('uses the credentialed same-origin path for %s', async path => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[]}'));
  vi.stubGlobal('fetch', fetchMock);
  await apiClient.get(path);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(`/api/proxy${path}`, expect.objectContaining({ credentials: 'include' }));
});

it('never sends an unsigned server-side request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', undefined);
  await expect(apiClient.get('/crm/leads')).rejects.toThrow('cannot be used during server rendering');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('preserves genuine 401 errors without retrying or concealing them', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"Authentication required"}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(apiClient.get('/crm/leads')).rejects.toMatchObject({ status: 401, message: 'Authentication required' });
  expect(fetchMock).toHaveBeenCalledOnce();
});
