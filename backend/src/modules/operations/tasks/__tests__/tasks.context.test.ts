import { expect, it, vi } from 'vitest';
import type { TaskRecord } from '@leadcrm/shared';
vi.mock('../tasks.repository', () => ({ findTaskRecordContext: vi.fn() }));
import { withTaskContext } from '../tasks.context';

const task: TaskRecord = { id: 'task', tenantId: 'tenant', title: 'Workflow follow-up', description: '', status: 'pending', dueDate: '2030-01-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', assignedUserId: 'owner', dealIds: ['deal'], accountIds: ['account'], accountId: 'account' };
const person = (id: string, tenantId = 'tenant') => ({ id, tenantId, firstName: id, lastName: 'Person' });
const account = { id: 'account', tenantId: 'tenant', name: 'Acme' };

it('shows Deal workflow CRM connections, deduplicates junction/legacy records, and preserves explicit associations', () => {
  const result = withTaskContext(task, { leads: [], contacts: [], accounts: [account], deals: [{ id: 'deal', tenantId: 'tenant', title: 'Expansion', organization: account, lead: person('lead'), contact: person('contact'), leadDeals: [{ lead: person('lead') }], contactDeals: [{ contact: person('contact') }] }] });
  expect(result.relatedRecords).toEqual([
    { kind: 'lead', id: 'lead', label: 'lead Person', via: 'Deal: Expansion' },
    { kind: 'contact', id: 'contact', label: 'contact Person', via: 'Deal: Expansion' },
  ]);
  expect(result.dealIds).toEqual(['deal']);
  expect(result.leadIds).toBeUndefined();
  expect(result.account).toEqual({ id: 'account', name: 'Acme' });
  expect(result.accounts).toEqual([result.account]);
});

it('keeps foreign-tenant and unrelated source records out of the response', () => {
  const result = withTaskContext(task, { leads: [], contacts: [], accounts: [{ ...account, tenantId: 'foreign' }], deals: [
    { id: 'deal', tenantId: 'tenant', title: 'Expansion', organization: { ...account, id: 'foreign', tenantId: 'foreign' }, lead: person('foreign', 'foreign'), contact: null, leadDeals: [], contactDeals: [] },
    { id: 'unrelated', tenantId: 'tenant', title: 'Other', organization: null, lead: person('other'), contact: null, leadDeals: [], contactDeals: [] },
  ] });
  expect(result.relatedRecords).toEqual([]);
  expect(result.accounts).toEqual([]);
  expect(result.account).toBeNull();
});

it('includes the connected Account, converted Contact, and all Deals for a Lead task', () => {
  const deal = { id: 'deal', tenantId: 'tenant', title: 'Expansion' };
  const result = withTaskContext({ ...task, dealIds: [], accountIds: [], accountId: null, leadIds: ['lead'] }, {
    leads: [{ ...person('lead'), account, convertedContact: person('contact'), deals: [deal], leadDeals: [{ deal }] }], contacts: [], deals: [], accounts: [],
  });
  expect(result.relatedRecords?.map(row => row.kind)).toEqual(['contact', 'account', 'deal']);
  expect(result.contactIds).toBeUndefined();
});
