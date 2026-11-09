import { creatorWhere } from '../../crm/access/record-visibility';
import { randomUUID } from 'node:crypto';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import { Prisma, CampaignStatus, CampaignType } from '@prisma/client';
import { z } from 'zod';
import { campaignLinkDestination, campaignHtmlLinks, CreateCampaignDraftSchema, CampaignDraftSchema, CampaignSendSchema, buildFinalSms, SMS_MAX_LENGTH, isWorkspaceAccessible, isOnboardingComplete, type CampaignSendResult, AudiencePreviewSchema, CampaignScheduleSchema, CampaignScheduleConfigSchema, campaignVariableKeys, campaignApprovedVariableKeys, type AudienceInput } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { AppError } from '../../../shared/errors/app-error';
import { getPaginationParams, paginate } from '../../../shared/helpers/pagination';
import { sendMail, assertBrevoConfigured, getBrevoSenderIdentity, EmailSubmissionError } from '../../../shared/services/email.service';
import { sendSms, assertSmsConfigured, getSmsSenderIdentity, getSmsDeviceId, SmsSubmissionError } from '../../../shared/services/sms.service';
import { runSubmissionPool } from './campaign-submission-pool';
import { smsCampaignSummary, smsSent, smsDelivered } from './sms-campaign-outcomes';
import { readSmsLinkHistory } from './sms-link-tracking';
import { requestNotificationDispatch } from '../../notifications/notification-events.service';
import { audienceDefinition, validateAudienceReferences, campaignScope, resolveAudience, campaignFieldsForAudienceSource } from './audiences.service';
import { sanitizeCampaignHtml, prepareCampaignHtml, renderCampaignMessage } from './campaign-content';
import { findCampaignReport } from './campaigns.repository';
import { deliveredRecipientWhere, recalculateCampaignDelivery, recipientDeliveryFailed } from './campaign-delivery-status';
import type { CampaignRecipient, CampaignClickedLink } from '@leadcrm/shared';
import { CAMPAIGN_LEASE_MS, interruptCampaignSubmission } from './campaign-submission-recovery';
import { readAuthUser } from '../../../core/auth/auth-user';
import { requireEmployeeAccount } from '../../../core/auth/account-access';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { assertPermissions } from '../../../core/permissions/permission.service';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { crmActor } from '../../crm/access/crm-record-access.service';

