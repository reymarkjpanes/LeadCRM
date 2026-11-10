import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api/client';
import { clearPageCache, getPageCache, setPageCache, subscribePageCacheInvalidation } from '../page-cache';

beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  for (const module of ['settings', 'deals', 'leads', 'contacts', 'accounts', 'tasks', 'campaigns', 'templates', 'pipeline', 'pipelines', 'workflows', 'reports', 'activities', 'notifications', 'archived-crm', 'counts-leads', 'counts-contacts', 'counts-accounts', 'counts-deals']) {
    setPageCache(module, 'tenant-a', {}, ['before-write']);
  }
});
afterEach(() => { vi.unstubAllGlobals(); clearPageCache(); });

it.each([
  ['/crm/merge', ['leads', 'contacts', 'accounts', 'deals', 'tasks', 'campaigns', 'counts-leads', 'activities']],
  ['/administration/closing-requirements/123', ['settings', 'leads', 'contacts', 'accounts', 'deals']],
  ['/administration/organization-settings', ['settings']],
  ['/crm/contacts/123/archive', ['contacts', 'leads', 'accounts', 'reports', 'activities']],
  ['/crm/leads/123/restore', ['leads', 'counts-leads', 'archived-crm']],
  ['/crm/contacts/123/restore', ['contacts', 'counts-contacts', 'archived-crm']],
  ['/crm/accounts/123/restore', ['accounts', 'leads', 'contacts', 'deals', 'counts-accounts', 'archived-crm']],
  ['/crm/accounts/123', ['accounts', 'leads', 'contacts', 'deals']],
  ['/crm/leads/123/convert', ['contacts', 'leads', 'accounts']],
  ['/crm/contacts', ['contacts', 'accounts', 'deals', 'counts-deals', 'reports', 'activities']],
  ['/marketing/templates/123', ['campaigns']],
  ['/notifications/123/read', ['notifications']],
  ['/administration/archived-data/Pipeline/123/restore', ['archived-crm', 'pipeline', 'pipelines']],
  ['/administration/archived-data/Workflow/123/restore', ['archived-crm', 'workflows']],
  ['/administration/archived-data/Product/123/restore', ['archived-crm']],
  ['/administration/product-interests/123', ['archived-crm']],
  ['/administration/archived-data/Task/123/restore', ['archived-crm', 'tasks', 'activities', 'reports']],
  ['/operations/tasks/123/archive', ['archived-crm', 'tasks', 'activities', 'reports']],
  ['/operations/tasks/bulk', ['archived-crm', 'tasks', 'activities', 'reports']],
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

it('evicts mounted Workflow readers after group changes and notifies authorization-wide mutations', async () => {
  const changed = vi.fn();
  const unsubscribe = subscribePageCacheInvalidation(changed);
  try {
    await apiClient.patch('/administration/groups/group-id');
    expect(changed).toHaveBeenCalledWith('workflows', undefined, true);
    changed.mockClear();
    await apiClient.patch('/administration/users/user-id');
    expect(changed).toHaveBeenCalledWith('*');
    changed.mockClear();
    await apiClient.patch('/administration/roles/role-id');
    expect(changed).toHaveBeenCalledWith('*');
  } finally { unsubscribe(); }
});

it.each(['/automation/workflows/validate', '/automation/workflows/workflow-id/test'])('keeps read-only Workflow previews after %s', async path => {
  const changed = vi.fn();
  const unsubscribe = subscribePageCacheInvalidation(changed);
  try {
    await apiClient.post(path, {});
    expect(getPageCache('workflows', 'tenant-a', {})).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
  } finally { unsubscribe(); }
});
