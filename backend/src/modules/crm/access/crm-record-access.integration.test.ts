import { beforeAll, afterAll, it, expect, describe } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EMPTY_PERMISSION_FLAGS, ArchiveQuerySchema, PERMISSION_MODULES } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import app from '../../../app';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { crmActor, isSalesRoleName, resolveCrmActor } from './crm-record-access.service';
import { updateRoleAndPermissions } from '../../administration/roles/roles.repository';
import { syncContactAssociations, syncLeadAssociations } from '../deals/deals.repository';
import { uploadFile } from '../record-files/record-files.service';
import { list as archivedList } from '../../administration/archived-data/archived-data.service';
import { eligibleAgents } from '../leads/lead-automation.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && (url.pathname === '/leadcrm_forms_test_2' || /^\/leadcrm_environment_test_\d+$/.test(url.pathname));
describe.skipIf(!disposable)('CRM assignment authorization with real HTTP sessions and PostgreSQL', () => {
  let server: Server, base: string, tenantId: string, foreignTenant: string;
  let a: any, b: any, admin: any, viewer: any, ordinary: any, inactive: any;
  let pipeline: any, stage: any, qualified: any, lost: any, product: any;
  const records: Record<string, Record<string, any>> = {};
  const delegates = { leads: 'lead', contacts: 'contact', accounts: 'account', deals: 'deal' } as const;
  const db = prisma as any;
  const scoped = (actor: any, work: () => Promise<unknown>) => tenantContext.run({ tenantId }, () => crmActor.run({ tenantId, userId: actor.id }, async () => await work()));
  async function person(name: string, edit = true, roleName = 'Sales Staff') {
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: roleName, isSystemRole: roleName === 'Client Admin', permissions: { create: [
      ...Object.keys(delegates).map(module => ({ module, ...EMPTY_PERMISSION_FLAGS, ...Object.fromEntries(PERMISSION_MODULES.find(m => m.key === module)!.actions.filter(action => ['canViewAll','canViewMy','canViewActive'].includes(action)).map(action => [action, true])), canView: true, canEdit: edit, canCreate: edit, canArchive: edit })),
      { module: 'archived_data', ...EMPTY_PERMISSION_FLAGS, canView: true, canRestore: edit },
    ] } } });
    const user = await prisma.user.create({ data: { tenantId, role: roleName, email: `${name.toLowerCase()}@camxian.com`, firstName: name, lastName: 'QA',
      mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId: role.id } } } });
    return { ...user, roleId: role.id, token: (await issueAuthSession(user)).token };
  }
  async function call(path: string, actor = a, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}/crm${path}`, { method, headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function snapshot() {
    return { records: await Promise.all(Object.values(delegates).map(model => db[model].findMany({ where: { tenantId }, orderBy: { id: 'asc' } }))),
      activities: await prisma.activity.count({ where: { tenantId } }), audits: await prisma.auditLog.count({ where: { tenantId } }),
      histories: await prisma.dealStageHistory.count({ where: { tenantId } }), workflows: await prisma.workflowExecutionRun.count({ where: { tenantId } }),
      notifications: await prisma.notificationEvent.count({ where: { tenantId } }), deliveries: await prisma.notificationDelivery.count({ where: { tenantId } }),
      children: await Promise.all(['customFieldValue', 'recordFile', 'leadProductInterest', 'contactProductInterest', 'leadDeal', 'contactDeal']
        .map(async model => (await db[model].findMany({ where: { tenantId } })).map((row: unknown) => JSON.stringify(row)).sort())) };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'RBAC QA', slug: `rbac-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    foreignTenant = (await prisma.tenant.create({ data: { name: 'Foreign RBAC QA', slug: `foreign-rbac-${Date.now()}` } })).id;
    a = await person('AgentA'); b = await person('AgentB', true, 'Sales Agent'); viewer = await person('Viewer', false, 'Sales Rep'); ordinary = await person('Ordinary', true, 'Operations');
    admin = await person('Admin', true, 'Client Admin'); inactive = await person('Inactive', true, 'Sales Manager');
    pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'RBAC Pipeline' } });
    stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
    qualified = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Qualified', order: 1 } });
    lost = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Cancelled', isLost: true, order: 2 } });
    product = await prisma.productInterest.create({ data: { tenantId, name: 'RBAC Product', dealValue: 100 } });
    for (const [module, model] of Object.entries(delegates)) {
      records[module] = {};
      for (const [kind, assignedUserId] of Object.entries({ own: a.id, other: b.id, unassigned: null, inactive: inactive.id })) {
        records[module][kind] = await db[model].create({ data: { tenantId, ...(module === 'accounts' ? {} : { assignedUserId }),
          ...(module === 'accounts' ? { name: `RBAC ${kind}` } : module === 'deals' ? { title: `RBAC ${kind}`, pipelineId: pipeline.id, stageId: stage.id, ownerId: a.id,
            productInterestId: product.id, productsNormalized: true, value: 100 } : { firstName: 'RBAC', lastName: kind, email: `${module}-${kind}@example.test` }) } });
      }
      if (module !== 'deals') records[module].foreign = await db[model].create({ data: { tenantId: foreignTenant,
        ...(module === 'accounts' ? { name: 'Foreign' } : { firstName: 'Foreign', lastName: 'Record', email: `${module}@foreign.test` }) } });
    }
    // Reproduce a historical state in this disposable cluster. Current product
    // triggers correctly require reassignment before normal deactivation.
    await prisma.$executeRawUnsafe('ALTER TABLE "User" DISABLE TRIGGER USER');
    try { await prisma.user.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } }); }
    finally { await prisma.$executeRawUnsafe('ALTER TABLE "User" ENABLE TRIGGER USER'); }
    const foreignPipeline = await prisma.pipeline.create({ data: { tenantId: foreignTenant, name: 'Foreign' } });
    const foreignStage = await prisma.stage.create({ data: { tenantId: foreignTenant, pipelineId: foreignPipeline.id, name: 'Lead', order: 0 } });
    records.deals.foreign = await prisma.deal.create({ data: { tenantId: foreignTenant, title: 'Foreign', pipelineId: foreignPipeline.id, stageId: foreignStage.id } });
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  }, 60000);
  afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });


  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s lists, searches, details and custom fields include every eligible assignment', async module => {
    const list = await call(`/${module}?limit=100`); expect(list.status).toBe(200);
    const ids = list.body.data.map((row: any) => row.id);
    for (const kind of ['own', 'other', 'unassigned', 'inactive']) {
      expect(ids).toContain(records[module][kind].id);
      expect((await call(`/${module}/${records[module][kind].id}`)).status).toBe(200);
      expect((await call(`/${module}/${records[module][kind].id}/custom-fields`)).status).toBe(200);
    }
    expect(ids).not.toContain(records[module].foreign.id);
    expect((await call(`/${module}?search=RBAC&limit=100`)).body.data.length).toBe(4);
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s denies other/unassigned updates, custom fields, archive and direct claiming without side effects', async module => {
    const before = await snapshot();
    for (const kind of ['other', 'unassigned']) {
      const id = records[module][kind].id;
      for (const payload of [{ ...(module === 'accounts' ? { name: 'Forbidden' } : module === 'deals' ? { title: 'Forbidden' } : { firstName: 'Forbidden' }) },
        { customFieldValues: {} }, { assignedUserId: a.id }, { assignedUserId: null }, ...(module === 'deals' ? [] : [{ status: 'Cancelled' }])]) {
        const result = await call(`/${module}/${id}`, a, 'PUT', payload);
        expect(result.status, JSON.stringify(result.body)).toBe(403);
      }
      expect((await call(`/${module}/${id}/archive`, a, 'PATCH')).status).toBe(403);
    }
    expect(await snapshot()).toEqual(before);
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s My filter is optional, paginates correctly and cannot spoof the current actor', async module => {
    const filter = module === 'deals' ? `assignedUserId=${a.id}` : `filter[scope]=equals:my&currentUserId=${b.id}`;
    const mine = await call(`/${module}?${filter}&limit=1`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((row: any) => row.id)).toEqual([records[module].own.id]);
    const all = await call(`/${module}?limit=2&page=1`), second = await call(`/${module}?limit=2&page=2`);
    expect(new Set([...all.body.data, ...second.body.data].map((row: any) => row.id)).size).toBe(4);
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s creation rejects another-agent assignment and missing Create permission', async module => {
    const payload = { ...(module === 'contacts' ? { requestId: randomUUID() } : {}), assignedUserId: b.id, ...(module === 'accounts' ? { name: 'Spoofed' } : module === 'deals'
      ? { title: 'Spoofed', pipelineId: pipeline.id, stageId: stage.id, productInterestIds: [product.id], leadIds: [records.leads.other.id] }
      : { firstName: 'Spoofed', lastName: 'QA', email: `${module}-spoof@example.test` }) };
    const before = await snapshot();
    expect((await call(`/${module}`, a, 'POST', payload)).status).toBe(403);
    expect((await call(`/${module}`, viewer, 'POST', payload)).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it('primary Sales is restrictive while unrelated ordinary roles retain existing access', async () => {
    expect((await call(`/accounts/${records.accounts.other.id}`, ordinary, 'PUT', { name: 'Ordinary allowed' })).status).toBe(200);
    const c = await person('AgentC', true, 'Sales');
    expect((await call('/record-access', c)).body.data).toMatchObject({ assignmentRestricted: true, clientAdmin: false });
    expect((await call(`/leads/${records.leads.other.id}`, c, 'PUT', { firstName: 'Denied' })).status).toBe(403);
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s file upload denies ownership before any storage or metadata side effect', async module => {
    const before = await snapshot();
    await expect(scoped(a, () => uploadFile(module as keyof typeof delegates, records[module].other.id, tenantId, a.id,
      { name: 'denied.txt', type: 'text/plain' }, Buffer.from('Denied')))).rejects.toMatchObject({ statusCode: 403 });
    expect(await snapshot()).toEqual(before);
  });
  it('empty participant replacements and direct child writes still require the canonical parent assignment', async () => {
    const before = await snapshot();
    for (const sync of [syncContactAssociations, syncLeadAssociations]) {
      await expect(scoped(a, () => prisma.$transaction(tx => sync(records.deals.other.id, tenantId, [], a.id, tx))))
        .rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(scoped(a, () => prisma.leadProductInterest.create({ data: { tenantId, leadId: records.leads.other.id, productInterestId: product.id } })))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await snapshot()).toEqual(before);
  });
  it('current module View revocation denies reads without relying on session role claims', async () => {
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: viewer.roleId, module: 'leads' }, data: { canView: false } });
    try {
      expect((await call('/leads', viewer)).status).toBe(403);
      expect((await call(`/leads/${records.leads.other.id}`, viewer)).status).toBe(403);
    } finally { await prisma.rolePermission.updateMany({ where: { tenantId, roleId: viewer.roleId, module: 'leads' }, data: { canView: true } }); }
  });
  it.each(['leads', 'contacts'])('%s cancellation rolls back when a related Deal belongs to another agent', async module => {
    const parent = await db[delegates[module as keyof typeof delegates]].create({ data: { tenantId, firstName: 'Cascade', lastName: 'QA',
      email: `cascade-${module}@example.test`, assignedUserId: a.id } });
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Cascade foreign assignment', assignedUserId: b.id,
      pipelineId: pipeline.id, stageId: stage.id, productInterestId: product.id, productsNormalized: true, value: 100 } });
    if (module === 'leads') await prisma.leadDeal.create({ data: { tenantId, leadId: parent.id, dealId: deal.id } });
    else await prisma.contactDeal.create({ data: { tenantId, contactId: parent.id, dealId: deal.id } });
    const before = await snapshot();
    expect((await call(`/${module}/${parent.id}`, a, 'PUT', { status: 'Cancelled' })).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it('an owned Deal can reference another-agent Contact without gaining permission to edit that Contact', async () => {
    const deal = records.deals.own.id, contact = records.contacts.other.id;
    const before = await prisma.contact.findUniqueOrThrow({ where: { id: contact } });
    expect((await call(`/deals/${deal}`, a, 'PUT', { contactIds: [contact] })).status).toBe(200);
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: contact } })).toEqual(before);
    expect((await call(`/contacts/${contact}`, a, 'PUT', { firstName: 'Relationship bypass' })).status).toBe(403);
    expect((await call(`/deals/${deal}`, a, 'PUT', { contactIds: [] })).status).toBe(200);
  });
  it('array transactions and tenant-scoped raw SQL cannot bypass assignment checks', async () => {
    const before = await snapshot();
    await expect(scoped(a, () => prisma.$transaction([prisma.lead.update({ where: { id: records.leads.other.id }, data: { firstName: 'Denied' } })])))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(scoped(a, () => prisma.$executeRaw`UPDATE "Lead" SET "firstName" = 'Denied' WHERE "id" = ${records.leads.other.id}`))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await snapshot()).toEqual(before);
  });
  it('current Edit revocation denies an assigned actor at both the HTTP and database boundaries', async () => {
    const id = records.leads.own.id;
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'leads' }, data: { canEdit: false } });
    try {
      expect((await call(`/leads/${id}`, a, 'PUT', { firstName: 'Permission bypass' })).status).toBe(403);
      await expect(scoped(a, () => prisma.lead.update({ where: { id }, data: { firstName: 'Permission bypass' } })))
        .rejects.toMatchObject({ statusCode: 403 });
    } finally { await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'leads' }, data: { canEdit: true } }); }
  });
  it('Archived Data retains tenant-wide rows but grants restore only for current direct assignment', async () => {
    const archived = await Promise.all([a, b].map((actor, index) => prisma.lead.create({ data: { tenantId, firstName: `Archived ${index}`,
      lastName: 'QA', email: `archive-${index}@example.test`, assignedUserId: actor.id, isArchived: true, deletedAt: new Date() } })));
    for (const sortBy of ['name', 'archivedAt']) {
      const result: any = await scoped(a, () => archivedList({ userId: a.id, tenantId, role: a.role }, ArchiveQuerySchema.parse({ type: 'Lead', sortBy })));
      expect(result.data.find((row: any) => row.id === archived[0].id)?.canRestore).toBe(true);
      expect(result.data.find((row: any) => row.id === archived[1].id)?.canRestore).toBe(false);
      expect(result.meta.total).toBe(2);
    }
  });
  it('closing an assigned Deal rolls back when its status cascade would edit another-agent Contact', async () => {
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Closing', lastName: 'QA', email: 'closing-cascade@example.test', assignedUserId: b.id } });
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Owned closing cascade', assignedUserId: a.id, pipelineId: pipeline.id,
      stageId: qualified.id, productInterestId: product.id, productsNormalized: true, value: 100 } });
    await prisma.contactDeal.create({ data: { tenantId, dealId: deal.id, contactId: contact.id } });
    const won = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Closed Deal', isWon: true, order: 3 } });
    // This workspace permits closing without mandatory evidence. Exercise the
    // real status cascade after closing validation, rather than failing it first.
    const definitions = await prisma.closingFieldDefinition.findMany({ where: { tenantId } });
    for (const field of definitions) await prisma.closingFieldDefinition.update({ where: { tenantId_id: { tenantId, id: field.id } },
      data: { definition: { ...(field.definition as Record<string, any>), required: false } } });
    try {
      const before = await snapshot();
      expect((await call(`/deals/${deal.id}/stage`, a, 'PATCH', { stageId: won.id })).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    } finally {
      for (const field of definitions) await prisma.closingFieldDefinition.update({ where: { tenantId_id: { tenantId, id: field.id } }, data: { definition: field.definition! } });
    }
  });
  it('an assigned Deal may become Lost without changing its other-agent Contact', async () => {
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Lost', lastName: 'QA', email: 'lost-reference@example.test', assignedUserId: b.id } });
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Owned Lost reference', assignedUserId: a.id, pipelineId: pipeline.id,
      stageId: stage.id, productInterestId: product.id, productsNormalized: true, value: 100 } });
    await prisma.contactDeal.create({ data: { tenantId, dealId: deal.id, contactId: contact.id } });
    expect((await call(`/deals/${deal.id}/stage`, a, 'PATCH', { stageId: lost.id, lostReason: 'Cascade QA' })).status).toBe(200);
    expect(await prisma.contact.findUnique({ where: { id: contact.id } })).toEqual(contact);
  });
  it('nested Lead junction writes cannot change another-agent Deal', async () => {
    const before = await snapshot();
    await expect(scoped(a, () => prisma.lead.update({ where: { id: records.leads.own.id }, data: {
      leadDeals: { create: { dealId: records.deals.other.id } },
    } }))).rejects.toMatchObject({ statusCode: 403 });
    expect(await snapshot()).toEqual(before);
  });
  it('nested connects cannot move another-agent Deal history onto an assigned Deal', async () => {
    const history = await prisma.dealStageHistory.create({ data: { tenantId, dealId: records.deals.other.id, newStageId: stage.id, movedById: b.id } });
    const before = await snapshot();
    await expect(scoped(a, () => prisma.deal.update({ where: { id: records.deals.own.id }, data: { stageHistories: { connect: { id: history.id } } } })))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await snapshot()).toEqual(before);
  });
  it('direct ORM creation cannot spoof another agent', async () => {
    const before = await snapshot();
    await expect(scoped(a, () => prisma.lead.create({ data: { tenantId, firstName: 'Spoof', lastName: 'QA', email: 'orm-spoof@example.test', assignedUserId: b.id } })))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await snapshot()).toEqual(before);
  });
  it('Prisma scalar archive syntax still requires Archive permission', async () => {
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'leads' }, data: { canArchive: false } });
    try {
      const before = await snapshot();
      await expect(scoped(a, () => prisma.lead.update({ where: { id: records.leads.own.id }, data: { isArchived: { set: true } } })))
        .rejects.toMatchObject({ statusCode: 403 });
      expect(await snapshot()).toEqual(before);
    } finally {
      await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'leads' }, data: { canArchive: true } });
    }
  });
  it.each(['leads'])('%s keeps server weighted tie-break assignment to another agent available', async module => {
    const agents = await eligibleAgents(prisma, tenantId, module === 'accounts' ? ['accounts'] : ['leads', 'deals']);
    // Exercise the existing round-robin tie-break with equal active workloads.
    await prisma.lead.updateMany({ where: { tenantId, assignedUserId: { in: agents.map(agent => agent.id) } }, data: { status: 'Cancelled' } });
    const targetIndex = agents.findIndex(agent => agent.id === b.id);
    const key = { tenantId, module: module === 'accounts' ? 'accounts-assignment' : 'lead-assignment', key: 'default' };
    const cursor = agents[(targetIndex + agents.length - 1) % agents.length].id;
    await prisma.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: cursor }, update: { value: cursor } });
    const payload = module === 'accounts' ? { name: 'Automatic assignment QA' } : {
      firstName: 'Automatic', lastName: 'QA', email: 'automatic-assignment@example.test', productInterest: [product.id],
    };
    const response = await call(`/${module}`, a, 'POST', payload);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data.assignedUserId).toBe(b.id);
    if (module === 'leads') {
      const generated = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: response.body.data.id } } } });
      expect(generated).toHaveLength(1);
      expect(generated[0].assignedUserId).toBe(b.id);
    }
    expect((await call(`/${module}/${response.body.data.id}`, a, 'PUT', module === 'accounts' ? { name: 'Denied' } : { firstName: 'Denied' })).status).toBe(403);
  });
  it('merging two assigned Leads rolls back if transferring a junction would edit another-agent Deal', async () => {
    const secondary = await prisma.lead.create({ data: { tenantId, firstName: 'Merge', lastName: 'QA', email: 'merge-cascade@example.test', assignedUserId: a.id } });
    await prisma.leadDeal.create({ data: { tenantId, leadId: secondary.id, dealId: records.deals.other.id } });
    const before = await snapshot();
    expect((await call('/merge', a, 'POST', { entityType: 'lead', primaryId: records.leads.own.id, secondaryId: secondary.id, fieldResolutions: {} })).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s permits own edit, denies missing Edit and own reassignment, isolates foreign IDs', async module => {
    const id = records[module].own.id;
    const patch = module === 'accounts' ? { name: 'Allowed' } : module === 'deals' ? { title: 'Allowed' } : { firstName: 'Allowed' };
    expect((await call(`/${module}/${id}`, a, 'PUT', patch)).status).toBe(200);
    expect((await call(`/${module}/${id}`, viewer, 'PUT', patch)).status).toBe(403);
    expect((await call(`/${module}/${id}`, a, 'PUT', { assignedUserId: b.id })).status).toBe(403);
    expect((await call(`/${module}/${records[module].foreign.id}`)).status).toBe(404);
    expect((await call(`/${module}/${records[module].foreign.id}`, a, 'PUT', patch)).status).toBe(404);
  });
  it('Kanban includes other agents; stage, pipeline, closing, conversion, reorder and mixed bulk writes are denied', async () => {
    const grouped = await call(`/deals?groupByStage=true&pipelineId=${pipeline.id}`);
    expect(grouped.status).toBe(200); expect(JSON.stringify(grouped.body)).toContain(records.deals.other.id);
    const before = await snapshot();
    const id = records.deals.other.id;
    for (const [path, method, body] of [
      [`/deals/${id}/stage`, 'PATCH', { stageId: qualified.id }], [`/deals/${id}/stage`, 'PATCH', { stageId: lost.id, lostReason: 'Denied' }],
      [`/deals/${id}/pipeline`, 'PATCH', { pipelineId: pipeline.id, stageId: stage.id }], [`/deals/${id}/closing-requirements`, 'PATCH', { values: { 'sales-contract': 'Denied' } }],
      [`/leads/${records.leads.other.id}/convert`, 'POST', {}],
      [`/pipelines/${pipeline.id}/deals/reorder`, 'PATCH', { dealIds: [records.deals.own.id, id] }],
      ['/deals/bulk/stage', 'POST', { dealIds: [records.deals.own.id, id], stageId: qualified.id }],
      ['/deals/bulk/archive', 'POST', { dealIds: [records.deals.own.id, id] }],
      ['/deals/bulk/reassign', 'POST', { dealIds: [records.deals.own.id], assignedUserId: b.id }],
    ] as const) expect((await call(path, a, method, body)).status, path).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it('a Sales membership remains restrictive under multiple ordinary roles; an admin-named grant does not promote the user', async () => {
    const sales = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales Representative' } });
    await prisma.userRole.create({ data: { tenantId, userId: ordinary.id, roleId: sales.id } });
    await prisma.userRole.create({ data: { tenantId, userId: ordinary.id, roleId: admin.roleId } });
    const policy = (await call('/record-access', ordinary)).body.data;
    expect(policy).toMatchObject({ assignmentRestricted: true, clientAdmin: false });
    expect((await call(`/leads/${records.leads.other.id}`, ordinary, 'PUT', { firstName: 'Denied' })).status).toBe(403);
  });
  it('Sales role renames retain the server-managed assignment restriction', async () => {
    await updateRoleAndPermissions(viewer.roleId, tenantId, { name: 'Regional Representative' });
    expect((await call('/record-access', viewer)).body.data).toMatchObject({ assignmentRestricted: true, clientAdmin: false });
    expect((await prisma.roleDefinition.findUniqueOrThrow({ where: { id: viewer.roleId } })).crmAssignmentRestricted).toBe(true);
  });
  it.each(['leads', 'contacts'])('%s merge authorizes both records and rolls back denied combinations', async module => {
    const before = await snapshot();
    expect((await call('/merge', a, 'POST', { entityType: module.slice(0, -1), primaryId: records[module].own.id,
      secondaryId: records[module].other.id, fieldResolutions: {} })).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it.each(['leads', 'contacts'] as const)('%s merge accepts only current owner grants for that module without requiring unrelated modules', async module => {
    const roles = await Promise.all(['canView', 'canEdit'].map(flag => prisma.roleDefinition.create({ data: { tenantId,
      name: `Merge ${module} ${flag} ${randomUUID()}`, permissions: { create: { module, [flag]: true } },
    } })));
    const assignee = await prisma.user.create({ data: { tenantId, email: `${randomUUID()}@example.test`, firstName: 'Module', lastName: 'Owner', role: roles[0].name,
      userRoles: { create: roles.map(role => ({ roleId: role.id })) } } });
    const model = db[delegates[module]];
    const identity = module === 'accounts' ? { name: 'Module merge' } : { firstName: 'Module', lastName: 'Merge' };
    const primary = await model.create({ data: { tenantId, ...identity, assignedUserId: a.id } });
    const secondary = await model.create({ data: { tenantId, ...identity, assignedUserId: assignee.id } });
    const input = { entityType: module.slice(0, -1), primaryId: primary.id, secondaryId: secondary.id, fieldResolutions: { assignedUserId: 'secondary' } };
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: roles[1].id, module }, data: { canEdit: false } });
    const before = await snapshot();
    const denied = await call('/merge', admin, 'POST', input);
    expect(denied.status, JSON.stringify(denied.body)).toBe(400);
    expect(await snapshot()).toEqual(before);
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: roles[1].id, module }, data: { canEdit: true } });
    const allowed = await call('/merge', admin, 'POST', input);
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    expect(await model.findUniqueOrThrow({ where: { id: primary.id } })).toMatchObject({ assignedUserId: assignee.id, isArchived: false });
    expect(await model.findUniqueOrThrow({ where: { id: secondary.id } })).toMatchObject({ assignedUserId: assignee.id, isArchived: true });
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s custom-field and note writes require current assignment', async module => {
    const fieldId = `qa-${module}-text`;
    await prisma.closingFieldDefinition.create({ data: { tenantId, id: fieldId, definition: { id: fieldId, module, name: 'QA Text', type: 'Text',
      group: 'Basic Information', groupId: `${module}:section:0`, active: true, required: false, visibleInForm: true, visibleInDetails: true,
      options: [], order: 100, version: 1, description: '' } } });
    const other = records[module].other.id, own = records[module].own.id;
    const denied = await call(`/${module}/${other}`, a, 'PUT', { customFieldValues: { [fieldId]: 'Forbidden' } });
    expect(denied.status).toBe(403);
    expect(await prisma.customFieldValue.count({ where: { tenantId, fieldId } })).toBe(0);
    expect((await call(`/${module}/${own}`, a, 'PUT', { customFieldValues: { [fieldId]: 'Allowed' } })).status).toBe(200);
    const link = { [`${module === 'accounts' ? 'account' : module.slice(0, -1)}Id`]: other };
    const before = await prisma.activity.count({ where: { tenantId } });
    expect((await call('/activities', a, 'POST', { type: 'note', title: 'Denied note', ...link })).status).toBe(403);
    expect(await prisma.activity.count({ where: { tenantId } })).toBe(before);
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s archive and restore retain ownership and operation permission checks', async module => {
    const id = records[module].own.id;
    expect((await call(`/${module}/${id}/archive`, a, 'PATCH')).status).toBe(200);
    expect((await call(`/${module}/${id}/restore`, b, 'PATCH')).status).toBe(403);
    expect((await call(`/${module}/${id}/restore`, viewer, 'PATCH')).status).toBe(403);
    expect((await call(`/${module}/${id}/restore`, a, 'PATCH')).status).toBe(200);
  });
  it.each(Object.keys(delegates).filter(module => module !== 'accounts'))('%s admin reassignment immediately rejects the old agent and permits the new agent', async module => {
    const id = records[module].own.id;
    expect((await call(`/${module}/${id}`, admin, 'PUT', { assignedUserId: b.id })).status).toBe(200);
    const patch = module === 'accounts' ? { name: 'New agent' } : module === 'deals' ? { title: 'New agent' } : { firstName: 'New agent' };
    expect((await call(`/${module}/${id}`, a, 'PUT', patch)).status).toBe(403);
    expect((await call(`/${module}/${id}`)).status).toBe(200);
    expect((await call(`/${module}/${id}`, b, 'PUT', patch)).status).toBe(200);
  });
  it('locks assignment through commit and denies the stale agent after a concurrent admin reassignment', async () => {
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Concurrent', lastName: 'QA', email: 'concurrent@example.test', assignedUserId: a.id } });
    let locked!: () => void, release!: () => void;
    const hasLock = new Promise<void>(done => { locked = done; });
    const gate = new Promise<void>(done => { release = done; });
    const assigning = scoped(admin, () => prisma.$transaction(async tx => {
      await tx.lead.update({ where: { id: lead.id, tenantId }, data: { assignedUserId: b.id } }); locked(); await gate;
    }));
    await Promise.race([hasLock, assigning.then(() => { throw new Error('Reassignment finished without the test lock'); })]);
    const stale = call(`/leads/${lead.id}`, a, 'PUT', { firstName: 'Stale update' });
    // A different native connection waits behind the administration transaction.
    await new Promise(done => setTimeout(done, 100)); release(); await assigning;
    expect((await stale).status).toBe(403);
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toMatchObject({ firstName: 'Concurrent', assignedUserId: b.id });
  });
  it('Accounts use module grants for create/edit/archive while rejecting retired fields and foreign records', async () => {
    const created = await call('/accounts', a, 'POST', { name: 'Shared Account QA' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    for (const field of ['assignedUserId', 'assignedUser', 'productInterests', 'activeProducts']) expect(created.body.data).not.toHaveProperty(field);
    expect((await call('/accounts', viewer, 'POST', { name: 'Denied' })).status).toBe(403);
    expect((await call('/accounts?limit=100', b)).body.data.some((row: any) => row.id === id)).toBe(true);
    expect((await call('/accounts/' + id, b, 'PUT', { name: 'Shared Account edited', customFieldValues: {} })).status).toBe(200);
    expect((await call('/accounts/' + id, viewer, 'PUT', { name: 'Denied' })).status).toBe(403);
    for (const field of ['assignedUserId', 'productInterests', 'activeProducts', 'productInterestIds', 'activeProductIds']) expect((await call('/accounts/' + id, b, 'PUT', { [field]: field === 'assignedUserId' ? a.id : [] })).status).toBe(400);
    expect((await call('/accounts?filter[scope]=equals:my', a)).status).toBe(400);
    expect((await call('/accounts/' + records.accounts.foreign.id, b, 'PUT', { name: 'Foreign' })).status).toBe(404);
    expect((await call('/accounts/' + id + '/archive', viewer, 'PATCH')).status).toBe(403);
    expect((await call('/accounts/' + id + '/archive', b, 'PATCH')).status).toBe(200);
  });
  it('recognizes configured template and legacy Sales identifiers, without classifying unrelated roles', async () => {
    for (const name of ['Sales', 'Sales Rep', 'Sales Agent', 'Sales Staff', 'Sales Representative', 'Sales Manager', 'sales-representative']) expect(isSalesRoleName(name)).toBe(true);
    for (const name of ['User', 'Operations', 'Viewer', 'Client Admin', 'Presales Support']) expect(isSalesRoleName(name)).toBe(false);
    expect((await resolveCrmActor(prisma, { tenantId, userId: a.id })).assignmentRestricted).toBe(true);
  });

  it.each(['leads', 'contacts'] as const)('%s manual status writes use role grants and persist canonical values without moving Deals', async module => {
    const model = db[delegates[module]];
    const histories = await prisma.dealStageHistory.count({ where: { tenantId } });
    for (const actor of [admin, b, ordinary]) {
      const customer = await model.create({ data: { tenantId, firstName: 'Status', lastName: randomUUID(), assignedUserId: actor.id } });
      for (const status of ['Hot', 'Warm', 'Cold', 'Inquiry', 'Cancelled', 'Inquiry']) {
        const result = await call(`/${module}/${customer.id}`, actor, 'PUT', { status });
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        expect(result.body.data.status).toBe(status);
        const persisted = await model.findUniqueOrThrow({ where: { id: customer.id } });
        expect(persisted.status).toBe(module === 'contacts' ? status.toUpperCase() : status);
        expect(persisted.manualCancellation).toBe(status === 'Cancelled');
      }
      const before = await model.findUniqueOrThrow({ where: { id: customer.id } });
      expect((await call(`/${module}/${customer.id}`, viewer, 'PUT', { status: 'Hot' })).status).toBe(403);
      expect((await call(`/${module}/${customer.id}`, actor, 'PUT', { status: 'Unsupported' })).status).toBe(400);
      expect((await call(`/${module}/${customer.id}`, actor, 'PUT', { status: 'Closed Deal' })).status).toBe(400);
      expect(await model.findUniqueOrThrow({ where: { id: customer.id } })).toEqual(before);
    }
    expect(await prisma.dealStageHistory.count({ where: { tenantId } })).toBe(histories);
    expect((await call(`/${module}/${records[module].foreign.id}`, ordinary, 'PUT', { status: 'Hot' })).status).toBe(404);
  });

  it('rejects direct writes to calculated Deal engagement even for Client Admin', async () => {
    const id = records.deals.own.id;
    const before = await prisma.deal.findUniqueOrThrow({ where: { id } });
    expect((await call(`/deals/${id}`, admin, 'PUT', { engagementStatus: 'Hot' })).status).toBe(400);
    expect(await prisma.deal.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });
  it('evaluates membership CRM roles per owning Group and preserves manual status through unrelated saves', async () => {
    const staff = await person('ScopedStaff', false, 'Scoped CRM Staff');
    await prisma.rolePermission.updateMany({ where: { roleId: staff.roleId }, data: { canView: false, canViewAll: false, canViewMy: false, canViewActive: false } });
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Scoped CRM editor', permissions: { create:
      Object.keys(delegates).map(module => ({ module, ...EMPTY_PERMISSION_FLAGS, canView: true, canViewAll: true, canEdit: true, canCreate: true })) } } });
    const groups = await Promise.all([1, 2, 3].map(number => prisma.tenantGroup.create({ data: { tenantId, name: 'Scoped Group ' + number } })));
    for (const [index, group] of groups.entries()) await prisma.tenantGroupMember.create({ data: { tenantId, groupId: group.id, userId: staff.id, isHead: index < 2, crmRoleId: index < 2 ? role.id : null } });
    const customers = await Promise.all(groups.map((group, index) => prisma.contact.create({ data: { tenantId, ownerGroupId: group.id,
      firstName: 'Group customer', lastName: String(index), email: randomUUID() + '@example.test', assignedUserId: b.id } })));
    const hiddenAccount = await prisma.account.create({ data: { tenantId, ownerGroupId: groups[2].id, name: 'Private Group Account' } });
    await prisma.contact.update({ where: { id: customers[0].id }, data: { accountId: hiddenAccount.id, companyName: hiddenAccount.name, companyFromAccount: true } });
    const deal = await prisma.deal.create({ data: { tenantId, ownerGroupId: groups[0].id, title: 'Scoped opportunity', assignedUserId: b.id,
      pipelineId: pipeline.id, stageId: stage.id, contactDeals: { create: { contactId: customers[0].id } } } });
    for (const customer of customers.slice(0, 2)) expect((await call('/contacts/' + customer.id, staff)).status).toBe(200);
    expect((await call('/contacts/' + customers[0].id, staff)).body.data).toMatchObject({ account: null, companyName: null });
    expect((await call('/contacts/' + customers[1].id, staff, 'PUT', { accountId: hiddenAccount.id })).status).toBe(400);
    expect((await call('/contacts/' + customers[2].id, staff)).status).toBe(404);
    const list = await call('/contacts?limit=100', staff);
    expect(list.status).toBe(200); expect(list.body.data.map((row: any) => row.id)).toEqual(expect.arrayContaining(customers.slice(0, 2).map(row => row.id)));
    expect(list.body.data.some((row: any) => row.id === customers[2].id || row.id === records.contacts.unassigned.id)).toBe(false);
    const currentVersion = (await prisma.contact.findUniqueOrThrow({ where: { id: customers[0].id } })).updatedAt.toISOString();
    const saved = await call('/contacts/' + customers[0].id, staff, 'PUT', { status: 'Hot', expectedUpdatedAt: currentVersion });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200); expect(saved.body.data.status).toBe('Hot');
    expect(saved.body.data).toMatchObject({ account: null, companyName: null });
    expect(saved.body.data).not.toHaveProperty('manualStatusContext');
    const dealProjection = (await call('/deals/' + deal.id, staff)).body.data;
    expect(dealProjection.contact.companyName).toBeNull();
    expect(dealProjection.contact).not.toHaveProperty('manualStatusContext');
    expect(dealProjection.contactDeals[0].contact).not.toHaveProperty('manualStatusContext');
    expect((await call('/contacts/' + customers[0].id, staff, 'PUT', { notes: 'Unrelated edit' })).body.data.status).toBe('Hot');
    expect((await call('/contacts/' + customers[0].id, staff, 'PUT', { status: 'Cold', expectedUpdatedAt: customers[0].updatedAt.toISOString() })).status).toBe(409);
    const history = await prisma.activity.findMany({ where: { tenantId, contactId: customers[0].id, type: 'stage_change' } });
    expect(history).toHaveLength(1); expect(history[0].metadata).toMatchObject({ previousStatus: 'Inquiry', newStatus: 'Hot', source: 'manual' });
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId).toBe(stage.id);
    expect((await call('/contacts/' + customers[2].id, staff, 'PUT', { status: 'Warm' })).status).toBe(404);
    expect((await call('/contacts/' + customers[0].id, staff, 'PUT', { ownerGroupId: groups[2].id })).status).toBe(400);
    expect((await call('/contacts/' + customers[0].id, staff, 'PUT', { status: 'Closed Deal' })).status).toBe(400);
    await prisma.tenantGroupMember.create({ data: { tenantId, groupId: groups[2].id, userId: admin.id, isHead: true } });
    expect((await call('/contacts/' + records.contacts.unassigned.id, admin, 'PUT', { status: 'Warm' })).status).toBe(200);
    const foreignGroup = await prisma.tenantGroup.create({ data: { tenantId: foreignTenant, name: 'Foreign ownership' } });
    expect((await call('/contacts/' + customers[0].id, admin, 'PUT', { ownerGroupId: foreignGroup.id })).status).toBe(400);
    const creates = [
      ['leads', { firstName: 'Scoped create', lastName: 'Lead', email: randomUUID() + '@example.test', assignedUserId: b.id, productInterest: [] }],
      ['contacts', { firstName: 'Scoped create', lastName: 'Contact', email: randomUUID() + '@example.test', assignedUserId: b.id, requestId: randomUUID() }],
      ['accounts', { name: 'Scoped create Account' }],
      ['deals', { title: 'Scoped create Deal', pipelineId: pipeline.id, stageId: stage.id, productInterestId: product.id, contactIds: [customers[1].id] }],
    ] as const;
    for (const [module, input] of creates) {
      expect((await call('/' + module, staff, 'POST', { ...input, ownerGroupId: groups[1].id })).status).toBe(400);
      // Group-only grants must not become workspace-wide create grants.
      expect((await call('/' + module, staff, 'POST', input)).status).toBe(403);
      const created = await call('/' + module, admin, 'POST', input);
      expect(created.status, module + ': ' + JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id;
      expect(created.body.data.ownerGroupId).toBeNull();
      const patch = module === 'accounts' ? { name: 'Edited Account' } : module === 'deals' ? { title: 'Edited Deal' } : { firstName: 'Edited customer' };
      expect((await call('/' + module + '/' + id, admin, 'PUT', patch)).status).toBe(200);
      expect((await call('/' + module + '/' + id, admin)).body.data).toMatchObject({ ...patch, ownerGroupId: null });
      expect((await call('/' + module + '/' + id, staff)).status).toBe(404);
      for (const ownerGroupId of [groups[0].id, foreignGroup.id, null]) {
        expect((await call('/' + module, admin, 'POST', { ...input, ownerGroupId })).status).toBe(400);
        expect((await call('/' + module + '/' + id, admin, 'PUT', { ownerGroupId })).status).toBe(400);
      }
      const historical = await db[delegates[module]].create({ data: { tenantId, ownerGroupId: groups[0].id,
        ...(module === 'accounts' ? { name: 'Historical Account' } : module === 'deals'
          ? { title: 'Historical Deal', pipelineId: pipeline.id, stageId: stage.id, assignedUserId: b.id }
          : { firstName: 'Historical', lastName: 'Customer', email: randomUUID() + '@example.test', assignedUserId: b.id }) } });
      expect((await call('/' + module + '/' + historical.id, staff, 'PUT', patch)).status).toBe(200);
      expect((await call('/' + module + '/' + historical.id, staff)).body.data).toMatchObject({ ...patch, ownerGroupId: groups[0].id });
      expect((await db[delegates[module]].findUniqueOrThrow({ where: { id: historical.id } })).ownerGroupId).toBe(groups[0].id);
    }
    const linked = await call('/contacts/' + customers[1].id, admin, 'PUT', { newAccount: { name: 'Historical scoped Account', requestId: randomUUID() } });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data.ownerGroupId).toBe(groups[1].id);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: linked.body.data.accountId } })).toMatchObject({ ownerGroupId: groups[1].id });
    await prisma.tenantGroupMember.deleteMany({ where: { tenantId, groupId: groups[0].id, userId: staff.id } });
    expect((await call('/contacts/' + customers[0].id, staff)).status).toBe(404);
    expect((await call('/contacts/' + customers[1].id, staff, 'PUT', { status: 'Cold' })).status).toBe(200);
  }, 60000);

});
