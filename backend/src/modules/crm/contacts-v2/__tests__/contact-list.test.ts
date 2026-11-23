import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ $transaction: vi.fn(), lead: { findMany: vi.fn() }, deal: { findMany: vi.fn() }, contact: {
  fields: { createdAt: { reference: 'createdAt' } }, findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(),
} }));
vi.mock('../../../../config/database.config', () => ({ default: db }));
import { findAllContacts } from '../contacts-v2.repository';
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(work => work(db));
  db.lead.findMany.mockResolvedValue([]); db.deal.findMany.mockResolvedValue([]);
  db.contact.findMany.mockResolvedValue([]); db.contact.count.mockResolvedValue(140); db.contact.groupBy.mockResolvedValue([]);
});

it('combines all Contact filters before paging and keeps tenant context in relationships', async () => {
  await findAllContacts('tenant', { page: 2, limit: 25, sort: 'createdAt:desc', currentUserId: 'viewer', filter: {
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
  expect(db.contact.findMany.mock.calls[0][0].where.AND).toEqual([
    { tenantId: 'tenant' }, { status: { in: ['INQUIRY', 'HOT', 'WARM'] } },
  ]);
});

it('sorts date pages in the database without reading the full collection', async () => {
  db.contact.findMany.mockResolvedValueOnce([{ id: 'page-id' }]).mockResolvedValueOnce([{ id: 'page-id', status: 'WARM' }]);
  const result = await findAllContacts('tenant', { page: 3, limit: 25, sort: 'createdAt:asc' });
  expect(db.contact.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 'tenant' }, skip: 50, take: 25, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  expect(result).toMatchObject({ total: 140, page: 3, limit: 25, data: [{ id: 'page-id' }] });
});

it('pages by latest sales activity by default, including converted Lead Deals', async () => {
  const contacts = [
    { id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') },
    { id: 'converted', createdAt: new Date('2026-01-02T00:00:00Z') },
    { id: 'recent', createdAt: new Date('2026-01-03T00:00:00Z') },
  ];
  const convertedActivity = new Date('2026-01-04T00:00:00Z');
  db.contact.findMany.mockResolvedValueOnce(contacts).mockResolvedValueOnce([contacts[1]]);
  db.lead.findMany.mockResolvedValueOnce([{ id: 'source-lead', contactId: 'converted' }]);
  db.deal.findMany.mockResolvedValueOnce([
    { createdAt: new Date('2026-01-05T00:00:00Z'), leadDeals: [], contactDeals: [{ contactId: 'old' }] },
    { createdAt: convertedActivity, leadDeals: [{ leadId: 'source-lead' }], contactDeals: [] },
  ]);

  const result = await findAllContacts('tenant', { page: 2, limit: 1 });

  expect(result).toMatchObject({ page: 2, limit: 1, total: 140, data: [{ id: 'converted', lastSalesActivityAt: convertedActivity }] });
  expect(db.contact.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
    skip: 0, take: 1, where: expect.objectContaining({ tenantId: 'tenant', id: { in: ['converted'] } }),
  }));
  expect(db.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    tenantId: 'tenant', contactId: { in: contacts.map(contact => contact.id) }, convertedAt: { not: null },
  } }));
  expect(db.deal.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant', AND: [{ tenantId: 'tenant' }] });
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
});

it('sorts and displays the current Account name for linked Contacts', async () => {
  const rows = [
    { id: 'b', companyName: 'Alpha', account: { name: 'Zebra' } },
    { id: 'a', companyName: 'Zebra', account: { name: 'Alpha' } },
  ];
  db.contact.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
  const result = await findAllContacts('tenant', { sort: 'companyName:asc' });
  expect(result.data).toMatchObject([{ id: 'a', companyName: 'Alpha' }, { id: 'b', companyName: 'Zebra' }]);
  for (const field of ['lastName', 'phone', 'status', 'source']) await expect(findAllContacts('tenant', { sort: `${field}:asc` })).resolves.toBeDefined();
});
it('sorts First Name alone, with record ID as the tie-breaker', async () => {
  const rows = [{ id: 'b', firstName: 'Ana', lastName: 'Alpha' }, { id: 'a', firstName: 'ana', lastName: 'Zulu' }];
  db.contact.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
  const result = await findAllContacts('tenant', { sort: 'firstName:asc' });
  expect(result.data.map(row => row.id)).toEqual(['a', 'b']);
});

it('searches full Contact names and related Accounts before pagination while retaining scope', async () => {
  await findAllContacts('tenant', { page: 3, limit: 25, sort: 'createdAt:desc', search: '  Mary   Jane de la Cruz  ', currentUserId: 'agent', filter: { scope: 'equals:my' } });
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
