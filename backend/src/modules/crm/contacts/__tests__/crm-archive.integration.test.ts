import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { replayCrmMigrations } from '../../../../tests/replay-crm-migrations';

// Always use an isolated in-memory PostgreSQL database, never DATABASE_URL.
vi.mock('../../../../config/database.config', async () => {
  const { installTenantScoping } = await import('../../../../core/tenant/tenant-prisma');
  const { installProductProjections } = await import('../../../../core/tenant/product-projections');
  const client = new PrismaClient({ datasources: { db: { url: process.env.CRM_ARCHIVE_TEST_DATABASE_URL! } } });
  installProductProjections(client); installTenantScoping(client);
  return { default: client };
});

let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, server: Server, storageServer: Server;
const storedObjects = new Map<string, Buffer>();
let base: string, tenantId: string, otherTenantId: string, adminCookie: string, viewerCookie: string;
const legacyId = randomUUID();
const modules = ['leads', 'contacts', 'accounts'] as const;
type Module = typeof modules[number];
const delegate = (module: Module) => module === 'leads' ? db.lead : module === 'contacts' ? db.contact : db.account;

async function call(path: string, method = 'GET', cookie = adminCookie, body?: unknown) {
  const response = await fetch(`${base}/crm/${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function create(module: Module, tenant = tenantId) {
  if (module === 'leads') return db.lead.create({ data: { tenantId: tenant, firstName: 'Archived', lastName: 'Lead', status: 'Qualified', productInterest: [] } });
  if (module === 'contacts') return db.contact.create({ data: { tenantId: tenant, firstName: 'Archived', lastName: 'Contact', status: 'HOT', activeProducts: [], productInterests: [] } });
  return db.account.create({ data: { tenantId: tenant, name: 'Archived Account', tags: [], productInterests: [], activeProducts: [] } });
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-crm-archive-test-signing-key';
  pg = await PGlite.create();
  const archiveMigration = '20261009000000_lead_archive_state';
  await replayCrmMigrations(pg, archiveMigration);
  await pg.exec(`INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('legacy-tenant','Legacy','legacy',NOW());
    INSERT INTO "Lead" (id,"tenantId","firstName","lastName",status,environment,"updatedAt") VALUES ('${legacyId}','legacy-tenant','Legacy','Archive','Archived','PRODUCTION',NOW());`);
  await replayCrmMigrations(pg, undefined, archiveMigration);
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 });
  await socket.start();
  process.env.CRM_ARCHIVE_TEST_DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  db = (await import('../../../../config/database.config')).default;
  storageServer = createServer((req, res) => {
    const parts = new URL(req.url!, 'http://storage.test').pathname.split('/').filter(Boolean);
    const bucketIndex = parts.indexOf('crm-record-files-test');
    const key = parts.slice(bucketIndex + 1).map(decodeURIComponent).join('/').replace(/^authenticated\//, '');
    if (req.method === 'POST') { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(Buffer.from(chunk))); req.on('end', () => { storedObjects.set(key, Buffer.concat(chunks)); res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); }); return; }
    const bytes = storedObjects.get(key); if (!bytes) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(bytes);
  });
  await new Promise<void>(resolve => storageServer.listen(0, '127.0.0.1', resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(storageServer.address() as { port: number }).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-only';
  process.env.SUPABASE_RECORD_FILES_BUCKET = 'crm-record-files-test';
  const tenant = await db.tenant.create({ data: { name: 'Archive test', slug: 'archive-test', status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  tenantId = tenant.id;
  otherTenantId = (await db.tenant.create({ data: { name: 'Other tenant', slug: 'other-archive-test' } })).id;
  const admin = await db.user.create({ data: { tenantId, email: 'archive@camxian.com', firstName: 'Archive', lastName: 'Admin', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const viewer = await db.user.create({ data: { tenantId, email: 'viewer@camxian.com', firstName: 'Read', lastName: 'Only', role: 'Archive Viewer', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const role = await db.roleDefinition.create({ data: { tenantId, name: 'Archive Viewer', permissions: { create: ['leads', 'contacts', 'archived_data'].map(module => ({ module, canView: true, canEdit: false, canDelete: false })) } } });
  await db.userRole.create({ data: { tenantId, userId: viewer.id, roleId: role.id } });
  const { issueAuthSession } = await import('../../../../core/auth/auth-session');
  adminCookie = `leadcrm_token=${(await issueAuthSession(admin)).token}`;
  viewerCookie = `leadcrm_token=${(await issueAuthSession(viewer)).token}`;
  server = (await import('../../../../app')).default.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
}, 60_000);
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (storageServer) await new Promise<void>(resolve => storageServer.close(() => resolve()));
  await db?.$disconnect(); await socket?.stop(); await pg?.close();
});

describe.sequential('CRM archive and restore through authenticated HTTP and PostgreSQL', () => {
  it('migrates legacy archived leads without deleting or changing their status', async () => {
    expect(await db.lead.findUniqueOrThrow({ where: { id: legacyId } })).toMatchObject({ status: 'Archived', isArchived: true });
    const { restoreContact } = await import('../contacts.repository');
    await restoreContact(legacyId, 'legacy-tenant');
    expect(await db.lead.findUniqueOrThrow({ where: { id: legacyId } })).toMatchObject({ status: 'Warm', isArchived: false });
  });
  it.each(modules)('%s persists archive, excludes active lists/counts, and restores without deleting relationships', async module => {
    const row = await create(module);
    const before = await call(module);
    const response = await call(`${module}/${row.id}/archive`, 'PATCH');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const archived = await (delegate(module) as any).findUniqueOrThrow({ where: { id: row.id } });
    expect(archived.isArchived).toBe(true);
    expect(archived.deletedAt).toBeInstanceOf(Date);
    if ('status' in row) expect(archived.status).toBe(row.status);
    expect((await call(`${module}/${row.id}/archive`, 'PATCH')).status).toBe(404);
    const active = await call(module);
    expect(active.body.data.some((item: any) => item.id === row.id)).toBe(false);
    expect(active.body.meta.total).toBe(before.body.meta.total - 1);
    expect((await call(`${module}?archived=true`)).body.data.some((item: any) => item.id === row.id)).toBe(true);
    // A fresh authenticated read observes persisted state, not frontend memory.
    expect((await call(`${module}/${row.id}/restore`, 'PATCH')).status).toBe(200);
    const restored = await (delegate(module) as any).findUniqueOrThrow({ where: { id: row.id } });
    expect(restored).toMatchObject({ isArchived: false, deletedAt: null, deletedBy: null });
    if ('status' in row) expect(restored.status).toBe(row.status);
    expect((await call(module)).body.data.some((item: any) => item.id === row.id)).toBe(true);
    expect((await call(`${module}?archived=true`)).body.data.some((item: any) => item.id === row.id)).toBe(false);
    expect((await call(`${module}/${row.id}/restore`, 'PATCH')).status).toBe(404);
    expect(await db.auditLog.count({ where: { entityId: row.id } })).toBe(2);
  });
  it.each(modules)('%s rejects cross-tenant archive and restore', async module => {
    for (const row of [await create(module, otherTenantId)]) {
      expect((await call(`${module}/${row.id}/archive`, 'PATCH')).status).toBe(404);
      await (delegate(module) as any).update({ where: { id: row.id }, data: { isArchived: true } });
      expect((await call(`${module}/${row.id}/restore`, 'PATCH')).status).toBe(404);
      expect(await (delegate(module) as any).findUniqueOrThrow({ where: { id: row.id } })).toHaveProperty('isArchived', true);
      expect((await call(`${module}?archived=true`)).body.data.some((item: any) => item.id === row.id)).toBe(false);
    }
  });
  it.each(modules)('%s requires authentication, permissions, valid IDs and existing records', async module => {
    const row = await create(module);
    for (const action of ['archive', 'restore']) {
      expect((await call(`${module}/${row.id}/${action}`, 'PATCH', '')).status).toBe(401);
      expect((await call(`${module}/${row.id}/${action}`, 'PATCH', viewerCookie)).status).toBe(403);
      expect((await call(`${module}/invalid/${action}`, 'PATCH')).status).toBe(400);
      expect((await call(`${module}/${randomUUID()}/${action}`, 'PATCH')).status).toBe(404);
    }
    expect(await (delegate(module) as any).findUniqueOrThrow({ where: { id: row.id } })).toHaveProperty('isArchived', false);
  });
  it('accepts only the supported Lead statuses and persists edits through the authenticated API', async () => {
    const lead = await create('leads');
    expect((await call(`leads/${lead.id}`, 'PUT', adminCookie, { status: 'Inquiry' })).status).toBe(400);
    expect((await call(`leads/${lead.id}`, 'PUT', adminCookie, { description: 'Retired' })).status).toBe(400);
    expect((await call(`leads/${lead.id}`, 'PUT', adminCookie, { status: 'Hot', address: 'Follow up address' })).status).toBe(200);
    expect(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: 'Hot', address: 'Follow up address' });
  });
  it.each(['leads', 'contacts', 'accounts'] as const)('%s uploads private file bytes, lists saved history and downloads after a separate request', async module => {
    const row = await create(module);
    const bytes = Buffer.from('%PDF-1.7\nSaved attachment');
    const path = `${module}/${row.id}/files?name=agreement.pdf&type=application/pdf`;
    const response = await fetch(`${base}/crm/${path}`, { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
    expect(response.status).toBe(201);
    const uploaded = (await response.json()).data;
    expect(uploaded).toMatchObject({ name: 'agreement.pdf', size: bytes.length, type: 'application/pdf', uploadedBy: 'Archive Admin' });
    expect((await (delegate(module) as any).findUniqueOrThrow({ where: { id: row.id } })).recordFiles).toBeUndefined();
    const list = await fetch(`${base}/crm/${module}/${row.id}/files`, { headers: { Cookie: adminCookie } });
    expect((await list.json()).data[0]).toMatchObject({ id: uploaded.id, name: 'agreement.pdf' });
    const persisted = await db.recordFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(persisted).toMatchObject({ name: 'agreement.pdf', [module === 'leads' ? 'leadId' : module === 'contacts' ? 'contactId' : 'accountId']: row.id });
    const download = await fetch(`${base}/crm/${module}/${row.id}/files/${uploaded.id}/download`, { headers: { Cookie: adminCookie } });
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect(download.headers.get('content-disposition')).toContain('agreement.pdf');
    const viewerDownload = await fetch(`${base}/crm/${module}/${row.id}/files/${uploaded.id}/download`, { headers: { Cookie: viewerCookie } });
    if (module === 'accounts') expect(viewerDownload.status).toBe(403);
    else {
      expect(viewerDownload.status).toBe(200);
      expect(Buffer.from(await viewerDownload.arrayBuffer())).toEqual(bytes);
    }
    expect((await fetch(`${base}/crm/${module}/${row.id}/files/${uploaded.id}/download`)).status).toBe(401);
  });
  it('does not allow a status filter to expose archived leads', async () => {
    const row = await create('leads');
    await call(`leads/${row.id}/archive`, 'PATCH');
    expect((await call('leads?filter[status]=in:Qualified')).body.data.some((item: any) => item.id === row.id)).toBe(false);
  });
  it('preserves account links and related records throughout archive and restore', async () => {
    const account = await create('accounts');
    const lead = await create('leads');
    const contact = await create('contacts');
    await db.lead.update({ where: { id: lead.id }, data: { accountId: account.id, contactId: contact.id } });
    await db.contact.update({ where: { id: contact.id }, data: { accountId: account.id } });
    for (const action of ['archive', 'restore']) {
      for (const [module, id] of [['accounts', account.id], ['contacts', contact.id], ['leads', lead.id]]) {
        expect((await call(`${module}/${id}/${action}`, 'PATCH')).status).toBe(200);
      }
      expect(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ accountId: account.id, contactId: contact.id });
      expect(await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).toHaveProperty('accountId', account.id);
      expect(await db.account.findUnique({ where: { id: account.id } })).not.toBeNull();
    }
  });
});

async function archiveRequest(path = '', method = 'GET', cookie = adminCookie) {
  const response = await fetch(`${base}/administration/archived-data${path}`, { method, headers: { Cookie: cookie } });
  return { status: response.status, body: await response.json() };
}

describe.sequential('Settings archived-data aggregation and missing restore routes', () => {
  it('restores deals through the existing endpoint while preserving stage, value and relationships', async () => {
    const pipeline = await db.pipeline.create({ data: { tenantId, name: 'Deal recovery pipeline' } });
    const stage = await db.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Qualified', order: 1 } });
    const lead = await create('leads');
    const deal = await db.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, leadDeals: { create: { leadId: lead.id, position: 0 } }, title: 'Recover deal', value: 1200, currency: 'PHP', isArchived: true } });
    const listed = await archiveRequest('?type=Deal');
    expect(listed.body.data.find((row: any) => row.id === deal.id)).toMatchObject({ name: deal.title, detail: 'PHP 1200', archivedAt: null });
    expect((await call('deals/invalid/restore', 'PATCH')).status).toBe(400);
    expect((await call(`deals/${deal.id}/restore`, 'PATCH', viewerCookie)).status).toBe(403);
    expect((await call(`deals/${deal.id}/restore`, 'PATCH')).status).toBe(200);
    expect(await db.deal.findUniqueOrThrow({ where: { id: deal.id }, include: { leadDeals: true } })).toMatchObject({ isArchived: false, stageId: stage.id, pipelineId: pipeline.id, leadDeals: [expect.objectContaining({ leadId: lead.id })], value: 1200 });
    expect((await archiveRequest('?type=Deal')).body.data.some((row: any) => row.id === deal.id)).toBe(false);
    expect((await call(`deals/${deal.id}/restore`, 'PATCH')).status).toBe(400);
  });
  it('paginates real archive identities and timestamps, excludes other tenants and validates queries', async () => {
    const lead = await create('leads');
    await call(`leads/${lead.id}/archive`, 'PATCH');
    const first = await archiveRequest('?type=Lead&limit=1&page=1');
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    const ids: string[] = [];
    for (let page = 1; page <= first.body.meta.total; page++) {
      const response = await archiveRequest(`?type=Lead&limit=1&page=${page}`);
      ids.push(...response.body.data.map((row: any) => row.id));
      expect(response.body.data.every((row: any) => row.type === 'Lead' && row.archivedAt && row.canRestore)).toBe(true);
    }
    expect(ids).toContain(lead.id);
    expect(new Set(ids).size).toBe(ids.length);
    const scopedCount = await db.lead.count({ where: { tenantId, isArchived: true } });
    expect(first.body.meta.total).toBe(scopedCount);
    for (const query of ['?type=unknown', '?type=__proto__', '?page=0', '?limit=51', '?tenantId=other']) {
      expect((await archiveRequest(query)).status).toBe(400);
    }
    expect((await archiveRequest('', 'GET', '')).status).toBe(401);
    const viewer = await archiveRequest('', 'GET', viewerCookie);
    expect(viewer.status).toBe(200);
    expect(viewer.body.data.every((row: any) => ['Lead', 'Contact'].includes(row.type) && !row.canRestore)).toBe(true);
    expect((await archiveRequest('?type=Workflow', 'GET', viewerCookie)).status).toBe(403);
  });

  const extraTypes = ['Pipeline', 'Workflow', 'Campaign', 'Template', 'Role'] as const;
  async function createExtra(type: typeof extraTypes[number], tenant = tenantId) {
    const data = { tenantId: tenant, name: 'Archive ' + randomUUID(), isArchived: true };
    switch (type) {
      case 'Pipeline': return db.pipeline.create({ data });
      case 'Workflow': return db.workflow.create({ data: { ...data, trigger: 'deal.created', actions: [], isActive: false, status: 'PAUSED' } });
      case 'Campaign': return db.campaign.create({ data: { ...data, type: 'EMAIL', status: 'SENT', sentCount: 7 } });
      case 'Template': return db.template.create({ data: { ...data, type: 'Email', content: 'Preserved content' } });
      case 'Role': return db.roleDefinition.create({ data: { tenantId: tenant, name: data.name, isArchived: true, permissions: { create: { module: 'contacts', canView: true } } } });
    }
  }
  async function readExtra(type: typeof extraTypes[number], id: string) {
    switch (type) {
      case 'Pipeline': return db.pipeline.findUniqueOrThrow({ where: { id } });
      case 'Workflow': return db.workflow.findUniqueOrThrow({ where: { id } });
      case 'Campaign': return db.campaign.findUniqueOrThrow({ where: { id } });
      case 'Template': return db.template.findUniqueOrThrow({ where: { id } });
      case 'Role': return db.roleDefinition.findUniqueOrThrow({ where: { id }, include: { permissions: true } });
    }
  }
  it.each(extraTypes)('%s restores the original database row and preserves content/history', async type => {
    const row = await createExtra(type);
    if (type === 'Campaign' || type === 'Workflow' || type === 'Role') expect((await archiveRequest(`?type=${type}`)).body.data.some((item: any) => item.id === row.id && item.archivedAt === null)).toBe(true);
    else expect((await archiveRequest(`?type=${type}`)).status).toBe(400);
    const before = await readExtra(type, row.id);
    expect((await archiveRequest(`/${type}/${row.id}/restore`, 'PATCH')).status).toBe(200);
    const after = await readExtra(type, row.id);
    expect(after).toMatchObject({ ...before, isArchived: false, updatedAt: expect.any(Date) });
    if (type === 'Workflow') expect(after).toMatchObject({ isActive: false, status: 'PAUSED' });
    if (type === 'Campaign' || type === 'Workflow' || type === 'Role') expect((await archiveRequest(`?type=${type}`)).body.data.some((item: any) => item.id === row.id)).toBe(false);
    expect((await archiveRequest(`/${type}/${row.id}/restore`, 'PATCH')).status).toBe(404);
    expect(await db.auditLog.count({ where: { entityId: row.id, action: type.toLowerCase() + '.restored' } })).toBe(1);
  });
  it.each(extraTypes)('%s rejects unauthenticated, unauthorized, cross-tenant and invalid restore requests', async type => {
    const own = await createExtra(type);
    expect((await archiveRequest(`/${type}/${own.id}/restore`, 'PATCH', '')).status).toBe(401);
    expect((await archiveRequest(`/${type}/${own.id}/restore`, 'PATCH', viewerCookie)).status).toBe(403);
    expect((await archiveRequest(`/${type}/invalid/restore`, 'PATCH')).status).toBe(400);
    const other = await createExtra(type, otherTenantId);
    expect((await archiveRequest(`/${type}/${other.id}/restore`, 'PATCH')).status).toBe(404);
    expect(await readExtra(type, other.id)).toHaveProperty('isArchived', true);
  });
  it('rejects unknown restore types and protected roles', async () => {
    expect((await archiveRequest(`/User/${randomUUID()}/restore`, 'PATCH')).status).toBe(400);
    const role = await db.roleDefinition.create({ data: { tenantId, name: 'Guest', isArchived: true } });
    expect((await archiveRequest(`/Role/${role.id}/restore`, 'PATCH')).status).toBe(403);
    expect((await archiveRequest('?type=Role')).status).toBe(200);
  });
  it('searches before pagination across allowed types and preserves tenant/RBAC scope', async () => {
    const marker = 'Search' + randomUUID();
    const campaign = await createExtra('Campaign');
    const workflow = await createExtra('Workflow');
    await db.campaign.update({ where: { id: campaign.id }, data: { name: marker + ' campaign' } });
    await db.workflow.update({ where: { id: workflow.id }, data: { name: marker + ' workflow' } });
    for (const tenant of [otherTenantId]) {
      const foreign = await createExtra('Campaign', tenant);
      await db.campaign.update({ where: { id: foreign.id }, data: { name: marker } });
    }
    const first = await archiveRequest(`?search=${marker.toLowerCase()}&limit=1`);
    const second = await archiveRequest(`?search=${marker}&limit=1&page=2`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.meta.total).toBe(2); expect(second.body.meta.total).toBe(2);
    expect([...first.body.data, ...second.body.data].map((r: any) => r.id)).toEqual([campaign.id, workflow.id]);
    expect((await archiveRequest(`?search=${marker}&type=Campaign`)).body.data.map((r: any) => r.id)).toEqual([campaign.id]);
    expect((await archiveRequest(`?search=${marker}`, 'GET', viewerCookie)).body.data).toEqual([]);
    expect((await archiveRequest('?search=' + 'x'.repeat(201))).status).toBe(400);
    // This legacy fixture omits newer product fields; seed only archive-search columns.
    const lead = { id: randomUUID() };
    await db.$executeRaw`INSERT INTO "Lead" (id,"tenantId","firstName","lastName",email,status,"isArchived","updatedAt") VALUES (${lead.id},${tenantId},${marker},'Person','unique-search@example.test','Warm',true,NOW())`;
    expect((await archiveRequest(`?search=${marker}%20Person&type=Lead`)).body.data.map((r: any) => r.id)).toEqual([lead.id]);
    expect((await archiveRequest('?search=unique-search%40example.test&type=Lead')).body.data.map((r: any) => r.id)).toEqual([lead.id]);
  });
  it('uses the existing user restore route, validates UUIDs and rejects already-active/cross-tenant users', async () => {
    const user = await db.user.create({ data: { tenantId, email: 'inactive@camxian.com', firstName: 'Inactive', lastName: 'User', role: 'Sales', status: 'INACTIVE' } });
    const userRestore = (id: string, cookie = adminCookie) => fetch(`${base}/administration/users/${id}/restore`, { method: 'PATCH', headers: { Cookie: cookie } });
    expect((await archiveRequest('?type=User')).body.data.some((row: any) => row.id === user.id)).toBe(true);
    expect((await userRestore('invalid')).status).toBe(400);
    expect((await userRestore(user.id, viewerCookie)).status).toBe(403);
    expect((await userRestore(user.id)).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ status: 'ACTIVE', email: user.email });
    expect((await userRestore(user.id)).status).toBe(404);
    const other = await db.user.create({ data: { tenantId: otherTenantId, email: 'other@camxian.com', firstName: 'Other', lastName: 'User', role: 'Sales', status: 'INACTIVE' } });
    expect((await userRestore(other.id)).status).toBe(404);
  });
});
