import type { NextFunction, Request, Response } from 'express';
import { beforeEach, expect, it, vi } from 'vitest';
import { exportCrm } from './crm-export.controller';

const mocks = vi.hoisted(() => ({ list: vi.fn(), policy: vi.fn() }));
vi.mock('../../../config/database.config', () => ({ default: { $transaction: (read: (tx: object) => Promise<unknown>) => read({}) } }));
vi.mock('../contacts/contacts.service', () => ({ getContacts: mocks.list }));
vi.mock('../contacts-v2/contacts-v2.service', () => ({ getContacts: mocks.list }));
vi.mock('../companies/companies.service', () => ({ getCompanies: mocks.list }));
vi.mock('../deals/deals.service', () => ({ getDeals: mocks.list }));
vi.mock('../deals/deal-presentation', () => ({ presentDealResponse: (_tenantId: string, result: unknown) => result }));
vi.mock('../access/crm-record-access.service', () => ({ requestedCrmScope: (_filters: unknown, scope: string | undefined) => scope ?? 'all', resolveCrmActor: mocks.policy }));

const row = { firstName: 'Matching', lastName: 'Record', name: 'Matching Record', title: 'Matching Record', stageId: 'stage', priority: 'HIGH', createdAt: new Date(), stage: { isWon: false, isLost: false } };
function request(query = {}) {
  return { query, user: { userId: 'actor', tenantId: 'tenant' } } as unknown as Request;
}
function response() {
  return { set: vi.fn(), send: vi.fn() } as unknown as Response;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.policy.mockResolvedValue({ userId: 'actor', tenantId: 'tenant', crmTeamUserIds: ['actor'] });
});

it.each(['leads', 'contacts', 'accounts', 'deals'] as const)('returns the existing empty-result error before creating a %s file', async module => {
  mocks.list.mockResolvedValue({ data: [], meta: { hasMore: false } });
  const res = response(), next = vi.fn<NextFunction>();
  await exportCrm(module)(request(), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: 'No data available to export.' }));
  expect(res.set).not.toHaveBeenCalled(); expect(res.send).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledWith('tenant', expect.objectContaining({ page: 1, limit: 100,
    ...(module === 'deals' ? { scope: 'all' } : { currentUserId: 'actor' }),
  }));
});

it.each(['leads', 'contacts', 'accounts', 'deals'] as const)('preserves populated %s exports and replaces browser pagination', async module => {
  mocks.list.mockResolvedValue({ data: [row], meta: { hasMore: false } });
  const res = response(), next = vi.fn<NextFunction>();
  await exportCrm(module)(request({ page: '99', limit: '1', pageSize: '1' }), res, next);
  expect(next).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledWith('tenant', expect.objectContaining({ page: 1, limit: 100 }));
  expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'text/csv; charset=utf-8' }));
  expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Matching'));
});

it('rejects Deals that are all removed by the final export view filters', async () => {
  mocks.list.mockResolvedValue({ data: [row], meta: { hasMore: false } });
  const res = response(), next = vi.fn<NextFunction>();
  await exportCrm('deals')(request({ view: JSON.stringify({ search: 'No match', filters: {} }) }), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  expect(res.set).not.toHaveBeenCalled(); expect(res.send).not.toHaveBeenCalled();
});

it('continues through filtered-out Deal batches before deciding whether export is empty', async () => {
  mocks.list.mockResolvedValueOnce({ data: [{ ...row, title: 'Excluded' }], meta: { hasMore: true } })
    .mockResolvedValueOnce({ data: [row], meta: { hasMore: false } });
  const res = response(), next = vi.fn<NextFunction>();
  await exportCrm('deals')(request({ view: JSON.stringify({ search: 'Matching', filters: {} }) }), res, next);
  expect(next).not.toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Matching Record'));
  expect(res.send).not.toHaveBeenCalledWith(expect.stringContaining('Excluded'));
});

it('rejects a completed export when Group authority changes while loading', async () => {
  mocks.policy.mockResolvedValueOnce({ userId: 'actor', tenantId: 'tenant', crmTeamUserIds: ['actor', 'group-member'] })
    .mockResolvedValueOnce({ userId: 'actor', tenantId: 'tenant', crmTeamUserIds: ['actor'] });
  mocks.list.mockResolvedValue({ data: [row], meta: { hasMore: false } });
  const res = response(), next = vi.fn<NextFunction>();
  await exportCrm('deals')(request(), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, message: 'Export access changed. Please retry.' }));
  expect(res.set).not.toHaveBeenCalled(); expect(res.send).not.toHaveBeenCalled();
});

it('rejects a completed export when the actor is deactivated during loading', async () => {
  mocks.policy.mockResolvedValueOnce({ userId: 'actor', tenantId: 'tenant', crmTeamUserIds: ['actor'] })
    .mockRejectedValueOnce(Object.assign(new Error('Account access is unavailable.'), { statusCode: 403 }));
  mocks.list.mockResolvedValue({ data: [row], meta: { hasMore: false } });
  const res = response(), next = vi.fn<NextFunction>();
  await exportCrm('leads')(request(), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  expect(res.set).not.toHaveBeenCalled(); expect(res.send).not.toHaveBeenCalled();
});
