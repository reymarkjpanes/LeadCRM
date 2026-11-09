import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { processTextBeeEvent, applyTextBeeEvidence, verifyTextBeeSignature } from '../textbee-webhook';
import { dispatchTenantNotifications } from '../../../notifications/notification-events.service';
import { notificationCounts, deleteNotifications } from '../../../notifications/notifications.repository';
import { saveNotificationPreferences } from '../../../notifications/notification-preferences.service';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@leadcrm/shared';
import { reconcileSmsStatuses } from '../sms-status-reconciliation';
import { getSmsBatch, sendSms } from '../../../../shared/services/sms.service';
import { interruptCampaignSubmission } from '../campaign-submission-recovery';
import { smsCampaignSummary } from '../sms-campaign-outcomes';
import { getCampaignReport, getCampaignById, getCampaigns } from '../campaigns.service';

vi.mock('../../../../shared/services/sms.service', async original => ({ ...await original<object>(), sendSms: vi.fn(), getSmsBatch: vi.fn() }));
vi.mock('../../../notifications/notification-events.service', async original => ({ ...await original<object>(), requestNotificationDispatch: vi.fn() }));
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = url.hostname === '127.0.0.1' && /^\/leadcrm_campaign_test_\d+$/.test(url.pathname);
const device = '664a9b8cd0e1f2a3b4c5d6e7';
describe.skipIf(!disposable)('SMS tracking on native disposable PostgreSQL', () => {
  let tenantId: string, creator: string, sender: string, denied: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const batchId = () => randomBytes(12).toString('hex');
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'SMS tracking QA', slug: randomUUID(), status: 'SANDBOX', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    await scope(async () => {
      const admin = await prisma.roleDefinition.create({ data: { tenantId, name: 'Client Admin', isSystemRole: true } });
      const marketing = await prisma.roleDefinition.create({ data: { tenantId, name: 'Marketing', permissions: { create: [{ module: 'campaigns', canView: true }] } } });
      const noAccess = await prisma.roleDefinition.create({ data: { tenantId, name: 'No Access' } });
      const user = async (roleId: string, role: string) => (await prisma.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'SMS', lastName: 'Tester', role,
        status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date(), userRoles: { create: { roleId } } } })).id;
      creator = await user(admin.id, 'Client Admin'); sender = await user(marketing.id, 'Marketing'); denied = await user(noAccess.id, 'No Access');
    });
  });
  beforeEach(() => { vi.stubEnv('TEXTBEE_API_KEY', 'mock-only'); vi.stubEnv('TEXTBEE_DEVICE_ID', device); vi.mocked(getSmsBatch).mockReset(); vi.mocked(sendSms).mockClear(); });
  afterEach(async () => { await scope(() => prisma.campaign.updateMany({ data: { isArchived: true } })); });
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

  async function submitted(count = 1, actor = sender) {
    return scope(async () => {
      const campaign = await prisma.campaign.create({ data: { tenantId, name: 'Verified SMS', type: 'SMS', status: 'SUBMITTED', createdById: creator, submittedById: actor,
        recipientCount: count, submissionStartedAt: new Date(), submissionFinishedAt: new Date(), smsDeviceId: device } });
      for (let index = 0; index < count; index++) await prisma.campaignContact.create({ data: { tenantId, campaignId: campaign.id,
        phone: `+63917123456${index}`, messageId: batchId(), status: 'submitted', submittedAt: new Date(), submissionAttemptedAt: new Date() } });
      return { campaign, rows: await prisma.campaignContact.findMany({ where: { campaignId: campaign.id }, orderBy: { phone: 'asc' } }) };
    });
  }
  type Row = Awaited<ReturnType<typeof submitted>>['rows'][number];
  const event = (row: Row, status: 'sent' | 'delivered' | 'failed' | 'unknown', key = randomUUID()) => ({
    smsId: `sms-${row.id}`, smsBatchId: row.messageId, deviceId: device, recipient: row.phone,
    webhookSubscriptionId: 'fixture-subscription', idempotencyKey: key,
    webhookEvent: status === 'unknown' ? 'UNKNOWN_STATE' : `MESSAGE_${status.toUpperCase()}`, status,
    ...(status === 'sent' || status === 'delivered' ? { sentAt: '2026-10-14T01:00:00.000Z' } : {}),
    ...(status === 'delivered' ? { deliveredAt: '2026-10-14T01:00:01.000Z' } : {}),
    ...(status === 'failed' ? { failedAt: '2026-10-14T01:00:02.000Z' } : {}),
  });
  const outbox = (id: string) => scope(() => prisma.notificationEvent.findMany({ where: { entityId: id, type: { startsWith: 'sms_campaign_' } }, orderBy: { createdAt: 'asc' } }));
  const deliver = () => scope(async () => { for (let n = 0; n < 10; n++) if (!(await dispatchTenantNotifications(tenantId)).claimed) break; });

  it('keeps notification polling active for a Submitted SMS owned by the staff sender', async () => {
    const { campaign } = await submitted();
    const delta = await scope(() => notificationCounts(tenantId, sender));
    expect(delta.activeSmsUntil).toBe(new Date(+campaign.submissionStartedAt! + 300000).toISOString());
    expect((await scope(() => notificationCounts(tenantId, creator))).activeSmsUntil).toBeNull();
  });

  it('accepts a fresh timestamped delivery receipt without a sent timestamp', async () => {
    const { campaign, rows: [row] } = await submitted();
    const { sentAt: _sentAt, ...payload } = event(row, 'delivered');
    const raw = Buffer.from(JSON.stringify(payload));
    const secret = 'fixture-secret-with-more-than-20-characters';
    vi.stubEnv('TEXTBEE_WEBHOOK_SECRET', secret);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = (at: number) => `t=${at},v1=${createHmac('sha256', secret).update(at + '.').update(raw).digest('hex')}`;
    const legacy = createHmac('sha256', secret).update(raw).digest('hex');
    expect(() => verifyTextBeeSignature(raw, legacy)).not.toThrow();
    expect(() => verifyTextBeeSignature(raw, undefined, signature(timestamp))).not.toThrow();
    expect(() => verifyTextBeeSignature(raw, legacy, signature(timestamp - 301))).toThrow('Unauthorized');
    await processTextBeeEvent(payload);
    expect(await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'delivered', sentAt: null });
    expect(await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ status: 'DELIVERED' });
  });

  it('persists ordered Sent/Delivered results once for the staff sender, excludes the admin creator, and preserves deletion identity', async () => {
    const { campaign, rows: [row] } = await submitted();
    await processTextBeeEvent(event(row, 'sent'));
    await processTextBeeEvent(event(row, 'sent'));
    await processTextBeeEvent(event(row, 'delivered'));
    expect((await outbox(campaign.id)).map(item => item.type)).toEqual(['sms_campaign_sent', 'sms_campaign_delivered']);
    await scope(() => dispatchTenantNotifications(tenantId));
    expect(await scope(() => prisma.notification.count({ where: { entityId: campaign.id, type: 'sms_campaign_delivered' } }))).toBe(0);
    await deliver();
    const notifications = await scope(() => prisma.notification.findMany({ where: { entityId: campaign.id } }));
    expect(notifications).toHaveLength(2);
    expect(new Set(notifications.map(n => n.userId))).toEqual(new Set([sender]));
    const adminDelta = await scope(() => notificationCounts(tenantId, creator));
    expect(adminDelta).toMatchObject({ updates: [], activeSmsUntil: null });
    const mine = notifications.filter(n => n.userId === sender);
    const delta = await scope(() => notificationCounts(tenantId, sender, { since: new Date(Date.now() - 60000).toISOString() }));
    expect(delta.updates.filter(n => n.entityId === campaign.id).map(n => n.type)).toEqual(['sms_campaign_sent', 'sms_campaign_delivered']);
    await scope(() => deleteNotifications(mine.map(n => n.id), tenantId, sender));
    await processTextBeeEvent(event(row, 'delivered')); await deliver();
    expect(await scope(() => prisma.notification.count({ where: { entityId: campaign.id, userId: sender } }))).toBe(0);
    await expect(scope(() => notificationCounts(tenantId, creator, { after: delta.cursor }))).rejects.toThrow('cursor');
  });

  it('accepts direct Delivered without inventing a Sent event and prevents terminal regressions', async () => {
    const { campaign, rows: [row] } = await submitted();
    await processTextBeeEvent(event(row, 'delivered'));
    await processTextBeeEvent(event(row, 'sent'));
    await processTextBeeEvent({ ...event(row, 'failed'), failedAt: '2026-10-14T01:00:00.500Z' });
    expect((await outbox(campaign.id)).map(n => n.type)).toEqual(['sms_campaign_delivered']);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('DELIVERED');
    expect((await scope(() => getCampaignReport(campaign.id, tenantId))).reviewRequired).toBe(true);
  });

  it.each([false, true])('resolves conflicting final evidence by timestamp in either arrival order (failure first: %s)', async failureFirst => {
    const { campaign, rows: [row] } = await submitted();
    const failed = { ...event(row, 'failed'), failedAt: '2026-10-17T03:15:51.234Z' };
    const delivered = { ...event(row, 'delivered'), sentAt: '2026-10-17T03:15:52.643Z', deliveredAt: '2026-10-17T03:15:54.165Z' };
    for (const payload of failureFirst ? [failed, delivered, failed] : [delivered, failed, delivered]) await processTextBeeEvent(payload);
    const report = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(report).toMatchObject({ status: 'DELIVERED', reviewRequired: true, deliveredCount: 1, failedCount: 0 });
    expect(report.recipients[0]).toMatchObject({ deliveryStatus: 'Delivered', providerConflict: true });
    expect(report.recipients[0].providerEvents).toHaveLength(2);
    expect((await scope(() => getCampaignById(campaign.id, tenantId))).reviewRequired).toBe(true);
    expect((await scope(() => getCampaigns(tenantId, { search: campaign.name }))).data.find(item => item.id === campaign.id)?.reviewRequired).toBe(true);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('does not hide newer authenticated failure evidence behind an earlier Delivered status', async () => {
    const { campaign, rows: [row] } = await submitted();
    await processTextBeeEvent(event(row, 'delivered')); await processTextBeeEvent(event(row, 'failed'));
    const report = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(report).toMatchObject({ status: 'FAILED', reviewRequired: true, failedCount: 1, deliveredCount: 0 });
    expect(report.recipients[0]).toMatchObject({ deliveryStatus: 'Failed', providerConflict: true });
    expect((await scope(() => getCampaignById(campaign.id, tenantId))).deliveredCount).toBe(0);
  });

  it('retains the current final result for an undated conflict and still exposes review evidence', async () => {
    const { campaign, rows: [row] } = await submitted();
    await processTextBeeEvent(event(row, 'delivered'));
    await applyTextBeeEvidence({ smsId: `sms-${row.id}`, smsBatchId: row.messageId!, deviceId: device, recipient: row.phone!, status: 'failed' });
    expect(await scope(() => getCampaignReport(campaign.id, tenantId))).toMatchObject({ status: 'DELIVERED', reviewRequired: true });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('uses the failure timestamp when a provider lookup retains older sent and delivery timestamps', async () => {
    const { campaign, rows: [row] } = await submitted();
    await processTextBeeEvent(event(row, 'delivered'));
    await applyTextBeeEvidence({ smsId: `sms-${row.id}`, smsBatchId: row.messageId!, deviceId: device, recipient: row.phone!, status: 'failed',
      sentAt: new Date('2026-10-14T01:00:00Z'), deliveredAt: new Date('2026-10-14T01:00:01Z'), failedAt: new Date('2026-10-14T01:00:02Z') });
    expect(await scope(() => getCampaignReport(campaign.id, tenantId))).toMatchObject({ status: 'FAILED', reviewRequired: true, failedCount: 1, deliveredCount: 0 });
    expect(await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ providerUpdatedAt: new Date('2026-10-14T01:00:02Z') });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('retains verified Sent when a later device report is unknown and another recipient completes', async () => {
    const { campaign, rows } = await submitted(2);
    await processTextBeeEvent(event(rows[0], 'sent'));
    await processTextBeeEvent(event(rows[0], 'unknown'));
    await processTextBeeEvent(event(rows[1], 'sent'));
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT');
    const saved = await prisma.campaignContact.findMany({ where: { campaignId: campaign.id } });
    expect(smsCampaignSummary(saved)).toMatchObject({ total: 2, sent: 2, delivered: 0, unconfirmed: 0 });
    expect((await outbox(campaign.id)).map(n => n.type)).toEqual(['sms_campaign_sent']);
  });

  it('keeps incomplete delivery Submitted until all accepted recipients have confirmed outcomes', async () => {
    const { campaign, rows } = await submitted(3);
    await processTextBeeEvent(event(rows[0], 'sent')); await processTextBeeEvent(event(rows[1], 'failed'));
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SUBMITTED');
    expect((await outbox(campaign.id)).map(n => n.type)).toEqual(['sms_campaign_progress']);
    await processTextBeeEvent(event(rows[2], 'sent'));
    const saved = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(saved).toMatchObject({ status: 'PARTIALLY_SENT', failedCount: 1, sentCount: 3 });
    const events = await outbox(campaign.id);
    expect(events.map(n => n.type)).toEqual(['sms_campaign_progress', 'sms_campaign_partial']);
    expect(events[1].payload).toMatchObject({ counts: { total: 3, sent: 2, failed: 1, submitted: 0 } });
  });

  it('records complete failure and unconfirmed outcomes with different semantics', async () => {
    const failed = await submitted(), unknown = await submitted();
    await processTextBeeEvent(event(failed.rows[0], 'failed')); await processTextBeeEvent(event(unknown.rows[0], 'unknown'));
    expect((await outbox(failed.campaign.id)).map(n => n.type)).toEqual(['sms_campaign_failed']);
    expect((await outbox(unknown.campaign.id)).map(n => n.type)).toEqual(['sms_campaign_unconfirmed']);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: unknown.campaign.id } })).status).toBe('INTERRUPTED');
  });

  it('shows unknown provider diagnostics consistently without retaining private message content', async () => {
    const { campaign, rows: [row] } = await submitted(); await due(row);
    vi.mocked(getSmsBatch).mockResolvedValue({ ...lookup(row, 'unknown'), messages: [{ ...lookup(row, 'unknown').messages[0],
      errorCode: '4', errorMessage: 'Status update timeout - no response from device after dispatch. private-message-and-key' }] } as never);
    await reconcileSmsStatuses();
    const saved = await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved).toMatchObject({ status: 'unknown', providerErrorCode: '4' });
    expect(saved.providerErrorMessage).toContain('No status response from the Android device');
    expect(saved.providerErrorMessage).not.toContain('private-message-and-key');
    const report = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(report.reviewRequired).toBe(true);
    expect(report.recipients[0]).toMatchObject({ deliveryStatus: 'Unknown', failureDetail: saved.providerErrorMessage });
    expect((await scope(() => getCampaignById(campaign.id, tenantId))).reviewRequired).toBe(true);
    expect((await scope(() => getCampaigns(tenantId, { search: campaign.name }))).data.find(item => item.id === campaign.id)?.reviewRequired).toBe(true);
    await processTextBeeEvent(event(row, 'delivered'));
    const resolved = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(resolved.reviewRequired).toBe(false);
    expect(resolved.recipients[0]).toMatchObject({ deliveryStatus: 'Delivered', failureDetail: null });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('makes expired pending batches actionable, preserves Sent and accepts late delivery evidence without resending', async () => {
    const { campaign, rows: [row] } = await submitted();
    const sent = await submitted();
    await processTextBeeEvent(event(sent.rows[0], 'sent'));
    const old = new Date(Date.now() - 31 * 86400000);
    await prisma.campaignContact.updateMany({ where: { id: { in: [row.id, sent.rows[0].id] } }, data: { submittedAt: old, nextSmsCheckAt: new Date(0) } });
    await Promise.all([reconcileSmsStatuses(), reconcileSmsStatuses()]);
    expect(await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'unknown', failureReason: 'SMS_VERIFICATION_EXPIRED', nextSmsCheckAt: null });
    expect(await prisma.campaignContact.findUniqueOrThrow({ where: { id: sent.rows[0].id } })).toMatchObject({ status: 'sent', nextSmsCheckAt: null });
    const report = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(report.reviewRequired).toBe(true); expect(report.recipients[0].failureDetail).toContain('30 days');
    expect((await scope(() => getCampaignReport(sent.campaign.id, tenantId))).reviewRequired).toBe(false);
    expect(getSmsBatch).not.toHaveBeenCalled(); expect(sendSms).not.toHaveBeenCalled();
    await processTextBeeEvent(event(row, 'delivered'));
    expect((await scope(() => getCampaignReport(campaign.id, tenantId))).reviewRequired).toBe(false);
  });

  it('flags an unconfirmed submission without a batch identity for review without polling or resending it', async () => {
    const { campaign, rows: [row] } = await submitted();
    await prisma.campaignContact.update({ where: { id: row.id }, data: { messageId: null, submittedAt: null, status: 'pending', failureReason: 'PROVIDER_SUBMISSION_UNCONFIRMED', nextSmsCheckAt: null } });
    const report = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(report.reviewRequired).toBe(true); expect(report.recipients[0].deliveryStatus).toBe('Unknown');
    expect(report.recipients[0].failureDetail).toContain('Provider acceptance was not confirmed');
    await reconcileSmsStatuses(); expect(getSmsBatch).not.toHaveBeenCalled(); expect(sendSms).not.toHaveBeenCalled();
  });

  it('serializes concurrent duplicate callbacks on native PostgreSQL without duplicate metrics or events', async () => {
    const { campaign, rows: [row] } = await submitted();
    await Promise.all(Array.from({ length: 5 }, () => processTextBeeEvent(event(row, 'sent', row.id))));
    await Promise.all(Array.from({ length: 5 }, () => processTextBeeEvent(event(row, 'sent'))));
    expect(await scope(() => prisma.smsWebhookReceipt.count({ where: { campaignContactId: row.id } }))).toBe(6);
    expect(await prisma.campaignMetrics.count({ where: { campaignId: campaign.id } })).toBe(1);
    expect(await outbox(campaign.id)).toHaveLength(1);
  });

  it('rejects mismatched device/phone/SMS identities and retries callbacks preceding the committed receipt', async () => {
    const { campaign, rows: [row] } = await submitted();
    await expect(processTextBeeEvent({ ...event(row, 'sent'), deviceId: batchId() })).rejects.toThrow('device');
    await expect(processTextBeeEvent({ ...event(row, 'sent'), recipient: '+639181234567' })).rejects.toThrow('match');
    await expect(processTextBeeEvent({ ...event(row, 'sent'), smsBatchId: batchId() })).rejects.toMatchObject({ statusCode: 503 });
    await processTextBeeEvent(event(row, 'sent'));
    await expect(processTextBeeEvent({ ...event(row, 'delivered'), smsId: 'different-message' })).rejects.toThrow('identity');
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT');
  });

  it('honors preferences and permission loss for sender without broadcasting successes', async () => {
    const { campaign, rows: [row] } = await submitted(1, denied);
    await scope(() => saveNotificationPreferences(tenantId, creator, { ...DEFAULT_NOTIFICATION_PREFERENCES, inAppGeneral: false }));
    await processTextBeeEvent(event(row, 'sent')); await deliver();
    expect(await scope(() => prisma.notification.count({ where: { entityId: campaign.id } }))).toBe(0);
    await scope(() => saveNotificationPreferences(tenantId, creator, DEFAULT_NOTIFICATION_PREFERENCES));
  });

  const lookup = (row: Row, status: string) => ({ batch: { _id: row.messageId!, recipientCount: 1 }, messages: [{ _id: `sms-${row.id}`, device: { _id: device }, smsBatch: row.messageId!, recipient: row.phone!, status,
    ...(status === 'sent' || status === 'delivered' ? { sentAt: '2026-10-14T01:00:00.000Z' } : {}), ...(status === 'delivered' ? { deliveredAt: '2026-10-14T01:00:01.000Z' } : {}) }] });
  async function due(row: Row) { await scope(() => prisma.campaignContact.update({ where: { id: row.id }, data: { nextSmsCheckAt: new Date(Date.now() - 1000) } })); }
  it.each(['reference', 'populated'])('recovers two delivered recipients through the real %s device parser without submitting messages', async shape => {
    const { campaign, rows } = await submitted(2);
    await scope(() => prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING', sentCount: 2 } }));
    for (const row of rows) await due(row);
    const transport = await vi.importActual<typeof import('../../../../shared/services/sms.service')>('../../../../shared/services/sms.service');
    vi.mocked(getSmsBatch).mockImplementation(transport.getSmsBatch);
    const nativeFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const row = rows.find(item => input === `https://api.textbee.dev/api/v1/gateway/devices/${device}/sms-batch/${item.messageId}`);
      if (!row) return nativeFetch(input, init);
      const evidence = lookup(row, 'delivered');
      return new Response(JSON.stringify({ data: { ...evidence, messages: [{ ...evidence.messages[0],
        device: shape === 'reference' ? device : { _id: device, name: 'Gateway' }, message: 'private-message', updatedAt: '2026-10-14T01:00:01Z' }] } }));
    });
    try {
      expect(await reconcileSmsStatuses()).toBe(2);
      const saved = await prisma.campaignContact.findMany({ where: { campaignId: campaign.id } });
      expect(saved.every(row => row.status === 'delivered' && row.nextSmsCheckAt === null)).toBe(true);
      const report = await scope(() => getCampaignReport(campaign.id, tenantId));
      expect(report).toMatchObject({ status: 'DELIVERED', deliveredCount: 2, sentCount: 2, failedCount: 0 });
      expect(report.recipients.every(row => row.deliveryStatus === 'Delivered')).toBe(true);
      expect((await scope(() => getCampaigns(tenantId, { search: campaign.name }))).data.find(row => row.id === campaign.id)?.status).toBe(report.status);
      await reconcileSmsStatuses();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true);
      expect(JSON.stringify(report)).not.toContain('private-message');
      expect(sendSms).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it.each(['pending', 'dispatched'])('repairs a completed legacy Sending parent to Submitted for %s without inferring delivery', async status => {
    const { campaign, rows: [row] } = await submitted(); await due(row);
    await scope(() => prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } }));
    vi.mocked(getSmsBatch).mockResolvedValue(lookup(row, status) as never);
    await reconcileSmsStatuses();
    expect(await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'submitted', submittedAt: row.submittedAt, sentAt: null, deliveredAt: null });
    const report = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(report).toMatchObject({ status: 'SUBMITTED', sentCount: 1, deliveredCount: 0 });
    expect(report.recipients[0].deliveryStatus).toBe('Submitted');
    expect((await scope(() => getCampaigns(tenantId, { search: campaign.name }))).data.find(row => row.id === campaign.id)?.status).toBe('SUBMITTED');
    expect(sendSms).not.toHaveBeenCalled();
  });

  it.each(['device', 'batch', 'recipient', 'count', 'messages', 'messageBatch', 'messageIdentity'])('rejects mismatched %s evidence and records a safe diagnosis', async mismatch => {
    const { rows: [row] } = await submitted(); await due(row);
    const result = lookup(row, 'delivered');
    if (mismatch === 'device') result.messages[0].device._id = batchId();
    if (mismatch === 'batch') result.batch._id = batchId();
    if (mismatch === 'recipient') result.messages[0].recipient = '+639181234567';
    if (mismatch === 'count') result.batch.recipientCount = 2;
    if (mismatch === 'messages') result.messages.push({ ...result.messages[0] });
    if (mismatch === 'messageBatch') result.messages[0].smsBatch = batchId();
    if (mismatch === 'messageIdentity') await prisma.campaignContact.update({ where: { id: row.id }, data: { smsId: 'different-message' } });
    vi.mocked(getSmsBatch).mockResolvedValue(result as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await reconcileSmsStatuses()).toBe(0);
      expect(warn).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({ event: 'sms_status_lookup_failed', category: 'identity_mismatch' }));
      expect(await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'submitted', deliveredAt: null, sentAt: null });
      expect(sendSms).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it.each(['transport', 'response_validation', 'persistence'])('distinguishes %s failures without leaking errors or preventing the next recipient check', async category => {
    const { rows } = await submitted(2); for (const row of rows) await due(row);
    vi.mocked(getSmsBatch).mockImplementation(async (_device, id) => lookup(rows.find(row => row.messageId === id)!, 'delivered') as never);
    const privateError = 'private-message-and-credential';
    const transaction = category === 'persistence' ? vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error(privateError)) : null;
    if (category === 'transport') vi.mocked(getSmsBatch).mockRejectedValueOnce(new TypeError(privateError));
    if (category === 'response_validation') vi.mocked(getSmsBatch).mockRejectedValueOnce(new z.ZodError([{ code: 'custom', path: ['data', 'messages'], message: privateError }]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await reconcileSmsStatuses()).toBe(1);
      expect(warn).toHaveBeenCalledWith('[Campaigns]', expect.objectContaining({ event: 'sms_status_lookup_failed', category }));
      expect(JSON.stringify(warn.mock.calls)).not.toContain(privateError);
      expect(await prisma.campaignContact.count({ where: { id: { in: rows.map(row => row.id) }, status: 'delivered' } })).toBe(1);
      expect(sendSms).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); transaction?.mockRestore(); }
  });
  it.each(['sent', 'delivered', 'failed'])('persists provider %s without optional event dates and exposes it consistently in reports', async status => {
    const { campaign, rows: [row] } = await submitted(); await due(row);
    const result = lookup(row, status);
    vi.mocked(getSmsBatch).mockResolvedValue({ ...result, messages: [{ ...result.messages[0], sentAt: undefined, deliveredAt: undefined }] } as never);
    await reconcileSmsStatuses();
    const saved = await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved).toMatchObject({ status, sentAt: null, deliveredAt: null });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(status.toUpperCase());
    expect(smsCampaignSummary([saved])).toMatchObject({ [status]: 1, submitted: 0, unconfirmed: 0 });
    const report = await scope(() => getCampaignReport(campaign.id, tenantId));
    expect(report.recipients[0].deliveryStatus.toLowerCase()).toBe(status);
    expect(sendSms).not.toHaveBeenCalled();
  });
  it('reconciles stale accepted batches once with backoff and preserves Sent when no delivery report exists', async () => {
    const { campaign, rows: [row] } = await submitted(); await due(row);
    vi.mocked(getSmsBatch).mockResolvedValue(lookup(row, 'sent') as never);
    await Promise.all([reconcileSmsStatuses(), reconcileSmsStatuses()]);
    expect(getSmsBatch).toHaveBeenCalledOnce(); expect(sendSms).not.toHaveBeenCalled();
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT');
    await due(row); await reconcileSmsStatuses();
    expect(await outbox(campaign.id)).toHaveLength(1);
    expect((await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).deliveredAt).toBeNull();
    await due(row); vi.mocked(getSmsBatch).mockResolvedValue(lookup(row, 'delivered') as never); await reconcileSmsStatuses();
    expect((await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).nextSmsCheckAt).toBeNull();
    expect((await outbox(campaign.id)).map(n => n.type)).toEqual(['sms_campaign_sent', 'sms_campaign_delivered']);
  });
  it('enriches status-only facts with later callback dates and repairs stale parent totals without duplicate notifications', async () => {
    const { campaign, rows: [row] } = await submitted(); await due(row);
    const result = lookup(row, 'sent');
    vi.mocked(getSmsBatch).mockResolvedValue({ ...result, messages: [{ ...result.messages[0], sentAt: undefined, deliveredAt: undefined }] } as never);
    await reconcileSmsStatuses();
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } });
    await due(row); await reconcileSmsStatuses();
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT');
    await processTextBeeEvent(event(row, 'sent'));
    expect((await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).sentAt).not.toBeNull();
    expect((await outbox(campaign.id)).filter(item => item.type === 'sms_campaign_sent')).toHaveLength(1);
    await processTextBeeEvent(event(row, 'delivered'));
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('DELIVERED');
  });

  it('enriches a missing Sent date without replacing an already verified Delivered date', async () => {
    const { rows: [row] } = await submitted();
    const deliveredAt = new Date('2026-10-14T01:00:05.000Z');
    await applyTextBeeEvidence({ smsId: `sms-${row.id}`, smsBatchId: row.messageId!, deviceId: device,
      recipient: row.phone!, status: 'delivered', deliveredAt });
    await processTextBeeEvent({ ...event(row, 'delivered'), sentAt: '2026-10-14T01:00:00.000Z', deliveredAt: '2026-10-14T01:00:01.000Z' });
    expect(await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'delivered', sentAt: new Date('2026-10-14T01:00:00.000Z'), deliveredAt, providerUpdatedAt: deliveredAt,
    });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('never resends on offline/timeout or mismatched lookup results and ignores stale lookup evidence', async () => {
    const { campaign, rows: [row] } = await submitted(); await due(row);
    vi.mocked(getSmsBatch).mockRejectedValueOnce(new Error('offline'));
    await reconcileSmsStatuses(); await reconcileSmsStatuses(); expect(getSmsBatch).toHaveBeenCalledOnce();
    await due(row); vi.mocked(getSmsBatch).mockResolvedValue({ ...lookup(row, 'sent'), batch: { _id: batchId(), recipientCount: 1 } } as never);
    await reconcileSmsStatuses(); expect(await outbox(campaign.id)).toHaveLength(0);
    await processTextBeeEvent(event(row, 'sent'));
    await applyTextBeeEvidence({ smsId: `sms-${row.id}`, smsBatchId: row.messageId!, deviceId: device, recipient: row.phone!, status: 'unknown' }, undefined, null);
    expect((await prisma.campaignContact.findUniqueOrThrow({ where: { id: row.id } })).failureReason).toBeNull();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('recovers interrupted submissions without replaying attempted or accepted recipients', async () => {
    const { campaign, rows } = await submitted(3);
    await scope(async () => {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { submissionFinishedAt: null, submissionLeaseId: 'expired', submissionLeaseUntil: new Date(0) } });
      await prisma.campaignContact.update({ where: { id: rows[1].id }, data: { status: 'submitting', submittedAt: null, messageId: null } });
      await prisma.campaignContact.update({ where: { id: rows[2].id }, data: { status: 'pending', submittedAt: null, submissionAttemptedAt: null, messageId: null } });
    });
    await interruptCampaignSubmission(campaign.id, tenantId, 'expired');
    const saved = await prisma.campaignContact.findMany({ where: { campaignId: campaign.id } });
    expect(smsCampaignSummary(saved)).toMatchObject({ total: 3, submitted: 1, unconfirmed: 1, failed: 1 });
    expect(sendSms).not.toHaveBeenCalled();
    expect((await outbox(campaign.id)).map(n => n.type)).toEqual(['sms_campaign_progress', 'sms_campaign_unconfirmed']);
  });
});