export async function getCampaignReport(id: string, tenantId: string) {
  const report = await findCampaignReport(id, tenantId);
  if (!report) throw new AppError('Campaign not found.', 404);
  const { campaignContacts, emailDeliveryLogs, ...campaign } = report;
  const latestByEmail = new Map<string, number>();
  const confirmedSentIds = new Set(emailDeliveryLogs.filter(log => log.EmailEvent.some(event => event.eventType === 'request')).map(log => log.brevoMessageId));
  const links = new Map<string, { emails: Set<string>; total: number; last: number }>();
  const historyByEmail = new Map<string, Set<string>>();
  const clickingRecipients = new Set<string>(), openingRecipients = new Set<string>();
  let totalClicks = 0, totalOpens = 0, trackingUpdatedAt = 0;
  for (const log of emailDeliveryLogs) {
    const email = log.toEmail.toLowerCase();
    const history = historyByEmail.get(email) ?? new Set<string>();
    for (const event of log.EmailEvent) history.add(event.eventType);
    historyByEmail.set(email, history);
    for (const event of log.EmailEvent) {
      const time = event.createdAt.getTime();
      latestByEmail.set(email, Math.max(latestByEmail.get(email) ?? 0, time));
      trackingUpdatedAt = Math.max(trackingUpdatedAt, time);
      if (campaign.type === 'SMS') continue;
      if (event.eventType === 'opened') { totalOpens++; openingRecipients.add(email); }
      if (event.eventType !== 'click') continue;
      // A verified click with a missing URL still proves recipient engagement,
      // but cannot be attributed to a particular destination.
      if (event.url && !campaignLinkDestination(event.url)) continue;
      totalClicks++; clickingRecipients.add(email);
      if (!event.url) continue;
      const link = links.get(event.url) ?? { emails: new Set<string>(), total: 0, last: 0 };
      link.emails.add(email); link.total++; link.last = Math.max(link.last, time);
      links.set(event.url, link);
    }
  }
  if (campaign.type === 'SMS') for (const row of campaignContacts) {
    if (row.status === 'excluded') continue;
    if (row.clickedAt) clickingRecipients.add(row.id);
    trackingUpdatedAt = Math.max(trackingUpdatedAt, row.providerUpdatedAt?.getTime() ?? 0, row.clickedAt?.getTime() ?? 0);
    for (const receipt of readSmsLinkHistory(row.smsLinkHistory)) {
      if (!receipt.clickedAt || !campaignLinkDestination(receipt.url)) continue;
      const time = (receipt.lastClickedAt ?? receipt.clickedAt).getTime();
      const link = links.get(receipt.url) ?? { emails: new Set<string>(), total: 0, last: 0 };
      link.emails.add(row.id); link.total += receipt.clickCount; link.last = Math.max(link.last, time);
      links.set(receipt.url, link); totalClicks += receipt.clickCount;
      trackingUpdatedAt = Math.max(trackingUpdatedAt, time);
    }
  }
  const recipients: CampaignRecipient[] = campaignContacts.map(recipient => {
    const person = recipient.contact ?? recipient.lead;
    const snapshot = recipient.personalization as Record<string, unknown> | null;
    const snapshotName = [snapshot?.first_name, snapshot?.last_name].filter(value => typeof value === 'string').join(' ').trim();
    const name = snapshotName || (person?.tenantId === tenantId ? `${person.firstName} ${person.lastName}`.trim() : '');
    const linkActivity = campaign.type === 'SMS' ? readSmsLinkHistory(recipient.smsLinkHistory).reduce((last, link) => Math.max(last, link.lastClickedAt?.getTime() ?? 0), 0) : 0;
    const last = Math.max(linkActivity, latestByEmail.get((recipient.email ?? '').toLowerCase()) ?? 0,
      ...[recipient.submittedAt, recipient.providerUpdatedAt, recipient.sentAt, recipient.deliveredAt, recipient.openedAt, recipient.clickedAt, recipient.bouncedAt].map(at => at?.getTime() ?? 0));
    return {
      id: recipient.id, name: name || recipient.email || recipient.phone || 'Unknown recipient', email: recipient.email, phone: recipient.phone,
      deliveryStatus: recipient.status === 'excluded' ? 'Excluded'
        : recipientDeliveryFailed(recipient) ? (campaign.type === 'EMAIL' && recipient.bouncedAt ? 'Bounced' : 'Failed')
        : (campaign.type === 'SMS' ? smsDelivered(recipient) : recipient.deliveredAt) ? 'Delivered'
        : (campaign.type === 'SMS' ? smsSent(recipient) : recipient.sentAt && (recipient.submittedAt || confirmedSentIds.has(recipient.messageId))) ? 'Sent'
        : campaign.type === 'SMS' && (recipient.status === 'unknown' || smsReviewReasons.includes(recipient.failureReason ?? '')) ? 'Unknown'
        : recipient.status === 'retrying' ? 'Retrying'
        : recipient.submittedAt || (campaign.type === 'EMAIL' && recipient.sentAt) ? 'Submitted' : 'Pending',
      opened: campaign.type !== 'SMS' && (!!recipient.openedAt || openingRecipients.has((recipient.email ?? '').toLowerCase())),
      clicked: !!recipient.clickedAt || (campaign.type !== 'SMS' && clickingRecipients.has((recipient.email ?? '').toLowerCase())),
      lastActivity: last ? new Date(last).toISOString() : null, failureReason: recipient.failureReason,
      failureDetail: recipient.providerErrorMessage ?? (campaign.type === 'SMS' ? smsReviewExplanation(recipient.failureReason) : null),
      ...(campaign.type === 'SMS' ? {
        providerConflict: recipient.smsStatusConflict,
        providerEvents: (recipient.smsWebhookReceipts ?? []).map(event => ({ status: event.status!, occurredAt: event.eventAt?.toISOString() ?? null, receivedAt: event.createdAt.toISOString() })),
      } : {}),
    };
  });
  const eligible = campaignContacts.filter(row => row.status !== 'excluded');
  const deliveredCount = eligible.filter(row => !recipientDeliveryFailed(row) && (campaign.type === 'SMS' ? smsDelivered(row) : row.deliveredAt)).length;
  const clickDenominator = campaign.type === 'SMS' ? campaign.sentCount : deliveredCount;
  const topLinks: CampaignClickedLink[] = [...links].map(([url, link]) => ({
    url, uniqueClicks: link.emails.size, totalClicks: link.total,
    clickRate: clickDenominator ? link.emails.size / clickDenominator * 100 : 0,
    clickShare: totalClicks ? link.total / totalClicks * 100 : 0,
    lastClicked: new Date(link.last).toISOString(),
  })).sort((a, b) => b.uniqueClicks - a.uniqueClicks || b.totalClicks - a.totalClicks || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  // Recipient timestamps retain historical unique evidence even if event history
  // predates repeatable receipts. Never fabricate historical total event counts.
  for (const row of eligible) {
    if (campaign.type === 'SMS') continue;
    if (row.openedAt && row.email) openingRecipients.add(row.email.toLowerCase());
    if (row.clickedAt && row.email) clickingRecipients.add(row.email.toLowerCase());
  }
  const completeHistory = campaign.type === 'SMS' ? campaign.smsTrackingVersion === 1 : !emailDeliveryLogs.some(log => log.EmailEvent.some(event => ['click', 'opened'].includes(event.eventType) && !event.providerEventKey?.includes(`:${event.eventType}:v2:`))) && eligible.length === campaign.recipientCount && eligible.every(row =>
    !row.email || ((!row.openedAt || historyByEmail.get(row.email.toLowerCase())?.has('opened')) && (!row.clickedAt || historyByEmail.get(row.email.toLowerCase())?.has('click'))));
  const trackingStatus = campaign.status === 'DRAFT' ? 'draft' as const
    : !campaign.submissionStartedAt && !campaign.sentCount ? 'not_sent' as const
    : !completeHistory || (campaign.type !== 'SMS' && campaign.sentCount > 0 && !emailDeliveryLogs.some(log => log.brevoMessageId)) ? 'historical_unavailable' as const
    : totalClicks > 0 ? 'recorded' as const
    : !(campaign.type === 'SMS' ? campaignContacts.some(row => readSmsLinkHistory(row.smsLinkHistory).length) : campaignHtmlLinks(sanitizeCampaignHtml(campaign.body ?? '')).length) ? 'no_links' as const : 'pending' as const;
  const measurable = !['draft', 'not_sent', 'historical_unavailable'].includes(trackingStatus);
  // Historical receipts still prove which recipients clicked each destination,
  // even when repeatable event totals cannot be reconstructed.
  return { ...campaign, recipients, topLinks, sendResult: campaignSendResult(campaign),
    reviewRequired: campaign.type === 'SMS' && campaignContacts.some(smsNeedsReview),
    ...(campaign.type === 'SMS' ? { smsDelivery: smsCampaignSummary(campaignContacts) } : {}),
    deliveredCount,
    bouncedCount: recipients.filter(row => row.deliveryStatus === 'Bounced').length,
    openedCount: openingRecipients.size, clickedCount: clickingRecipients.size,
    totalClicks: measurable ? totalClicks : null, uniqueClicks: measurable ? clickingRecipients.size : null,
    totalOpens: measurable && campaign.type !== 'SMS' ? totalOpens : null, uniqueOpens: measurable && campaign.type !== 'SMS' ? openingRecipients.size : null,
    ctr: measurable && clickDenominator && (campaign.type !== 'SMS' || clickingRecipients.size <= clickDenominator) ? clickingRecipients.size / clickDenominator * 100 : null,
    ctor: measurable && campaign.type !== 'SMS' && openingRecipients.size ? clickingRecipients.size / openingRecipients.size * 100 : null,
    trackingStatus, trackingUpdatedAt: trackingUpdatedAt ? new Date(trackingUpdatedAt).toISOString() : null,
  };
}

export async function getCampaigns(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const where: Prisma.CampaignWhereInput = { ...await creatorWhere(tenantId), isArchived: query.archived === 'true',
    ...(query.status ? { status: { in: z.array(z.nativeEnum(CampaignStatus)).parse(String(query.status).split(',')) } } : {}),
    ...(query.type ? { type: { in: z.array(z.nativeEnum(CampaignType)).parse(String(query.type).split(',')) } } : {}),
    AND: buildSearchClauses(query.search, ['name', 'subject']) };
  const ids = await sortedPageIds(query.sort === 'createdAt:desc' ? undefined : query.sort, ['name', 'type', 'status', 'createdAt'], (page - 1) * limit, limit,
    () => prisma.campaign.findMany({ where, select: { id: true, name: true, type: true, status: true, createdAt: true } }));
  const [data, total] = await Promise.all([
    prisma.campaign.findMany({ where: ids ? { ...where, id: { in: ids } } : where, skip: ids ? 0 : (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], include: { targetAudience: { select: { name: true } } } }),
    prisma.campaign.count({ where }),
  ]);
  const reviews = await smsReviewCampaignIds(tenantId, data.filter(row => row.type === 'SMS').map(row => row.id));
  return paginate(orderPage(data.map(row => ({ ...row, reviewRequired: reviews.has(row.id) })), ids), total, { page, limit });
}
export async function getCampaignById(id: string, tenantId: string) {
  const c = await prisma.campaign.findFirst({ where: { id, ...await creatorWhere(tenantId) } });
  if (!c) throw new AppError('Campaign not found.', 404);
  const where = { ...campaignScope(tenantId), campaignId: id };
  const [deliveredCount, bouncedCount] = await Promise.all([
    prisma.campaignContact.count({ where: { ...where, AND: [deliveredRecipientWhere,
      c.type === 'SMS' ? { OR: [{ deliveredAt: { not: null } }, { status: 'delivered' }] } : { deliveredAt: { not: null } }] } }),
    prisma.campaignContact.count({ where: { ...where, bouncedAt: { not: null } } }),
  ]);
  const reviews = await smsReviewCampaignIds(tenantId, c.type === 'SMS' ? [id] : []);
  return { ...c, deliveredCount, bouncedCount, sendResult: campaignSendResult(c), reviewRequired: reviews.has(id) };
}
const smsReviewReasons = ['PROVIDER_SUBMISSION_UNCONFIRMED', 'TEXTBEE_UNKNOWN_STATE', 'SMS_VERIFICATION_EXPIRED'];
const smsNeedsReview = (row: { status: string; failureReason: string | null; smsStatusConflict?: boolean }) => !!row.smsStatusConflict || (!['delivered', 'failed', 'excluded'].includes(row.status)
  && (row.status === 'unknown' || smsReviewReasons.includes(row.failureReason ?? '')));
function smsReviewExplanation(reason: string | null) {
  if (reason === 'SMS_VERIFICATION_EXPIRED') return 'No final provider result within 30 days. Automatic verification has stopped. Review TextBee history before sending again.';
  if (reason === 'PROVIDER_SUBMISSION_UNCONFIRMED') return 'Provider acceptance was not confirmed. Review TextBee history before sending again; this message has not been retried.';
  if (reason === 'TEXTBEE_UNKNOWN_STATE') return 'The provider could not confirm the outcome. Review the Android device and TextBee history.';
  if (reason === 'TEXTBEE_FAILED') return 'The provider reported a failed SMS. Check the Android device, SIM and TextBee history.';
  return null;
}
async function smsReviewCampaignIds(tenantId: string, campaignIds: string[]) {
  if (!campaignIds.length) return new Set<string>();
  const rows = await prisma.campaignContact.findMany({ where: { tenantId, campaignId: { in: campaignIds },
    OR: [{ smsStatusConflict: true }, { status: { notIn: ['delivered', 'failed', 'excluded'] }, OR: [{ status: 'unknown' }, { failureReason: { in: smsReviewReasons } }] }] },
    distinct: ['campaignId'], select: { campaignId: true } });
  return new Set(rows.map(row => row.campaignId));
}
function campaignSendResult(campaign: { id: string; recipientCount: number; sentCount: number; failedCount: number; status: CampaignStatus; submissionFinishedAt: Date | null; submissionInterruptedAt?: Date | null }): CampaignSendResult {
  return { campaignId: campaign.id, eligibleRecipients: campaign.recipientCount, submittedRecipients: campaign.sentCount, failedRecipients: campaign.failedCount, status: campaign.status, submissionComplete: !!campaign.submissionFinishedAt, ...(campaign.submissionInterruptedAt ? { submissionInterrupted: true } : {}) };
}
async function validateReferences(tenantId: string, dto: ReturnType<typeof CampaignDraftSchema.parse>) {
  if (dto.targetAudienceId) await audienceDefinition(tenantId, dto.targetAudienceId);
  for (const [id, type] of [[dto.emailTemplateId, 'Email'], [dto.smsTemplateId, 'SMS']] as const) {
    if (id && !await prisma.template.findFirst({ where: { ...campaignScope(tenantId), id, type, isArchived: false } })) throw new AppError('Template not found.', 404);
  }
  if (dto.targetAudienceId && dto.audienceSource) throw new AppError('Select a saved audience or a source, not both.', 400);
}
export async function createCampaign(tenantId: string, userId: string, input: unknown) {
  const dto = CreateCampaignDraftSchema.parse(input);
  await validateReferences(tenantId, dto);
  const campaign = await prisma.campaign.create({ data: { ...dto, body: dto.body === undefined ? undefined : dto.type === 'SMS' ? dto.body : prepareCampaignHtml(dto.body), ...campaignScope(tenantId), createdById: userId } });
  await writeAuditLog({ tenantId, userId, action: 'campaign.created', entityType: 'Campaign', entityId: campaign.id });
  return campaign;
}
export async function updateCampaign(id: string, tenantId: string, userId: string, input: unknown) {
  const dto = CampaignDraftSchema.partial().parse(input);
  const existing = await getCampaignById(id, tenantId);
  await validateReferences(tenantId, CampaignDraftSchema.parse({ name: existing.name, type: existing.type, audienceSource: existing.audienceSource, targetAudienceId: existing.targetAudienceId, emailTemplateId: existing.emailTemplateId, smsTemplateId: existing.smsTemplateId, ...dto }));
  const changed = await prisma.campaign.updateMany({ where: { id, ...await creatorWhere(tenantId), status: 'DRAFT', isArchived: false }, data: { ...dto, body: dto.body === undefined ? undefined : (dto.type ?? existing.type) === 'SMS' ? dto.body : prepareCampaignHtml(dto.body) } });
  if (!changed.count) throw new AppError('Only draft campaigns can be edited.', 409);
  await writeAuditLog({ tenantId, userId, action: 'campaign.updated', entityType: 'Campaign', entityId: id });
  return getCampaignById(id, tenantId);
}
export async function getCampaignMetrics(tenantId: string) {
  const where = { ...await creatorWhere(tenantId), isArchived: false };
  const [sum, active, email, sms] = await Promise.all([
    prisma.campaign.aggregate({ where, _sum: { sentCount: true, openedCount: true, clickedCount: true } }),
    prisma.campaign.count({ where: { ...where, status: 'SENDING', submissionFinishedAt: null } }),
    prisma.campaign.aggregate({ where: { ...where, type: 'EMAIL' }, _sum: { sentCount: true, openedCount: true, clickedCount: true } }),
    prisma.campaign.aggregate({ where: { ...where, type: 'SMS', smsTrackingVersion: 1 }, _sum: { clickedCount: true } }),
  ]);
  return { activeCampaigns: active, sent: sum._sum.sentCount || 0, emailSent: email._sum.sentCount || 0, opened: email._sum.openedCount || 0, clicked: (email._sum.clickedCount || 0) + (sms._sum.clickedCount || 0) };
}

type ScheduledExpectation = { scheduledFor: Date; scheduledById: string; updatedAt: Date; definition: AudienceInput };
async function assertCampaignSender(tenantId: string, userId: string) {
  const actor = await readAuthUser(userId, tenantId);
  await requireEmployeeAccount(actor);
  if (actor.status !== 'ACTIVE' || actor.mustChangePassword || !isWorkspaceAccessible(actor.tenantStatus) || !isOnboardingComplete(actor)) throw new AppError('Campaign sender access is unavailable.', 403);
  await assertPermissions({ userId, tenantId, role: actor.role }, ['campaigns.send']);
}
async function effectiveContent(campaign: { type: CampaignType; subject: string | null; body: string | null; emailTemplateId: string | null; smsTemplateId: string | null }, tenantId: string, tx: Prisma.TransactionClient) {
  const templateId = campaign.type === 'EMAIL' ? campaign.emailTemplateId : campaign.smsTemplateId;
  const template = templateId ? await tx.template.findFirst({ where: { id: templateId, tenantId, isArchived: false, type: campaign.type === 'EMAIL' ? 'Email' : 'SMS' } }) : null;
  if (templateId && !template) throw new AppError('The selected template is no longer available.', 400);
  return { subject: campaign.subject || template?.subject || '', body: campaign.body || template?.content || '' };
}
async function validateCampaignVariables(tenantId: string, definition: AudienceInput, subject: string, body: string, tx: Prisma.TransactionClient) {
  await validateAudienceReferences(tenantId, definition, tx);
  const fields = await campaignFieldsForAudienceSource(tenantId, definition.source, tx);
  const available = campaignApprovedVariableKeys(fields);
  const unavailable = campaignVariableKeys(subject + '\n' + body).filter(key => !available.has(key));
  if (unavailable.length) throw new AppError(`Repair unavailable campaign variables: ${unavailable.map(key => '{{' + key + '}}').join(', ')}.`, 400);
}
async function resolveCampaignRecipients(tenantId: string, definition: AudienceInput, tx: Prisma.TransactionClient, channel: 'EMAIL' | 'SMS', subject: string, body: string, userId: string) {
  // Workers have no HTTP actor. Resolve current recipient access on the same
  // transaction connection, while suppression remains tenant-authoritative.
  return crmActor.run({ tenantId, userId, readRecords: false }, async () => {
    const requiredVariables = new Set(campaignVariableKeys(subject + '\n' + body));
    const resolved = await resolveAudience(tenantId, { source: definition.source, matchMode: definition.matchMode, conditions: definition.conditions }, tx, channel, undefined, requiredVariables);
    const unresolved = resolved.records.filter(record => !record.reason && record.unresolvedVariables?.length);
    if (unresolved.length) {
      const reasons = new Set(unresolved.flatMap(record => record.unresolvedVariables ?? []).map(value => value.endsWith(':multiple-deals') ? 'multiple linked Deals' : value.endsWith(':missing-account') ? 'missing linked Accounts' : 'missing linked Deals'));
      throw new AppError(`Resolve recipient relationships for campaign variables before scheduling or sending. ${[...reasons].join(' and ')} make ${unresolved.length} recipient message${unresolved.length === 1 ? '' : 's'} unresolved.`, 400);
    }
    return resolved;
  });
}
async function campaignSender(tenantId: string, channel: 'EMAIL' | 'SMS', content: string, tx: Prisma.TransactionClient) {
  if (channel === 'EMAIL') {
    assertBrevoConfigured();
    const identity = getBrevoSenderIdentity();
    return { sender_name: identity.senderName, sender_email: identity.senderEmail! };
  }
  assertSmsConfigured();
  const identity = await getSmsSenderIdentity(tenantId, tx);
  const keys = campaignVariableKeys(content);
  if (keys.includes('sender_name') && !identity.organizationName || keys.includes('sender_email') && !identity.organizationEmail) throw new AppError('Configure the organization name and valid contact email before using SMS sender variables.', 400);
  return { sender_name: identity.organizationName ?? '', sender_email: identity.organizationEmail ?? '' };
}
export async function scheduleCampaign(id: string, tenantId: string, userId: string, input: unknown) {
  const { scheduledFor } = CampaignScheduleSchema.parse(input), due = new Date(scheduledFor), scope = await creatorWhere(tenantId);
  await assertCampaignSender(tenantId, userId);
  await prisma.$transaction(async tx => {
    // The conditional update below serializes schedule changes with due-time claims.
    const row = await tx.campaign.findFirst({ where: { id, ...scope, isArchived: false } });
    if (!row) throw new AppError('Campaign not found.', 404);
    if (!['DRAFT', 'SCHEDULED'].includes(row.status) || row.submissionStartedAt) throw new AppError('Only an unstarted Draft or Scheduled campaign can be scheduled.', 409);
    if (row.type === 'MULTI_CHANNEL') throw new AppError('Schedule Once supports Email or SMS.', 400);
    let configuration: AudienceInput;
    let content = { subject: row.subject || '', body: row.body || '' };
    if (row.status === 'SCHEDULED') configuration = CampaignScheduleConfigSchema.parse(row.scheduleConfig);
    else {
      configuration = await audienceDefinition(tenantId, row.targetAudienceId, row.audienceSource, tx);
      content = await effectiveContent(row, tenantId, tx);
      CampaignSendSchema.parse({ name: row.name, type: row.type, ...content, audienceSource: configuration.source });
    }
    await validateCampaignVariables(tenantId, configuration, content.subject, content.body, tx);
    await campaignSender(tenantId, row.type as 'EMAIL' | 'SMS', content.subject + '\n' + content.body, tx);
    await resolveCampaignRecipients(tenantId, configuration, tx, row.type as 'EMAIL' | 'SMS', content.subject, content.body, userId);
    const changed = await tx.campaign.updateMany({ where: { id, ...scope, status: row.status, updatedAt: row.updatedAt, scheduledFor: row.scheduledFor, scheduledById: row.scheduledById, submissionStartedAt: null, isArchived: false }, data: { status: 'SCHEDULED', scheduledFor: due, scheduledById: userId, scheduleConfig: { source: configuration.source, matchMode: configuration.matchMode, conditions: configuration.conditions, timezone: 'Asia/Manila' }, ...content } });
    if (!changed.count) throw new AppError('The campaign changed while scheduling. Reload its current state.', 409);
  });
  await writeAuditLog({ tenantId, userId, action: 'campaign.scheduled', entityType: 'Campaign', entityId: id, after: { scheduledFor: due.toISOString(), timezone: 'Asia/Manila' } });
  return getCampaignById(id, tenantId);
}
export async function cancelCampaignSchedule(id: string, tenantId: string, userId: string) {
  await assertCampaignSender(tenantId, userId);
  const current = await getCampaignById(id, tenantId);
  const changed = await prisma.campaign.updateMany({ where: { id, ...await creatorWhere(tenantId), status: 'SCHEDULED', updatedAt: current.updatedAt, scheduledFor: current.scheduledFor, scheduledById: current.scheduledById, submissionStartedAt: null, isArchived: false }, data: { status: 'DRAFT', scheduledFor: null, scheduledById: null, scheduleConfig: Prisma.DbNull } });
  if (!changed.count) throw new AppError('Only an unclaimed Scheduled campaign can be cancelled. Sending may already have started.', 409);
  await writeAuditLog({ tenantId, userId, action: 'campaign.schedule_cancelled', entityType: 'Campaign', entityId: id });
  return getCampaignById(id, tenantId);
}

type PreparedCampaign = {
  recipients: { id: string; logId: string; email: string | null; phone: string | null; leadId?: string | null; contactId?: string | null; channel: 'EMAIL' | 'SMS'; subject: string; html: string; sms: string }[];
  leaseId: string;
  smsDeviceId: string | null;
  resumed?: boolean;
};
async function prepareCampaign(id: string, tenantId: string, expected: ScheduledExpectation | undefined, submittedById: string): Promise<PreparedCampaign> {
  const scope = campaignScope(tenantId), owned = await creatorWhere(tenantId);
  const preparationStarted = performance.now();
  if (!acceptingSubmissions) throw new AppError('Campaign sending is temporarily unavailable while the server restarts.', 503);
  const channel = await prisma.campaign.findFirst({ where: { id, ...owned }, select: { type: true } });
  const smsDeviceId = channel?.type === 'SMS' ? await getSmsDeviceId() : null;
  if (!acceptingSubmissions) throw new AppError('Campaign sending is temporarily unavailable while the server restarts.', 503);
  const leaseId = randomUUID();
  const preparation = prisma.$transaction(async tx => {
    // The row lock also serializes draft edits and simultaneous Send Now requests.
    const claim = await tx.campaign.updateMany({ where: { id, ...owned, status: expected ? 'SCHEDULED' : 'DRAFT', ...(expected ? { scheduledFor: expected.scheduledFor, scheduledById: expected.scheduledById, updatedAt: expected.updatedAt } : {}), submissionStartedAt: null, isArchived: false }, data: { status: 'SENDING', submissionStartedAt: new Date(), submissionLeaseId: leaseId, submissionLeaseUntil: new Date(Date.now() + CAMPAIGN_LEASE_MS) } });
    if (!claim.count) {
      if (!await tx.campaign.findFirst({ where: { id, ...owned } })) throw new AppError('Campaign not found.', 404);
      throw new AppError('Campaign has already started or is not sendable.', 409, 'CAMPAIGN_CLAIM_CONFLICT');
    }
    const campaign = await tx.campaign.findFirstOrThrow({ where: { id, ...owned } });
    if (campaign.type === 'EMAIL') assertBrevoConfigured();
    else if (campaign.type === 'SMS') assertSmsConfigured();
    else throw new AppError('Send Now supports Email or SMS. Save Multi-Channel campaigns as drafts.', 400);
    const content = expected ? { subject: campaign.subject || '', body: campaign.body || '' } : await effectiveContent(campaign, tenantId, tx);
    const definition = expected?.definition ?? await audienceDefinition(tenantId, campaign.targetAudienceId, campaign.audienceSource, tx);
    CampaignSendSchema.parse({ name: campaign.name, type: campaign.type, ...content, audienceSource: definition.source });
    await validateCampaignVariables(tenantId, definition, content.subject, content.body, tx);
    const sender = await campaignSender(tenantId, campaign.type, content.subject + '\n' + content.body, tx);
    const resolved = await resolveCampaignRecipients(tenantId, definition, tx, campaign.type, content.subject, content.body, submittedById);
    const eligible = resolved.records.filter(r => !r.reason);
    if (!eligible.length) throw new AppError('No eligible recipients. Check audience exclusions.', 400);
    if (campaign.type === 'EMAIL') {
    const limit = Number(process.env.BREVO_DAILY_EMAIL_LIMIT || 300);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new AppError('Campaign daily limit is not configured correctly.', 503);
    const day = new Date().toISOString().slice(0, 10);
    await tx.campaignEmailQuota.upsert({ where: { day }, create: { day }, update: {} });
    const reserved = await tx.campaignEmailQuota.updateMany({ where: { day, reserved: { lte: limit - eligible.length } }, data: { reserved: { increment: eligible.length } } });
    if (!reserved.count) throw new AppError(`This campaign has ${eligible.length} eligible recipients, exceeding the available campaign allowance under the configured ${limit}/day limit. Reduce the audience or try another day.`, 409);
    }
    const sends = eligible.map(r => {
      const message = campaign.type === 'SMS' ? buildFinalSms({ body: content.body, variables: { ...r.personalization, ...sender } }) : '';
      if (campaign.type === 'SMS' && !message.trim()) throw new AppError('Personalization left an SMS empty. Add recipient values or update the message.', 400);
      return { ...r, phone: r.phone ?? null, personalization: { ...r.personalization, ...sender }, id: randomUUID(), logId: randomUUID(), channel: campaign.type as 'EMAIL' | 'SMS',
        ...(campaign.type === 'SMS' ? { subject: '', html: '', sms: message }
          : { ...renderCampaignMessage(content.subject, content.body, { ...r.personalization, ...sender }), sms: '' }) };
    });
    const tooLong = sends.filter(r => r.channel === 'SMS' && r.sms.length > SMS_MAX_LENGTH).length;
    if (tooLong) throw new AppError(`${tooLong} recipient message${tooLong === 1 ? '' : 's'} exceeds the ${SMS_MAX_LENGTH}-character SMS limit after personalization.`, 400);
    await tx.campaignContact.createMany({ data: [
      ...sends.map(r => ({ id: r.id, ...scope, campaignId: id, leadId: r.leadId, contactId: r.contactId, email: r.email, phone: r.phone, personalization: r.personalization, status: 'pending' })),
      ...resolved.records.filter(r => r.reason).map(r => ({ ...scope, campaignId: id, leadId: r.leadId, contactId: r.contactId, email: r.email, phone: r.phone, personalization: { ...r.personalization, ...sender }, status: 'excluded', failureReason: r.reason })),
    ] });
    if (campaign.type === 'EMAIL') await tx.emailDeliveryLog.createMany({ data: sends.map(r => ({ id: r.logId, ...scope, campaignId: id, leadId: r.leadId, contactId: r.contactId, fromEmail: sender.sender_email, toEmail: r.email!, subject: r.subject, status: 'pending' })) });
    await tx.campaign.update({ where: { id, ...owned }, data: { recipientCount: eligible.length, submittedById, ...(campaign.type === 'SMS' ? { smsDeviceId, smsTrackingVersion: 0 } : {}), ...content } });
    return { recipients: sends, leaseId, smsDeviceId };
  }, { timeout: 30000 });
  activePreparations.add(preparation);
  void preparation.finally(() => activePreparations.delete(preparation)).catch(() => undefined);
  const result = await preparation;
  console.info('[Campaigns]', { event: 'preparation_completed', campaignId: id, tenantId, durationMs: Math.round(performance.now() - preparationStarted) });
  return result;
}

async function submissionTransaction<T>(id: string, tenantId: string, leaseId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const claim = await tx.campaign.updateMany({ where: { id, tenantId, submissionLeaseId: leaseId, submissionFinishedAt: null, submissionLeaseUntil: { gt: new Date() } },
      data: { submissionLeaseUntil: new Date(Date.now() + CAMPAIGN_LEASE_MS) } });
    if (!claim.count) throw new AppError('Campaign submission claim expired. Review the campaign report before sending anything again.', 409);
    return work(tx);
  }, { timeout: 30000 });
}

