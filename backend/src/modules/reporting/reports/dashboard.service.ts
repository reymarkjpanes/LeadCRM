import { Prisma } from '@prisma/client';
import { DashboardQuerySchema, dashboardPeriod, dashboardFunnelPeriod, SALES_PIPELINE_STAGES, type DashboardQuery, type DashboardReport, type DashboardStage } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { findUserEffectivePermissions } from '../../administration/roles/roles.repository';
import { AppError } from '../../../shared/errors/app-error';
import type { AuthenticatedUser } from '../../../api/middleware/auth.middleware';
import { dealStalenessSelect, evaluateDealStaleness, staleDealCutoff } from '../../crm/deals/deal-staleness';
import { resolveCrmActor, crmPolicyReadWhere, crmPolicySqlWhere, taskReadWhere } from '../../crm/access/crm-record-access.service';

export async function dashboardAccess(identity: AuthenticatedUser) {
  const user = await prisma.user.findFirst({ where: { id: identity.userId, tenantId: identity.tenantId, status: 'ACTIVE' }, select: { role: true, groupMemberships: { where: { tenantId: identity.tenantId }, select: { group: { select: { name: true, tenantId: true } } } } } });
  if (!user) throw new AppError('Authentication required', 401);
  const admin = user.role === 'Client Admin';
  const permissions = admin ? {} : await findUserEffectivePermissions(identity.userId, identity.tenantId);
  const can = (module: string) => admin || !!permissions[module]?.canView;
  if (!can('dashboard')) throw new AppError('Dashboard access denied', 403);
  const policy = await resolveCrmActor(prisma, { userId: identity.userId, tenantId: identity.tenantId });
  const dealScope = crmPolicyReadWhere(policy, 'deals');
  const leadScope = crmPolicyReadWhere(policy, 'leads');
  const taskScope = taskReadWhere(policy);
  const leaderboard = can('deals') && (admin || user.groupMemberships.some(({ group }) => group.tenantId === identity.tenantId && ['top management', 'head of sales'].includes(group.name.trim().toLowerCase())));
  return { admin, deals: can('deals'), leads: can('leads'), tasks: can('tasks'), leaderboard, dealScope, leadScope, taskScope, policy };
}

export function verifyDashboardStages(stages: DashboardStage[]) {
  const names = SALES_PIPELINE_STAGES.map(name => name.toLowerCase());
  if (stages.length !== 5 || stages.some((stage, i) => stage.name.trim().toLowerCase() !== names[i] ||
    stage.isWon !== (i === 3) || stage.isLost !== (i === 4))) {
    throw new AppError('The Sales Pipeline must contain Lead, Contacted, Qualified, Closed Deal and Cancelled in the official order. Review its configuration; historical data has not been changed.', 409, 'DASHBOARD_PIPELINE_CONFIGURATION');
  }
}

type Totals = { revenue: number; won: number; lost: number; currentWon: number; totalDeals: number; average: number | null; active: number;
  openValue: number; monetaryMissing: number; wonMissing: number; openMissing: number;
  currencyExcluded: number; closingDateMissing: number; attributionMissing: number; unattributedRevenue: number; unattributedMissing: number };
const percent = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 1000) / 10 : null;

