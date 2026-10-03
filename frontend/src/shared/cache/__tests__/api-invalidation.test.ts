import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api/client';
import { clearPageCache, getPageCache, setPageCache } from '../page-cache';

beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  for (const module of ['leads', 'contacts', 'accounts', 'campaigns', 'templates', 'pipeline', 'pipelines', 'workflows', 'reports', 'activities', 'notifications', 'archived-crm', 'counts-leads', 'counts-contacts', 'counts-accounts']) {
    setPageCache(module, 'tenant-a', {}, ['before-write']);
  }
});
afterEach(() => { vi.unstubAllGlobals(); clearPageCache(); });

it.each([
  ['/crm/contacts/123/archive', ['contacts', 'leads', 'accounts', 'reports', 'activities']],
  ['/crm/leads/123/restore', ['leads', 'counts-leads', 'archived-crm']],
  ['/crm/contacts/123/restore', ['contacts', 'counts-contacts', 'archived-crm']],
  ['/crm/accounts/123/restore', ['accounts', 'counts-accounts', 'archived-crm']],
  ['/crm/leads/123/convert', ['contacts', 'leads', 'accounts']],
  ['/marketing/templates/123', ['campaigns']],
  ['/notifications/123/read', ['notifications']],
  ['/administration/archived-data/Pipeline/123/restore', ['archived-crm', 'pipeline', 'pipelines']],
  ['/administration/archived-data/Workflow/123/restore', ['archived-crm', 'workflows']],
  ['/administration/archived-data/Template/123/restore', ['archived-crm', 'campaigns', 'templates']],
])('invalidates caches after a successful mutation to %s', async (path, modules) => {
  await apiClient.patch(path);
  for (const module of modules) expect(getPageCache(module, 'tenant-a', {})).toBeNull();
});

it('does not invalidate data for failed writes or GET requests', async () => {
  await apiClient.get('/crm/contacts');
  expect(getPageCache('contacts', 'tenant-a', {})).not.toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'failed' }) } as Response);
  await expect(apiClient.patch('/crm/contacts/123/archive')).rejects.toThrow('failed');
  expect(getPageCache('contacts', 'tenant-a', {})).not.toBeNull();
});

it('forwards the cancellation signal to fetch', async () => {
  const controller = new AbortController();
  await apiClient.get('/crm/leads', { signal: controller.signal });
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
});