// These predicates never include previously accepted, uncertain or historical failures.
function safeSubmissionWhere(now: Date): Prisma.CampaignContactWhereInput {
  return { submittedAt: null, sentAt: null, deliveredAt: null, messageId: null, OR: [
    { status: 'pending', submissionAttemptedAt: null, submissionAttemptCount: 0, failureReason: null },
    { status: 'retrying', submissionAttemptCount: 1, nextSubmissionAttemptAt: { lte: now }, failureReason: { in: ['BREVO_HTTP_429', 'TEXTBEE_HTTP_429'] } },
  ] };
}

async function recipientStillEligible(tenantId: string, userId: string, recipient: PreparedCampaign['recipients'][number]) {
  const source = recipient.contactId ? 'CONTACTS' : recipient.leadId ? 'LEADS' : null;
  if (!source) return false;
  const field = recipient.channel === 'SMS' ? 'phone' : 'email';
  return crmActor.run({ tenantId, userId, readRecords: true }, async () => {
    // Stored phones can retain local formatting; compare normalized evidence only
    // after resolving the same authorized record and tenant-wide suppression.
    const select = { email: true, phone: true };
    const person = recipient.contactId
      ? await prisma.contact.findFirst({ where: { id: recipient.contactId, tenantId }, select })
      : await prisma.lead.findFirst({ where: { id: recipient.leadId!, tenantId }, select });
    const value = person?.[field];
    if (!value) return false;
    const result = await resolveAudience(tenantId, { source, conditions: [{ field, operator: 'equals', value }] }, prisma, recipient.channel);
    return result.records.some(row => !row.reason && (row.contactId ?? null) === (recipient.contactId ?? null) && (row.leadId ?? null) === (recipient.leadId ?? null)
      && (recipient.channel === 'SMS' ? row.phone === recipient.phone : row.email === recipient.email));
  });
}

