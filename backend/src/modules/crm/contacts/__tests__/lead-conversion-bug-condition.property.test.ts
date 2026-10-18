import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as fc from 'fast-check';
import { conversionFixture } from './conversion-fixture';
vi.mock('../../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.CONVERSION_TEST_DATABASE_URL! } } }) }));
vi.mock('../../../automation/triggers/triggers.service', () => ({ fireLeadUpdated: vi.fn(), fireLeadStatusChanged: vi.fn(), fireContactCreated: vi.fn(), fireContactUpdated: vi.fn(), fireContactStatusChanged: vi.fn(), fireDealUpdated: vi.fn() }));
let fixture: Awaited<ReturnType<typeof conversionFixture>>;
beforeAll(async () => { fixture = await conversionFixture(); }, 180000);
afterAll(async () => { await fixture?.close(); });
it('converts varied company names on the fully migrated schema without unknown Contact fields', async () => {
  const accounts = new Map<string, { id: string; name: string }>();
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}$/), async name => {
    const normalizedName = name.trim().replace(/\s+/g, ' ');
    const identity = normalizedName.toLowerCase();
    const existing = accounts.get(identity);
    const { lead, deal } = await fixture.inquiry(name);
    const result = await fixture.convert(lead.id);
    expect(result.contact.companyName).toBe(name);
    // Case/whitespace variants reuse the Account without rewriting its saved name.
    expect(result.account?.name).toBe(existing?.name ?? normalizedName);
    expect(result.account).not.toBeNull();
    if (existing) expect(result.account?.id).toBe(existing.id);
    expect(result.contact.accountId).toBe(result.account?.id);
    expect(result.lead.accountId).toBe(result.account?.id);
    expect(result.contact.status).toBe('Closed');
    expect(await fixture.db.leadDeal.count({ where: { leadId: lead.id, dealId: deal.id } })).toBe(1);
    expect(await fixture.db.contactDeal.count({ where: { contactId: result.contact.id, dealId: deal.id } })).toBe(1);
    accounts.set(identity, { id: result.account!.id, name: existing?.name ?? normalizedName });
    expect(await fixture.db.account.count({ where: { tenantId: 'conversion' } })).toBe(accounts.size);
  }), { numRuns: 12, examples: [['w'], ['W'], ['W ']] });
}, 30000);
