import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Prisma } from '@prisma/client';
import { EMPTY_PERMISSION_FLAGS, PERMISSION_MODULES } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import app from '../../../app';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { crmActor } from './crm-record-access.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/leadcrm_forms_test_2';
const modules = ['leads', 'contacts', 'deals', 'tasks'] as const;
type Module = typeof modules[number];
type Actor = { id: string; roleId: string; token: string };

describe.skipIf(!disposable)('OWN and supervised Group scope through authenticated APIs', () => {
  let server: Server, base: string, tenantId: string;
  let ana: Actor, alex: Actor, alice: Actor, ben: Actor, bea: Actor, bob: Actor, ungrouped: Actor, admin: Actor;
  let groupA: string, groupB: string, stageId: string, otherStageId: string;
  const records: Record<Module, Record<string, string>> = { leads: {}, contacts: {}, deals: {}, tasks: {} };
  const path = (module: Module) => `${module === 'tasks' ? '/operations' : '/crm'}/${module}`;
  const ids = (response: { body: any }) => response.body.data.map((row: { id: string }) => row.id).sort();
  async function call(route: string, actor: Actor, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}${route}`, { method, headers: {
      Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const content = await response.text();
    return { status: response.status, body: content.startsWith('{') ? JSON.parse(content) : content };
  }
  async function person(name: string, clientAdmin = false): Promise<Actor> {
    // Deliberately unrelated labels prove that persisted Head membership controls supervision.
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: clientAdmin ? 'Client Admin' : `Custom ${name}`,
      isSystemRole: clientAdmin, permissions: { create: [...modules, 'accounts', 'archived_data'].map(module => ({
        module, ...EMPTY_PERMISSION_FLAGS,
        ...Object.fromEntries(PERMISSION_MODULES.find(item => item.key === module)!.actions.map(action => [action, true])),
      })) } } });
    const user = await prisma.user.create({ data: { tenantId, role: role.name, firstName: name, lastName: 'Group QA',
      email: `${name.toLowerCase()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date(),
      userRoles: { create: { roleId: role.id } } } });
    return { id: user.id, roleId: role.id, token: (await issueAuthSession(user)).token };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Group scopes QA', slug: `group-scopes-${Date.now()}`,
      onboardingCompletedAt: new Date() } })).id;
    ana = await person('Ana'); alex = await person('Alex'); alice = await person('Alice');
    ben = await person('Ben'); bea = await person('Bea'); bob = await person('Bob');
    ungrouped = await person('Ungrouped'); admin = await person('Admin', true);
    groupA = (await prisma.tenantGroup.create({ data: { tenantId, name: 'Group A' } })).id;
    groupB = (await prisma.tenantGroup.create({ data: { tenantId, name: 'Group B' } })).id;
    await prisma.tenantGroupMember.createMany({ data: [
      { tenantId, groupId: groupA, userId: ana.id }, { tenantId, groupId: groupA, userId: alex.id },
      { tenantId, groupId: groupA, userId: alice.id, isHead: true },
      { tenantId, groupId: groupB, userId: ben.id }, { tenantId, groupId: groupB, userId: bea.id },
      { tenantId, groupId: groupB, userId: bob.id, isHead: true },
    ] });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Group Pipeline' } });
    stageId = (await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0 } })).id;
    otherStageId = (await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Contacted', order: 1 } })).id;
    const product = await prisma.productInterest.create({ data: { tenantId, name: 'Group Product', dealValue: 100 } });
    for (const [name, actor] of Object.entries({ ana, alex, alice, ben, bea, bob, ungrouped })) {
      const assignedUserId = actor.id;
      records.leads[name] = (await prisma.lead.create({ data: { tenantId, assignedUserId, firstName: name, lastName: 'Lead', email: `${name}-lead@example.test` } })).id;
      records.contacts[name] = (await prisma.contact.create({ data: { tenantId, assignedUserId, firstName: name, lastName: 'Contact', email: `${name}-contact@example.test` } })).id;
      records.deals[name] = (await prisma.deal.create({ data: { tenantId, assignedUserId, ownerId: ben.id, title: `${name} private Deal`,
        pipelineId: pipeline.id, stageId, productInterestId: product.id, productsNormalized: true, value: 100 } })).id;
      records.tasks[name] = (await prisma.task.create({ data: { tenantId, assignedUserId, createdById: admin.id, title: `${name} private Task`, dueDate: new Date() } })).id;
    }
    records.deals.unassigned = (await prisma.deal.create({ data: { tenantId, title: 'Unassigned private Deal', ownerId: ana.id, pipelineId: pipeline.id, stageId } })).id;
    const foreignTenant = (await prisma.tenant.create({ data: { name: 'Foreign Group QA', slug: `foreign-group-${Date.now()}` } })).id;
    const foreignPipeline = await prisma.pipeline.create({ data: { tenantId: foreignTenant, name: 'Foreign Pipeline' } });
    const foreignStage = await prisma.stage.create({ data: { tenantId: foreignTenant, pipelineId: foreignPipeline.id, name: 'Lead', order: 0 } });
    records.deals.foreign = (await prisma.deal.create({ data: { tenantId: foreignTenant, title: 'Foreign private Deal', pipelineId: foreignPipeline.id, stageId: foreignStage.id } })).id;
    await prisma.leadDeal.createMany({ data: [
      { tenantId, leadId: records.leads.ana, dealId: records.deals.ana },
      { tenantId, leadId: records.leads.ana, dealId: records.deals.ben },
    ] });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  }, 60000);
  afterAll(async () => {
    if (server) await new Promise<void>(done => server.close(() => done()));
    await prisma.$disconnect();
  });

  it.each(modules)('%s gives associates OWN, Heads supervised Groups, and Client Admin the tenant', async module => {
    for (const [actor, visible] of [
      [ana, ['ana']], [alex, ['alex']], [ben, ['ben']], [bea, ['bea']],
      [alice, ['ana', 'alex', 'alice']], [bob, ['ben', 'bea', 'bob']], [ungrouped, ['ungrouped']],
    ] as Array<[Actor, string[]]>) {
      const result = await call(`${path(module)}?limit=100`, actor);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(ids(result)).toEqual(visible.map(name => records[module][name]).sort());
    }
    const all = await call(`${path(module)}?limit=100`, admin);
    expect(all.status).toBe(200);
    expect(ids(all)).toEqual(Object.entries(records[module]).filter(([key]) => key !== 'foreign').map(([, id]) => id).sort());
  });

  it.each(modules)('%s rejects peer, other Group, and forged owner reads', async module => {
    for (const [actor, hidden] of [[ana, 'alex'], [alice, 'ben'], [bob, 'ana']] as Array<[Actor, string]>) {
      expect((await call(`${path(module)}/${records[module][hidden]}`, actor)).status).toBe(404);
      const ownerId = hidden === 'ana' ? ana.id : hidden === 'alex' ? alex.id : ben.id;
      const ownerFilter = module === 'leads' || module === 'contacts' ? `filter[assignedUserId]=in:${ownerId}` : `assignedUserId=${ownerId}`;
      const list = await call(`${path(module)}?${ownerFilter}&limit=100`, actor);
      expect(list.status).toBe(200); expect(ids(list)).toEqual([]);
    }
  });

  it.each(['leads', 'contacts', 'deals'] as const)('%s allows granted Head edits and denies peer or outside Group writes', async module => {
    const payload = module === 'deals' ? { title: 'Supervised Deal edit' } : { address: 'Supervised address edit' };
    expect((await call(`${path(module)}/${records[module].ana}`, alice, 'PUT', payload)).status).toBe(200);
    for (const [actor, record] of [[ana, records[module].alex], [alice, records[module].ben]] as Array<[Actor, string]>) {
      expect((await call(`${path(module)}/${record}`, actor, 'PUT', payload)).status).toBe(404);
      expect((await call(`${path(module)}/${record}/archive`, actor, 'PATCH')).status).toBe(404);
    }
  });

  it('rechecks View and Edit revocations on the same authenticated session', async () => {
    const where = { tenantId, roleId: alice.roleId, module: 'deals' };
    await prisma.rolePermission.updateMany({ where, data: { canEdit: false } });
    try { expect((await call(`/crm/deals/${records.deals.ana}`, alice, 'PUT', { title: 'Revoked edit' })).status).toBe(403); }
    finally { await prisma.rolePermission.updateMany({ where, data: { canEdit: true } }); }
    await prisma.rolePermission.updateMany({ where, data: { canView: false } });
    try { expect((await call('/crm/deals', alice)).status).toBe(403); }
    finally { await prisma.rolePermission.updateMany({ where, data: { canView: true } }); }
  });

  it('keeps My views inside the current owner even for a Head', async () => {
    expect(ids(await call('/crm/deals?scope=my', alice))).toEqual([records.deals.alice]);
  });

  it('scopes search, export, relationships and cross-tenant IDs', async () => {
    expect(ids(await call('/crm/deals?search=ben', alice))).toEqual([]);
    const csv = await call('/crm/deals/export', alice);
    expect(csv.status).toBe(200); expect(csv.body).toContain('alex private Deal'); expect(csv.body).not.toContain('ben private Deal');
    expect((await call(`/crm/deals/${records.deals.foreign}`, admin)).status).toBe(404);
    expect((await call(`/crm/deals/${records.deals.ben}/relationships`, alice)).status).toBe(404);
    const relationships = await call(`/crm/leads/${records.leads.ana}/relationships`, ana);
    expect(relationships.status).toBe(200); expect(JSON.stringify(relationships.body)).not.toContain(records.deals.ben);
  });

  it('rejects mixed-scope bulk actions before changing any Deal', async () => {
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: records.deals.ana } });
    const result = await call('/crm/deals/bulk/stage', alice, 'POST', { dealIds: [records.deals.ana, records.deals.ben], stageId: otherStageId });
    expect(result.status).toBe(404);
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  });

  it('allows supervised stage changes and hides peer activity and custom values', async () => {
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: records.deals.ana } });
    expect((await call(`/crm/deals/${before.id}/stage`, alice, 'PATCH', { stageId: otherStageId })).status).toBe(200);
    expect((await call(`/crm/deals/${records.deals.ben}/stage`, alice, 'PATCH', { stageId: otherStageId })).status).toBe(404);
    const history = await call(`/crm/activities?dealId=${before.id}`, alice);
    expect(history.status).toBe(200);
    expect((await call(`/crm/activities?dealId=${before.id}`, alex)).status).toBe(404);
    expect((await call(`/crm/deals/${before.id}/custom-fields`, alex)).status).toBe(404);
    expect((await call(`/crm/deals/${before.id}/stage`, alice, 'PATCH', { stageId })).status).toBe(200);
  });

  it('permits reassignment within supervised Groups and rejects outside targets and self claiming', async () => {
    const id = records.deals.ana;
    expect((await call(`/crm/deals/${id}`, alice, 'PUT', { assignedUserId: alex.id })).status).toBe(200);
    expect((await call(`/crm/deals/${id}`, ana)).status).toBe(404);
    expect((await call(`/crm/deals/${id}`, alex)).status).toBe(200);
    expect((await call(`/crm/deals/${id}`, alice, 'PUT', { assignedUserId: ben.id })).status).toBe(403);
    expect((await call(`/crm/deals/${records.deals.ben}`, ana, 'PUT', { assignedUserId: ana.id })).status).toBe(404);
    expect((await call(`/crm/deals/${id}`, alice, 'PUT', { assignedUserId: ana.id })).status).toBe(200);
  });

  it('validates scalar, composite and email assignee selectors at the Prisma mutation boundary', async () => {
    const id = records.deals.ana;
    const before = await prisma.deal.findUniqueOrThrow({ where: { id } });
    const asHead = <T>(work: () => Promise<T>) => tenantContext.run({ tenantId }, () =>
      crmActor.run({ tenantId, userId: alice.id, readRecords: true }, async () => await work()));
    for (const data of [
      { assignedUserId: { set: ben.id } },
      { assignedUser: { connect: { id_tenantId: { id: ben.id, tenantId } } } },
      { assignedUser: { connect: { tenantId_email: { tenantId, email: 'ben@camxian.com' } } } },
    ] as Array<Prisma.DealUpdateInput | Prisma.DealUncheckedUpdateInput>) {
      await expect(asHead(() => prisma.deal.update({ where: { id, tenantId }, data }))).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.deal.findUniqueOrThrow({ where: { id } })).toEqual(before);
    }
    const beforeLeads = await prisma.lead.findMany({ where: { tenantId }, orderBy: { id: 'asc' } });
    for (const actor of [ana, alice]) {
      for (const connect of [
        { id_tenantId: { id: ben.id, tenantId } },
        { tenantId_email: { tenantId, email: 'ben@camxian.com' } },
      ] as Prisma.UserWhereUniqueInput[]) {
        const data: Prisma.LeadCreateInput = { id: randomUUID(), firstName: 'Denied', lastName: 'Assignment',
          tenant: { connect: { id: tenantId } }, assignedUser: { connect } };
        const asActor = <T>(work: () => Promise<T>) => tenantContext.run({ tenantId }, () =>
          crmActor.run({ tenantId, userId: actor.id, readRecords: true }, async () => await work()));
        await expect(asActor(() => prisma.lead.create({ data }))).rejects.toMatchObject({ statusCode: 403 });
        await expect(asActor(() => prisma.lead.upsert({ where: { id: data.id }, create: data, update: { firstName: 'Denied upsert' } })))
          .rejects.toMatchObject({ statusCode: 403 });
        expect(await prisma.lead.findMany({ where: { tenantId }, orderBy: { id: 'asc' } })).toEqual(beforeLeads);
      }
    }
    try {
      const updated = await asHead(() => prisma.deal.update({ where: { id, tenantId }, data: {
        assignedUser: { connect: { id_tenantId: { id: alex.id, tenantId } } },
      } }));
      expect(updated.assignedUserId).toBe(alex.id);
    } finally { await prisma.deal.update({ where: { id, tenantId }, data: { assignedUserId: before.assignedUserId } }); }
  });

  it('rejects nested User mutations through CRM assignee and owner relations without changing users or the Deal', async () => {
    const id = records.deals.ana;
    const snapshot = async () => ({
      deal: await prisma.deal.findUniqueOrThrow({ where: { id } }),
      users: await prisma.user.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: {
        id: true, email: true, role: true, firstName: true, lastName: true, status: true, updatedAt: true,
      } }),
    });
    const before = await snapshot();
    for (const data of [
      { assignedUser: { update: { role: 'Client Admin' } } },
      { assignedUser: { create: { tenant: { connect: { id: tenantId } }, firstName: 'Nested', lastName: 'Denied',
        email: 'nested-user-denied@camxian.com', role: 'Client Admin' } } },
      { owner: { update: { role: 'Client Admin' } } },
    ] as Prisma.DealUpdateInput[]) {
      await expect(tenantContext.run({ tenantId }, () => crmActor.run({ tenantId, userId: alice.id, readRecords: true },
        async () => await prisma.deal.update({ where: { id, tenantId }, data })))).rejects.toMatchObject({ statusCode: 403 });
      expect(await snapshot()).toEqual(before);
    }
  });

  it('ordinary membership in multiple Groups grants no peer access', async () => {
    await prisma.tenantGroupMember.create({ data: { tenantId, groupId: groupB, userId: ana.id } });
    try { expect(ids(await call('/crm/deals?limit=100', ana))).toEqual([records.deals.ana]); }
    finally { await prisma.tenantGroupMember.deleteMany({ where: { tenantId, groupId: groupB, userId: ana.id } }); }
  });

  it('membership transfers immediately change Head supervision while retaining the associate owner', async () => {
    await prisma.$transaction(async tx => {
      await tx.tenantGroupMember.deleteMany({ where: { tenantId, groupId: groupA, userId: ana.id } });
      await tx.tenantGroupMember.create({ data: { tenantId, groupId: groupB, userId: ana.id } });
    });
    try {
      expect((await call(`/crm/deals/${records.deals.ana}`, alice)).status).toBe(404);
      expect((await call(`/crm/deals/${records.deals.ana}`, bob)).status).toBe(200);
      expect((await call(`/crm/deals/${records.deals.ana}`, ana)).status).toBe(200);
    } finally {
      await prisma.tenantGroupMember.deleteMany({ where: { tenantId, groupId: groupB, userId: ana.id } });
      await prisma.tenantGroupMember.create({ data: { tenantId, groupId: groupA, userId: ana.id } });
    }
  });

  it('Head removal and supervising multiple Groups change scope without changing role grants', async () => {
    await prisma.tenantGroupMember.updateMany({ where: { tenantId, groupId: groupA, userId: alice.id }, data: { isHead: false } });
    try { expect(ids(await call('/crm/deals?limit=100', alice))).toEqual([records.deals.alice]); }
    finally { await prisma.tenantGroupMember.updateMany({ where: { tenantId, groupId: groupA, userId: alice.id }, data: { isHead: true } }); }
    await prisma.tenantGroupMember.updateMany({ where: { tenantId, groupId: groupB, userId: bob.id }, data: { isHead: false } });
    await prisma.tenantGroupMember.create({ data: { tenantId, groupId: groupB, userId: alice.id, isHead: true } });
    try { expect(ids(await call('/crm/deals?limit=100', alice))).toEqual(['ana', 'alex', 'alice', 'ben', 'bea', 'bob'].map(name => records.deals[name]).sort()); }
    finally {
      await prisma.tenantGroupMember.deleteMany({ where: { tenantId, groupId: groupB, userId: alice.id } });
      await prisma.tenantGroupMember.updateMany({ where: { tenantId, groupId: groupB, userId: bob.id }, data: { isHead: true } });
    }
  });

  it('rejects a deactivated user even when their session previously had Deal grants', async () => {
    const dormant = await person('Dormant');
    expect((await call('/crm/deals', dormant)).status).toBe(200);
    await prisma.user.update({ where: { id: dormant.id }, data: { status: 'INACTIVE' } });
    expect((await call('/crm/deals', dormant)).status).toBe(401);
  });

  it('retains organization-wide Client Admin authority when the same user heads a Group', async () => {
    await prisma.tenantGroupMember.updateMany({ where: { tenantId, groupId: groupA, userId: alice.id }, data: { isHead: false } });
    await prisma.tenantGroupMember.create({ data: { tenantId, groupId: groupA, userId: admin.id, isHead: true } });
    try {
      const policy = await call('/crm/record-access', admin);
      expect(policy.body.data).toMatchObject({ clientAdmin: true, crmGroupHead: true, assignmentRestricted: false });
      expect((await call(`/crm/deals/${records.deals.ben}`, admin)).status).toBe(200);
      expect((await call(`/crm/leads/${records.leads.ben}`, admin)).status).toBe(200);
      expect((await call(`/crm/contacts/${records.contacts.ben}`, admin)).status).toBe(200);
      expect((await call(`/operations/tasks/${records.tasks.ben}`, admin)).status).toBe(200);
    } finally {
      await prisma.tenantGroupMember.deleteMany({ where: { tenantId, groupId: groupA, userId: admin.id } });
      await prisma.tenantGroupMember.updateMany({ where: { tenantId, groupId: groupA, userId: alice.id }, data: { isHead: true } });
    }
  });
});
