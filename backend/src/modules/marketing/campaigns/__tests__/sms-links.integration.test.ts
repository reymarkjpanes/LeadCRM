import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SMS_MAX_LENGTH } from '@leadcrm/shared';
vi.mock('../../../../shared/services/sms.service', async original => ({ ...await original<object>(), sendSms: vi.fn(), getSmsDeviceId: vi.fn(async () => 'test-device') }));
vi.mock('../../../notifications/notification-events.service', async original => ({ ...await original<object>(), requestNotificationDispatch: vi.fn() }));
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { createCampaign, sendCampaign, getCampaignReport, scheduleCampaign, dispatchDueCampaigns } from '../campaigns.service';
import { createAudience } from '../audiences.service';
import { sendSms, SmsSubmissionError } from '../../../../shared/services/sms.service';
import { applyTextBeeEvidence } from '../textbee-webhook';

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = database.hostname === '127.0.0.1' && /^\/leadcrm_campaign_test_\d+$/.test(database.pathname);
describe.skipIf(!disposable)('plain SMS URLs on native disposable PostgreSQL', () => {
  let tenantId: string, otherTenant: string, userId: string, audienceId: string;
  const scoped = <T>(work: () => T, tenant = tenantId) => tenantContext.run({ tenantId: tenant }, async () => await work());
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Plain SMS QA', slug: randomUUID(), status: 'SANDBOX', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other SMS tenant', slug: randomUUID() } })).id;
    userId = (await prisma.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'Plain', lastName: 'Tester', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } })).id;
    await scoped(async () => {
      await prisma.contact.create({ data: { tenantId, firstName: 'Plain', lastName: 'Recipient', phone: '+639171234567' } });
      audienceId = (await createAudience(tenantId, { name: 'SMS recipient', source: 'CONTACTS', conditions: [] })).id;
    });
  });
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'invalid-origin-does-not-block-sms'); vi.stubEnv('TEXTBEE_API_KEY', 'mock-only');
    vi.mocked(sendSms).mockReset().mockImplementation(async () => ({ messageId: `batch-${randomUUID()}`, submitted: true, status: 'pending' }));
  });
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });
  const draft = (body = 'Visit https://example.test/products?a=1&b=2#section and https://example.test/about. Again https://example.test/products?a=1&b=2#section') => scoped(() => createCampaign(tenantId, userId, { name: randomUUID(), type: 'SMS', body, targetAudienceId: audienceId }));

  it('sends original personalized URLs without tokens, tracking configuration or fabricated clicks', async () => {
    const campaign = await draft('Hi {{firstName}}, visit https://example.test/products?a=1&b=2#section.');
    await scoped(() => sendCampaign(campaign.id, tenantId, userId));
    expect(sendSms).toHaveBeenCalledExactlyOnceWith('+639171234567', 'Hi Plain, visit https://example.test/products?a=1&b=2#section.', { deviceId: 'test-device' });
    const row = await scoped(() => prisma.campaignContact.findFirstOrThrow({ where: { campaignId: campaign.id } }));
    expect(row.smsLinkHistory).toEqual([]);
    expect(row.clickedAt).toBeNull();
    expect(await scoped(() => getCampaignReport(campaign.id, tenantId))).toMatchObject({ smsTrackingVersion: 0, trackingStatus: 'historical_unavailable', clickedCount: 0, totalClicks: null, totalOpens: null, topLinks: [] });
    await expect(scoped(() => getCampaignReport(campaign.id, otherTenant), otherTenant)).rejects.toThrow('not found');
  });

  it('preserves provider delivery and failure facts independently of URLs', async () => {
    const campaign = await draft();
    await scoped(() => sendCampaign(campaign.id, tenantId, userId));
    const row = await scoped(() => prisma.campaignContact.findFirstOrThrow({ where: { campaignId: campaign.id } }));
    await applyTextBeeEvidence({ smsId: 'failed-plain-sms', smsBatchId: row.messageId!, deviceId: 'test-device', recipient: row.phone!, status: 'failed', failedAt: new Date() });
    expect(await scoped(() => getCampaignReport(campaign.id, tenantId))).toMatchObject({ status: 'FAILED', failedCount: 1, deliveredCount: 0, clickedCount: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('keeps uncertain submissions unconfirmed without retrying provider sends', async () => {
    vi.mocked(sendSms).mockRejectedValueOnce(new SmsSubmissionError('unconfirmed'));
    const campaign = await draft();
    await scoped(() => sendCampaign(campaign.id, tenantId, userId));
    expect(await scoped(() => getCampaignReport(campaign.id, tenantId))).toMatchObject({ status: 'INTERRUPTED', sentCount: 0, reviewRequired: true, deliveredCount: 0, clickedCount: 0, ctr: null });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('uses the same original URL policy when a saved schedule dispatches', async () => {
    const campaign = await draft('Scheduled https://example.test/path?x=1#destination');
    await scoped(() => scheduleCampaign(campaign.id, tenantId, userId, { scheduledFor: new Date(Date.now() + 60000).toISOString() }));
    await scoped(() => prisma.campaign.update({ where: { id: campaign.id }, data: { scheduledFor: new Date(Date.now() - 1000) } }));
    await dispatchDueCampaigns();
    await vi.waitFor(() => expect(sendSms).toHaveBeenCalledExactlyOnceWith('+639171234567', 'Scheduled https://example.test/path?x=1#destination', { deviceId: 'test-device' }));
    expect((await scoped(() => prisma.campaignContact.findFirstOrThrow({ where: { campaignId: campaign.id } }))).smsLinkHistory).toEqual([]);
  });

  it('validates actual original URL length and rolls back preparation before any send', async () => {
    const longName = await scoped(() => prisma.contact.create({ data: { tenantId, firstName: 'A'.repeat(SMS_MAX_LENGTH), lastName: 'Long', phone: '+639181234567' } }));
    try {
      const campaign = await draft('Hi {{firstName}}, visit https://example.test/path.');
      await expect(scoped(() => sendCampaign(campaign.id, tenantId, userId))).rejects.toThrow('SMS limit');
      expect(await scoped(() => prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } }))).toMatchObject({ status: 'DRAFT', submissionStartedAt: null, smsTrackingVersion: null });
      expect(await scoped(() => prisma.campaignContact.count({ where: { campaignId: campaign.id } }))).toBe(0);
      expect(sendSms).not.toHaveBeenCalled();
    } finally { await scoped(() => prisma.contact.delete({ where: { id: longName.id } })); }
  });
});