async function deliverPrepared(id: string, tenantId: string, userId: string, preparation: PreparedCampaign): Promise<CampaignSendResult> {
  const scope = campaignScope(tenantId);
  const { recipients: prepared, leaseId } = preparation;
  // No external HTTP inside a transaction. Keep at most five provider requests active.
  console.info('[Campaigns]', { event: 'submission_started', campaignId: id, tenantId, recipientCount: prepared.length });
  const submit = async (recipient: typeof prepared[number]) => {
    if (!acceptingSubmissions) throw new AppError('Campaign submission interrupted by server shutdown.', 503);
    await assertCampaignSender(tenantId, userId);
    if (preparation.resumed && !await recipientStillEligible(tenantId, userId, recipient)) {
      await submissionTransaction(id, tenantId, leaseId, async tx => {
        const changed = await tx.campaignContact.updateMany({ where: { id: recipient.id, ...scope, ...safeSubmissionWhere(new Date()) }, data: { status: 'failed', nextSubmissionAttemptAt: null, failureReason: 'RECIPIENT_NO_LONGER_ELIGIBLE' } });
        if (changed.count && recipient.channel === 'EMAIL') await tx.emailDeliveryLog.update({ where: { id: recipient.logId, ...scope }, data: { status: 'failed', errorMessage: 'RECIPIENT_NO_LONGER_ELIGIBLE' } });
      });
      return;
    }
      const intentStarted = performance.now();
      // Persist the intent before the HTTP call so crash recovery can distinguish
      // untouched recipients from messages the provider may have accepted.
      const attempt = await submissionTransaction(id, tenantId, leaseId, async tx => {
        const marked = await tx.campaignContact.updateMany({ where: { id: recipient.id, ...scope, ...safeSubmissionWhere(new Date()) },
          data: { status: 'submitting', submissionAttemptedAt: new Date(), submissionAttemptCount: { increment: 1 }, nextSubmissionAttemptAt: null, failureReason: null } });
        if (!marked.count) throw new AppError('Recipient submission already attempted. Automatic replay is blocked.', 409);
        if (recipient.channel === 'EMAIL') await tx.emailDeliveryLog.update({ where: { id: recipient.logId, ...scope }, data: { status: 'submitting' } });
        return tx.campaignContact.findUniqueOrThrow({ where: { id: recipient.id, ...scope }, select: { submissionAttemptCount: true } });
      });
      let result;
      const providerStarted = performance.now();
      try {
        result = recipient.channel === 'SMS'
          ? await sendSms(recipient.phone!, recipient.sms, { deviceId: preparation.smsDeviceId! })
          : await sendMail({ to: recipient.email!, subject: recipient.subject, html: recipient.html, requireDelivery: true });
        if (recipient.channel === 'EMAIL' && result.submitted && !result.messageId) throw new EmailSubmissionError('unconfirmed');
      } catch (error) {
        const rejected = (error instanceof EmailSubmissionError || error instanceof SmsSubmissionError) && error.outcome === 'rejected';
        const reason = rejected ? `${recipient.channel === 'SMS' ? 'TEXTBEE' : 'BREVO'}_HTTP_${error.httpStatus}` : 'PROVIDER_SUBMISSION_UNCONFIRMED';
        const retryAt = rejected && error.httpStatus === 429 && attempt.submissionAttemptCount < 2
          ? new Date(Math.max(Date.now() + 30000, error.retryAfterAt ?? 0)) : null;
        console.warn('[Campaigns]', { event: 'recipient_submission', campaignId: id, tenantId, recipientId: recipient.id, outcome: rejected ? 'rejected' : 'unconfirmed', httpStatus: error instanceof EmailSubmissionError || error instanceof SmsSubmissionError ? error.httpStatus : undefined, providerMs: Math.round(performance.now() - providerStarted) });
        // Unconfirmed requests may have been accepted: preserve them for review.
        await submissionTransaction(id, tenantId, leaseId, async tx => {
          const status = retryAt ? 'retrying' : rejected ? 'failed' : 'pending';
          await tx.campaignContact.update({ where: { id: recipient.id, ...scope }, data: { status, failureReason: reason, nextSubmissionAttemptAt: retryAt,
            ...(error instanceof EmailSubmissionError ? { providerErrorCode: error.providerCode, providerErrorMessage: error.providerMessage } : {}) } });
          if (recipient.channel === 'EMAIL') await tx.emailDeliveryLog.update({ where: { id: recipient.logId, ...scope }, data: { status, errorMessage: error instanceof EmailSubmissionError ? error.providerMessage : reason } });
          if (recipient.channel === 'SMS') await recalculateCampaignDelivery(tx, id, tenantId);
        });
        if (retryAt) console.info('[Campaigns]', { event: 'submission_retry_scheduled', campaignId: id, tenantId, recipientId: recipient.id, attempt: attempt.submissionAttemptCount, retryAt: retryAt.toISOString() });
        if (recipient.channel === 'SMS') requestNotificationDispatch(tenantId);
        return;
      }
      const submitted = result.submitted;
      const now = new Date();
      console.info('[Campaigns]', { event: 'recipient_submission', campaignId: id, tenantId, recipientId: recipient.id, outcome: submitted ? 'accepted' : 'not_submitted', messageId: result.messageId, intentMs: Math.round(providerStarted - intentStarted), providerMs: Math.round(performance.now() - providerStarted) });
      await submissionTransaction(id, tenantId, leaseId, async tx => {
        await tx.campaign.update({ where: { id, ...scope }, data: submitted ? { sentCount: { increment: 1 } } : { failedCount: { increment: 1 } } });
        await tx.campaignContact.update({ where: { id: recipient.id, ...scope }, data: { status: submitted ? 'submitted' : 'failed', messageId: result.messageId,
          submittedAt: submitted ? now : null,
          ...(recipient.channel === 'SMS' && submitted ? { nextSmsCheckAt: new Date(+now + 60000) } : {}),
          failureReason: submitted ? null : 'TRANSPORT_NOT_SUBMITTED', providerErrorCode: null, providerErrorMessage: null } });
        if (recipient.channel === 'EMAIL') await tx.emailDeliveryLog.update({ where: { id: recipient.logId, ...scope }, data: { status: submitted ? 'submitted' : 'failed', brevoMessageId: result.messageId, errorMessage: submitted ? null : 'TRANSPORT_NOT_SUBMITTED' } });
      });
  };
  try { await runSubmissionPool(prepared, submit); }
  catch { throw new AppError('Campaign delivery requires review because a result could not be saved or access changed.', 503); }
  const result = await submissionTransaction(id, tenantId, leaseId, async tx => {
    // Hold the same campaign lock as webhooks while taking the final snapshot.
    const waiting = await tx.campaignContact.count({ where: { campaignId: id, ...scope, status: 'retrying', nextSubmissionAttemptAt: { not: null } } });
    const uncertain = await tx.campaignContact.count({ where: { campaignId: id, ...scope, failureReason: 'PROVIDER_SUBMISSION_UNCONFIRMED', submittedAt: null, sentAt: null, deliveredAt: null } });
    // Keep deferred work durable and release its lease; the scheduler claims it later.
    await tx.campaign.update({ where: { id, ...scope }, data: { submissionFinishedAt: waiting ? null : new Date(), submissionInterruptedAt: !waiting && uncertain ? new Date() : null, submissionLeaseId: null, submissionLeaseUntil: null } });
    let campaign = await recalculateCampaignDelivery(tx, id, tenantId);
    // Campaign.sentAt is the historical submission time, never delivery proof.
    if (campaign.sentCount && !campaign.sentAt) campaign = await tx.campaign.update({ where: { id, ...scope }, data: { sentAt: new Date() } });
    return campaignSendResult(campaign);
  });
  console.info('[Campaigns]', { event: 'submission_completed', tenantId, ...result });
  requestNotificationDispatch(tenantId);
  await writeAuditLog({ tenantId, userId, action: 'campaign.submitted', entityType: 'Campaign', entityId: id, after: { ...result } });
  return result;
}
let acceptingSubmissions = true;
const activePreparations = new Set<Promise<unknown>>();
const activeSubmissions = new Set<Promise<CampaignSendResult>>();
function trackSubmission(id: string, tenantId: string, userId: string, preparation: PreparedCampaign) {
  const work = deliverPrepared(id, tenantId, userId, preparation).catch(async error => {
    try { await interruptCampaignSubmission(id, tenantId, preparation.leaseId); }
    catch { console.error('[Campaigns] Could not persist interruption; the expired lease will be recovered.'); }
    throw error;
  });
  activeSubmissions.add(work);
  void work.finally(() => activeSubmissions.delete(work)).catch(() => undefined);
  return work;
}
/** Stop between batches, let in-flight provider calls finish, then preserve the report. */
export async function drainCampaignSubmissions() {
  acceptingSubmissions = false;
  do { await Promise.allSettled([...activePreparations, ...activeSubmissions]); }
  while (activePreparations.size || activeSubmissions.size);
}
export function resumeCampaignSubmissions() {
  if (activePreparations.size || activeSubmissions.size) throw new Error('CAMPAIGN_DRAIN_INCOMPLETE');
  acceptingSubmissions = true;
}
// Service-level completion is useful to workers/tests; HTTP uses queueCampaign below.
export async function sendCampaign(id: string, tenantId: string, userId: string): Promise<CampaignSendResult> {
  await assertCampaignSender(tenantId, userId);
  return trackSubmission(id, tenantId, userId, await prepareCampaign(id, tenantId, undefined, userId));
}

