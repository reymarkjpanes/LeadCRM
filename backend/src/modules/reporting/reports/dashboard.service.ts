import { Prisma } from '@prisma/client';
import { DashboardQuerySchema, dashboardPeriod, dashboardFunnelPeriod, SALES_PIPELINE_STAGES, type DashboardQuery, type DashboardReport, type DashboardStage } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { findUserEffectivePermissions } from '../../administration/roles/roles.repository';
import { AppError } from '../../../shared/errors/app-error';
import type { AuthenticatedUser } from '../../../api/middleware/auth.middleware';

export async function dashboardAccess(identity: AuthenticatedUser) {
  const user = await prisma.user.findFirst({ where: { id: identity.userId, tenantId: identity.tenantId, status: 'ACTIVE' }, select: { role: true } });
  if (!user) throw new AppError('Authentication required', 401);
  const admin = user.role === 'Client Admin';
  const permissions = admin ? {} : await findUserEffectivePermissions(identity.userId, identity.tenantId);
  const can = (module: string) => admin || !!permissions[module]?.canView;
  if (!can('dashboard')) throw new AppError('Dashboard access denied', 403);
  return { admin, deals: can('deals'), leads: can('leads'), tasks: can('tasks') };
}

export function verifyDashboardStages(stages: DashboardStage[]) {
  const names = SALES_PIPELINE_STAGES.map(name => name.toLowerCase());
  if (stages.length !== 5 || stages.some((stage, i) => stage.name.trim().toLowerCase() !== names[i] ||
    stage.isWon !== (i === 3) || stage.isLost !== (i === 4))) {
    throw new AppError('The Sales Pipeline must contain Lead, Contacted, Qualified, Closed Won and Closed Lost in the official order. Review its configuration; historical data has not been changed.', 409, 'DASHBOARD_PIPELINE_CONFIGURATION');
  }
}

type Totals = { revenue: number; won: number; lost: number; average: number | null; active: number; forecast: number;
  openValue: number; forecastMissing: number; monetaryMissing: number; wonMissing: number; openMissing: number;
  currencyExcluded: number; closingDateMissing: number; attributionMissing: number };
const percent = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 1000) / 10 : null;

