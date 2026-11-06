import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { replayCrmMigrations } from '../../../tests/replay-crm-migrations';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { DashboardQuerySchema, dashboardPeriod, dashboardFunnelPeriod, dashboardToday, dashboardCsv } from '@leadcrm/shared';

vi.mock('../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.DASHBOARD_TEST_DATABASE_URL! } } }) }));
const disposable = !!process.env.DATABASE_URL && /^postgres(?:ql)?:\/\/[^/]+@127\.0\.0\.1:\d+\/leadcrm_forms_test_2(?:\?|$)/.test(process.env.DATABASE_URL);
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, server: Server, base: string;
let dashboard: typeof import('./dashboard.service').getDashboard;
let move: typeof import('../../crm/deals/deals.repository').moveDealStage;
let adminToken: string, agentToken: string, foreignToken: string;
const now = new Date('2020-01-15T04:00:00Z');
const query = { range: 'custom', start: '2020-01-01', end: '2020-01-31' };
const admin = { userId: 'admin', tenantId: 'a', role: 'Client Admin', email: 'admin@camxian.com' };
const agent = { userId: 'agent', tenantId: 'a', role: 'Sales', email: 'agent@camxian.com' };
const scoped = <T>(work: () => T) => tenantContext.run({ tenantId: 'a' }, work);
const report = () => scoped(() => dashboard(admin, query, now));

describe('Lead Source Performance', () => {
  const tenantId = 'source-performance', pipelineId = 'source-sales';
  const identity = { userId: 'source-admin', tenantId, role: 'Client Admin', email: 'source@camxian.com' };
  const read = (extra = {}) => tenantContext.run({ tenantId }, () => dashboard(identity, { range: 'thisMonth', ...extra }, now));
  const create = (id: string, source: string | null, extra = {}) => db.deal.create({ data: {
    id: `source-${id}`, tenantId, pipelineId, stageId: 'source-won', title: id, leadSource: source,
    createdAt: new Date('2019-12-01T00:00:00Z'), closedAt: new Date('2020-01-05T00:00:00Z'), value: 100, currency: 'PHP', ...extra,
  } });
  beforeAll(async () => {
    await db.tenant.create({ data: { id: tenantId, name: 'Sources', slug: tenantId } });
    await db.user.create({ data: { id: identity.userId, tenantId, role: identity.role, email: identity.email, firstName: 'Source', lastName: 'Admin' } });
    await db.pipeline.createMany({ data: [{ id: pipelineId, tenantId, name: 'Sales Pipeline' }, { id: 'source-other', tenantId, name: 'Other' }] });
    const official = await db.stage.findMany({ where: { pipelineId: 'sales' }, orderBy: { order: 'asc' } });
    await db.stage.createMany({ data: [...official.map(stage => ({
      id: `source-${stage.id}`, tenantId, pipelineId, name: stage.name, order: stage.order, isWon: stage.isWon, isLost: stage.isLost,
    })), { id: 'source-other-won', tenantId, pipelineId: 'source-other', name: 'Won', order: 0, isWon: true }] });
    for (const [name, count] of [['Referral', 12], ['Website', 8], ['Social Media Advertisement', 5], ['Email Campaign', 3], ['Content Marketing', 2], ['Google Ads', 1], ['Direct Mail', 1], ['Others', 2]] as const) {
      for (let i = 0; i < count; i++) await create(`${name}-${i}`, i === 0 && name === 'Referral' ? ' Referral ' : name, name === 'Website' ? { currency: 'USD', value: null } : {});
    }
    for (const [index, source] of [null, '', ' \t\n '].entries()) await create(`missing-${index}`, source);
    await db.lead.createMany({ data: [0, 1].map(index => ({ id: `source-person-${index}`, tenantId, firstName: 'Linked', lastName: String(index), source: 'Wrong fallback' })) });
    await db.contact.create({ data: { id: 'source-contact', tenantId, firstName: 'Linked', lastName: 'Contact', source: 'Wrong fallback' } });
    await db.leadDeal.createMany({ data: [
      ...[0, 1].map(index => ({ tenantId, dealId: 'source-Referral-0', leadId: `source-person-${index}` })),
      { tenantId, dealId: 'source-Referral-1', leadId: 'source-person-0' },
      { tenantId, dealId: 'source-missing-0', leadId: 'source-person-0' },
    ] });
    await db.contactDeal.create({ data: { tenantId, dealId: 'source-Referral-0', contactId: 'source-contact' } });
    await create('open', 'Excluded', { stageId: 'source-qualified' });
    await create('cancelled', 'Excluded', { stageId: 'source-lost' });
    await create('archived', 'Excluded', { isArchived: true });
    await create('deleted', 'Excluded', { deletedAt: now });
    await create('other-pipeline', 'Excluded', { pipelineId: 'source-other', stageId: 'source-other-won' });
    await create('no-close-date', 'Excluded', { closedAt: null });
    await create('future-close', 'Excluded', { closedAt: new Date('2020-01-16T00:00:00Z') });
    await create('invalid-close', 'Excluded', { closedAt: new Date('2019-11-30T00:00:00Z') });
    await db.tenant.create({ data: { id: 'source-foreign', name: 'Foreign sources', slug: 'source-foreign' } });
    await db.pipeline.create({ data: { id: 'source-foreign-sales', tenantId: 'source-foreign', name: 'Sales Pipeline' } });
    await db.stage.create({ data: { id: 'source-foreign-won', tenantId: 'source-foreign', pipelineId: 'source-foreign-sales', name: 'Won', order: 0, isWon: true } });
    await create('foreign', 'Foreign source', { tenantId: 'source-foreign', pipelineId: 'source-foreign-sales', stageId: 'source-foreign-won' });
  });
  it('counts distinct valid wins, saves source precedence, and groups overflow without changing revenue', async () => {
    const result = await read();
    expect(result.leadSourcePerformance).toEqual({
      period: { start: '2020-01-01', end: '2020-01-15', timezone: 'Asia/Manila' },
      sources: [
        { name: 'Referral', won: 12 }, { name: 'Website', won: 8 }, { name: 'Others', won: 6 },
        { name: 'Social Media Advertisement', won: 5 }, { name: 'Email Campaign', won: 3 }, { name: 'Not specified', won: 3 },
      ],
    });
    expect(result.leadSourcePerformance!.sources.reduce((sum, row) => sum + row.won, 0)).toBe(result.metrics.won);
    expect(result.metrics.totalRevenue).toBe(2900);
    const different = await read({ leadSourceRange: 'lastMonth' });
    expect(different.leadSourcePerformance!.sources).toEqual([]);
    expect(different.metrics).toEqual(result.metrics);
    expect(different.distribution).toEqual(result.distribution);
    expect(different.conversion).toEqual(result.conversion);
  });
  it('uses close dates and half-open Manila boundaries, with five named groups when none are missing', async () => {
    const from = '2020-01-09T16:00:00Z', until = '2020-01-10T16:00:00Z';
    for (const [name, count] of [['Alpha', 6], ['Beta', 5], ['Gamma', 4], ['Delta', 3], ['Epsilon', 2], ['Zeta', 1]] as const) {
      for (let i = 0; i < count; i++) await create(`boundary-${name}-${i}`, name, { closedAt: new Date(from) });
    }
    await create('before-boundary', 'Excluded', { closedAt: new Date(+new Date(from) - 1) });
    await create('at-until', 'Excluded', { closedAt: new Date(until) });
    await create('last-millisecond', 'Zeta', { closedAt: new Date(+new Date(until) - 1) });
    const result = await read({ leadSourceRange: 'custom', leadSourceStart: '2020-01-10', leadSourceEnd: '2020-01-10' });
    expect(result.leadSourcePerformance!.sources).toEqual([
      { name: 'Alpha', won: 6 }, { name: 'Beta', won: 5 }, { name: 'Gamma', won: 4 }, { name: 'Delta', won: 3 },
      { name: 'Epsilon', won: 2 }, { name: 'Others', won: 2 },
    ]);
    expect(result.leadSourcePerformance!.sources.reduce((sum, row) => sum + row.won, 0)).toBe(22);
  });
  it('refreshes source edits through the existing committed Dashboard revision', async () => {
    const before = await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId } });
    const original = await read();
    try {
      await db.deal.update({ where: { id: 'source-Referral-1' }, data: { leadSource: null } });
      const after = await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId } });
      expect(after.analytics).toBeGreaterThan(before.analytics);
      const changed = await read();
      expect(changed.leadSourcePerformance!.sources.find(row => row.name === 'Referral')!.won).toBe(11);
      expect(changed.leadSourcePerformance!.sources.find(row => row.name === 'Not specified')!.won).toBe(4);
      expect(changed.metrics).toEqual(original.metrics);
    } finally { await db.deal.update({ where: { id: 'source-Referral-1' }, data: { leadSource: 'Referral' } }); }
  });
  it('preserves tenant and module authorization and rejects invalid independent dates', async () => {
    await db.roleDefinition.create({ data: { id: 'source-viewer-role', tenantId, name: 'Source viewer' } });
    await db.rolePermission.create({ data: { tenantId, roleId: 'source-viewer-role', module: 'dashboard', canView: true } });
    await db.user.create({ data: { id: 'source-viewer', tenantId, role: 'Source viewer', email: 'source-viewer@camxian.com', firstName: 'Viewer', lastName: 'Test' } });
    await db.userRole.create({ data: { tenantId, userId: 'source-viewer', roleId: 'source-viewer-role' } });
    const viewer = { ...identity, userId: 'source-viewer', role: 'Source viewer' };
    expect((await tenantContext.run({ tenantId }, () => dashboard(viewer, {}, now))).leadSourcePerformance).toBeNull();
    await expect(tenantContext.run({ tenantId: 'b' }, () => dashboard(identity, {}, now))).rejects.toThrow('Workspace mismatch');
    await expect(read({ leadSourceRange: 'custom', leadSourceStart: '2020-02-30', leadSourceEnd: '2020-03-01' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(read({ leadSourceRange: 'custom', leadSourceStart: '2010-01-01', leadSourceEnd: '2020-01-01' })).rejects.toThrow('at most two years');
  });
});
async function deal(id: string, stageId: string, value: number | null = 1000, extra = {}) {
  return db.deal.create({ data: { id, tenantId: 'a', title: id, pipelineId: 'sales', stageId, assignedUserId: 'agent', ownerId: 'agent',
    value, currency: 'PHP', createdAt: new Date('2020-01-01T00:00:00Z'), tags: [], ...extra } });
}
async function close(id: string, stageId: 'won' | 'lost', closedAt = new Date('2020-01-05T00:00:00Z')) {
  await db.deal.update({ where: { id }, data: { stageId, closedAt } });
  await db.dealStageHistory.create({ data: { tenantId: 'a', dealId: id, previousStageId: 'qualified', newStageId: stageId, movedById: 'admin', movedAt: closedAt } });
}
async function http(path: string, token = adminToken, method = 'GET', body?: unknown) {
  return fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'disposable-dashboard-test-secret';
  if (disposable) {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', '1');
    process.env.DASHBOARD_TEST_DATABASE_URL = url.toString();
  }
  else {
    pg = await PGlite.create(); await replayCrmMigrations(pg);
    socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
    process.env.DASHBOARD_TEST_DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  }
  db = (await import('../../../config/database.config')).default;
  const { installTenantScoping } = await import('../../../core/tenant/tenant-prisma'); installTenantScoping(db);
  dashboard = (await import('./dashboard.service')).getDashboard;
  move = (await import('../../crm/deals/deals.repository')).moveDealStage;
  await db.tenant.createMany({ data: [{ id: 'a', name: 'A', slug: 'a', onboardingStep: 3, onboardingCompletedAt: now }, { id: 'b', name: 'B', slug: 'b', onboardingStep: 3, onboardingCompletedAt: now }] });
  await db.user.createMany({ data: [
    { id: 'admin', tenantId: 'a', role: 'Client Admin', email: 'admin@camxian.com' },
    { id: 'agent', tenantId: 'a', role: 'Sales', email: 'agent@camxian.com' },
    { id: 'other-agent', tenantId: 'a', role: 'Sales', email: 'other@camxian.com' },
    { id: 'foreign', tenantId: 'b', role: 'Client Admin', email: 'foreign@camxian.com' },
    { id: 'denied', tenantId: 'a', role: 'Viewer', email: 'denied@camxian.com' },
  ].map(user => ({ ...user, firstName: user.id, lastName: 'Test', mustChangePassword: false, onboardingCompletedAt: now })) });
  await db.roleDefinition.create({ data: { id: 'sales-role', tenantId: 'a', name: 'Sales' } });
  await db.rolePermission.createMany({ data: ['dashboard','deals','leads','tasks'].map(module => ({ tenantId: 'a', roleId: 'sales-role', module, canView: true, canViewAll: ['deals', 'leads'].includes(module), canEdit: true, canCreate: true })) });
  await db.userRole.createMany({ data: ['agent','other-agent'].map(userId => ({ tenantId: 'a', userId, roleId: 'sales-role' })) });
  await db.pipeline.createMany({ data: [{ id: 'sales', tenantId: 'a', name: 'Sales Pipeline' }, { id: 'foreign-sales', tenantId: 'b', name: 'Sales Pipeline' }] });
  await db.stage.createMany({ data: [
    ['lead','Lead',10,'#3B82F6'], ['contacted','Contacted',40,'#F59E0B'], ['qualified','Qualified',70,'#8B5CF6'],
    ['won','Closed Deal',100,'#059669'], ['lost','Cancelled',0,'#DC2626'],
  ].flatMap(([id, name, probability, color], order) => ['a','b'].map(tenantId => ({ id: tenantId === 'a' ? String(id) : `foreign-${id}`,
    tenantId, pipelineId: tenantId === 'a' ? 'sales' : 'foreign-sales', name: String(name), probability: Number(probability), color: String(color), order,
    isWon: id === 'won', isLost: id === 'lost', requiredFields: [] }))) });
  await db.closingFieldDefinition.create({ data: { tenantId: 'a', id: 'optional', definition: { id: 'optional', name: 'Optional note', module: 'deals', group: 'Closed Won Requirements', type: 'Text', required: false, active: true, order: 0, options: [] } } });
  const { createAuthSessionToken } = await import('../../../core/auth/auth-session');
  for (const id of ['admin','agent','foreign']) {
    const token = await createAuthSessionToken(await db.user.findUniqueOrThrow({ where: { id } }));
    if (id === 'admin') adminToken = token; if (id === 'agent') agentToken = token; if (id === 'foreign') foreignToken = token;
  }
  const app = (await import('../../../app')).default;
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
}, 90000);
afterAll(async () => {
  server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await db?.$disconnect(); await socket?.stop(); await pg?.close();
});