export async function queueCampaign(id: string, tenantId: string, userId: string): Promise<CampaignSendResult> {
  await assertCampaignSender(tenantId, userId);
  const prepared = await prepareCampaign(id, tenantId, undefined, userId);
  // The committed snapshot and submissionStartedAt claim
  // prevent replays even if the browser closes or the proxy request finishes.
  void trackSubmission(id, tenantId, userId, prepared).catch(() => {
    console.error('[Campaigns] Delivery interrupted; persisted recipient results require review.');
  });
  return { campaignId: id, eligibleRecipients: prepared.recipients.length, submittedRecipients: 0, failedRecipients: 0, status: 'SENDING', submissionComplete: false };
}

export async function archiveCampaign(id: string, tenantId: string, userId: string) {
  const current = await getCampaignById(id, tenantId);
  const result = await prisma.campaign.updateMany({ where: { id, ...await creatorWhere(tenantId), status: current.status, scheduledFor: current.scheduledFor, scheduledById: current.scheduledById, OR: [{ submissionStartedAt: null }, { submissionFinishedAt: { not: null } }] }, data: { isArchived: true, ...(current.status === 'SCHEDULED' ? { status: 'DRAFT', scheduledFor: null, scheduledById: null, scheduleConfig: Prisma.DbNull } : {}) } });
  if (!result.count) throw new AppError('A sending campaign cannot be archived.', 409);
  await writeAuditLog({ tenantId, userId, action: 'campaign.archived', entityType: 'Campaign', entityId: id });
}

