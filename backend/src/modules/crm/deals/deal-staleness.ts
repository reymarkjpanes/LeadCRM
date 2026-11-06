import type { DealStaleness } from '@leadcrm/shared';
import { Prisma } from '@prisma/client';
import { tenantContext } from '../../../core/tenant/tenant-context';

const DAY_MS = 86_400_000;

export const staleDealCutoff = (thresholdDays: number, now: Date): Date =>
  new Date(now.getTime() - thresholdDays * DAY_MS);

export const dealStalenessSelect = {
  stageChangedAt: true, createdAt: true, isArchived: true, deletedAt: true, engagementStatus: true,
  stage: { select: { id: true, name: true, rottenAfterDays: true, isWon: true, isLost: true } },
  pipeline: { select: { isArchived: true } },
} satisfies Prisma.DealSelect;

type StalenessInput = {
  stageChangedAt: Date | null;
  createdAt: Date;
  isArchived: boolean;
  deletedAt: Date | null;
  engagementStatus?: string;
  stage: { id: string; name: string; rottenAfterDays: number | null; isWon: boolean; isLost: boolean };
  pipeline: { isArchived: boolean };
};

const stageEntry = (deal: StalenessInput) => deal.stageChangedAt ?? deal.createdAt;
const isEligible = (deal: StalenessInput) => !deal.isArchived && !deal.deletedAt && !deal.pipeline.isArchived &&
  !deal.stage.isWon && !deal.stage.isLost && (deal.stage.rottenAfterDays ?? 0) > 0 &&
  !['closed', 'closed_deal', 'closed deal', 'cancelled', 'canceled'].includes(deal.engagementStatus?.trim().toLowerCase() ?? '');

export function dealStaleness(deal: StalenessInput, now: Date, latestWork?: Date): DealStaleness {
  const { stage } = deal;
  const enteredAt = stageEntry(deal);
  const inactiveSince = latestWork && latestWork > enteredAt && latestWork <= now ? latestWork : enteredAt;
  const elapsedDays = (date: Date) => Math.max(0, Math.floor((+now - +date) / DAY_MS));
  return {
    stageId: stage.id,
    stageName: stage.name,
    thresholdDays: stage.rottenAfterDays,
    daysInStage: elapsedDays(enteredAt),
    daysInactive: elapsedDays(inactiveSince),
    isStale: isEligible(deal) && stage.rottenAfterDays !== null && inactiveSince <= staleDealCutoff(stage.rottenAfterDays, now),
  };
}

// Older audit entries record persisted changes but do not distinguish staff from
// workflow updates. Never use bookkeeping fields or related record projections.
const legacyEditFields = ['title', 'value', 'currency', 'priority', 'expectedCloseDate', 'leadSource', 'accountId',
  'assignedUserId', 'address', 'addressSource', 'productInterestOther', 'engagementStatus'];

/** Use only Deal IDs the caller has already authorized. Evidence never leaves the server. */
export async function evaluateDealStaleness(db: Prisma.TransactionClient, tenantId: string,
  deals: ReadonlyArray<StalenessInput & { id: string }>, now: Date): Promise<Map<string, DealStaleness>> {
  const scope = tenantContext.getStore();
  if (scope && scope.tenantId !== tenantId) throw new Error('Deal inactivity workspace mismatch.');
  const inputs = deals.filter(deal => isEligible(deal) && stageEntry(deal) < now)
    .map(deal => ({ id: deal.id, entered: stageEntry(deal).toISOString() }));
  // Every source is explicitly scoped to the tenant and authorized IDs. Use UTC
  // timestamp comparisons even when the database session is set to Manila time.
  const rows = !inputs.length ? [] : await tenantContext.exit(async () => await db.$queryRaw<{ id: string; latest: Date }[]>`
    WITH candidates AS (
      SELECT id, entered::timestamptz AT TIME ZONE 'UTC' AS entered
      FROM jsonb_to_recordset(${JSON.stringify(inputs)}::jsonb) AS i(id text, entered text)
    ), bounds AS (
      SELECT min(entered) AS earliest, ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC' AS observed FROM candidates
    ), completions AS (
      SELECT a."createdAt" AS at, a.metadata #> '{taskEvent,after,dealIds}' AS deals
      FROM "Activity" a CROSS JOIN bounds b
      WHERE a."tenantId" = ${tenantId} AND a.type = 'task' AND a."taskId" IS NOT NULL
        AND a.metadata #>> '{taskEvent,event}' = 'completed' AND a."createdAt" > b.earliest AND a."createdAt" <= b.observed
    ), evidence AS (
      SELECT c.id, a."createdAt" AS at FROM candidates c CROSS JOIN bounds b
      JOIN "Activity" a ON a."dealId" = c.id AND a."tenantId" = ${tenantId}
        AND a."createdAt" > c.entered AND a."createdAt" <= b.observed
      WHERE a.type IN ('note', 'call', 'meeting', 'sms')
        AND (a.type <> 'sms' OR COALESCE(lower(a.metadata ->> 'status'), '') NOT IN ('failed', 'draft', 'scheduled', 'pending'))
      UNION ALL
      SELECT c.id, a.at FROM candidates c JOIN completions a ON a.at > c.entered AND jsonb_exists(a.deals, c.id)
      UNION ALL
      SELECT c.id, a."createdAt" FROM candidates c CROSS JOIN bounds b
      JOIN "AuditLog" a ON a."entityId" = c.id AND a."entityType" = 'Deal' AND a."tenantId" = ${tenantId}
        AND a."createdAt" > c.entered AND a."createdAt" <= b.observed
      WHERE a.action = 'deal.reassigned' OR (a.action = 'deal.updated' AND (
        a.metadata -> 'stalenessReset' = 'true'::jsonb OR (
          a.metadata -> 'stalenessReset' IS NULL AND
          jsonb_exists_any(a.changeset -> 'after', ARRAY[${Prisma.join(legacyEditFields)}]::text[])
        )
      ))
      UNION ALL
      SELECT c.id, m."sentAt" FROM candidates c CROSS JOIN bounds b
      JOIN "MailboxMessage" m ON m."dealId" = c.id AND m."tenantId" = ${tenantId}
        AND m."sentAt" > c.entered AND m."sentAt" <= b.observed
      WHERE jsonb_typeof(m."dealAttribution") = 'object' AND NOT (m.labels && ARRAY['DRAFT','SPAM','TRASH','DELETED'])
        AND (m.direction = 'inbound' AND m.meaningful OR m.direction = 'outbound' AND EXISTS (
          SELECT 1 FROM "MailboxSendReceipt" r WHERE r."tenantId" = ${tenantId} AND r."accountId" = m."accountId"
            AND r.operation IN ('send','schedule') AND r.status = 'sent'
            AND (r."providerMessageId" = m."providerMessageId" OR r."rfcMessageId" = m."rfcMessageId")
            AND COALESCE(r."authorizationContext" ->> 'composeMode', '') <> 'forward'
            AND COALESCE(r."authorizationContext" ->> 'forwardSourceMessageId', '') = ''
            AND r."authorizationContext" ->> 'internalSourceReceiptId' IS NULL
        ))
    )
    SELECT id, max(at) AS latest FROM evidence GROUP BY id`);
  const latest = new Map(rows.map(row => [row.id, row.latest]));
  return new Map(deals.map(deal => [deal.id, dealStaleness(deal, now, latest.get(deal.id))]));
}