describe('Qualified-only forecast', () => {
  const tenantId = 'forecast-fixture', pipelineId = 'forecast-sales';
  const identity = { ...admin, userId: 'forecast-admin', tenantId };
  const stageIds = Array.from({ length: 5 }, () => randomUUID());
  const read = (extra = {}) => tenantContext.run({ tenantId }, () => dashboard(identity, { ...query, ...extra }, now));
  const create = (id: string, index: number, value: number | null, extra = {}) => db.deal.create({ data: {
    id: `forecast-${id}`, tenantId, pipelineId, stageId: stageIds[index], title: id, value, currency: 'PHP',
    assignedUserId: identity.userId, createdAt: new Date('2020-01-01T00:00:00Z'),
    ...(index >= 3 ? { closedAt: new Date('2020-01-05T00:00:00Z') } : {}), ...extra,
  } });
  beforeAll(async () => {
    await db.tenant.create({ data: { id: tenantId, name: 'Forecast fixture', slug: tenantId } });
    await db.user.create({ data: { id: identity.userId, tenantId, role: 'Client Admin', email: 'forecast@camxian.com', firstName: 'Forecast', lastName: 'Admin' } });
    await db.pipeline.create({ data: { id: pipelineId, tenantId, name: 'Sales Pipeline' } });
    await db.stage.createMany({ data: ['Lead', 'Contacted', 'Qualified', 'Closed Deal', 'Cancelled'].map((name, index) => ({
      id: stageIds[index], tenantId, pipelineId, name, order: index + 1, isWon: index === 3, isLost: index === 4, requiredFields: [],
    })) });
    for (const [id, index, value] of [['lead', 0, 200000], ['contacted', 1, 12995], ['q1', 2, 20000], ['q2', 2, 12000], ['q3', 2, 5000], ['won', 3, 12000], ['lost', 4, 90000]] as const) await create(id, index, value);
    await create('archived', 2, 900000, { isArchived: true });
    await create('deleted', 2, 900000, { deletedAt: now });
    await db.pipeline.create({ data: { id: 'forecast-other', tenantId, name: 'Other' } });
    await db.stage.create({ data: { id: 'forecast-other-q', tenantId, pipelineId: 'forecast-other', name: 'Qualified', order: 1 } });
    await create('outside', 2, 900000, { pipelineId: 'forecast-other', stageId: 'forecast-other-q' });
    await create('foreign', 2, 900000, { tenantId: 'b', pipelineId: 'foreign-sales', stageId: 'foreign-qualified', assignedUserId: 'foreign' });
    await db.roleDefinition.create({ data: { id: 'forecast-viewer-role', tenantId, name: 'Forecast viewer' } });
    await db.rolePermission.create({ data: { tenantId, roleId: 'forecast-viewer-role', module: 'dashboard', canView: true } });
    await db.user.create({ data: { id: 'forecast-viewer', tenantId, role: 'Forecast viewer', email: 'forecast-viewer@camxian.com', firstName: 'Viewer', lastName: 'Test' } });
    await db.userRole.create({ data: { tenantId, userId: 'forecast-viewer', roleId: 'forecast-viewer-role' } });
  });
  it('returns 37000 from configured stage IDs while preserving all-open values, counts, revenue and history', async () => {
    const history = await db.dealStageHistory.count({ where: { tenantId } });
    const result = await read();
    expect(result.metrics).toMatchObject({ forecastedRevenue: 37000, forecastMissing: 0, openPipelineValue: 249995,
      activeDeals: 5, totalRevenue: 12000, currentWon: 1, totalDeals: 7, winRate: 14.3 });
    expect(result.metrics.forecastedRevenue).toBe(result.distribution.find(row => row.id === stageIds[2])!.value);
    expect(dashboardCsv(result)).toContain('"Forecasted Revenue","37000","Current Qualified deals / PHP"');
    expect((await read({ range: 'today' })).metrics.forecastedRevenue).toBe(37000);
    expect(await db.dealStageHistory.count({ where: { tenantId } })).toBe(history);
    expect((await db.deal.findUniqueOrThrow({ where: { id: 'forecast-lead' } })).value).toBe(200000);
    const denied = await tenantContext.run({ tenantId }, () => dashboard({ ...identity, userId: 'forecast-viewer', role: 'Forecast viewer' }, query, now));
    expect(denied.metrics.forecastedRevenue).toBeNull();
    expect(denied.access.deals).toBe(false);
  });
  it('does not make Forecast unavailable when Lead or Contacted amounts are invalid', async () => {
    try {
      await db.deal.update({ where: { id: 'forecast-lead' }, data: { value: null } });
      await db.deal.update({ where: { id: 'forecast-contacted' }, data: { value: -5 } });
      expect((await read()).metrics).toMatchObject({ forecastedRevenue: 37000, forecastMissing: 0, openPipelineValue: null });
    } finally {
      await db.deal.update({ where: { id: 'forecast-lead' }, data: { value: 200000 } });
      await db.deal.update({ where: { id: 'forecast-contacted' }, data: { value: 12995 } });
    }
  });
  it.each([null, -5, NaN, Infinity])('preserves unavailable Forecast for invalid Qualified money %s', async value => {
    try {
      if (value === null) await db.deal.update({ where: { id: 'forecast-q1' }, data: { value: null } });
      else await db.$executeRaw`UPDATE "Deal" SET value = ${String(value)}::float8 WHERE id = 'forecast-q1'`;
      expect((await read()).metrics).toMatchObject({ forecastedRevenue: null, forecastMissing: 1 });
    } finally { await db.deal.update({ where: { id: 'forecast-q1' }, data: { value: 20000 } }); }
  });
  it('accepts zero and excludes other currencies and an empty Qualified stage', async () => {
    const ids = ['forecast-q1', 'forecast-q2', 'forecast-q3'];
    try {
      await db.deal.update({ where: { id: ids[0] }, data: { value: 0 } });
      expect((await read()).metrics).toMatchObject({ forecastedRevenue: 17000, forecastMissing: 0 });
      await db.deal.update({ where: { id: ids[0] }, data: { value: 999999, currency: 'USD' } });
      expect((await read()).metrics).toMatchObject({ forecastedRevenue: 17000, forecastMissing: 0, currencyExcluded: 1 });
      await db.deal.updateMany({ where: { id: { in: ids } }, data: { isArchived: true } });
      expect((await read()).metrics).toMatchObject({ forecastedRevenue: 0, forecastMissing: 0, activeDeals: 2 });
    } finally {
      await db.deal.updateMany({ where: { id: { in: ids } }, data: { isArchived: false } });
      await db.deal.update({ where: { id: ids[0] }, data: { value: 20000, currency: 'PHP' } });
    }
  });
  it('recomputes after manual and real Workflow movements using committed analytics revisions', async () => {
    const id = 'forecast-lead';
    const scopedMove = (stageId: string) => tenantContext.run({ tenantId }, () => move(id, tenantId, stageId, identity.userId));
    const { dispatchAction } = await import('../../automation/actions/action-dispatcher');
    const action = async (stageId: string) => {
      const result = await tenantContext.run({ tenantId }, () => dispatchAction(
        { type: 'move_deal_stage', config: { stageId } }, { 'deal.id': id }, tenantId, identity.userId));
      expect(result.error).toBeUndefined();
      return result;
    };
    const before = (await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId } })).analytics;
    try {
      await scopedMove(stageIds[2]);
      expect((await read()).metrics.forecastedRevenue).toBe(237000);
      await scopedMove(stageIds[1]);
      expect((await read()).metrics.forecastedRevenue).toBe(37000);
      expect(await action(stageIds[2])).toMatchObject({ success: true, output: { movedDealIds: [id] } });
      expect((await read()).metrics.forecastedRevenue).toBe(237000);
      expect(await action(stageIds[0])).toMatchObject({ success: true, output: { movedDealIds: [id] } });
      expect((await read()).metrics.forecastedRevenue).toBe(37000);
      expect((await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId } })).analytics).toBeGreaterThan(before);
      expect((await db.deal.findUniqueOrThrow({ where: { id } })).value).toBe(200000);
      expect(await db.dealStageHistory.count({ where: { tenantId, dealId: id, newStageId: stageIds[2] } })).toBe(2);
    } finally { await scopedMove(stageIds[0]); }
  });
});