export async function getDashboard(identity: AuthenticatedUser, input: unknown, now = new Date()): Promise<DashboardReport> {
  const started = performance.now();
  const parsed = DashboardQuerySchema.safeParse(input);
  if (!parsed.success) throw new AppError('Choose a valid dashboard date range.', 400);
  const query: DashboardQuery = parsed.data;
  let period: ReturnType<typeof dashboardPeriod>;
  try { period = dashboardPeriod(query, now); } catch { throw new AppError('Choose a reporting period of at most two years.', 400); }
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
      generatedAt: now.toISOString(), queryMs: 0, currency, scope: 'organization',
      period: { start: period.start, end: period.end, timezone: period.timezone, interval },
      access: { deals: access.deals, leads: access.leads, tasks: access.tasks }, pipeline: null,
      metrics: { totalRevenue: null, forecastedRevenue: null, activeDeals: null, totalLeads: null, won: null, lost: null,
        winRate: null, averageDealDays: null, openPipelineValue: null, forecastMissing: 0, monetaryMissing: 0,
        currencyExcluded: 0, closingDateMissing: 0 },
      trend: [], distribution: [], conversion: null, leaderboard: [], actions: [], pendingActions: 0, warnings: [],
    };
    const ownerScope = access.admin ? {} : { assignedUserId: userId };
    const leadWhere = { tenantId, isArchived: false, deletedAt: null, convertedAt: null };
    if (access.leads) result.metrics.totalLeads = await tx.lead.count({ where: leadWhere });

    if (access.deals) {
      // Same authoritative lookup used by Lead -> Product Deal automation; read-only.
      const pipelines = await tx.pipeline.findMany({ where: { tenantId, isArchived: false, name: { equals: 'Sales Pipeline', mode: 'insensitive' } },
        select: { id: true, name: true, stages: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: {
          id: true, name: true, order: true, color: true, probability: true, isWon: true, isLost: true,
        } } } });
      if (pipelines.length !== 1) throw new AppError('Configure one active Sales Pipeline for dashboard reporting.', 409, 'DASHBOARD_PIPELINE_CONFIGURATION');
      const pipeline = pipelines[0];
      verifyDashboardStages(pipeline.stages);
      result.pipeline = pipeline;
      const [lead, contacted, qualified, won, lost] = pipeline.stages;
      // Prisma DateTime columns are UTC timestamp-without-time-zone. Explicit
      // UTC casts avoid implicit comparisons in the database session timezone.
      const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
      const scope = Prisma.sql`d."tenantId" = ${tenantId} AND d."pipelineId" = ${pipeline.id}
        AND NOT d."isArchived" AND d."deletedAt" IS NULL`;
      const resolved = Prisma.sql`d."closedAt" >= ${utc(period.from)} AND d."closedAt" < ${utc(period.until)}
        AND d."closedAt" >= d."createdAt" AND d."closedAt" <= ${utc(now)}`;
      const validMoney = Prisma.sql`d.currency = ${currency} AND d.value >= 0 AND d.value::text NOT IN ('NaN','Infinity','-Infinity')`;
      const raw = <T>(sql: Prisma.Sql) => tenantContext.exit(async () => await tx.$queryRaw<T>(sql));
      const totals = (await raw<Totals[]>(Prisma.sql`
        WITH eligible AS (SELECT d.*, s."isWon", s."isLost", s.probability FROM "Deal" d
          JOIN "Stage" s ON s.id = d."stageId" AND s."tenantId" = d."tenantId" WHERE ${scope})
        SELECT COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE d."isWon" AND ${resolved} AND ${validMoney}), 2),0)::float8 AS revenue,
          COUNT(*) FILTER (WHERE d."isWon" AND ${resolved})::int AS won,
          COUNT(*) FILTER (WHERE d."isLost" AND ${resolved})::int AS lost,
          AVG(EXTRACT(EPOCH FROM (d."closedAt" - d."createdAt"))/86400) FILTER (WHERE d."isWon" AND ${resolved})::float8 AS average,
          COUNT(*) FILTER (WHERE NOT d."isWon" AND NOT d."isLost")::int AS active,
          COALESCE(round(SUM(round(d.value::numeric,2) * d.probability / 100) FILTER (WHERE NOT d."isWon" AND NOT d."isLost" AND ${validMoney} AND d.probability BETWEEN 0 AND 100),2),0)::float8 AS forecast,
          COALESCE(round(SUM(round(d.value::numeric,2)) FILTER (WHERE NOT d."isWon" AND NOT d."isLost" AND ${validMoney}),2),0)::float8 AS "openValue",
          COUNT(*) FILTER (WHERE NOT d."isWon" AND NOT d."isLost" AND d.currency = ${currency} AND (d.probability IS NULL OR d.probability NOT BETWEEN 0 AND 100 OR d.value IS NULL OR NOT (${validMoney})))::int AS "forecastMissing",
          COUNT(*) FILTER (WHERE d.currency = ${currency} AND NOT COALESCE((${validMoney}), false) AND (NOT d."isLost" AND (NOT d."isWon" OR ${resolved})))::int AS "monetaryMissing",
          COUNT(*) FILTER (WHERE d."isWon" AND ${resolved} AND d.currency = ${currency} AND NOT COALESCE((${validMoney}), false))::int AS "wonMissing",
          COUNT(*) FILTER (WHERE NOT d."isWon" AND NOT d."isLost" AND d.currency = ${currency} AND NOT COALESCE((${validMoney}), false))::int AS "openMissing",
          COUNT(*) FILTER (WHERE d.currency IS DISTINCT FROM ${currency} AND (NOT d."isWon" AND NOT d."isLost" OR ${resolved}))::int AS "currencyExcluded",
          COUNT(*) FILTER (WHERE (d."isWon" OR d."isLost") AND (d."closedAt" IS NULL OR d."closedAt" < d."createdAt" OR d."closedAt" > ${utc(now)}))::int AS "closingDateMissing",
          COUNT(*) FILTER (WHERE d."isWon" AND ${resolved} AND d."revenueOwnerEligible" IS NULL)::int AS "attributionMissing"
        FROM eligible d`))[0];
      Object.assign(result.metrics, {
        totalRevenue: totals.wonMissing ? null : totals.revenue, forecastedRevenue: totals.forecastMissing ? null : totals.forecast,
        activeDeals: totals.active, won: totals.won, lost: totals.lost, winRate: percent(totals.won, totals.won + totals.lost),
        averageDealDays: totals.average === null ? null : Math.round(totals.average * 10) / 10,
        openPipelineValue: totals.openMissing ? null : totals.openValue, forecastMissing: totals.forecastMissing,
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
      result.leaderboard = await raw<DashboardReport['leaderboard']>(Prisma.sql`
        SELECT u.id, u."firstName", u."lastName", COUNT(*)::int AS won, round(SUM(round(d.value::numeric,2)),2)::float8 AS revenue
        FROM "Deal" d JOIN "User" u ON u.id = d."revenueOwnerId" AND u."tenantId" = ${tenantId}
        WHERE ${scope} AND ${resolved} AND d."stageId" = ${won.id} AND ${validMoney} AND d."revenueOwnerEligible" = true
        GROUP BY u.id, u."firstName", u."lastName" ORDER BY revenue DESC, won DESC, u.id ASC LIMIT 5`);
      const excluded = await tx.deal.count({ where: { tenantId, isArchived: false, deletedAt: null, pipelineId: { not: pipeline.id } } });
      if (excluded) result.warnings.push(`${excluded} visible deals outside the authoritative Sales Pipeline are excluded; no records were changed.`);
      if (totals.currencyExcluded) result.warnings.push(`${totals.currencyExcluded} deals have another or unknown currency and are excluded from ${currency} monetary totals.`);
      if (totals.monetaryMissing) result.warnings.push(`${totals.monetaryMissing} deals have missing or invalid amounts; affected monetary totals are unavailable.`);
      if (totals.forecastMissing) result.warnings.push(`${totals.forecastMissing} open deals have incomplete forecast data. Forecast uses current open stages, regardless of expected close date.`);
      if (totals.closingDateMissing) result.warnings.push(`${totals.closingDateMissing} closed deals have missing or invalid closing dates and are excluded from period results.`);
      if (totals.attributionMissing) result.warnings.push(`${totals.attributionMissing} period wins lack verified historical agent attribution and are excluded from the leaderboard.`);
      if (history.missing) result.warnings.push(`${history.missing} cohort deals lack a recorded starting milestone. Conversion counts show recorded events only; progression rates are unavailable and historical stages were not inferred.`);
      if (pipeline.stages.some(stage => !stage.color)) result.warnings.push('Some official stages have no configured color. Suggested defaults are shown until colors are saved in Deals.');
    }

    if (access.tasks) {
      const where = { tenantId, isArchived: false, status: { notIn: ['completed', 'cancelled'] }, ...ownerScope };
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
      const where = { ...leadWhere, ...ownerScope, status: 'Hot' };
      const [count, leads] = await Promise.all([tx.lead.count({ where }), tx.lead.findMany({ where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], select: { id: true, firstName: true, lastName: true } })]);
      result.pendingActions += count;
      result.actions.push(...leads.map(lead => ({ id: lead.id, kind: 'lead' as const, title: `${lead.firstName} ${lead.lastName}`,
        priority: 'High', dueDate: null, overdue: false, href: `/crm/leads/${encodeURIComponent(lead.id)}` })));
    }
    if (access.deals && result.pipeline) {
      const stages = await tx.stage.findMany({ where: { tenantId, pipelineId: result.pipeline.id, isWon: false, isLost: false, rottenAfterDays: { not: null } },
        select: { id: true, rottenAfterDays: true } });
      if (stages.length) {
        const where: Prisma.DealWhereInput = { tenantId, isArchived: false, deletedAt: null, ...ownerScope, OR: stages.map(stage => ({ stageId: stage.id,
          OR: [{ stageChangedAt: { lt: new Date(+now - stage.rottenAfterDays! * 86400000) } }, { stageChangedAt: null, createdAt: { lt: new Date(+now - stage.rottenAfterDays! * 86400000) } }] })) };
        const [count, deals] = await Promise.all([tx.deal.count({ where }), tx.deal.findMany({ where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, title: true, priority: true } })]);
        result.pendingActions += count;
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
  if (current.admin !== access.admin || ['deals','leads','tasks'].some(key => current[key as keyof typeof report.access] !== report.access[key as keyof typeof report.access])) {
    throw new AppError('Reporting access changed. Please retry.', 403);
  }
  report.queryMs = Math.round((performance.now() - started) * 10) / 10;
  return report;
}