export async function duplicateCampaign(id: string, tenantId: string, userId: string, input: unknown = {}) {
  const original = await getCampaignById(id, tenantId);
  const repair = z.object({ audienceSource: z.enum(['LEADS', 'CONTACTS']).optional() }).strict().parse(input);
  const legacyAudience = original.targetAudienceId ? await prisma.targetAudience.findFirst({ where: { id: original.targetAudienceId, tenantId }, select: { source: true } }) : null;
  if ((original.audienceSource === 'ALL' || legacyAudience?.source === 'ALL') && !repair.audienceSource) throw new AppError('Select a Lead or Contact source before duplicating this legacy mixed campaign.', 400);
  return createCampaign(tenantId, userId, { name: original.name.slice(0, 140) + ' (Copy)', type: original.type, subject: original.subject ?? '', body: original.body ?? '', targetAudienceId: repair.audienceSource ? null : original.targetAudienceId, audienceSource: repair.audienceSource ?? original.audienceSource, emailTemplateId: original.emailTemplateId, smsTemplateId: original.smsTemplateId });
}

/** Resume only a frozen snapshot with a safe recipient, never another audience evaluation. */
export async function resumePendingCampaigns(now = new Date()) {
  const ready = { status: 'SENDING' as const, isArchived: false, submissionFinishedAt: null, submissionLeaseId: null, submissionLeaseUntil: null,
    submittedById: { not: null }, campaignContacts: { some: safeSubmissionWhere(now) } };
  const rows = await prisma.campaign.findMany({ where: ready, orderBy: [{ submissionStartedAt: 'asc' }, { id: 'asc' }], take: 25 });
  let resumed = 0;
  for (const row of rows) await tenantContext.run({ tenantId: row.tenantId }, async () => {
    if (!acceptingSubmissions) return;
    const leaseId = randomUUID();
    try {
      const prepared = await prisma.$transaction(async tx => {
        const claim = await tx.campaign.updateMany({ where: { id: row.id, tenantId: row.tenantId, ...ready }, data: { submissionLeaseId: leaseId, submissionLeaseUntil: new Date(Date.now() + CAMPAIGN_LEASE_MS) } });
        if (!claim.count) return null;
        const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: row.id, tenantId: row.tenantId } });
        if (campaign.type !== 'EMAIL' && campaign.type !== 'SMS') throw new AppError('Unsupported campaign channel.', 400);
        const contacts = await tx.campaignContact.findMany({ where: { campaignId: row.id, tenantId: row.tenantId, ...safeSubmissionWhere(now) }, orderBy: { id: 'asc' } });
        const logs = campaign.type === 'EMAIL' ? await tx.emailDeliveryLog.findMany({ where: { campaignId: row.id, tenantId: row.tenantId, brevoMessageId: null } }) : [];
        const recipients = contacts.map(contact => {
          const values = contact.personalization && typeof contact.personalization === 'object' && !Array.isArray(contact.personalization)
            ? Object.fromEntries(Object.entries(contact.personalization).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
          const log = logs.find(item => item.toEmail === contact.email);
          if (campaign.type === 'EMAIL' && !log) throw new AppError('Persisted email submission log is missing.', 409);
          return { id: contact.id, logId: log?.id ?? '', email: contact.email, phone: contact.phone, leadId: contact.leadId, contactId: contact.contactId,
            channel: campaign.type as 'EMAIL' | 'SMS', ...(campaign.type === 'EMAIL' ? renderCampaignMessage(campaign.subject ?? '', campaign.body ?? '', values) : { subject: '', html: '' }),
            sms: campaign.type === 'SMS' ? buildFinalSms({ body: campaign.body ?? '', variables: values }) : '' };
        });
        return { recipients, leaseId, smsDeviceId: campaign.smsDeviceId, resumed: true };
      }, { timeout: 30000 });
      if (!prepared) return;
      resumed++;
      console.info('[Campaigns]', { event: 'submission_resumed', campaignId: row.id, tenantId: row.tenantId, recipients: prepared.recipients.length });
      void trackSubmission(row.id, row.tenantId, row.submittedById!, prepared).catch(() => console.error('[Campaigns]', { event: 'resumed_submission_interrupted', campaignId: row.id, tenantId: row.tenantId }));
    } catch (error) {
      console.error('[Campaigns]', { event: 'submission_resume_unavailable', campaignId: row.id, tenantId: row.tenantId, code: error instanceof AppError ? error.code ?? `VALIDATION_${error.statusCode}` : 'DATABASE_UNAVAILABLE' });
    }
  });
  return resumed;
}

