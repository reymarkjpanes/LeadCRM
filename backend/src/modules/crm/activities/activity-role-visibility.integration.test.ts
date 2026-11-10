import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { replayCrmMigrations } from '../../../tests/replay-crm-migrations';
import { installTenantScoping } from '../../../core/tenant/tenant-prisma';
import { installProductProjections } from '../../../core/tenant/product-projections';
import { crmActor, installCrmRecordAccess } from '../access/crm-record-access.service';
import { resolve } from 'node:path';

vi.setConfig({ testTimeout: 120000 });

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('../../../config/database.config', () => ({ default: new Proxy({}, { get: (_target, property) => {
  const value = (holder.client as any)[property]; return typeof value === 'function' ? value.bind(holder.client) : value;
} }) }));

type Actor = { id: string; token: string; roleId: string };
type Kind = 'lead' | 'contact' | 'deal';
type Fixture = { id: string; emailIds: string[]; activityIds: string[] };
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, server: Server, base: string;
let admin: Actor, head: Actor, agent: Actor, rep: Actor, outsider: Actor, member: Actor, limited: Actor, denied: Actor;
let groupA: string, groupB: string, foreign: Fixture, converted: string;
let duringBody: (() => Promise<unknown>) | undefined;
const tenantId = randomUUID(), foreignTenant = randomUUID();
const records: Record<string, Record<Kind, Fixture>> = {};
async function call(actor: Actor, path: string) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${actor.token}` } });
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
}
const list = (actor: Actor, kind: Kind, row: Fixture, suffix = '') => call(actor, `/crm/activities?${kind}Id=${row.id}&limit=100${suffix}`);

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'isolated-activity-role-test-secret');
  pg = await PGlite.create(); await replayCrmMigrations(pg);
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
  db = new PrismaClient({ datasources: { db: { url: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1` } } });
  holder.client = db; installProductProjections(db); installTenantScoping(db); installCrmRecordAccess(db);
  db.$use(async (params, next) => {
    const result = await next(params);
    if (params.model === 'MailboxMessage' && params.action === 'findMany' && duringBody) {
      const change = duringBody; duringBody = undefined; await crmActor.exit(async () => await change());
    }
    return result;
  });
  await db.tenant.createMany({ data: [tenantId, foreignTenant].map(id => ({ id, name: 'Activity roles', slug: id,
    status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() })) });
  async function actor(name: string, ownOnly = false, deny = false, tenant = tenantId): Promise<Actor> {
    const role = await db.roleDefinition.create({ data: { tenantId: tenant, name, permissions: { create:
      ['leads', 'contacts', 'deals', 'accounts', 'tasks'].map(module => ({ module, canView: !deny,
        canViewAll: !deny && !ownOnly, canViewMy: !deny && ownOnly && module !== 'accounts' })) } } });
    const user = await db.user.create({ data: { tenantId: tenant, firstName: name, lastName: 'Test', role: name,
      email: `${randomUUID()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date(),
      userRoles: { create: { roleId: role.id } } } });
    const token = (await (await import('../../../core/auth/auth-session')).issueAuthSession(user)).token;
    await db.emailAccount.create({ data: { id: `mail-${user.id}`, tenantId: tenant, userId: user.id,
      email: user.email, accessToken: 'fixture-no-provider-token', scopes: [] } });
    return { id: user.id, token, roleId: role.id };
  }
  admin = await actor('Client Admin'); head = await actor('Sales Admin'); agent = await actor('Sales Agent', true);
  rep = await actor('Sales Representative', true); outsider = await actor('Outside Agent', true);
  member = await actor('Ordinary Member', true); limited = await actor('Limited Head', true); denied = await actor('Denied Head', false, true);
  // Elevated readers intentionally have no personal connected mailbox.
  await db.emailAccount.deleteMany({ where: { userId: { in: [admin.id, head.id, limited.id, denied.id] } } });
  async function group(name: string, members: Actor[], leader: Actor) {
    return db.tenantGroup.create({ data: { tenantId, name, members: { create: members.map(user => ({ userId: user.id, isHead: user.id === leader.id })) } } });
  }
  groupA = (await group('Headed A', [head, agent, member], head)).id;
  groupB = (await group('Headed B', [head, rep], head)).id;
  await group('Member only', [head, outsider], outsider);
  await group('Limited', [limited, agent], limited); await group('Denied', [denied, agent], denied);
  const pipelines = new Map<string, { pipelineId: string; stageId: string }>();
  for (const tenant of [tenantId, foreignTenant]) {
    const pipeline = await db.pipeline.create({ data: { tenantId: tenant, name: 'Activity pipeline' } });
    const stage = await db.stage.create({ data: { tenantId: tenant, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
    pipelines.set(tenant, { pipelineId: pipeline.id, stageId: stage.id });
  }
  async function fixture(owner: Actor, kind: Kind, tenant = tenantId): Promise<Fixture> {
    const data = { tenantId: tenant, assignedUserId: owner.id };
    const contactId = kind === 'deal' ? records[owner.id].contact.id : undefined;
    const row = kind === 'deal' ? await db.deal.create({ data: { ...data, ...pipelines.get(tenant)!, title: `Timeline Deal ${owner.id.slice(0, 6)}`, tags: [],
      contactDeals: { create: { contactId: contactId! } } } })
      : kind === 'lead' ? await db.lead.create({ data: { ...data, firstName: `Timeline ${owner.id.slice(0, 6)}`, lastName: 'Lead', email: `${randomUUID()}@example.test` } })
      : await db.contact.create({ data: { ...data, firstName: `Timeline ${owner.id.slice(0, 6)}`, lastName: 'Contact', email: `${randomUUID()}@example.test` } });
    const links = { [`${kind}Id`]: row.id };
    const customer = 'email' in row ? row.email! : (await db.contact.findUniqueOrThrow({ where: { id: contactId! } })).email!;
    const activityIds: string[] = [], emailIds: string[] = [];
    const task = await db.task.create({ data: { tenantId: tenant, title: 'Timeline Task', assignedUserId: owner.id, dueDate: new Date() } });
    for (const type of ['note', 'stage_change', 'task']) activityIds.push((await db.activity.create({ data: {
      tenantId: tenant, ...links, type, title: `Timeline ${type}`, createdById: owner.id, ...(type === 'task' ? { taskId: task.id } : {}),
    } })).id);
    for (const direction of ['inbound', 'outbound']) {
      const accountId = `mail-${owner.id === head.id ? agent.id : owner.id}`;
      const mailbox = (await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })).email;
      const message = await db.mailboxMessage.create({ data: { tenantId: tenant, accountId, providerMessageId: randomUUID(), threadId: randomUUID(),
        ...links, ...(contactId ? { contactId } : {}), direction, from: direction === 'inbound' ? customer : mailbox,
        fromAddress: direction === 'inbound' ? customer : mailbox,
        recipients: [direction === 'inbound' ? mailbox : customer], recipientAddresses: [direction === 'inbound' ? mailbox : customer], authorizationParticipants: [mailbox, customer],
        subject: `Timeline ${kind} ${direction}`, body: `Stored ${kind} ${direction} body\n${'Historical message content. '.repeat(80)}`, snippet: 'Stored history',
        labels: direction === 'inbound' ? ['INBOX'] : ['SENT'], sentAt: new Date('2026-10-01T00:00:00Z'), participantPolicyVersion: 1 } });
      const activity = await db.activity.create({ data: { tenantId: tenant, ...links, type: 'email', title: message.subject,
        createdById: tenant === tenantId ? outsider.id : owner.id, mailboxMessageId: message.id,
        metadata: { mailboxMessageId: 'forged', email: { body: 'Forged body' } } } });
      emailIds.push(activity.id); activityIds.push(activity.id);
    }
    return { id: row.id, emailIds, activityIds };
  }
  for (const owner of [agent, rep, outsider, head]) {
    records[owner.id] = {} as Record<Kind, Fixture>;
    for (const kind of ['lead', 'contact', 'deal'] as const) records[owner.id][kind] = await fixture(owner, kind);
  }
  const foreignActor = await actor('Foreign Agent', false, false, foreignTenant);
  foreign = await fixture(foreignActor, 'contact', foreignTenant);
  const source = await db.lead.create({ data: { tenantId, firstName: 'Converted', lastName: 'Lead', assignedUserId: agent.id,
    contactId: records[agent.id].contact.id, convertedAt: new Date() } });
  converted = (await db.activity.create({ data: { tenantId, leadId: source.id, type: 'note', title: 'Converted source history', createdById: outsider.id } })).id;
  server = (await import('../../../app')).default.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
}, 180000);

afterAll(async () => {
  server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await db?.$disconnect(); await socket?.stop(); await pg?.close(); vi.unstubAllEnvs();
});

it.each(['lead', 'contact', 'deal'] as const)('Client Admin and Group Head read %s sent/received, task and status history without personal Gmail', async kind => {
  for (const actor of [admin, head]) for (const owner of [agent]) {
    const row = records[owner.id][kind];
    const result = await list(actor, kind, row);
    expect(result.status, JSON.stringify(result.body)).toBe(200); expect(result.cache).toBe('no-store');
    expect(result.body.data.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(row.activityIds));
    expect(result.body.data.filter((item: { type: string }) => item.type === 'email').map((item: any) => item.metadata.email.direction).sort()).toEqual(['inbound', 'outbound']);
    expect(result.body.data.filter((item: { type: string }) => item.type === 'email').every((item: any) => item.metadata.email.body.startsWith('Stored'))).toBe(true);
    const preview = await call(actor, `/crm/${kind === 'lead' ? 'leads' : kind === 'contact' ? 'contacts' : 'deals'}/${row.id}/relationships`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data.activities.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(row.emailIds));
    for (const id of row.emailIds) expect((await call(actor, `/crm/activities/${id}`)).status).toBe(200);
  }
});

it('limits management to headed Groups, preserves module grants and hides foreign tenant history', async () => {
  for (const owner of [rep, head]) expect((await list(head, 'lead', records[owner.id].lead, '&type=email')).body.data).toHaveLength(2);
  for (const kind of ['lead', 'contact', 'deal'] as const) {
    const row = records[outsider.id][kind];
    expect((await list(admin, kind, row)).body.data.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(row.emailIds));
    expect((await list(head, kind, row)).status).toBe(404);
    expect((await call(head, `/crm/activities/${row.emailIds[0]}`)).status).toBe(404);
    const preview = await call(head, `/crm/${kind === 'lead' ? 'leads' : kind === 'contact' ? 'contacts' : 'deals'}/${row.id}/relationships`);
    expect(preview.status).toBe(404);
    for (const actor of [member, limited]) expect((await list(actor, kind, records[agent.id][kind])).status).toBe(404);
    expect((await list(denied, kind, records[agent.id][kind])).status).toBe(403);
  }
  for (const actor of [admin, head, agent]) {
    expect((await list(actor, 'contact', foreign)).status).toBe(404);
    expect((await call(actor, `/crm/activities/${foreign.emailIds[0]}`)).status).toBe(404);
  }
  const policy = (await call(head, '/crm/record-access')).body.data;
  expect(policy.activityReadScope).toBe('managed-groups'); expect(policy).not.toHaveProperty('activityTeamUserIds');
  expect((await call(member, '/crm/record-access')).body.data.activityReadScope).toBe('mailbox');
});

it('retains Sales Agent assignment and mailbox restrictions', async () => {
  const own = records[agent.id].lead;
  expect((await list(agent, 'lead', own)).status).toBe(200);
  expect((await list(agent, 'lead', own, '&type=email')).body.data).toHaveLength(2);
  expect((await list(agent, 'lead', records[rep.id].lead)).status).toBe(404);
  expect((await call(agent, `/crm/activities/${records[rep.id].lead.emailIds[0]}`)).status).toBe(404);
  await db.emailAccount.update({ where: { id: `mail-${agent.id}` }, data: { isActive: false } });
  expect((await list(agent, 'lead', own, '&type=email')).body.data).toEqual([]);
  expect((await list(head, 'lead', own, '&type=email')).body.data).toHaveLength(2);
  expect((await list(admin, 'lead', own, '&type=email')).body.data).toHaveLength(2);
  await db.emailAccount.update({ where: { id: `mail-${agent.id}` }, data: { isActive: true } });
});

it('keeps conversion history, canonical message links, search, counts and cursor pages consistent', async () => {
  const row = records[agent.id].contact;
  const result = await list(head, 'contact', row);
  expect(result.body.data.map((item: { id: string }) => item.id)).toContain(converted);
  const pages: string[] = []; let cursor: string | null = null;
  do {
    const page = await call(head, `/crm/activities?contactId=${row.id}&type=email&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
    expect(page.status).toBe(200); expect(page.body.total).toBe(2);
    pages.push(...page.body.data.map((item: { id: string }) => item.id)); cursor = page.body.nextCursor;
  } while (cursor);
  expect(pages.sort()).toEqual([...row.emailIds].sort());
  const search = await list(head, 'contact', row, '&type=email&search=inbound');
  expect(search.body.total).toBe(1); expect(search.body.data).toHaveLength(1);
  const forged = await db.activity.create({ data: { tenantId, contactId: row.id, type: 'email', title: 'Forged email', createdById: admin.id,
    metadata: { mailboxMessageId: foreign.emailIds[0], email: { body: 'Secret' } } } });
  expect((await call(admin, `/crm/activities/${forged.id}`)).status).toBe(404);
  expect((await list(admin, 'contact', row, '&type=email')).body.total).toBe(2);
});

it('does not mix separate Deals sharing the same Contact', async () => {
  const first = records[agent.id].deal, second = records[rep.id].deal;
  await db.contactDeal.createMany({ data: [first, second].map(row => ({ tenantId, contactId: records[agent.id].contact.id, dealId: row.id })), skipDuplicates: true });
  for (const actor of [admin, head]) {
    const result = await list(actor, 'deal', first, '&type=email');
    expect(result.body.data.map((item: { id: string }) => item.id).sort()).toEqual([...first.emailIds].sort());
  }
});

it('projects Task history references through current CRM scope after a linked Deal is reassigned', async () => {
  const source = await db.deal.findUniqueOrThrow({ where: { id: records[agent.id].deal.id } });
  const deal = await db.deal.create({ data: { tenantId, pipelineId: source.pipelineId, stageId: source.stageId,
    title: 'Task history scoped Deal', assignedUserId: agent.id } });
  const task = await db.task.create({ data: { tenantId, title: 'Own Task with historical context', assignedUserId: agent.id,
    dueDate: new Date(), dealLinks: { create: { dealId: deal.id } } } });
  const state = { dealIds: [deal.id], leadIds: [records[agent.id].lead.id, records[outsider.id].lead.id],
    contactIds: [records[agent.id].contact.id, records[outsider.id].contact.id], accountIds: [] };
  const metadata = { taskEvent: { version: 1, id: randomUUID(), event: 'updated', taskId: task.id,
    actorId: agent.id, taskTitle: task.title, before: state, after: state, context: state } };
  const activity = await db.activity.create({ data: { tenantId, taskId: task.id, type: 'task', title: 'Task Updated',
    createdById: agent.id, metadata } });
  const before = await call(agent, `/crm/activities/${activity.id}`);
  expect(before.status).toBe(200);
  expect(before.body.data.metadata.taskEvent.context.dealIds).toEqual([deal.id]);
  await db.deal.update({ where: { id: deal.id }, data: { assignedUserId: outsider.id } });
  for (const reader of [agent, head]) {
    const page = await call(reader, `/crm/activities?taskId=${task.id}&limit=100`);
    expect(page.status).toBe(200);
    const projected = page.body.data.find((row: { id: string }) => row.id === activity.id).metadata.taskEvent;
    for (const key of ['before', 'after', 'context']) expect(projected[key]).toEqual({
      dealIds: [], leadIds: [records[agent.id].lead.id], contactIds: [records[agent.id].contact.id], accountIds: [],
    });
    const detail = await call(reader, `/crm/activities/${activity.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.metadata.taskEvent.context.dealIds).toEqual([]);
    expect(JSON.stringify(detail.body)).not.toContain(deal.id);
    expect(JSON.stringify(detail.body)).not.toContain(records[outsider.id].lead.id);
  }
  expect((await call(admin, `/crm/activities/${activity.id}`)).body.data.metadata).toEqual(metadata);
  expect((await db.activity.findUniqueOrThrow({ where: { id: activity.id } })).metadata).toEqual(metadata);
});

if (process.env.LEADCRM_ACTIVITY_BROWSER === 'true') it('verifies authenticated Deal, Lead and Contact panels in Chromium', async () => {
  const { verifyActivityRolePanels } = await import(resolve(__dirname, '../../../../scripts/activity-role-browser-fixture.mjs'));
  await verifyActivityRolePanels({ db, apiBase: base, admin, head, agent, outsider, records });
}, 360000);

it.each(['head', 'membership', 'assignment', 'permission'] as const)('rejects stale bodies, totals and cursors after a mid-read %s change', async change => {
  const row = records[agent.id].lead;
  duringBody = () => change === 'head' ? db.tenantGroupMember.updateMany({ where: { groupId: groupA, userId: head.id }, data: { isHead: false } })
    : change === 'membership' ? db.tenantGroupMember.deleteMany({ where: { groupId: groupA, userId: agent.id } })
    : change === 'assignment' ? db.lead.update({ where: { id: row.id }, data: { assignedUserId: outsider.id } })
    : db.rolePermission.updateMany({ where: { roleId: head.roleId, module: 'leads' }, data: { canView: false, canViewAll: false } });
  const result = await list(head, 'lead', row, '&type=email');
  expect(result.status, JSON.stringify(result.body)).toBe(409);
  expect(result.body).not.toHaveProperty('data'); expect(result.body).not.toHaveProperty('total'); expect(result.body).not.toHaveProperty('nextCursor');
  if (change === 'head') await db.tenantGroupMember.updateMany({ where: { groupId: groupA, userId: head.id }, data: { isHead: true } });
  if (change === 'membership') await db.tenantGroupMember.create({ data: { tenantId, groupId: groupA, userId: agent.id } });
  if (change === 'assignment') await db.lead.update({ where: { id: row.id }, data: { assignedUserId: agent.id } });
  if (change === 'permission') await db.rolePermission.updateMany({ where: { roleId: head.roleId, module: 'leads' }, data: { canView: true, canViewAll: true } });
});
