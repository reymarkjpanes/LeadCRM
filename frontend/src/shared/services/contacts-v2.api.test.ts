import { beforeEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: transport }));
import { contactsV2Api, toContactWrite } from './contacts-v2.api';
beforeEach(() => {
  vi.clearAllMocks();
  transport.post.mockResolvedValue({ success: true, data: { id: 'contact', company: 'Acme', source: 'Referral', accountId: 'account' } });
  transport.put.mockResolvedValue({ success: true, data: { id: 'contact' } });
});
it('translates all display aliases to persisted Contact fields on create and edit', async () => {
  const draft = { companyName: 'Acme', leadSource: 'Referral', productInterest: ['CCTV'], accountId: 'account' };
  const expected = { company: 'Acme', source: 'Referral', productInterests: ['CCTV'], accountId: 'account' };
  const response = await contactsV2Api.create(draft);
  expect(transport.post).toHaveBeenCalledWith('/crm/contacts', expected);
  expect(response.data).toMatchObject({ companyName: 'Acme', leadSource: 'Referral', accountId: 'account', organizationId: 'account' });
  await contactsV2Api.update('contact', draft);
  expect(transport.put).toHaveBeenCalledWith('/crm/contacts/contact', expected);
  expect(toContactWrite({ companyName: '', leadSource: '', productInterest: [] })).toEqual({ company: '', source: '', productInterests: [] });
});
it('makes exactly one list request with server page, sort, search and filters', async () => {
  transport.get.mockResolvedValue({ success: true, data: [], meta: { total: 10000, page: 2, limit: 25, hasMore: true } });
  const result = await contactsV2Api.list({ page: 2, limit: 25, sort: 'companyName:asc', search: 'acme', filters: [{ field: 'related', operator: 'in', value: ['has_deals'] }] });
  expect(transport.get).toHaveBeenCalledOnce();
  expect(transport.get).toHaveBeenCalledWith('/crm/contacts', { params: { page: 2, limit: 25, sort: 'companyName:asc', search: 'acme', 'filter[related]': 'in:has_deals' }, signal: undefined });
  expect(result.meta.total).toBe(10000);
});