describe('authoritative dashboard', () => {
  it('returns five zero cards for a new empty workspace before any pipeline has been configured', async () => {
    const tenantId = 'unconfigured-empty';
    await db.tenant.create({ data: { id: tenantId, name: 'New empty workspace', slug: tenantId } });
    await db.user.create({ data: { id: 'empty-admin', tenantId, role: 'Client Admin', firstName: 'Empty', lastName: 'Admin', email: 'empty@camxian.com' } });
    const result = await tenantContext.run({ tenantId }, () => dashboard({ ...admin, userId: 'empty-admin', tenantId }, query, now));
    expect(result.metrics).toMatchObject({ totalRevenue: 0, forecastedRevenue: 0, activeDeals: 0, totalLeads: 0, winRate: 0 });
    expect(result.pipeline).toBeNull(); expect(result.trend).toEqual([]); expect(result.distribution).toEqual([]); expect(result.leaderboard).toEqual([]);
    expect(await db.pipeline.count({ where: { tenantId } })).toBe(0);
  });
  it('restricts leaderboard data to the approved Groups or Client Admin, including HTTP and revocation', async () => {
    const group = await db.tenantGroup.create({ data: { tenantId: 'a', name: 'Top Management' } });
    try {
      const denied = await scoped(() => dashboard(agent, query, now));
      expect(denied.access.leaderboard).toBe(false); expect(denied.leaderboard).toEqual([]);
      expect((await report()).access.leaderboard).toBe(true);
      await db.tenantGroupMember.create({ data: { tenantId: 'a', userId: agent.userId, groupId: group.id } });
      expect((await scoped(() => dashboard(agent, query, now))).access.leaderboard).toBe(true);
      await db.tenantGroup.update({ where: { id: group.id }, data: { name: 'Head of Sales' } });
      const response = await http('/reporting/dashboard', agentToken);
      expect(response.status).toBe(200); expect((await response.json()).data.access.leaderboard).toBe(true);
      await db.tenantGroupMember.deleteMany({ where: { groupId: group.id } });
      const revoked = await (await http('/reporting/dashboard', agentToken)).json();
      expect(revoked.data.access.leaderboard).toBe(false); expect(revoked.data.leaderboard).toEqual([]);
    } finally { await db.tenantGroupMember.deleteMany({ where: { groupId: group.id } }); await db.tenantGroup.delete({ where: { id: group.id } }); }
  });
  it('uses the same assigned dataset for Sales cards, charts, actions and CSV', async () => {
    await db.rolePermission.updateMany({ where: { tenantId: 'a', roleId: 'sales-role', module: { in: ['leads', 'deals'] } }, data: { canViewAll: false, canViewMy: true } });
    try {
      await deal('scoped-own', 'qualified', 1250, { assignedUserId: 'agent' });
      await deal('scoped-other', 'qualified', 987654, { assignedUserId: 'other-agent' });
      await db.lead.createMany({ data: ['agent','other-agent'].map((assignedUserId, index) => ({ id: `scope-person-${index}`, tenantId: 'a', firstName: 'Scope', lastName: String(index), status: 'Hot', assignedUserId })) });
      const staff = await scoped(() => dashboard(agent, query, now));
      expect(staff.metrics).toMatchObject({ activeDeals: 1, forecastedRevenue: 1250, totalLeads: 1 });
      expect(staff.distribution.reduce((sum, row) => sum + row.count, 0)).toBe(1);
      expect(staff.actions.some(row => row.id === 'scope-person-1')).toBe(false);
      expect(dashboardCsv(staff)).not.toContain('987654');
    } finally {
      await db.deal.deleteMany({ where: { id: { in: ['scoped-own','scoped-other'] } } });
      await db.lead.deleteMany({ where: { id: { in: ['scope-person-0','scope-person-1'] } } });
      await db.rolePermission.updateMany({ where: { tenantId: 'a', roleId: 'sales-role', module: { in: ['leads', 'deals'] } }, data: { canViewAll: true, canViewMy: false } });
    }
  });
  it('uses Manila boundaries, calendar validation and bounded custom ranges', () => {
    expect(dashboardPeriod({ range: 'today' }, new Date('2020-01-01T16:30:00Z')).from.toISOString()).toBe('2020-01-01T16:00:00.000Z');
    expect(dashboardPeriod({ range: 'lastMonth' }, new Date('2020-03-01T00:00:00Z'))).toMatchObject({ start: '2020-02-01', end: '2020-02-29' });
    expect(DashboardQuerySchema.safeParse({ range: 'custom', start: '2020-02-30', end: '2020-03-01' }).success).toBe(false);
    expect(() => dashboardPeriod({ range: 'custom', start: '2010-01-01', end: '2020-01-01' })).toThrow();
    expect(dashboardFunnelPeriod({ range: 'today', funnelRange: 'week' }, now)).toMatchObject({ start: '2020-01-13', end: '2020-01-15' });
    expect(dashboardFunnelPeriod({ range: 'today', funnelRange: 'year' }, now)).toMatchObject({ start: '2020-01-01', end: '2020-01-15' });
    expect(dashboardFunnelPeriod({ range: 'today' }, new Date('2020-01-31T16:30:00Z'))).toMatchObject({ start: '2020-02-01', end: '2020-02-01' });
    expect(() => dashboardFunnelPeriod({ range: 'today', funnelRange: 'custom', funnelStart: '2020-01-01', funnelEnd: '2020-01-16' }, now)).toThrow('historical');
  });
  it('renders an actually empty workspace without fabricated rates or velocity', async () => {
    const result = await report();
    expect(result.metrics).toMatchObject({ totalRevenue: 0, activeDeals: 0, totalLeads: 0, forecastedRevenue: 0, winRate: 0, currentWon: 0, totalDeals: 0, averageDealDays: null });
    expect(result.distribution.map(row => row.count)).toEqual([0,0,0]); expect(result.pendingActions).toBe(0);
  });
  it('matches the Deals pipeline snapshot across historical filters, exclusions and committed stage moves', async () => {
    const tenantId = 'funnel-counts', pipelineId = 'funnel-sales', userId = 'funnel-admin';
    await db.tenant.create({ data: { id: tenantId, name: 'Funnel counts', slug: tenantId, onboardingStep: 3, onboardingCompletedAt: now } });
    const user = await db.user.create({ data: { id: userId, tenantId, role: 'Client Admin', email: 'funnel@camxian.com',
      firstName: 'Funnel', lastName: 'Admin', mustChangePassword: false, onboardingCompletedAt: now } });
    await db.pipeline.createMany({ data: [{ id: pipelineId, tenantId, name: 'Sales Pipeline' }, { id: 'funnel-other', tenantId, name: 'Other Pipeline' }] });
    const official = await db.stage.findMany({ where: { pipelineId: 'sales' }, orderBy: { order: 'asc' } });
    const stages = official.map(stage => ({ id: `funnel-${stage.id}`, tenantId, pipelineId, name: stage.name,
      order: stage.order, isWon: stage.isWon, isLost: stage.isLost, color: stage.color, requiredFields: [] }));
    await db.stage.createMany({ data: [...stages, { ...stages[0], id: 'funnel-other-lead', pipelineId: 'funnel-other' }] });
    await db.closingFieldDefinition.create({ data: { id: 'funnel-optional', tenantId, definition: { id: 'funnel-optional', name: 'Optional note',
      module: 'deals', group: 'Closed Won Requirements', type: 'Text', required: false, active: true, order: 0, options: [] } } });
    for (const [index, stage] of stages.entries()) {
      for (let i = 0; i < [17, 1, 2, 1, 3][index]; i++) await db.deal.create({ data: {
        id: `${stage.id}-${i}`, tenantId, pipelineId, stageId: stage.id, title: `${stage.name} ${i}`, assignedUserId: userId, ownerId: userId,
        value: index === 0 && i === 1 ? null : 100, currency: index === 0 && i === 0 ? 'USD' : 'PHP',
        createdAt: new Date('2020-01-01T00:00:00Z'), ...(index >= 3 ? { closedAt: new Date('2020-01-05T00:00:00Z') } : {}),
      } });
      for (const exclusion of ['archived', 'deleted']) await db.deal.create({ data: {
        id: `${stage.id}-${exclusion}`, tenantId, pipelineId, stageId: stage.id, title: exclusion, ownerId: userId,
        ...(exclusion === 'archived' ? { isArchived: true } : { deletedAt: now }),
      } });
    }
    await db.deal.create({ data: { id: 'funnel-outside', tenantId, pipelineId: 'funnel-other', stageId: 'funnel-other-lead', title: 'Outside' } });
    await db.deal.create({ data: { id: 'funnel-foreign', tenantId: 'b', pipelineId: 'foreign-sales', stageId: 'foreign-lead', title: 'Foreign' } });
    const { createAuthSessionToken } = await import('../../../core/auth/auth-session');
    const token = await createAuthSessionToken(user);
    const identity = { userId, tenantId, role: user.role, email: user.email };
    const read = (funnelRange: 'week' | 'month' | 'year' | 'custom' = 'month') => tenantContext.run({ tenantId }, () => dashboard(identity, {
      range: 'custom', start: '2020-01-12', end: '2020-01-13', funnelRange,
      ...(funnelRange === 'custom' ? { funnelStart: '2020-01-01', funnelEnd: '2020-01-02' } : {}),
    }, now));
    const compare = async (expected: number[]) => {
      const response = await http(`/crm/deals?pipelineId=${pipelineId}&limit=100`, token);
      expect(response.status).toBe(200);
      const rows = (await response.json()).data as Array<{ id: string; stageId: string }>;
      expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
      const counts = stages.map(stage => rows.filter(row => row.stageId === stage.id).length);
      expect(counts).toEqual(expected);
      const grouped = await http(`/crm/deals?pipelineId=${pipelineId}&groupByStage=true`, token);
      expect(grouped.status).toBe(200);
      const groups = (await grouped.json()).data.stages as Array<{ stageId: string; total: number }>;
      expect(stages.map(stage => groups.find(group => group.stageId === stage.id)!.total)).toEqual(counts);
      const result = await read();
      expect(result.pipeline!.id).toBe(pipelineId);
      expect(stages.slice(0, 3).map(stage => result.distribution.find(row => row.id === stage.id)!.count)).toEqual(counts.slice(0, 3));
      expect(result.metrics.currentWon).toBe(counts[3]);
      expect(result.metrics.totalDeals).toBe(rows.length);
      expect(result.metrics.activeDeals).toBe(counts.slice(0, 3).reduce((sum, count) => sum + count, 0));
      expect(result.metrics.won).toBe(0);
      return result;
    };
    const initial = await compare([17, 1, 2, 1, 3]);
    for (const range of ['week', 'month', 'year', 'custom'] as const) {
      const filtered = await read(range);
      expect(filtered.distribution).toEqual(initial.distribution);
      expect(filtered.metrics.currentWon).toBe(1);
    }
    await tenantContext.run({ tenantId }, () => move('funnel-lead-0', tenantId, stages[1].id, userId));
    await compare([16, 2, 2, 1, 3]);
    await tenantContext.run({ tenantId }, () => move('funnel-qualified-0', tenantId, stages[3].id, userId));
    await compare([16, 2, 1, 2, 3]);
    expect((await db.deal.findUniqueOrThrow({ where: { id: 'funnel-outside' } })).stageId).toBe('funnel-other-lead');
  }, 60000);
  it('reconciles revenue, outcomes, open counts, values, forecast and creation-to-close duration', async () => {
    await deal('open-lead', 'lead', 1000); await deal('open-contacted', 'contacted', 2000); await deal('open-qualified', 'qualified', 3000);
    await deal('winner', 'qualified', 45000); await close('winner', 'won');
    await deal('loser', 'qualified', 90000); await close('loser', 'lost');
    await db.lead.createMany({ data: [
      { id: 'active-lead', tenantId: 'a', firstName: 'Active', lastName: 'Lead', assignedUserId: 'agent', status: 'Hot' },
      { id: 'archived-lead', tenantId: 'a', firstName: 'Archived', lastName: 'Lead', isArchived: true },
      { id: 'converted-lead', tenantId: 'a', firstName: 'Converted', lastName: 'Lead', convertedAt: now },
    ] });
    const result = await report();
    expect(result.metrics).toMatchObject({ totalRevenue: 45000, won: 1, lost: 1, winRate: 20, currentWon: 1, totalDeals: 5, activeDeals: 3, forecastedRevenue: 3000, openPipelineValue: 6000, totalLeads: 1, averageDealDays: 4 });
    expect(result.trend.reduce((sum, row) => sum + row.revenue, 0)).toBe(result.metrics.totalRevenue);
    expect(result.trend.reduce((sum, row) => sum + row.won, 0)).toBe(1);
    expect(result.trend.reduce((sum, row) => sum + row.lost, 0)).toBe(1);
    expect(result.distribution.reduce((sum, row) => sum + row.count, 0)).toBe(result.metrics.activeDeals);
    expect(result.distribution.reduce((sum, row) => sum + (row.value ?? 0), 0)).toBe(result.metrics.openPipelineValue);
    expect(result.leaderboard[0]).toMatchObject({ id: 'agent', won: 1, revenue: 45000 });
  });
  it('reconciles multiple agents for admins and authorized custom roles while keeping action details scoped', async () => {
    const before = await report();
    await deal('second-agent-open', 'contacted', 2000, { assignedUserId: 'other-agent', ownerId: 'other-agent' });
    await deal('second-agent-win', 'qualified', 21000, { assignedUserId: 'other-agent', ownerId: 'other-agent' });
    await close('second-agent-win', 'won');
    await db.lead.create({ data: { id: 'second-agent-lead', tenantId: 'a', firstName: 'Private', lastName: 'Other action', status: 'Hot', assignedUserId: 'other-agent' } });
    const [organization, staff] = await Promise.all([report(), scoped(() => dashboard(agent, query, now))]);
    expect(staff.scope).toBe('authorized'); expect(staff.metrics).toEqual(organization.metrics);
    expect(staff.distribution).toEqual(organization.distribution); expect(staff.trend).toEqual(organization.trend);
    expect(staff.conversion).toEqual(organization.conversion); expect(staff.leaderboard).toEqual([]); expect(staff.access.leaderboard).toBe(false);
    expect(staff.leadSourcePerformance).toEqual(organization.leadSourcePerformance);
    expect(organization.metrics).toMatchObject({ totalRevenue: before.metrics.totalRevenue! + 21000, activeDeals: before.metrics.activeDeals! + 1,
      totalLeads: before.metrics.totalLeads! + 1, forecastedRevenue: before.metrics.forecastedRevenue, openPipelineValue: before.metrics.openPipelineValue! + 2000 });
    expect(organization.metrics).toMatchObject({ won: 2, lost: 1, currentWon: 2, totalDeals: 7, winRate: 28.6, averageDealDays: 4 });
    expect(organization.leaderboard.map(row => row.revenue).sort((a, b) => a! - b!)).toEqual([21000, 45000]);
    expect(organization.leaderboard.map(row => row.id).sort()).toEqual(['agent', 'other-agent']);
    expect(organization.actions.some(row => row.id === 'second-agent-lead')).toBe(true);
    expect(staff.actions.some(row => row.id === 'second-agent-lead')).toBe(true);
    await db.deal.updateMany({ where: { id: { in: ['second-agent-open','second-agent-win'] } }, data: { isArchived: true } });
    await db.lead.update({ where: { id: 'second-agent-lead' }, data: { isArchived: true } });
  });
  it('regroups the same global period by actual calendar weeks, months and years', async () => {
    const reports = [];
    for (const revenueInterval of ['week','month','year']) reports.push(await scoped(() => dashboard(admin, { ...query, revenueInterval }, now)));
    expect(reports.map(row => row.trend.length)).toEqual([5,1,1]);
    expect(reports[0].trend[0]).toMatchObject({ name: '2019-12-30', revenue: 45000, won: 1, lost: 1 });
    for (const row of reports) {
      expect(row.metrics).toEqual(reports[0].metrics);
      expect(row.trend.reduce((sum, bucket) => sum + bucket.revenue, 0)).toBe(row.metrics.totalRevenue);
      expect(row.period).toMatchObject({ start: query.start, end: query.end });
    }
  });
  it('keeps funnel cohorts independent and excludes milestones after a custom observation cutoff', async () => {
    await deal('historical-cutoff', 'lead', 100, { createdAt: new Date('2020-01-10T00:00:00Z') });
    await db.dealStageHistory.create({ data: { tenantId: 'a', dealId: 'historical-cutoff', previousStageId: 'lead', newStageId: 'contacted', movedById: 'admin', movedAt: new Date('2020-01-11T00:00:00Z') } });
    const historical = await scoped(() => dashboard(admin, { range: 'today', funnelRange: 'custom', funnelStart: '2020-01-10', funnelEnd: '2020-01-10' }, now));
    expect(historical.conversion!.stages.map(row => row.reached)).toEqual([1,0,0,0,0]);
    expect(historical.conversion!.period.observationCutoff).toBe('2020-01-10T15:59:59.999Z');
    const later = await scoped(() => dashboard(admin, { range: 'today', funnelRange: 'custom', funnelStart: '2020-01-10', funnelEnd: '2020-01-11' }, now));
    expect(later.conversion!.stages.map(row => row.reached)).toEqual([1,1,0,0,0]);
    expect(later.metrics).toEqual(historical.metrics);
    await db.deal.update({ where: { id: 'historical-cutoff' }, data: { isArchived: true } });
  });
  it('handles stage movements, skips, backwards moves, lost reopening, repeated closure and actual future history', async () => {
    await deal('journey', 'lead', 500, { createdAt: new Date() });
    for (const stageId of ['contacted','qualified','lead','qualified','lost','qualified']) {
      await scoped(() => move('journey', 'a', stageId, 'admin', undefined, undefined, stageId === 'lost' ? 'Deferred' : undefined));
    }
    await scoped(() => move('journey', 'a', 'won', 'admin'));
    await scoped(() => move('journey', 'a', 'won', 'admin'));
    await expect(scoped(() => move('journey', 'a', 'qualified', 'admin'))).rejects.toThrow('won');
    expect(await db.dealStageHistory.count({ where: { dealId: 'journey', newStageId: 'won' } })).toBe(1);
    const result = await scoped(() => dashboard(admin, query));
    expect(result.conversion!.stages.map(row => row.reached)).toEqual([1,1,1,1,1]);
    expect(result.conversion!.qualifiedToWon).toBe(100);
    expect(result.conversion!.qualifiedToLost).toBe(100);
    // Lifetime milestones retain the earlier Lost event even after reopening;
    // period outcome metrics use the one current authoritative terminal result.
    expect(result.metrics.activeDeals).toBe(3);
  });
  it('handles Manila month edges without losing the first or last bucket', async () => {
    await deal('boundary', 'qualified', 250, { createdAt: new Date('2019-12-01T00:00:00Z') });
    await close('boundary', 'won', new Date('2019-12-31T16:00:00Z'));
    expect((await db.deal.findUniqueOrThrow({ where: { id: 'boundary' } })).closedAt?.toISOString()).toBe('2019-12-31T16:00:00.000Z');
    const result = await report();
    expect(result.trend[0]).toMatchObject({ name: '2020-01-01', revenue: 45250 });
    expect(result.trend.reduce((sum, row) => sum + row.revenue, 0)).toBe(result.metrics.totalRevenue);
  });
  it('ignores probabilities and expected close dates while preserving unavailable monetary totals', async () => {
    await db.stage.update({ where: { id: 'lead' }, data: { probability: null } });
    await db.deal.update({ where: { id: 'open-lead' }, data: { expectedCloseDate: new Date('2030-01-01') } });
    const unweighted = await report();
    expect(unweighted.metrics.forecastedRevenue).toBe(3000);
    expect(unweighted.metrics.openPipelineValue).toBe(6000);
    await db.stage.update({ where: { id: 'lead' }, data: { probability: 10 } });
    await deal('missing-value', 'lead', null);
    expect((await report()).metrics).toMatchObject({ forecastedRevenue: 3000, forecastMissing: 0, openPipelineValue: null, totalRevenue: 45250 });
    await db.deal.update({ where: { id: 'missing-value' }, data: { isArchived: true } });
  });
  it('keeps current pipeline KPIs independent of period outcomes and excludes archive, deletion and other pipelines', async () => {
    const before = await report();
    await db.pipeline.create({ data: { id: 'other-pipeline', tenantId: 'a', name: 'Other Pipeline' } });
    await db.stage.create({ data: { id: 'other-stage', tenantId: 'a', pipelineId: 'other-pipeline', name: 'Lead', order: 0 } });
    const ids = ['accuracy-archived','accuracy-deleted','accuracy-outside'];
    try {
      await deal(ids[0], 'qualified', 900000, { isArchived: true });
      await deal(ids[1], 'lead', 900000, { deletedAt: now });
      await deal(ids[2], 'other-stage', 900000, { pipelineId: 'other-pipeline' });
      const emptyPeriod = await scoped(() => dashboard(admin, { range: 'custom', start: '2020-01-12', end: '2020-01-13' }, now));
      expect(emptyPeriod.metrics).toMatchObject({ won: 0, lost: 0, totalRevenue: 0, currentWon: before.metrics.currentWon,
        totalDeals: before.metrics.totalDeals, winRate: before.metrics.winRate, activeDeals: before.metrics.activeDeals,
        forecastedRevenue: before.metrics.forecastedRevenue });
      expect(emptyPeriod.leaderboard).toEqual([]);
      expect(emptyPeriod.trend.every(row => row.revenue === 0 && row.won === 0 && row.lost === 0)).toBe(true);
      expect(emptyPeriod.distribution.reduce((sum,row) => sum + row.percentage,0)).toBeCloseTo(100,0);
      expect(emptyPeriod.warnings.join(' ')).toContain('outside the authoritative Sales Pipeline');
    } finally { await db.deal.updateMany({ where: { id: { in: ids } }, data: { isArchived: true } }); }
  });
  it('groups all verified agents, preserves deactivated ownership, sorts ties and separates uncredited wins', async () => {
    const before = await report();
    const ids = ['credit-repeat','credit-admin','credit-unknown',...Array.from({ length: 6 }, (_,i) => `credit-extra-${i}`)];
    try {
      await deal(ids[0], 'qualified', 500); await close(ids[0], 'won');
      await deal(ids[1], 'qualified', 900, { assignedUserId: 'admin' }); await close(ids[1], 'won');
      await deal(ids[2], 'won', 700, { closedAt: new Date('2020-01-05') });
      // Even a sales user's stage-change actor is not evidence of assigned ownership.
      await db.dealStageHistory.create({ data: { tenantId: 'a', dealId: ids[2], newStageId: 'won', movedById: 'agent', movedAt: new Date('2020-01-05') } });
      for (let i = 0; i < 6; i++) {
        const userId = `credit-user-${i}`;
        await db.user.create({ data: { id: userId, tenantId: 'a', firstName: 'Credited', lastName: String(i), email: `${userId}@camxian.com`, role: 'Sales' } });
        await db.userRole.create({ data: { tenantId: 'a', userId, roleId: 'sales-role' } });
        await deal(ids[i + 3], 'qualified', 100, { assignedUserId: userId }); await close(ids[i + 3], 'won');
      }
      await db.deal.update({ where: { id: ids[3] }, data: { assignedUserId: 'other-agent' } });
      await db.user.update({ where: { id: 'credit-user-0' }, data: { status: 'INACTIVE' } });
      await db.deal.update({ where: { id: ids[0] }, data: { assignedUserId: 'other-agent' } });
      const result = await report();
      expect(result.leaderboard).toHaveLength(7);
      expect(result.leaderboard[0]).toMatchObject({ id: 'agent', won: before.leaderboard[0].won + 1, revenue: before.leaderboard[0].revenue! + 500 });
      expect(result.leaderboard.slice(1).map(row => row.id)).toEqual(Array.from({ length: 6 }, (_,i) => `credit-user-${i}`));
      expect(result.metrics).toMatchObject({ unattributedWon: 2, unattributedRevenue: 1600 });
      expect(result.warnings.join(' ')).toContain('2 period wins lack verified historical agent attribution');
      expect(result.leaderboard.some(row => row.id === 'admin')).toBe(false);
    } finally {
      await db.user.update({ where: { id: 'credit-user-0' }, data: { status: 'ACTIVE' } });
      await db.deal.updateMany({ where: { id: { in: ids } }, data: { isArchived: true } });
    }
  });
  it('keeps valid zero amounts and credited won counts when an amount is invalid', async () => {
    const before = await report();
    const ids = ['amount-zero','amount-invalid-open','amount-invalid-won','amount-currency-open'];
    try {
      await deal(ids[0], 'lead', 0);
      await deal(ids[1], 'qualified', -5);
      await deal(ids[2], 'qualified', null); await close(ids[2], 'won');
      await deal(ids[3], 'contacted', 999999, { currency: 'USD' });
      const result = await report();
      expect(result.metrics).toMatchObject({ totalRevenue: null, openPipelineValue: null, forecastedRevenue: null, forecastMissing: 1, monetaryMissing: 2, currencyExcluded: 1,
        activeDeals: before.metrics.activeDeals! + 3 });
      expect(result.distribution.find(row => row.name === 'Lead')!.value).toBe(before.distribution[0].value);
      expect(result.distribution.find(row => row.name === 'Qualified')!.value).toBeNull();
      expect(result.leaderboard.find(row => row.id === 'agent')).toMatchObject({ won: before.leaderboard[0].won + 1, revenue: null });
      expect(result.warnings.join(' ')).toContain('affected monetary totals are unavailable');
    } finally { await db.deal.updateMany({ where: { id: { in: ids } }, data: { isArchived: true } }); }
  });
  it('uses identical half-open Manila boundaries for period revenue, wins, losses and attribution', async () => {
    const ids = ['edge-before','edge-first','edge-last','edge-after'];
    try {
      for (const [index, date] of ['2020-01-09T15:59:59.999Z','2020-01-09T16:00:00.000Z','2020-01-10T15:59:59.999Z','2020-01-10T16:00:00.000Z'].entries()) {
        await deal(ids[index], 'qualified', 100); await close(ids[index], index === 2 ? 'lost' : 'won', new Date(date));
      }
      const result = await scoped(() => dashboard(admin, { range: 'custom', start: '2020-01-10', end: '2020-01-10', revenueInterval: 'week' }, now));
      expect(result.metrics).toMatchObject({ totalRevenue: 100, won: 1, lost: 1 });
      expect(result.trend).toEqual([{ name: '2020-01-06', revenue: 100, won: 1, lost: 1 }]);
      expect(result.leaderboard).toMatchObject([{ id: 'agent', won: 1, revenue: 100 }]);
      // The HTTP contract preserves calendar strings and uses the same boundaries.
      const response = await http('/reporting/dashboard?range=custom&start=2020-01-10&end=2020-01-10&revenueInterval=week');
      expect(response.status).toBe(200);
      const api = (await response.json()).data;
      expect(api.period).toMatchObject({ start: '2020-01-10', end: '2020-01-10', timezone: 'Asia/Manila' });
      expect(api.metrics).toMatchObject({ totalRevenue: 100, won: 1, lost: 1 });
      expect(api.trend).toEqual(result.trend);
      expect(api.leaderboard).toEqual(result.leaderboard);
    } finally { await db.deal.updateMany({ where: { id: { in: ids } }, data: { isArchived: true } }); }
  });
  it('reconciles cent-normalized legacy amounts across dates and stage groups', async () => {
    const before = await report();
    await deal('fraction-open-lead', 'lead', 0.004);
    await deal('fraction-open-contacted', 'contacted', 0.004);
    for (const [id, date] of [['fraction-win-a','2020-01-06'],['fraction-win-b','2020-01-07']]) {
      await deal(id, 'qualified', 0.004); await close(id, 'won', new Date(date));
    }
    const result = await report();
    expect(result.metrics.totalRevenue).toBe(before.metrics.totalRevenue);
    expect(result.metrics.totalRevenue).toBe(result.trend.reduce((sum,row) => sum + row.revenue,0));
    expect(result.metrics.openPipelineValue).toBe(result.distribution.reduce((sum,row) => sum + (row.value ?? 0),0));
    await db.deal.updateMany({ where: { id: { startsWith: 'fraction-' } }, data: { isArchived: true } });
  });
  it('isolates currencies, unknown closing dates and legacy attribution instead of guessing', async () => {
    await deal('dollars', 'qualified', 999999, { currency: 'USD' }); await close('dollars', 'won');
    await deal('unknown-close', 'won', 999999);
    const result = await report();
    expect(result.metrics.totalRevenue).toBe(45250); expect(result.metrics.currencyExcluded).toBe(1);
    // The journey closed after this fixed as-of date; it and the null date are excluded.
    expect(result.metrics.closingDateMissing).toBe(2);
    expect(result.warnings.join(' ')).toContain('another or unknown currency');
    await db.deal.update({ where: { id: 'unknown-close' }, data: { closedAt: new Date('2020-01-05T00:00:00Z') } });
    expect((await report()).warnings.join(' ')).toContain('historical agent attribution');
    await db.deal.update({ where: { id: 'unknown-close' }, data: { isArchived: true } });
  });
  it('keeps won attribution after reassignment and records incomplete legacy conversion', async () => {
    await db.deal.update({ where: { id: 'winner' }, data: { assignedUserId: 'other-agent', ownerId: 'other-agent', revenueOwnerId: 'other-agent', revenueOwnerEligible: false } });
    expect((await report()).leaderboard.find(row => row.id === 'agent')?.revenue).toBe(45250);
    expect((await db.deal.findUniqueOrThrow({ where: { id: 'winner' } })).revenueOwnerId).toBe('agent');
    await db.deal.update({ where: { id: 'open-lead' }, data: { currentStageHistoryId: null } });
    await db.dealStageHistory.deleteMany({ where: { dealId: 'open-lead' } });
    const conversion = (await report()).conversion!;
    expect(conversion.missingHistory).toBeGreaterThan(0);
    expect(conversion.leadToContacted).toBeNull();
    expect(conversion.qualifiedToWon).toBeNull();
  });
  it('tracks only qualifying tasks and links authorized actionable records', async () => {
    await db.task.createMany({ data: [
      { id: 'overdue', status: 'pending', dueDate: new Date('2019-12-01'), title: 'Overdue' },
      { id: 'today', status: 'in_progress', dueDate: now, title: 'Today' },
      { id: 'done', status: 'completed', dueDate: now, title: 'Done' },
      { id: 'cancelled', status: 'cancelled', dueDate: now, title: 'Cancelled' },
    ].map(task => ({ ...task, tenantId: 'a', assignedUserId: 'agent' })) });
    const result = await report();
    expect(result.actions[0]).toMatchObject({ id: 'overdue', overdue: true, href: '/operations/taskboard?taskId=overdue' });
    expect(result.actions.map(row => row.id)).not.toContain('done'); expect(result.actions.map(row => row.id)).not.toContain('cancelled');
    await db.task.createMany({ data: Array.from({ length: 8 }, (_, index) => ({ id: `priority-${index}`, tenantId: 'a', assignedUserId: 'agent', title: `Priority ${index}`,
      status: 'pending', priority: index === 7 ? 'High' : 'Low', dueDate: new Date(+now + (index === 7 ? 10 : 1) * 86400000) })) });
    const ordered = (await report()).actions.filter(row => row.kind === 'task');
    expect(ordered).toHaveLength(10);
    expect(ordered.slice(0,3).map(row => row.id)).toEqual(['overdue','priority-7','today']);
    await db.task.updateMany({ where: { id: { startsWith: 'priority-' } }, data: { isArchived: true } });
  });
  it('publishes revision counters only for committed data and covers archive, tasks, roles and tenant isolation', async () => {
    const before = await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId: 'a' } });
    await expect(db.$transaction(async tx => { await tx.deal.update({ where: { id: 'open-qualified' }, data: { value: 777 } }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId: 'a' } })).toEqual(before);
    await db.deal.update({ where: { id: 'open-qualified' }, data: { value: 3500 } });
    await db.task.update({ where: { id: 'overdue' }, data: { status: 'completed' } });
    const after = await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId: 'a' } });
    expect(after.analytics).toBeGreaterThan(before.analytics); expect(after.actions).toBeGreaterThan(before.actions);
    const foreignBefore = await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId: 'b' } });
    await db.lead.update({ where: { id: 'active-lead' }, data: { isArchived: true } });
    expect(await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId: 'b' } })).toEqual(foreignBefore);
  });
  it('returns every qualifying action beyond the old display caps without widening staff or tenant access', async () => {
    const ids: string[] = [];
    const ownIds: string[] = [];
    await db.stage.update({ where: { id: 'lead' }, data: { rottenAfterDays: 1 } });
    try {
      for (const owner of ['agent', 'other-agent']) {
        const created = [];
        for (let index = 0; index < 8; index++) {
          const id = `scroll-task-${owner}-${index}`;
          await db.task.create({ data: { id, tenantId: 'a', assignedUserId: owner, title: id, status: 'pending', priority: index % 2 ? 'Low' : 'High', dueDate: new Date(+now - 86400000) } });
          created.push(id);
        }
        for (let index = 0; index < 5; index++) {
          const id = `scroll-lead-${owner}-${index}`;
          await db.lead.create({ data: { id, tenantId: 'a', assignedUserId: owner, firstName: id, lastName: 'Action', status: 'Hot' } });
          created.push(id);
        }
        for (let index = 0; index < 4; index++) {
          const id = `scroll-deal-${owner}-${index}`;
          await deal(id, 'lead', 100, { assignedUserId: owner, ownerId: owner });
          created.push(id);
        }
        ids.push(...created);
        if (owner === 'agent') ownIds.push(...created);
      }
      await db.task.create({ data: { id: 'scroll-foreign', tenantId: 'b', assignedUserId: 'foreign', title: 'Foreign action', dueDate: now, status: 'pending' } });
      const organization = await report();
      const staff = await scoped(() => dashboard(agent, query, now));
      expect(organization.actions.filter(row => ids.includes(row.id))).toHaveLength(34);
      const authorizedIds = ids.filter(id => !id.startsWith('scroll-task-') || id.startsWith('scroll-task-agent-'));
      expect(staff.actions.filter(row => ids.includes(row.id))).toHaveLength(26);
      expect(staff.actions.filter(row => ids.includes(row.id)).map(row => row.id).sort()).toEqual(authorizedIds.sort());
      expect(organization.pendingActions).toBe(organization.actions.length);
      expect(staff.pendingActions).toBe(staff.actions.length);
      expect(organization.actions.some(row => row.id === 'scroll-foreign')).toBe(false);
      expect(staff.actions.some(row => row.id === 'scroll-foreign')).toBe(false);
      const orderedTasks = organization.actions.filter(row => row.id.startsWith('scroll-task-'));
      expect(orderedTasks.slice(0, 8).every(row => row.priority === 'High')).toBe(true);
      expect(orderedTasks.slice(8).every(row => row.priority === 'Low')).toBe(true);
      await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'tasks' }, data: { canView: false } });
      const restricted = await scoped(() => dashboard(agent, query, now));
      expect(restricted.actions.some(row => row.kind === 'task')).toBe(false);
      expect(restricted.actions.filter(row => ids.includes(row.id))).toHaveLength(18);
    } finally {
      await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'tasks' }, data: { canView: true } });
      await db.stage.update({ where: { id: 'lead' }, data: { rottenAfterDays: null } });
      await db.task.updateMany({ where: { id: { startsWith: 'scroll-' } }, data: { isArchived: true } });
      await db.lead.updateMany({ where: { id: { startsWith: 'scroll-' } }, data: { isArchived: true } });
      await db.deal.updateMany({ where: { id: { startsWith: 'scroll-' } }, data: { isArchived: true } });
    }
  });
  it('matches server card staleness at exact thresholds across active pipelines and preserves action scope', async () => {
    const { presentDealResponse } = await import('../../crm/deals/deal-presentation');
    const day = 86400000;
    const previous = await db.stage.findUniqueOrThrow({ where: { id: 'qualified' } });
    const ids: string[] = [];
    await db.pipeline.createMany({ data: [
      { id: 'stale-custom', tenantId: 'a', name: 'Custom follow-up' },
      { id: 'stale-archived-pipeline', tenantId: 'a', name: 'Archived', isArchived: true },
    ] });
    await db.stage.createMany({ data: [
      { id: 'stale-custom-stage', tenantId: 'a', pipelineId: 'stale-custom', name: 'Review', order: 0, rottenAfterDays: 7 },
      { id: 'stale-disabled', tenantId: 'a', pipelineId: 'stale-custom', name: 'No timer', order: 1 },
      { id: 'stale-won', tenantId: 'a', pipelineId: 'stale-custom', name: 'Custom success', order: 2, isWon: true, rottenAfterDays: 1 },
      { id: 'stale-lost', tenantId: 'a', pipelineId: 'stale-custom', name: 'Custom loss', order: 3, isLost: true, rottenAfterDays: 1 },
      { id: 'stale-archived-stage', tenantId: 'a', pipelineId: 'stale-archived-pipeline', name: 'Review', order: 0, rottenAfterDays: 1 },
    ] });
    const create = async (id: string, stageId: string, extra = {}) => {
      ids.push(id);
      return deal(id, stageId, 100, { pipelineId: stageId === 'qualified' ? 'sales' : 'stale-custom', stageChangedAt: new Date(+now - 14 * day), ...extra });
    };
    try {
      await db.stage.update({ where: { id: 'qualified' }, data: { rottenAfterDays: 14 } });
      await create('stale-before', 'qualified', { stageChangedAt: new Date(+now - 14 * day + 1) });
      await create('stale-exact', 'qualified');
      await create('stale-after', 'qualified', { stageChangedAt: new Date(+now - 15 * day) });
      await create('stale-fallback', 'qualified', { stageChangedAt: null, createdAt: new Date(+now - 14 * day), updatedAt: now });
      await create('stale-new-stage', 'qualified', { stageChangedAt: now });
      await create('stale-custom-exact', 'stale-custom-stage', { stageChangedAt: new Date(+now - 7 * day) });
      await create('stale-other-agent', 'stale-custom-stage', { assignedUserId: 'other-agent' });
      await create('stale-null', 'stale-disabled');
      await create('stale-terminal-won', 'stale-won');
      await create('stale-terminal-lost', 'stale-lost');
      await create('stale-archived', 'qualified', { isArchived: true });
      await create('stale-deleted', 'qualified', { deletedAt: now });
      await create('stale-inactive', 'stale-archived-stage', { pipelineId: 'stale-archived-pipeline' });
      ids.push('stale-foreign');
      await db.stage.update({ where: { id: 'foreign-qualified' }, data: { rottenAfterDays: 1 } });
      await db.deal.create({ data: { id: 'stale-foreign', tenantId: 'b', title: 'Foreign', pipelineId: 'foreign-sales', stageId: 'foreign-qualified', ownerId: 'foreign', createdAt: new Date(+now - 30 * day) } });
      const before = await db.deal.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
      const counts = [await db.notification.count(), await db.task.count()];
      const rows = before.filter(row => row.tenantId === 'a');
      const cards = await scoped(() => presentDealResponse('a', rows, now)) as Array<(typeof rows)[number] & { staleness: { isStale: boolean; thresholdDays: number | null } }>;
      const expected = ['stale-after', 'stale-custom-exact', 'stale-exact', 'stale-fallback', 'stale-other-agent'].sort();
      const actions = (await report()).actions.filter(row => ids.includes(row.id));
      expect(actions.map(row => row.id).sort()).toEqual(expected);
      expect(cards.filter(row => row.staleness.isStale).map(row => row.id).sort()).toEqual(expected);
      expect(cards.find(row => row.id === 'stale-custom-exact')!.staleness.thresholdDays).toBe(7);
      expect(actions.find(row => row.id === 'stale-exact')).toMatchObject({ title: 'stale-exact', priority: 'MEDIUM', href: '/crm/deals/stale-exact' });
      expect((await scoped(() => dashboard(agent, query, now))).actions.filter(row => ids.includes(row.id)).map(row => row.id).sort()).toEqual(expected);
      await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'deals' }, data: { canView: false } });
      expect((await scoped(() => dashboard(agent, query, now))).actions.some(row => row.kind === 'deal')).toBe(false);
      expect(await db.deal.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })).toEqual(before);
      expect([await db.notification.count(), await db.task.count()]).toEqual(counts);
      await scoped(() => move('stale-exact', 'a', 'contacted', 'admin'));
      expect((await report()).actions.some(row => row.id === 'stale-exact')).toBe(false);
      const moved = await db.deal.findUniqueOrThrow({ where: { id: 'stale-exact' } });
      const card = await scoped(() => presentDealResponse('a', moved, moved.stageChangedAt!)) as typeof moved & { staleness: { isStale: boolean; daysInStage: number } };
      expect(card.staleness).toMatchObject({ isStale: false, daysInStage: 0 });
    } finally {
      await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'deals' }, data: { canView: true } });
      await db.stage.update({ where: { id: 'qualified' }, data: { rottenAfterDays: previous.rottenAfterDays } });
      await db.stage.update({ where: { id: 'foreign-qualified' }, data: { rottenAfterDays: null } });
      await db.deal.deleteMany({ where: { id: { in: ids } } });
      await db.stage.deleteMany({ where: { pipelineId: { in: ['stale-custom', 'stale-archived-pipeline'] } } });
      await db.pipeline.deleteMany({ where: { id: { in: ['stale-custom', 'stale-archived-pipeline'] } } });
    }
  });
  it('uses the same activity evidence across the Deal response and Action Center at a Manila midnight', async () => {
    const { presentDealResponse } = await import('../../crm/deals/deal-presentation');
    const midnight = new Date('2020-01-14T16:00:00Z');
    const cutoff = new Date(+midnight - 86_400_000);
    const recent = new Date(+cutoff + 1);
    const entered = new Date(+cutoff - 2 * 86_400_000);
    const prefix = 'inactive-evidence-';
    const ids = ['note', 'call', 'meeting', 'sms', 'reply', 'sent', 'forward', 'draft', 'automated', 'task', 'task-created',
      'other', 'future', 'workflow', 'audit', 'audit-noop', 'exact', 'closed', 'cancelled'].map(key => prefix + key);
    const id = (key: string) => prefix + key;
    const prior = await db.stage.findUniqueOrThrow({ where: { id: 'qualified' } });
    const account = await db.emailAccount.create({ data: { tenantId: 'a', userId: 'admin', email: 'test@example.test', accessToken: 'fixture' } });
    const task = await db.task.create({ data: { tenantId: 'a', assignedUserId: 'agent', title: prefix, dueDate: recent, status: 'completed' } });
    const isFixture = (row: { id: string }) => row.id.startsWith(prefix);
    const [{ version }] = await db.$queryRaw<{ version: string }[]>`SELECT version()`;
    const nativeTimezone = !version.includes('PGlite');
    try {
      // The PGlite socket drops Prisma connections on timezone changes. The
      // native QA run also verifies the session's timezone, through the same API.
      if (nativeTimezone) {
        await db.$executeRawUnsafe("SET TIME ZONE 'Asia/Manila'");
        expect(await db.$queryRaw`SELECT current_setting('TimeZone') AS timezone`).toEqual([{ timezone: 'Asia/Manila' }]);
      }
      await db.stage.update({ where: { id: 'qualified' }, data: { rottenAfterDays: 1 } });
      for (const dealId of ids) await deal(dealId, 'qualified', 100, { createdAt: entered, stageChangedAt: entered,
        ...(dealId === id('closed') ? { engagementStatus: 'Closed Deal' } : dealId === id('cancelled') ? { engagementStatus: 'Cancelled' } : {}) });
      await db.activity.createMany({ data: [
        ...['note','call','meeting','sms'].map(type => ({ tenantId: 'a', dealId: id(type), type, title: prefix, createdAt: recent })),
        { tenantId: 'a', dealId: id('exact'), type: 'note', title: prefix, createdAt: cutoff },
        { tenantId: 'a', dealId: id('future'), type: 'note', title: prefix, createdAt: new Date(+midnight + 1000) },
        { tenantId: 'a', dealId: id('workflow'), type: 'workflow', title: prefix, createdAt: recent },
        { tenantId: 'a', type: 'note', title: prefix, createdAt: recent },
        ...[['completed','task'], ['created','task-created']].map(([event, key]) => ({ tenantId: 'a', taskId: task.id,
          type: 'task', title: prefix, createdAt: recent, metadata: { taskEvent: { event, after: { dealIds: [id(key)] } } } })),
      ].map(activity => ({ ...activity, createdById: 'admin' })) });
      await db.auditLog.createMany({ data: [
        { tenantId: 'a', userId: 'admin', action: 'deal.updated', entityType: 'Deal', entityId: id('audit'),
          changeset: { before: { priority: 'LOW' }, after: { priority: 'HIGH' } }, createdAt: recent },
        { tenantId: 'a', userId: 'admin', action: 'deal.updated', entityType: 'Deal', entityId: id('audit-noop'),
          changeset: { before: { updatedAt: entered.toISOString() }, after: { updatedAt: recent.toISOString() } }, createdAt: recent },
        { tenantId: 'a', userId: 'admin', action: 'deal.updated', entityType: 'Deal', entityId: id('workflow'),
          changeset: { before: { title: 'Previous' }, after: { title: 'Changed by workflow' } }, metadata: { stalenessReset: false }, createdAt: recent },
      ] });
      await db.mailboxMessage.createMany({ data: ['reply','sent','forward','draft','automated'].map(key => ({
        tenantId: 'a', accountId: account.id, dealId: id(key), direction: ['sent','forward'].includes(key) ? 'outbound' : 'inbound',
        providerMessageId: key, threadId: key, from: 'test@example.test', recipients: ['customer@example.test'], ccRecipients: [],
        subject: prefix, body: prefix, snippet: prefix,
        labels: key === 'draft' ? ['DRAFT'] : [], meaningful: key !== 'automated', sentAt: recent, dealAttribution: { kind: 'reply' },
      })) });
      await db.mailboxSendReceipt.createMany({ data: ['sent','forward'].map(key => ({ tenantId: 'a', accountId: account.id,
        requestId: key, payloadHash: key, providerMessageId: key, status: 'sent', authorizationContext: { composeMode: key === 'forward' ? 'forward' : 'new' },
      })) });

      const read = (at: Date) => scoped(() => dashboard(admin, query, at));
      expect((await read(new Date(+midnight - 1))).actions.some(row => row.id === id('exact'))).toBe(false);
      const expected = ['audit-noop','automated','draft','exact','forward','future','other','task-created','workflow'].map(id).sort();
      for (const at of [midnight, new Date(+midnight + 1)]) {
        const actions = (await read(at)).actions.filter(isFixture).map(row => row.id).sort();
        expect(actions).toEqual(+at === +midnight ? expected : [...expected, ...['audit','call','meeting','note','reply','sent','sms','task'].map(id)].sort());
      }
      const rows = await db.deal.findMany({ where: { id: { in: ids } } });
      const presented = await scoped(() => presentDealResponse('a', rows, midnight)) as Array<{ id: string; staleness: { isStale: boolean; daysInStage: number; daysInactive: number } }>;
      expect(presented.filter(row => row.staleness.isStale).map(row => row.id).sort()).toEqual(expected);
      expect(presented.find(row => row.id === id('exact'))!.staleness).toMatchObject({ daysInactive: 1, daysInStage: 3 });
    } finally {
      if (nativeTimezone) await db.$executeRawUnsafe('RESET TIME ZONE');
      await db.mailboxSendReceipt.deleteMany({ where: { accountId: account.id } });
      await db.mailboxMessage.deleteMany({ where: { accountId: account.id } });
      await db.emailAccount.delete({ where: { id: account.id } });
      await db.activity.deleteMany({ where: { tenantId: 'a', title: prefix } });
      await db.task.delete({ where: { id: task.id } });
      await db.auditLog.deleteMany({ where: { tenantId: 'a', entityId: { in: ids } } });
      await db.deal.deleteMany({ where: { id: { in: ids } } });
      await db.stage.update({ where: { id: 'qualified' }, data: { rottenAfterDays: prior.rottenAfterDays } });
    }
  });
  it('reconciles live HTTP reports and Deal badges after threshold changes, no-op saves, and real work', async () => {
    const ids = ['staleness-http-edit','staleness-http-note','staleness-http-reassign','staleness-http-custom-field'];
    const stageUrl = '/crm/stages/qualified';
    const prior = await db.stage.findUniqueOrThrow({ where: { id: 'qualified' } });
    const entered = new Date(Date.now() - 2 * 86_400_000);
    const field = 'staleness-http-field';
    const read = async (path: string, token = adminToken, method = 'GET', body?: unknown) => {
      const response = await http(path, token, method, body);
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result.data;
    };
    const actions = async (token = adminToken) => (await read('/reporting/dashboard', token)).actions.filter((row: { id: string }) => ids.includes(row.id)).map((row: { id: string }) => row.id).sort();
    try {
      await db.closingFieldDefinition.create({ data: { tenantId: 'a', id: field, definition: { id: field, name: 'Follow-up field', type: 'Text', module: 'deals', group: 'Deal Details', active: true, order: 0, visibleInForm: true, required: false, options: [] } } });
      for (const id of ids) await deal(id, 'qualified', 100, { createdAt: entered, stageChangedAt: entered });
      await read(stageUrl, adminToken, 'PUT', { rottenAfterDays: 3 });
      expect(await actions()).toEqual([]);
      expect((await read(`/crm/deals/${ids[0]}`)).staleness).toMatchObject({ isStale: false, thresholdDays: 3 });
      expect((await http(stageUrl, agentToken, 'PUT', { rottenAfterDays: 1 })).status).toBe(403);
      await read(stageUrl, adminToken, 'PUT', { rottenAfterDays: 1 });
      expect(await actions()).toEqual([...ids].sort());
      await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'deals' }, data: { canViewAll: false, canViewMy: true } });
      expect(await actions(agentToken)).toEqual([...ids].sort());
      expect(await actions(foreignToken)).toEqual([]);
      await read(`/crm/deals/${ids[0]}`, adminToken, 'PUT', { title: ids[0] });
      expect((await read(`/crm/deals/${ids[0]}`)).staleness.isStale).toBe(true);
      expect(await actions()).toEqual([...ids].sort());
      expect((await read(`/crm/deals/${ids[0]}`, adminToken, 'PUT', { title: 'Actual Deal edit' })).staleness).toMatchObject({ isStale: false, daysInStage: 2, daysInactive: 0 });
      await read('/crm/activities', adminToken, 'POST', { dealId: ids[1], type: 'note', title: 'Follow-up' });
      expect((await read(`/crm/deals/${ids[1]}`)).staleness.isStale).toBe(false);
      expect(await read('/crm/deals/bulk/reassign', adminToken, 'POST', { dealIds: [ids[2]], assignedUserId: 'other-agent' })).toMatchObject({ succeeded: 1, failed: 0 });
      expect((await read(`/crm/deals/${ids[2]}`)).staleness.isStale).toBe(false);
      await read(`/crm/deals/${ids[3]}`, adminToken, 'PUT', { customFieldValues: { [field]: 'Recorded outcome' } });
      expect(await actions()).toEqual([]);
      expect(await actions(agentToken)).toEqual([]);
    } finally {
      await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'deals' }, data: { canViewAll: true, canViewMy: false } });
      await db.stage.update({ where: { id: 'qualified' }, data: { rottenAfterDays: prior.rottenAfterDays } });
      await db.customFieldValue.deleteMany({ where: { tenantId: 'a', dealId: { in: ids } } });
      await db.deal.deleteMany({ where: { id: { in: ids } } });
      await db.closingFieldDefinition.delete({ where: { tenantId_id: { tenantId: 'a', id: field } } });
    }
  });
  it('serves qualifying custom-pipeline actions when the official Sales Pipeline cannot be reported', async () => {
    const id = 'staleness-partial';
    const entered = new Date(Date.now() - 2 * 86_400_000);
    await db.pipeline.create({ data: { id, tenantId: 'a', name: 'Custom Pipeline' } });
    await db.stage.create({ data: { id, tenantId: 'a', pipelineId: id, name: 'Follow-up', order: 0, rottenAfterDays: 1 } });
    await deal(id, id, 100, { pipelineId: id, stageChangedAt: entered });
    try {
      for (const [hide, stageName, duplicate] of [[true, 'Qualified', false], [false, 'Broken Qualified', false], [false, 'Qualified', true]] as const) {
        await db.pipeline.update({ where: { id: 'sales' }, data: { isArchived: hide } });
        await db.stage.update({ where: { id: 'qualified' }, data: { name: stageName } });
        if (duplicate) await db.pipeline.create({ data: { id: `${id}-duplicate`, tenantId: 'a', name: 'sales pipeline' } });
        const response = await http('/reporting/dashboard');
        expect(response.status).toBe(200);
        const { data } = await response.json();
        expect(data).toMatchObject({ pipeline: null, metrics: { totalRevenue: null, activeDeals: null }, warnings: [expect.stringContaining('Sales Pipeline')] });
        expect(data.actions.filter((row: { id: string }) => row.id === id)).toEqual([expect.objectContaining({ href: `/crm/deals/${id}`, kind: 'deal' })]);
        expect((await http('/reporting/pipeline-summary')).status).toBe(409);
      }
    } finally {
      await db.stage.update({ where: { id: 'qualified' }, data: { name: 'Qualified' } });
      await db.pipeline.update({ where: { id: 'sales' }, data: { isArchived: false } });
      await db.pipeline.deleteMany({ where: { id: `${id}-duplicate` } });
      await db.deal.delete({ where: { id } });
      await db.stage.delete({ where: { id } });
      await db.pipeline.delete({ where: { id } });
    }
  });
  it('enforces staff scope, module restrictions, HTTP auth, exports and cross-tenant requests', async () => {
    const organization = await scoped(() => dashboard(agent, query, now));
    expect(organization.scope).toBe('authorized'); expect(organization.metrics).toEqual((await report()).metrics);
    expect((await http('/reporting/dashboard', '')).status).toBe(401);
    expect((await http('/reporting/dashboard?tenantId=b')).status).toBe(400);
    const foreign = await (await http('/reporting/dashboard', foreignToken)).json();
    expect(foreign.data.metrics.totalRevenue).toBe(0); expect(foreign.data.actions).toEqual([]);
    const response = await http('/reporting/dashboard/export?range=custom&start=2020-01-01&end=2020-01-31');
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/csv');
    const csv = await response.text(); expect(csv).toContain('Reporting period'); expect(csv).toContain('Current Qualified deals');
    const injected = { ...await report(), actions: [{ id: 'x', title: ' =HYPERLINK("evil")', kind: 'task' as const, dueDate: null, priority: 'High', overdue: false, href: '/x' }] };
    expect(dashboardCsv(injected)).toContain('"\' =HYPERLINK(""evil"")"');
    await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'deals' }, data: { canView: false } });
    const restricted = await scoped(() => dashboard(agent, query));
    expect(restricted.metrics.totalRevenue).toBeNull(); expect(restricted.trend).toEqual([]); expect(restricted.leaderboard).toEqual([]);
    expect(restricted.leadSourcePerformance).toBeNull();
    expect((await http('/reporting/pipeline-summary', agentToken)).status).toBe(403);
    expect((await http('/crm/pipelines/events', agentToken)).status).toBe(403);
    await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'dashboard' }, data: { canView: false } });
    expect((await http('/reporting/dashboard', agentToken)).status).toBe(403);
    expect((await http('/reporting/dashboard/export', agentToken)).status).toBe(403);
    expect((await http('/reporting/dashboard/events', agentToken)).status).toBe(403);
  });
  it('validates historical filters server-side and persists each authorized stage color without altering deals or history', async () => {
    const tomorrow = dashboardToday(new Date(Date.now() + 86400000));
    expect((await http(`/reporting/dashboard?funnelRange=custom&funnelStart=${tomorrow}&funnelEnd=${tomorrow}`)).status).toBe(400);
    expect((await http('/reporting/dashboard?funnelRange=custom&funnelStart=2020-01-10&funnelEnd=2020-01-01')).status).toBe(400);
    expect((await http('/reporting/dashboard?revenueInterval=day')).status).toBe(400);
    const ids = ['lead','contacted','qualified','won','lost'];
    const beforeDeals = await db.deal.findMany({ orderBy: { id: 'asc' } });
    const beforeHistory = await db.dealStageHistory.findMany({ orderBy: { id: 'asc' } });
    for (const [index, id] of ids.entries()) {
      const color = `#12345${index}`;
      expect((await http(`/crm/stages/${id}`, adminToken, 'PUT', { color })).status).toBe(200);
      const pipeline = await (await http('/crm/pipelines/sales')).json();
      expect(pipeline.data.stages.find((stage: { id: string }) => stage.id === id).color).toBe(color);
      expect((await report()).pipeline!.stages.find(stage => stage.id === id)!.color).toBe(color);
    }
    expect(await db.deal.findMany({ orderBy: { id: 'asc' } })).toEqual(beforeDeals);
    expect(await db.dealStageHistory.findMany({ orderBy: { id: 'asc' } })).toEqual(beforeHistory);
    expect((await http('/crm/stages/lead', adminToken, 'PUT', { color: 'red' })).status).toBe(400);
    expect((await http('/crm/stages/lead', agentToken, 'PUT', { color: '#123456' })).status).toBe(403);
    expect((await http('/crm/stages/foreign-lead', adminToken, 'PUT', { color: '#123456' })).status).toBe(404);
    expect((await http('/crm/stages/lead', adminToken, 'PUT', { name: 'Proposal' })).status).toBe(400);
    expect((await http('/crm/stages', adminToken, 'POST', { pipelineId: 'sales', name: 'Negotiation', order: 6 })).status).toBe(400);
    expect((await http('/crm/stages/contacted', adminToken, 'DELETE')).status).toBe(400);
    expect((await http('/crm/pipelines/sales/stages/reorder', adminToken, 'PATCH', { stageIds: [...ids].reverse() })).status).toBe(400);
    expect((await db.stage.findMany({ where: { pipelineId: 'sales' }, orderBy: { order: 'asc' } })).map(stage => stage.id)).toEqual(ids);
  });
  it('streams tenant stage metadata and revokes it when Deals access is removed', async () => {
    const { createAuthSessionToken } = await import('../../../core/auth/auth-session');
    const token = await createAuthSessionToken(await db.user.findUniqueOrThrow({ where: { id: 'other-agent' } }));
    await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'deals' }, data: { canView: true } });
    const controller = new AbortController();
    try {
      const response = await fetch(base + '/crm/pipelines/events', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const read = async (event: string) => {
        let buffer = '';
        for (;;) {
          const part = await reader.read();
          if (part.done) throw new Error('Metadata stream ended before event');
          buffer += new TextDecoder().decode(part.value);
          const match = buffer.match(new RegExp(`event: ${event}\\ndata: ([^\\n]+)`));
          if (match) return JSON.parse(match[1]);
        }
      };
      const first = await read('pipeline-change');
      expect(Object.keys(first)).toEqual(['metadata']); expect(first.metadata).toMatch(/^[0-9a-f]{64}$/);
      await db.stage.update({ where: { id: 'contacted' }, data: { color: '#ABCDEF' } });
      const changed = await read('pipeline-change'); expect(changed.metadata).not.toBe(first.metadata);
      expect(JSON.stringify(changed)).not.toContain('Contacted');
      await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'deals' }, data: { canView: false } });
      expect(await read('pipeline-access-changed')).toEqual({});
      expect((await http('/crm/pipelines/events', token)).status).toBe(403);
    } finally { controller.abort(); }
  }, 20000);
  it('streams committed tenant revisions and rechecks live session authorization', async () => {
    await db.rolePermission.updateMany({ where: { roleId: 'sales-role', module: 'dashboard' }, data: { canView: true } });
    const a = new AbortController(), b = new AbortController();
    const open = (token: string, signal: AbortSignal) => fetch(base + '/reporting/dashboard/events', { headers: { Authorization: `Bearer ${token}` }, signal });
    const readEvent = async (reader: ReadableStreamDefaultReader<Uint8Array>, event: string) => {
      let buffer = '';
      for (;;) {
        const part = await reader.read();
        if (part.done) throw new Error('Stream ended before event');
        buffer += new TextDecoder().decode(part.value);
        const match = buffer.match(new RegExp(`event: ${event}\\ndata: ([^\\n]+)`));
        if (match) return JSON.parse(match[1]);
      }
    };
    try {
      const [own, foreign] = await Promise.all([open(agentToken, a.signal), open(foreignToken, b.signal)]);
      expect(own.status).toBe(200); expect(own.headers.get('x-accel-buffering')).toBe('no');
      const ownReader = own.body!.getReader(), foreignReader = foreign.body!.getReader();
      const first = await readEvent(ownReader, 'dashboard-change');
      await readEvent(foreignReader, 'dashboard-change');
      await db.lead.create({ data: { tenantId: 'b', firstName: 'Foreign', lastName: 'Event' } });
      const changed = await readEvent(foreignReader, 'dashboard-change');
      expect(changed.leads).toBe('1');
      expect((await db.dashboardRevision.findUniqueOrThrow({ where: { tenantId: 'a' } })).leads.toString()).toBe(first.leads);
      expect(await readEvent(ownReader, 'dashboard-heartbeat')).toEqual({});
      expect(Object.keys(first).sort()).toEqual(['access','actions','analytics','content','leads']);
      const { revokeSession } = await import('../../../core/auth/session.service');
      await revokeSession(agentToken);
      expect(await readEvent(ownReader, 'dashboard-access-changed')).toEqual({});
      expect((await http('/reporting/dashboard', agentToken)).status).toBe(401);
    } finally {
      a.abort(); b.abort();
    }
  }, 20000);
});
