import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ contact: {
  fields: { createdAt: { reference: 'createdAt' } }, findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(),
} }));
vi.mock('../../../../config/database.config', () => ({ default: db }));
import { findAllContacts } from '../contacts-v2.repository';
beforeEach(() => {
  vi.clearAllMocks(); db.contact.findMany.mockResolvedValue([]); db.contact.count.mockResolvedValue(140); db.contact.groupBy.mockResolvedValue([]);
});

it('combines all Contact filters before paging and keeps tenant context in relationships', async () => {
  await findAllContacts('tenant', { page: 2, limit: 25, currentUserId: 'viewer', filter: {
    scope: 'equals:my', status: 'in:Hot,Warm', assignedUserId: 'in:viewer,colleague', system: 'in:touched', related: 'in:has_deals',
  } });
  expect(db.contact.findMany).toHaveBeenCalledOnce();
  expect(db.contact.findMany.mock.calls[0][0]).toMatchObject({ skip: 25, take: 25, where: {
    tenantId: 'tenant', isArchived: false, AND: expect.arrayContaining([
      { status: { in: ['HOT', 'WARM'] } }, { assignedUserId: 'viewer' },
      { assignedUserId: { in: ['viewer', 'colleague'] } },
      { updatedAt: { gt: db.contact.fields.createdAt } },
      { contactDeals: { some: { tenantId: 'tenant', deal: { tenantId: 'tenant', isArchived: false } } } },
    ]),
  } });
  expect(JSON.stringify(db.contact.findMany.mock.calls[0][0].where)).not.toContain('other');
});

it.each([{ tenantId: 'equals:other' }, { status: 'gte:Hot' }, { assignedUserId: 'contains:viewer' }, { related: 'in:has_password' }])('rejects unsupported Contact filters before querying: %j', async filter => {
  await expect(findAllContacts('tenant', { filter })).rejects.toThrow();
  expect(db.contact.findMany).not.toHaveBeenCalled();
});

it('keeps active tab status scope and handles both update choices as all records', async () => {
  await findAllContacts('tenant', { filter: { scope: 'equals:active', system: 'in:touched,untouched' } });
  expect(db.contact.findMany.mock.calls[0][0].where.AND).toEqual([{ status: { in: ['HOT', 'WARM'] } }]);
});

it('sorts date pages in the database without reading the full collection', async () => {
  db.contact.findMany.mockResolvedValueOnce([{ id: 'page-id' }]).mockResolvedValueOnce([{ id: 'page-id', status: 'WARM' }]);
  const result = await findAllContacts('tenant', { page: 3, limit: 25, sort: 'createdAt:asc' });
  expect(db.contact.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 'tenant' }, skip: 50, take: 25, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  expect(result).toMatchObject({ total: 140, page: 3, limit: 25, data: [{ id: 'page-id' }] });
});

it('sorts the displayed Company instead of the linked Account name', async () => {
  db.contact.findMany.mockResolvedValueOnce([
    { id: 'b', companyName: 'Alpha', account: { name: 'Zebra' } },
    { id: 'a', companyName: 'Zebra', account: { name: 'Alpha' } },
  ]).mockResolvedValueOnce([{ id: 'b' }, { id: 'a' }]);
  const result = await findAllContacts('tenant', { sort: 'companyName:asc' });
  expect(result.data.map(row => row.id)).toEqual(['b', 'a']);
  for (const field of ['lastName', 'phone', 'status', 'source']) await expect(findAllContacts('tenant', { sort: `${field}:asc` })).resolves.toBeDefined();
});
it('sorts First Name alone, with record ID as the tie-breaker', async () => {
  const rows = [{ id: 'b', firstName: 'Ana', lastName: 'Alpha' }, { id: 'a', firstName: 'ana', lastName: 'Zulu' }];
  db.contact.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
  const result = await findAllContacts('tenant', { sort: 'firstName:asc' });
  expect(result.data.map(row => row.id)).toEqual(['a', 'b']);
});

it('searches full Contact names and related Accounts before pagination while retaining scope', async () => {
  await findAllContacts('tenant', { page: 3, limit: 25, search: '  Mary   Jane de la Cruz  ', currentUserId: 'agent', filter: { scope: 'equals:my' } });
  const { where, skip, take } = db.contact.findMany.mock.calls[0][0];
  expect({ skip, take }).toEqual({ skip: 50, take: 25 });
  expect(where).toMatchObject({ tenantId: 'tenant', isArchived: false });
  expect(where.AND).toContainEqual({ assignedUserId: 'agent' });
  for (const term of ['Mary', 'Jane', 'de', 'la', 'Cruz']) expect(where.AND).toContainEqual({ OR: expect.arrayContaining([
    { firstName: { contains: term, mode: 'insensitive' } },
    { lastName: { contains: term, mode: 'insensitive' } },
    { account: { name: { contains: term, mode: 'insensitive' } } },
  ]) });
  expect(db.contact.count.mock.calls[0][0].where).toEqual(where);
});
