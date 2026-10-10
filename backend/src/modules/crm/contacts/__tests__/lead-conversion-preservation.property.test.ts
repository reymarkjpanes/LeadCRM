import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { conversionFixture } from './conversion-fixture';
vi.mock('../../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.CONVERSION_TEST_DATABASE_URL! } } }) }));
vi.mock('../../../automation/triggers/triggers.service', () => ({ fireLeadUpdated: vi.fn(), fireLeadStatusChanged: vi.fn(), fireContactCreated: vi.fn(), fireContactUpdated: vi.fn(), fireContactStatusChanged: vi.fn(), fireDealUpdated: vi.fn() }));
let fixture: Awaited<ReturnType<typeof conversionFixture>>;
beforeAll(async () => { fixture = await conversionFixture(); }, 60000);
afterAll(async () => { await fixture?.close(); });
it('retries reuse the converted identity and preserve original Deal and conversion history', async () => {
  const { lead, deal } = await fixture.inquiry('Repeat customer');
  const first = await fixture.convert(lead.id);
  const original = await fixture.db.deal.findUniqueOrThrow({ where: { id: deal.id } });
  const second = await fixture.convert(lead.id, { contactId: '8f4c4b89-a3f6-4f14-b7ce-0db7ec7cff2c' });
  expect(second.contact.id).toBe(first.contact.id);
  expect(second.lead.convertedAt).toEqual(first.lead.convertedAt);
  expect(await fixture.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).toEqual(original);
  expect(await fixture.db.auditLog.count({ where: { action: 'lead.converted', entityId: lead.id } })).toBe(1);
  expect(await fixture.db.contactDeal.count({ where: { dealId: deal.id } })).toBe(1);
});
it('rejects unsupported conversion options before changing any record', async () => {
  const { lead } = await fixture.inquiry('Options');
  const before = await fixture.db.lead.findUniqueOrThrow({ where: { id: lead.id } });
  for (const option of [{ createContact: false }, { createDeal: true }]) await expect(fixture.convert(lead.id, option)).rejects.toThrow();
  expect(await fixture.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toEqual(before);
  expect(await fixture.db.contact.count({ where: { email: lead.email } })).toBe(0);
});
it('rolls back conversion on missing and foreign Account links', async () => {
  const foreign = await fixture.db.account.create({ data: { tenantId: 'foreign', name: 'Foreign' } });
  await fc.assert(fc.asyncProperty(fc.uuid(), async missing => {
    const { lead } = await fixture.inquiry('Rollback');
    const before = await fixture.db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    for (const accountId of [missing, foreign.id]) await expect(fixture.convert(lead.id, { accountId })).rejects.toThrow();
    expect(await fixture.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toEqual(before);
    expect(await fixture.db.contact.count({ where: { email: lead.email } })).toBe(0);
  }), { numRuns: 4 });
}, 30000);
it('keeps the real Lead list paginated, scoped and searchable after conversion', async () => {
  const { lead } = await fixture.inquiry('Search target');
  await fixture.db.lead.create({ data: { tenantId: 'foreign', firstName: 'John', lastName: 'Foreign' } });
  for (const limit of [1, 5, 25]) {
    const result = await fixture.getContacts('conversion', { search: lead.email!, page: 1, limit });
    expect(result.data.map(row => row.id)).toEqual([lead.id]);
    expect(result.meta).toMatchObject({ page: 1, limit, total: 1, hasMore: false });
  }
});
it('preserves distinct Product IDs when a retired catalog name is reused', async () => {
  const { lead } = await fixture.inquiry('Product identity customer');
  await fixture.db.productInterest.update({ where: { id: 'product' }, data: { active: false } });
  const duplicate = await fixture.db.productInterest.create({ data: { tenantId: 'conversion', name: 'CRM Enterprise', dealValue: 900 } });
  const account = await fixture.db.account.create({ data: { tenantId: 'conversion', name: lead.companyName!, productsNormalized: true,
    productLinks: { create: { productInterestId: duplicate.id, position: 0, interested: true, activeProduct: true } } } });
  const existing = await fixture.db.contact.create({ data: { tenantId: 'conversion', firstName: 'Existing', lastName: 'Customer', email: lead.email,
    accountId: account.id, productsNormalized: true, productLinks: { create: { productInterestId: duplicate.id, position: 0, interested: true, activeProduct: true } } } });
  const result = await fixture.convert(lead.id);
  expect(result.contact.id).toBe(existing.id);
  const contactLinks = await fixture.db.contactProductInterest.findMany({ where: { contactId: existing.id } });
  expect(contactLinks.map(link => link.productInterestId).sort()).toEqual([duplicate.id, 'product'].sort());
  expect(contactLinks.every(link => link.interested && link.activeProduct)).toBe(true);
  const accountLinks = await fixture.db.accountProductInterest.findMany({ where: { accountId: account.id } });
  expect(accountLinks.map(link => link.productInterestId).sort()).toEqual([duplicate.id, 'product'].sort());
  expect(accountLinks.find(link => link.productInterestId === 'product')?.activeProduct).toBe(false);
  expect(await fixture.db.contact.findFirst({ where: { id: existing.id }, select: { productsNormalized: true } })).toEqual({ productsNormalized: true });
});
