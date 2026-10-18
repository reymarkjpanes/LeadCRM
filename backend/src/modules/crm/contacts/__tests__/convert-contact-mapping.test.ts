import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { conversionFixture } from './conversion-fixture';
vi.mock('../../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.CONVERSION_TEST_DATABASE_URL! } } }) }));
vi.mock('../../../automation/triggers/triggers.service', () => ({ fireLeadUpdated: vi.fn(), fireLeadStatusChanged: vi.fn(), fireContactCreated: vi.fn(), fireContactUpdated: vi.fn(), fireContactStatusChanged: vi.fn(), fireDealUpdated: vi.fn() }));
let fixture: Awaited<ReturnType<typeof conversionFixture>>;
beforeAll(async () => { fixture = await conversionFixture(); }, 60000);
afterAll(async () => { await fixture?.close(); });
it('maps Lead fields into real Contact columns and normalized Product links after a confirmed sale', async () => {
  const { lead, deal } = await fixture.inquiry('ABC Corporation');
  const result = await fixture.convert(lead.id);
  const contact = await fixture.db.contact.findUniqueOrThrow({ where: { id: result.contact.id }, include: { productLinks: true } });
  expect(contact).toMatchObject({ firstName: 'John', lastName: 'Smith', companyName: 'ABC Corporation', address: 'Makati', source: 'Website', notes: 'Original inquiry', status: 'CLOSED', lifecycleStage: 'CUSTOMER' });
  expect(contact.productLinks).toEqual([expect.objectContaining({ productInterestId: 'product', interested: true, activeProduct: false })]);
  expect(contact.productInterests).toEqual(['CRM Enterprise']);
  expect(contact).not.toHaveProperty('activeProducts');
  expect(contact.customerSince).toBeInstanceOf(Date);
  expect(contact.convertedAt).toBeInstanceOf(Date);
  expect(contact.productLinks[0]).not.toHaveProperty('product');
  expect(await fixture.db.contact.findUniqueOrThrow({ where: { id: contact.id }, select: {
    productInterests: true, productLinks: { select: { productInterestId: true } },
  } })).toEqual({ productInterests: ['CRM Enterprise'], productLinks: [{ productInterestId: 'product' }] });
  expect(result.lead).toMatchObject({ status: lead.status, contactId: contact.id, accountId: contact.accountId });
  expect(result.lead.convertedAt).toBeInstanceOf(Date);
  expect(await fixture.db.contactDeal.count({ where: { contactId: contact.id, dealId: deal.id } })).toBe(1);
  expect(await fixture.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ value: 12500, stageId: 'won', title: 'Original sale' });
});
it('basic conversion preserves the Lead status and existing open Deal without recording a sale', async () => {
  const { lead, deal } = await fixture.inquiry('Not yet sold', false);
  const result = await fixture.convert(lead.id);
  expect(result.lead).toMatchObject({ status: lead.status, contactId: result.contact.id });
  expect(result.lead.convertedAt).toBeInstanceOf(Date);
  const contact = await fixture.db.contact.findUniqueOrThrow({ where: { id: result.contact.id } });
  expect(contact.status).toBe('WARM');
  expect(contact.lifecycleStage).not.toBe('CUSTOMER');
  expect(contact.customerSince).toBeNull();
  expect(await fixture.db.contactDeal.count({ where: { contactId: contact.id, dealId: deal.id } })).toBe(1);
  expect(await fixture.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ stageId: 'open', wonConfirmedAt: null, hasEverBeenWon: false });
});
