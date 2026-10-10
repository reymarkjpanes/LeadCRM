import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { conversionFixture } from './conversion-fixture';
vi.mock('../../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.CONVERSION_TEST_DATABASE_URL! } } }) }));
vi.mock('../../../automation/triggers/triggers.service', () => ({ fireLeadUpdated: vi.fn(), fireLeadStatusChanged: vi.fn(), fireContactCreated: vi.fn(), fireContactUpdated: vi.fn(), fireContactStatusChanged: vi.fn(), fireDealUpdated: vi.fn() }));
let fixture: Awaited<ReturnType<typeof conversionFixture>>;
beforeAll(async () => { fixture = await conversionFixture(); }, 60000);
afterAll(async () => { await fixture?.close(); });
it('converts varied company names on the fully migrated schema without unknown Contact fields', async () => {
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}$/), async name => {
    const { lead, deal } = await fixture.inquiry(name);
    const result = await fixture.convert(lead.id);
    expect(result.contact.company).toBe(name);
    expect(result.account?.name).toBe(name.trim().replace(/\s+/g, ' '));
    expect(result.contact.status).toBe('Closed');
    expect(await fixture.db.leadDeal.count({ where: { leadId: lead.id, dealId: deal.id } })).toBe(1);
    expect(await fixture.db.contactDeal.count({ where: { contactId: result.contact.id, dealId: deal.id } })).toBe(1);
  }), { numRuns: 12 });
}, 30000);