export async function getDashboard(identity: AuthenticatedUser, input: unknown, now = new Date(),
  { strictSalesPipeline = false } = {}): Promise<DashboardReport> {
  const started = performance.now();
  const parsed = DashboardQuerySchema.safeParse(input);
  if (!parsed.success) throw new AppError('Choose a valid dashboard date range.', 400);
  const query: DashboardQuery = parsed.data;
  let period: ReturnType<typeof dashboardPeriod>;
  try { period = dashboardPeriod(query, now); } catch { throw new AppError('Choose a reporting period of at most two years.', 400); }
  let sourcePeriod: ReturnType<typeof dashboardPeriod>;
  try {
    sourcePeriod = dashboardPeriod({ range: query.leadSourceRange ?? 'thisMonth', start: query.leadSourceStart, end: query.leadSourceEnd }, now);
  } catch { throw new AppError('Choose a Lead Source reporting period of at most two years.', 400); }
  let funnel: ReturnType<typeof dashboardFunnelPeriod>;
  try { funnel = dashboardFunnelPeriod(query, now); } catch (error) { throw new AppError(error instanceof Error ? error.message : 'Choose a valid historical funnel period.', 400); }
  const interval = query.revenueInterval ?? 'month';
  const { tenantId, userId } = identity;
  const context = tenantContext.getStore();
  if (context && context.tenantId !== tenantId) throw new AppError('Workspace mismatch', 403);
  const access = await dashboardAccess(identity);

  // Only this parameterized, explicitly scoped reporting repository bypasses the
  // generic raw-query guard. Analytics use trusted tenant scope; dashboard.view
  // is the existing organization reporting grant, with module-level restrictions.
  // RepeatableRead keeps every card, chart and export on the same DB snapshot.
  const report = await prisma.$transaction(async tx => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true } });
    const currency = tenant.currency || 'PHP';
    const result: DashboardReport = {
      generatedAt: now.toISOString(), queryMs: 0, currency, scope: access.admin ? 'organization' : 'authorized',
      period: { start: period.start, end: period.end, timezone: period.timezone, interval },
      access: { deals: access.deals, leads: access.leads, tasks: access.tasks, leaderboard: access.leaderboard }, pipeline: null,
      metrics: { totalRevenue: null, forecastedRevenue: null, activeDeals: null, totalLeads: null, won: null, lost: null,
        winRate: null, currentWon: null, totalDeals: null, unattributedWon: null, unattributedRevenue: null,
        averageDealDays: null, openPipelineValue: null, forecastMissing: 0, monetaryMissing: 0,
        currencyExcluded: 0, closingDateMissing: 0 },
      trend: [], distribution: [], leadSourcePerformance: null, conversion: null, leaderboard: [], actions: [], pendingActions: 0, warnings: [],
    };
    const leadWhere = { ...access.leadScope, tenantId, isArchived: false, deletedAt: null, convertedAt: null };
    if (access.leads) result.metrics.totalLeads = await tx.lead.count({ where: leadWhere });

    let invalidSalesPipelines: string[] = [];
    if (access.deals) {
      // Same authoritative lookup used by Lead -> Product Deal automation; read-only.
      const pipelines = await tx.pipeline.findMany({ where: { tenantId, isArchived: false, name: { equals: 'Sales Pipeline', mode: 'insensitive' } },
        select: { id: true, name: true, stages: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: {
          id: true, name: true, order: true, color: true, probability: true, isWon: true, isLost: true,
        } } } });
      let configurationError: AppError | undefined;
      if (pipelines.length > 1 || !pipelines.length && await tx.deal.count({ where: { ...access.dealScope, tenantId, isArchived: false, deletedAt: null } })) {
        configurationError = new AppError('Configure one active Sales Pipeline for dashboard reporting.', 409, 'DASHBOARD_PIPELINE_CONFIGURATION');
      } else if (pipelines.length === 1) {
        try { verifyDashboardStages(pipelines[0].stages); }
        catch (error) {
          if (!(error instanceof AppError) || error.code !== 'DASHBOARD_PIPELINE_CONFIGURATION') throw error;
          configurationError = error;
        }
      }
      if (configurationError) {
        if (strictSalesPipeline) throw configurationError;
        invalidSalesPipelines = pipelines.map(pipeline => pipeline.id);
        result.warnings.push(configurationError.message);
      } else if (!pipelines.length) {
        Object.assign(result.metrics, { totalRevenue: 0, forecastedRevenue: 0, activeDeals: 0, won: 0, lost: 0, winRate: 0, currentWon: 0, totalDeals: 0, unattributedWon: 0, unattributedRevenue: 0, openPipelineValue: 0 });
        result.leadSourcePerformance = { period: { start: sourcePeriod.start, end: sourcePeriod.end, timezone: sourcePeriod.timezone }, sources: [] };
      } else {
      const pipeline = pipelines[0];
      result.pipeline = pipeline;
      const [lead, contacted, qualified, won, lost] = pipeline.stages;
      // Prisma DateTime columns are UTC timestamp-without-time-zone. Explicit
      // UTC casts avoid implicit comparisons in the database session timezone.
      const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
      const scope = Prisma.sql`d."tenantId" = ${tenantId} AND d."pipelineId" = ${pipeline.id}
        AND NOT d."isArchived" AND d."deletedAt" IS NULL
        AND ${crmPolicySqlWhere(access.policy, 'deals', 'd')}`;
      const resolved = Prisma.sql`d."closedAt" >= ${utc(period.from)} AND d."closedAt" < ${utc(period.until)}
        AND d."closedAt" >= d."createdAt" AND d."closedAt" <= ${utc(now)}`;
      const validMoney = Prisma.sql`d.currency = ${currency} AND d.value >= 0 AND d.value::text NOT IN ('NaN','Infinity','-Infinity')`;
      // Only the immutable closure snapshot proves sales credit. Current roles,
      // assignees and the stage-change actor cannot establish old ownership.
      const credited = Prisma.sql`d."revenueOwnerEligible" = true AND d."revenueOwnerId" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = d."revenueOwnerId" AND u."tenantId" = ${tenantId})`;
      const raw = <T>(sql: Prisma.Sql) => tenantContext.exit(async () => await tx.$queryRaw<T>(sql));
      const sourceGroups = await raw<Array<{ name: string; won: number }>>(Prisma.sql`
        SELECT COALESCE(NULLIF(regexp_replace(d."leadSource", '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), 'Not specified') AS name,
          COUNT(DISTINCT d.id)::int AS won
        FROM "Deal" d JOIN "Stage" s ON s.id = d."stageId" AND s."tenantId" = d."tenantId" AND s."pipelineId" = d."pipelineId"
        WHERE ${scope} AND s."isWon" AND d."closedAt" >= ${utc(sourcePeriod.from)} AND d."closedAt" < ${utc(sourcePeriod.until)}
          AND d."closedAt" >= d."createdAt" AND d."closedAt" <= ${utc(now)}
        GROUP BY 1 ORDER BY won DESC, name ASC`);
      const unspecified = sourceGroups.find(row => row.name === 'Not specified');
      const named = sourceGroups.filter(row => row.name !== 'Not specified' && row.name !== 'Others');
      const sources = named.slice(0, unspecified ? 4 : 5);
      if (unspecified) sources.push(unspecified);
      const others = sourceGroups.filter(row => !sources.includes(row)).reduce((sum, row) => sum + row.won, 0);
      if (others) sources.push({ name: 'Others', won: others });
      sources.sort((a, b) => b.won - a.won || a.name.localeCompare(b.name));
      result.leadSourcePerformance = {
        period: { start: sourcePeriod.start, end: sourcePeriod.end, timezone: sourcePeriod.timezone }, sources,
      };
      const totals = (await raw<Totals[]>(Prisma.sql`
        WITH eligible AS (SELECT d.*, s."isWon", s."isLost" FROM "Deal" d
          JOIN "Stage" s ON s.id = d."stageId" AND s."tenantId" = d."tenantId" AND s."pipelineId" = d."pipelineId" WHERE ${scope})
        SELECT COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE d."isWon" AND ${resolved} AND ${validMoney}), 2),0)::float8 AS revenue,
          COUNT(*) FILTER (WHERE d."isWon" AND ${resolved})::int AS won,
          COUNT(*) FILTER (WHERE d."isLost" AND ${resolved})::int AS lost,
          COUNT(*) FILTER (WHERE d."isWon")::int AS "currentWon", COUNT(*)::int AS "totalDeals",
          AVG(EXTRACT(EPOCH FROM (d."closedAt" - d."createdAt"))/86400) FILTER (WHERE d."isWon" AND ${resolved})::float8 AS average,
          COUNT(*) FILTER (WHERE NOT d."isWon" AND NOT d."isLost")::int AS active,
          COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE NOT d."isWon" AND NOT d."isLost" AND ${validMoney}),2),0)::float8 AS "openValue",
          COUNT(*) FILTER (WHERE d.currency = ${currency} AND NOT COALESCE((${validMoney}), false) AND (NOT d."isLost" AND (NOT d."isWon" OR ${resolved})))::int AS "monetaryMissing",
          COUNT(*) FILTER (WHERE d."isWon" AND ${resolved} AND d.currency = ${currency} AND NOT COALESCE((${validMoney}), false))::int AS "wonMissing",
          COUNT(*) FILTER (WHERE NOT d."isWon" AND NOT d."isLost" AND d.currency = ${currency} AND NOT COALESCE((${validMoney}), false))::int AS "openMissing",
          COUNT(*) FILTER (WHERE d.currency IS DISTINCT FROM ${currency} AND (NOT d."isWon" AND NOT d."isLost" OR ${resolved}))::int AS "currencyExcluded",
          COUNT(*) FILTER (WHERE (d."isWon" OR d."isLost") AND (d."closedAt" IS NULL OR d."closedAt" < d."createdAt" OR d."closedAt" > ${utc(now)}))::int AS "closingDateMissing",
          COUNT(*) FILTER (WHERE d."isWon" AND ${resolved} AND NOT COALESCE((${credited}),false))::int AS "attributionMissing",
          COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE d."isWon" AND ${resolved} AND ${validMoney} AND NOT COALESCE((${credited}),false)),2),0)::float8 AS "unattributedRevenue",
          COUNT(*) FILTER (WHERE d."isWon" AND ${resolved} AND d.currency = ${currency} AND NOT COALESCE((${validMoney}),false) AND NOT COALESCE((${credited}),false))::int AS "unattributedMissing"
        FROM eligible d`))[0];
      Object.assign(result.metrics, {
        totalRevenue: totals.wonMissing ? null : totals.revenue,
        activeDeals: totals.active, won: totals.won, lost: totals.lost, winRate: percent(totals.currentWon, totals.totalDeals) ?? 0,
        currentWon: totals.currentWon, totalDeals: totals.totalDeals, unattributedWon: totals.attributionMissing,
        unattributedRevenue: totals.unattributedMissing ? null : totals.unattributedRevenue,
        averageDealDays: totals.average === null ? null : Math.round(totals.average * 10) / 10,
        openPipelineValue: totals.openMissing ? null : totals.openValue,
        monetaryMissing: totals.monetaryMissing, currencyExcluded: totals.currencyExcluded, closingDateMissing: totals.closingDateMissing,
      });
      result.trend = await raw<DashboardReport['trend']>(Prisma.sql`
        WITH buckets AS (SELECT generate_series(date_trunc(${interval}, ${period.from.toISOString()}::timestamptz AT TIME ZONE 'Asia/Manila'),
          date_trunc(${interval}, (${period.until.toISOString()}::timestamptz - interval '1 millisecond') AT TIME ZONE 'Asia/Manila'),
          CASE WHEN ${interval} = 'week' THEN interval '1 week' WHEN ${interval} = 'year' THEN interval '1 year' ELSE interval '1 month' END) AS bucket),
        performance AS (SELECT date_trunc(${interval}, d."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila') AS bucket,
          COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE d."stageId" = ${won.id} AND ${validMoney}),2),0)::float8 AS revenue,
          COUNT(*) FILTER (WHERE d."stageId" = ${won.id})::int AS won, COUNT(*) FILTER (WHERE d."stageId" = ${lost.id})::int AS lost
          FROM "Deal" d WHERE ${scope} AND ${resolved} AND d."stageId" IN (${won.id}, ${lost.id}) GROUP BY 1)
        SELECT to_char(b.bucket, 'YYYY-MM-DD') AS name, COALESCE(p.revenue,0) AS revenue, COALESCE(p.won,0)::int AS won, COALESCE(p.lost,0)::int AS lost
        FROM buckets b LEFT JOIN performance p USING (bucket) ORDER BY b.bucket`);
      const groups = await raw<Array<{ id: string; count: number; value: number; missing: number }>>(Prisma.sql`
        SELECT d."stageId" AS id, COUNT(*)::int AS count,
          COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE ${validMoney}),2),0)::float8 AS value,
          COUNT(*) FILTER (WHERE d.currency = ${currency} AND NOT COALESCE((${validMoney}),false))::int AS missing
        FROM "Deal" d WHERE ${scope} AND d."stageId" IN (${lead.id}, ${contacted.id}, ${qualified.id}) GROUP BY d."stageId"`);
      const qualifiedTotals = groups.find(group => group.id === qualified.id);
      result.metrics.forecastedRevenue = qualifiedTotals?.missing ? null : qualifiedTotals?.value ?? 0;
      result.metrics.forecastMissing = qualifiedTotals?.missing ?? 0;
      result.distribution = pipeline.stages.slice(0, 3).map(stage => {
        const row = groups.find(group => group.id === stage.id);
        return { id: stage.id, name: stage.name, color: stage.color, count: row?.count ?? 0,
          value: row?.missing ? null : row?.value ?? 0, percentage: percent(row?.count ?? 0, totals.active) ?? 0 };
      });
      const cutoff = new Date(funnel.observationCutoff);
      const cohort = Prisma.sql`${scope} AND d."createdAt" >= ${utc(funnel.from)} AND d."createdAt" < ${utc(funnel.until)} AND d."createdAt" <= ${utc(cutoff)}`;
      const history = (await raw<Array<{ cohort: number; missing: number; lead: number; contacted: number; qualified: number; won: number; lost: number;
        leadContacted: number; contactedQualified: number; qualifiedWon: number; qualifiedLost: number }>>(Prisma.sql`
        WITH milestones AS (SELECT d.id,
          BOOL_OR(h."newStageId" = ${lead.id}) AS lead, BOOL_OR(h."newStageId" = ${contacted.id}) AS contacted,
          BOOL_OR(h."newStageId" = ${qualified.id}) AS qualified, BOOL_OR(h."newStageId" = ${won.id}) AS won, BOOL_OR(h."newStageId" = ${lost.id}) AS lost,
          COUNT(h.id) AS events, BOOL_OR(h."previousStageId" IS NULL AND h."movedAt" = d."createdAt") AS initial
          FROM "Deal" d LEFT JOIN "DealStageHistory" h ON h."dealId" = d.id AND h."tenantId" = ${tenantId}
            AND h."movedAt" >= d."createdAt" AND h."movedAt" <= ${utc(cutoff)}
          WHERE ${cohort} GROUP BY d.id)
        SELECT COUNT(*)::int AS cohort, COUNT(*) FILTER (WHERE events = 0 OR NOT COALESCE(initial,false))::int AS missing,
          COUNT(*) FILTER (WHERE lead)::int AS lead, COUNT(*) FILTER (WHERE contacted)::int AS contacted,
          COUNT(*) FILTER (WHERE qualified)::int AS qualified, COUNT(*) FILTER (WHERE won)::int AS won, COUNT(*) FILTER (WHERE lost)::int AS lost,
          COUNT(*) FILTER (WHERE lead AND contacted)::int AS "leadContacted", COUNT(*) FILTER (WHERE contacted AND qualified)::int AS "contactedQualified",
          COUNT(*) FILTER (WHERE qualified AND won)::int AS "qualifiedWon", COUNT(*) FILTER (WHERE qualified AND lost)::int AS "qualifiedLost"
        FROM milestones`))[0];
      result.conversion = { cohort: history.cohort, missingHistory: history.missing,
        period: { start: funnel.start, end: funnel.end, timezone: funnel.timezone, range: funnel.range, observationCutoff: funnel.observationCutoff },
        stages: pipeline.stages.map((stage, index) => ({ id: stage.id, name: stage.name, color: stage.color,
          reached: [history.lead, history.contacted, history.qualified, history.won, history.lost][index] })),
        leadToContacted: history.missing ? null : percent(history.leadContacted, history.lead),
        contactedToQualified: history.missing ? null : percent(history.contactedQualified, history.contacted),
        qualifiedToWon: history.missing ? null : percent(history.qualifiedWon, history.qualified),
        qualifiedToLost: history.missing ? null : percent(history.qualifiedLost, history.qualified),
      };
      if (access.leaderboard) result.leaderboard = await raw<DashboardReport['leaderboard']>(Prisma.sql`
        SELECT u.id, u."firstName", u."lastName", COUNT(*)::int AS won,
          CASE WHEN COUNT(*) FILTER (WHERE d.currency = ${currency} AND NOT COALESCE((${validMoney}),false)) > 0 THEN NULL
            ELSE COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE ${validMoney}),2),0)::float8 END AS revenue
        FROM "Deal" d JOIN "User" u ON u.id = d."revenueOwnerId" AND u."tenantId" = ${tenantId}
        WHERE ${scope} AND ${resolved} AND d."stageId" = ${won.id} AND ${credited}
        GROUP BY u.id, u."firstName", u."lastName" ORDER BY revenue DESC NULLS LAST, won DESC, u.id ASC`);
      const excluded = await tx.deal.count({ where: { ...access.dealScope, tenantId, isArchived: false, deletedAt: null, pipelineId: { not: pipeline.id } } });
      if (excluded) result.warnings.push(`${excluded} visible deals outside the authoritative Sales Pipeline are excluded from sales metrics; no records were changed.`);
      if (totals.currencyExcluded) result.warnings.push(`${totals.currencyExcluded} deals have another or unknown currency and are excluded from ${currency} monetary totals.`);
      if (totals.monetaryMissing) result.warnings.push(`${totals.monetaryMissing} deals have missing or invalid amounts; affected monetary totals are unavailable.`);
      if (totals.closingDateMissing) result.warnings.push(`${totals.closingDateMissing} closed deals have missing or invalid closing dates and are excluded from period results.`);
      if (totals.attributionMissing) result.warnings.push(`${totals.attributionMissing} period wins lack verified historical agent attribution and are excluded from the leaderboard.`);
      if (history.missing) result.warnings.push(`${history.missing} cohort deals lack a recorded starting milestone. Conversion counts show recorded events only; progression rates are unavailable and historical stages were not inferred.`);
      if (pipeline.stages.some(stage => !stage.color)) result.warnings.push('Some official stages have no configured color. Shared stage-color defaults are shown.');
      }
    }

    if (access.tasks) {
      const where = { ...access.taskScope, tenantId, isArchived: false, status: { notIn: ['completed', 'cancelled'] } };
      const selection = { orderBy: [{ dueDate: 'asc' as const }, { id: 'asc' as const }], select: { id: true, title: true, dueDate: true, priority: true } };
      const [count, overdue, high, other] = await Promise.all([
        tx.task.count({ where }),
        tx.task.findMany({ ...selection, where: { ...where, dueDate: { lt: now } } }),
        tx.task.findMany({ ...selection, where: { ...where, dueDate: { gte: now }, priority: 'High' } }),
        tx.task.findMany({ ...selection, where: { ...where, dueDate: { gte: now }, priority: { not: 'High' } } }),
      ]);
      const tasks = [...overdue, ...high, ...other];
      result.pendingActions += count;
      result.actions.push(...tasks.map(task => ({ id: task.id, kind: 'task' as const, title: task.title, priority: task.priority,
        dueDate: task.dueDate.toISOString(), overdue: task.dueDate < now, href: `/operations/taskboard?taskId=${encodeURIComponent(task.id)}` })));
    }
    if (access.leads) {
      const where = { ...leadWhere, status: 'Hot' };
      const [count, leads] = await Promise.all([tx.lead.count({ where }), tx.lead.findMany({ where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], select: { id: true, firstName: true, lastName: true } })]);
      result.pendingActions += count;
      result.actions.push(...leads.map(lead => ({ id: lead.id, kind: 'lead' as const, title: `${lead.firstName} ${lead.lastName}`,
        priority: 'High', dueDate: null, overdue: false, href: `/crm/leads/${encodeURIComponent(lead.id)}` })));
    }
    if (access.deals) {
      const stages = await tx.stage.findMany({ where: { tenantId, pipelineId: { notIn: invalidSalesPipelines },
        pipeline: { tenantId, isArchived: false }, isWon: false, isLost: false, rottenAfterDays: { gt: 0 } },
        select: { id: true, pipelineId: true, rottenAfterDays: true } });
      if (stages.length) {
        const candidates = await tx.deal.findMany({ where: { tenantId, isArchived: false, deletedAt: null,
          AND: [access.dealScope, { OR: stages.map(stage => {
            const cutoff = staleDealCutoff(stage.rottenAfterDays!, now);
            return { stageId: stage.id, pipelineId: stage.pipelineId,
              OR: [{ stageChangedAt: { lte: cutoff } }, { stageChangedAt: null, createdAt: { lte: cutoff } }] };
          }) }] }, select: { id: true, title: true, priority: true, ...dealStalenessSelect } });
        const staleness = await evaluateDealStaleness(tx, tenantId, candidates, now);
        const deals = candidates.filter(deal => staleness.get(deal.id)?.isStale);
        result.pendingActions += deals.length;
        result.actions.push(...deals.map(deal => ({ id: deal.id, kind: 'deal' as const, title: deal.title, priority: deal.priority,
          dueDate: null, overdue: false, href: `/crm/deals/${encodeURIComponent(deal.id)}` })));
      }
    }
    const priority = (value: string) => ({ high: 0, medium: 1, low: 2 }[value.toLowerCase()] ?? 3);
    const kind = (value: string) => ({ task: 0, lead: 1, deal: 2 }[value] ?? 3);
    result.actions.sort((a, b) => Number(b.overdue) - Number(a.overdue) || kind(a.kind) - kind(b.kind) || priority(a.priority) - priority(b.priority) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id.localeCompare(b.id));
    return result;
  }, { isolationLevel: 'RepeatableRead', timeout: 20000 });
  // Recheck permission after aggregation: a role changed during the snapshot
  // must not release data under a former authorization scope.
  const current = await dashboardAccess(identity);
  if (JSON.stringify(current) !== JSON.stringify(access)) {
    throw new AppError('Reporting access changed. Please retry.', 403);
  }
  report.queryMs = Math.round((performance.now() - started) * 10) / 10;
  return report;
}
