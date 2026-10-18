import { beforeEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: transport }));
import { contactsV2Api, toContactWrite } from './contacts-v2.api';
import { RETIRED_CONTACT_FIELDS } from '@leadcrm/shared';
beforeEach(() => {
  vi.clearAllMocks();
  transport.post.mockResolvedValue({ success: true, data: { id: 'contact', companyName: 'Acme', source: 'Referral', accountId: 'account' } });
  transport.put.mockResolvedValue({ success: true, data: { id: 'contact' } });
});
it('excludes all retired Contact fields from transport and response compatibility', async () => {
  const retired = Object.fromEntries(RETIRED_CONTACT_FIELDS.map(field=>[field,'legacy']));
  expect(toContactWrite({ firstName:'Nora', ...retired } as never)).toEqual({firstName:'Nora'});
  transport.get.mockResolvedValue({success:true,data:[{id:'contact',lifecycleStage:'CUSTOMER',customerSince:'2020-01-01',productInterests:['CCTV'],...retired}],meta:{total:1}});
  const result = await contactsV2Api.list();
  for (const field of RETIRED_CONTACT_FIELDS) expect(result.data[0]).not.toHaveProperty(field);
  expect(result.data[0]).toMatchObject({lifecycleStage:'CUSTOMER',customerSince:'2020-01-01',productInterests:['CCTV']});
});
it('translates all display aliases to persisted Contact fields on create and edit', async () => {
  const draft = { companyName: 'Acme', leadSource: 'Referral', productInterest: ['CCTV'], accountId: 'account' };
  const expected = { companyName: 'Acme', source: 'Referral', productInterests: ['CCTV'], accountId: 'account' };
  const requestId = '96eaed35-af9f-4686-8854-83c5da0f8e05';
  const response = await contactsV2Api.create({ ...draft, requestId });
  expect(transport.post).toHaveBeenCalledWith('/crm/contacts', { ...expected, requestId });
  expect(response.data).toMatchObject({ companyName: 'Acme', leadSource: 'Referral', accountId: 'account', organizationId: 'account' });
  await contactsV2Api.update('contact', draft);
  expect(transport.put).toHaveBeenCalledWith('/crm/contacts/contact', expected);
  expect(toContactWrite({ companyName: '', leadSource: '', productInterest: [] })).toEqual({ companyName: '', source: '', productInterests: [] });
  expect(toContactWrite({ ...draft, requestId } as never)).not.toHaveProperty('requestId');
});
it('makes exactly one list request with server page, sort, search and filters', async () => {
  transport.get.mockResolvedValue({ success: true, data: [], meta: { total: 10000, page: 2, limit: 25, hasMore: true } });
  const result = await contactsV2Api.list({ page: 2, limit: 25, sort: 'companyName:asc', search: 'acme', filters: [{ field: 'related', operator: 'in', value: ['has_deals'] }] });
  expect(transport.get).toHaveBeenCalledOnce();
  expect(transport.get).toHaveBeenCalledWith('/crm/contacts', { params: { page: 2, limit: 25, sort: 'companyName:asc', search: 'acme', 'filter[related]': 'in:has_deals' }, signal: undefined });
  expect(result.meta.total).toBe(10000);
});