/** Bounded cross-tenant discovery; all actor checks and writes run in tenant context. */
export async function dispatchDueCampaigns(now = new Date()) {
  const due = await prisma.campaign.findMany({ where: { status: 'SCHEDULED', scheduledFor: { lte: now }, isArchived: false, submissionStartedAt: null }, orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }], take: 25 });
  let dispatched = 0;
  for (const row of due) await tenantContext.run({ tenantId: row.tenantId }, async () => {
    try {
      if (!row.scheduledById || !row.scheduledFor) throw new AppError('The saved scheduling actor or due time is missing. Schedule again.', 400);
      await assertCampaignSender(row.tenantId, row.scheduledById);
      const approved = CampaignScheduleConfigSchema.parse(row.scheduleConfig);
      const definition = AudiencePreviewSchema.parse({ source: approved.source, matchMode: approved.matchMode, conditions: approved.conditions });
      const prepared = await crmActor.run({ tenantId: row.tenantId, userId: row.scheduledById, readRecords: true }, () => prepareCampaign(row.id, row.tenantId, { scheduledFor: row.scheduledFor!, scheduledById: row.scheduledById!, updatedAt: row.updatedAt, definition }, row.scheduledById!));
      dispatched++;
      console.info('[Campaigns]', { event: 'schedule_claimed', campaignId: row.id, tenantId: row.tenantId, scheduledFor: row.scheduledFor.toISOString() });
      void trackSubmission(row.id, row.tenantId, row.scheduledById, prepared).catch(() => console.error('[Campaigns] Scheduled submission interrupted; review persisted recipient outcomes.'));
    } catch (error) {
      if (!acceptingSubmissions) return; // Shutdown preserves an unclaimed schedule for restart.
      // An expected-state conflict means another runner/cancel/reschedule won.
      if (error instanceof AppError && error.code === 'CAMPAIGN_CLAIM_CONFLICT') return;
      if (error instanceof SmsSubmissionError && (error.outcome === 'unconfirmed' || error.httpStatus === 429)
        || !(error instanceof AppError) && !(error instanceof z.ZodError)) {
        console.warn('[Campaigns]', { event: 'schedule_preflight_deferred', campaignId: row.id, tenantId: row.tenantId, code: error instanceof SmsSubmissionError ? `TEXTBEE_HTTP_${error.httpStatus ?? 'UNAVAILABLE'}` : 'INFRASTRUCTURE_UNAVAILABLE' });
        return;
      }
      const reason = (error instanceof z.ZodError ? 'Approved scheduling configuration is invalid. Repair and schedule again.' : error.message).slice(0, 1000);
      const saved = row.scheduleConfig && typeof row.scheduleConfig === 'object' && !Array.isArray(row.scheduleConfig) ? row.scheduleConfig : {};
      await prisma.campaign.updateMany({ where: { id: row.id, tenantId: row.tenantId, status: 'SCHEDULED', scheduledFor: row.scheduledFor, scheduledById: row.scheduledById, updatedAt: row.updatedAt, submissionStartedAt: null }, data: { status: 'DRAFT', scheduledFor: null, scheduledById: null, scheduleConfig: { ...saved, scheduleFailureReason: reason } } });
      console.warn('[Campaigns]', { event: 'schedule_preflight_failed', campaignId: row.id, tenantId: row.tenantId, code: error instanceof AppError ? error.code ?? `VALIDATION_${error.statusCode}` : 'INVALID_SCHEDULE' });
    }
  });
  return dispatched;
}
export function startCampaignScheduleScheduler() {
  let running: Promise<unknown> | undefined;
  const run = () => { if (!running) running = (async () => {
    const started = performance.now();
    const dispatched = await dispatchDueCampaigns();
    const resumed = await resumePendingCampaigns();
    console.info('[Campaigns]', { event: 'scheduler_sweep', dispatched, resumed, durationMs: Math.round(performance.now() - started) });
  })().catch(() => console.error('[Campaigns]', { event: 'scheduler_sweep_failed' })).finally(() => { running = undefined; }); };
  console.info('[Campaigns]', { event: 'scheduler_started', intervalMs: 30000 });
  run();
  const interval = setInterval(run, 30_000); interval.unref();
  return async () => { clearInterval(interval); await running; };
}
