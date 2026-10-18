import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { type Server } from 'node:http';
import { replayCrmMigrations } from '../../../../tests/replay-crm-migrations';
import { createPrivateStorageFixture } from '../../../../tests/private-storage-fixture';
import { MAX_ACTIVE_PRODUCTS } from '@leadcrm/shared';

// Always use an isolated in-memory PostgreSQL database, never DATABASE_URL.
vi.mock('../../../../config/database.config', async () => {
  const { installTenantScoping } = await import('../../../../core/tenant/tenant-prisma');
  const { installProductProjections } = await import('../../../../core/tenant/product-projections');
  const client = new PrismaClient({ datasources: { db: { url: process.env.CRM_ARCHIVE_TEST_DATABASE_URL! } } });
  installProductProjections(client); installTenantScoping(client);
  return { default: client };
});

let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, server: Server, storage: Awaited<ReturnType<typeof createPrivateStorageFixture>>;
let base: string, tenantId: string, otherTenantId: string, adminCookie: string, viewerCookie: string;
const legacyId = randomUUID();
const retiredFields = ['customerType','recordType','score','linkedinUrl','activeProducts','lastContactedAt','qualifiedAt','disqualifiedReason','jobTitle'];
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
  if (module === 'contacts') return db.contact.create({ data: { tenantId: tenant, firstName: 'Archived', lastName: 'Contact', status: 'HOT', productInterests: [] } });
  return db.account.create({ data: { tenantId: tenant, name: 'Archived Account', tags: [],   } });
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
  storage = await createPrivateStorageFixture();
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
  await storage?.cleanup();
  await db?.$disconnect(); await socket?.stop(); await pg?.close();
});

describe.sequential('Product recovery through the existing Settings archive API', () => {
  async function productActor(grants?: Array<{ module: string; canView: boolean; canRestore?: boolean }>, tenant?: string) {
    const tenantId = tenant ?? (await db.tenant.create({ data: { name: 'Product recovery', slug: randomUUID(), status: 'ACTIVE' } })).id;
    const role = grants ? await db.roleDefinition.create({ data: { tenantId, name: randomUUID(), permissions: { create: grants } } }) : null;
    const user = await db.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'Product', lastName: 'Recovery', role: role?.name ?? 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    if (role) await db.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
    const { issueAuthSession } = await import('../../../../core/auth/auth-session');
    const cookie = `leadcrm_token=${(await issueAuthSession(user)).token}`;
    const request = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${base}/administration/${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    return { tenantId, userId: user.id, request };
  }

  it('archives and restores the same Product in Product/All without changing linked CRM history or prices', async () => {
    const actor = await productActor();
    const product = await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'CCTV Surveillance System', dealValue: 5000.25 } });
    const other = await db.productInterest.create({ data: { tenantId: otherTenantId, name: product.name, dealValue: 999, active: false } });
    const pipeline = await db.pipeline.create({ data: { tenantId: actor.tenantId, name: 'Historical product pipeline' } });
    const stage = await db.stage.create({ data: { tenantId: actor.tenantId, pipelineId: pipeline.id, name: 'Won', order: 1, isWon: true } });
    const lead = await db.lead.create({ data: { tenantId: actor.tenantId, firstName: 'Historical', lastName: 'Lead', productsNormalized: true, productLinks: { create: { productInterestId: product.id, position: 0 } } } });
    const account = await db.account.create({ data: { tenantId: actor.tenantId, name: 'Historical Account',   } });
    const contact = await db.contact.create({ data: { tenantId: actor.tenantId, firstName: 'Historical', lastName: 'Contact', accountId: account.id, productsNormalized: true, productLinks: { create: { productInterestId: product.id, position: 0, activeProduct: true } } } });
    const deal = await db.deal.create({ data: { tenantId: actor.tenantId, title: 'Original product price', pipelineId: pipeline.id, stageId: stage.id, accountId: account.id, productInterestId: product.id, productsNormalized: true, value: 3210.75, currency: 'PHP', leadDeals: { create: { leadId: lead.id, position: 0 } }, contactDeals: { create: { contactId: contact.id, position: 0 } } } });
    const history = () => Promise.all([
      db.deal.findUniqueOrThrow({ where: { id: deal.id }, include: { leadDeals: true, contactDeals: true } }),
      db.leadProductInterest.findMany({ where: { leadId: lead.id } }),
      db.contactProductInterest.findMany({ where: { contactId: contact.id } }),
      db.account.findUniqueOrThrow({ where: { id: account.id } }),
    ]);
    const before = await history();
    expect((await actor.request('archived-data?type=Product')).body.meta.total).toBe(0);
    expect((await actor.request('product-interests')).body.data.some((row: any) => row.id === product.id)).toBe(true);
    expect((await actor.request(`product-interests/${product.id}`, 'DELETE')).status).toBe(200);
    const archived = await db.productInterest.findUniqueOrThrow({ where: { id: product.id } });
    expect(archived.active).toBe(false);
    expect((await actor.request('product-interests')).body.data.some((row: any) => row.id === product.id)).toBe(false);
    for (const sortBy of ['archivedAt', 'name']) {
      for (const type of ['', '&type=Product']) {
        const listed = await actor.request(`archived-data?search=cctv%20surveillance&sortBy=${sortBy}${type}`);
        expect(listed.status).toBe(200);
        expect(listed.body.meta.total).toBe(1);
        expect(listed.body.data).toEqual([{ type: 'Product', id: product.id, name: product.name, detail: '₱5,000.25', archivedAt: archived.updatedAt.toISOString(), canRestore: true }]);
        expect(listed.body.data.some((row: any) => row.id === other.id)).toBe(false);
      }
    }
    expect((await actor.request(`archived-data/Product/${other.id}/restore`, 'PATCH')).status).toBe(404);
    expect((await actor.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(200);
    expect(await db.productInterest.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ ...product, active: true, updatedAt: expect.any(Date) });
    expect((await actor.request('archived-data?type=Product')).body.meta.total).toBe(0);
    expect((await actor.request('product-interests')).body.data).toEqual([expect.objectContaining({ id: product.id, name: product.name, dealValue: 5000.25, active: true })]);
    expect(await history()).toEqual(before);
    expect(await db.auditLog.findMany({ where: { tenantId: actor.tenantId, entityId: product.id, action: 'product.restored' } })).toEqual([expect.objectContaining({ entityType: 'Product', changeset: { before: { active: false }, after: { active: true } } })]);
    expect((await actor.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(404);
    expect(await db.productInterest.count({ where: { tenantId: actor.tenantId } })).toBe(1);
  });

  it('enforces products.view and archived_data.restore independently on HTTP reads and writes', async () => {
    const owner = await productActor();
    const product = await db.productInterest.create({ data: { tenantId: owner.tenantId, name: 'Restricted product', dealValue: 0, active: false } });
    for (const grants of [
      [{ module: 'archived_data', canView: true, canRestore: true }],
      [{ module: 'archived_data', canView: true }, { module: 'products', canView: true }],
      [{ module: 'products', canView: true }],
    ]) {
      const staff = await productActor(grants, owner.tenantId);
      const canView = grants.some(grant => grant.module === 'archived_data') && grants.some(grant => grant.module === 'products');
      expect((await staff.request('archived-data?type=Product')).status).toBe(canView ? 200 : 403);
      const all = await staff.request('archived-data');
      if (all.status === 200) expect(all.body.data).toEqual(canView ? [expect.objectContaining({ id: product.id, canRestore: false })] : []);
      expect((await staff.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(403);
    }
    const restorer = await productActor([{ module: 'archived_data', canView: true, canRestore: true }, { module: 'products', canView: true }], owner.tenantId);
    expect((await restorer.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(200);
  });

  it('returns controlled case-insensitive duplicate conflicts and retains the archived record', async () => {
    const actor = await productActor();
    const product = await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'CCTV Surveillance System', dealValue: 5000, active: false } });
    await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'cctv surveillance system', dealValue: 9000 } });
    const response = await actor.request(`archived-data/Product/${product.id}/restore`, 'PATCH');
    expect(response.status).toBe(409);
    expect(response.body.error.message ?? response.body.error).toBe('An active product with this name already exists.');
    expect(await db.productInterest.findUniqueOrThrow({ where: { id: product.id } })).toEqual(product);
    expect(await db.auditLog.count({ where: { entityId: product.id, action: 'product.restored' } })).toBe(0);
  });

  it('does not mistake wildcard characters in a Product name for an active duplicate', async () => {
    const actor = await productActor();
    const product = await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'CCTV 100%_kit', dealValue: 1, active: false } });
    await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'CCTV 100XXkit', dealValue: 2 } });
    expect((await actor.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(200);
    expect((await db.productInterest.findUniqueOrThrow({ where: { id: product.id } })).active).toBe(true);
  });

  it('requires explicit field enablement and shares the creation limit at 99/100 active Products', async () => {
    const actor = await productActor();
    const product = await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'Restore capacity', dealValue: 12.34, active: false } });
    await db.tenantPreference.create({ data: { tenantId: actor.tenantId, module: 'product-interests', key: 'enabled', value: false } });
    expect((await actor.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(409);
    expect((await db.productInterest.findUniqueOrThrow({ where: { id: product.id } })).active).toBe(false);
    expect((await actor.request('product-interests/field', 'POST', {})).status).toBe(200);
    await db.productInterest.createMany({ data: Array.from({ length: MAX_ACTIVE_PRODUCTS - 1 }, (_, index) => ({ tenantId: actor.tenantId, name: `Capacity ${index}`, dealValue: 0 })) });
    expect((await actor.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(200);
    const another = await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'Overflow', dealValue: 0, active: false } });
    const full = await actor.request(`archived-data/Product/${another.id}/restore`, 'PATCH');
    expect(full.status).toBe(400);
    expect(full.body.error.message ?? full.body.error).toBe('Maximum 100 products.');
    expect((await actor.request('product-interests', 'POST', { name: 'Created overflow', dealValue: 0 })).status).toBe(400);
    expect((await db.productInterest.findUniqueOrThrow({ where: { id: another.id } })).active).toBe(false);
    expect(await db.productInterest.count({ where: { tenantId: actor.tenantId, active: true } })).toBe(MAX_ACTIVE_PRODUCTS);
  });

  it('rolls back Product activation when its restore audit cannot be written', async () => {
    const actor = await productActor();
    const product = await db.productInterest.create({ data: { tenantId: actor.tenantId, name: 'Atomic recovery', dealValue: 1, active: false } });
    const auditService = await import('../../../../core/audit/audit.service');
    const audit = vi.spyOn(auditService, 'writeAuditLog').mockRejectedValueOnce(new Error('Acceptance: audit unavailable'));
    try {
      expect((await actor.request(`archived-data/Product/${product.id}/restore`, 'PATCH')).status).toBe(500);
      expect(await db.productInterest.findUniqueOrThrow({ where: { id: product.id } })).toEqual(product);
      expect(await db.auditLog.count({ where: { entityId: product.id, action: 'product.restored' } })).toBe(0);
    } finally { audit.mockRestore(); }
  });
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
it('supports Contact CRUD without retired properties and rejects them before any mutation or automatic Deal creation', async () => {
  const dealCount = await db.deal.count();
  const created = await call('contacts', 'POST', adminCookie, {requestId:randomUUID(),firstName:'Retirement',lastName:'CRUD',email:'retirement-crud@example.test',productInterests:[]});
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id;
  expect(await db.deal.count()).toBe(dealCount);
  for (const field of retiredFields) {
    expect(created.body.data).not.toHaveProperty(field);
    expect((await call(`contacts/${id}`,'PUT',adminCookie,{[field]:null})).status).toBe(400);
    expect((await call('contacts','POST',adminCookie,{requestId:randomUUID(),firstName:'Invalid',lastName:'Retired',email:'invalid@example.test',[field]:null})).status).toBe(400);
  }
  const since = new Date('2020-01-01T00:00:00Z');
  await db.contact.update({where:{id},data:{lifecycleStage:'CUSTOMER',customerSince:since,convertedAt:since}});
  const updated = await call(`contacts/${id}`,'PUT',adminCookie,{notes:'Retained note'});
  expect(updated.status).toBe(200);
  expect(updated.body.data).toMatchObject({notes:'Retained note',lifecycleStage:'CUSTOMER',customerSince:since.toISOString(),convertedAt:since.toISOString()});
  const listed = await call('contacts?search=retirement-crud&sort=firstName:asc&page=1&limit=1');
  expect(listed.status).toBe(200); expect(listed.body.data.map((row:any)=>row.id)).toEqual([id]);
  const detail = await call(`contacts/${id}`);
  expect(detail.status).toBe(200);
  for (const field of retiredFields) { expect(detail.body.data).not.toHaveProperty(field); expect(listed.body.data[0]).not.toHaveProperty(field); }
  const before = await db.contact.findUnique({where:{id}});
  expect((await call('contacts?filter[score]=gte:80')).status).toBe(400);
  expect((await call('contacts?sort=score:desc')).status).toBe(400);
  expect(await db.contact.findUnique({where:{id}})).toEqual(before);
  expect((await call(`contacts/${id}/archive`,'PATCH')).status).toBe(200);
  expect((await call(`contacts/${id}/restore`,'PATCH')).status).toBe(200);
  expect(await db.contact.count({where:{email:'invalid@example.test'}})).toBe(0);
});

it('creates, edits and imports Contacts with persisted Account, Product Interest, Status and eligible Agent', async () => {
  const role = await db.roleDefinition.create({ data: { tenantId, name: 'Contact assignment fixture', permissions: { create: ['contacts', 'deals'].map(module => ({ module, canView: true, canEdit: true, canCreate: true })) } } });
  const agent = await db.user.create({ data: { tenantId, email: 'contact-agent@example.test', firstName: 'Contact', lastName: 'Agent', role: role.name, userRoles: { create: { roleId: role.id } } } });
  const account = await db.account.create({ data: { tenantId, name: 'Contact association fixture' } });
  const product = await db.productInterest.create({ data: { tenantId, name: 'Contact fixture product', dealValue: 1500 } });
  const payload = { requestId: randomUUID(), firstName: 'Association', lastName: 'Contact', email: 'contact-associations@example.test', accountId: account.id, assignedUserId: agent.id, productInterestIds: [product.id], status: 'Hot' };
  const created = await call('contacts', 'POST', adminCookie, payload);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id;
  expect(await db.contact.findUniqueOrThrow({ where: { id }, include: { productLinks: true, contactDeals: true } })).toMatchObject({ accountId: account.id, assignedUserId: agent.id, status: 'HOT', productLinks: [{ productInterestId: product.id, interested: true }], contactDeals: [{ dealId: expect.any(String) }] });
  const edited = await call(`contacts/${id}`, 'PUT', adminCookie, { status: 'Cold', notes: 'Notes still supported', accountId: account.id, assignedUserId: agent.id });
  expect(edited.status, JSON.stringify(edited.body)).toBe(200);
  expect(await db.contact.findUniqueOrThrow({ where: { id } })).toMatchObject({ accountId: account.id, assignedUserId: agent.id, status: 'COLD', notes: 'Notes still supported' });
  const detail = await call(`contacts/${id}`);
  expect(detail.body.data).toMatchObject({ id, account: { id: account.id }, assignedUser: { id: agent.id }, productInterests: [product.name] });
  const admin = await db.user.findFirstOrThrow({ where: { tenantId, role: 'Client Admin' } });
  expect((await call('contacts', 'POST', adminCookie, { ...payload, requestId: randomUUID(), email: 'invalid-admin-agent@example.test', assignedUserId: admin.id })).status).toBe(400);

  const keys = ['firstName', 'lastName', 'email', 'phone', 'companyName', 'address', 'productInterest'];
  const input = { fileName: 'contacts.csv', csvText: `${keys.join(',')}\nImported,Contact,imported-contact@example.test,+639171234567,Acme,Manila,${product.name}`, mappings: Object.fromEntries(keys.map((key, index) => [key, index])), idempotencyKey: randomUUID() };
  let imported = await call('contacts/imports', 'POST', adminCookie, input);
  for (let attempt = 0; imported.body.data?.status === 'importing' && attempt < 10; attempt++) imported = await call('contacts/imports', 'POST', adminCookie, input);
  expect(imported.body.data, JSON.stringify(imported.body)).toMatchObject({ successfulRecords: 1, failedRecords: 0 });
  expect(await db.contact.findFirstOrThrow({ where: { tenantId, email: 'imported-contact@example.test' } })).toMatchObject({ firstName: 'Imported', companyName: 'Acme', address: 'Manila', productInterests: [product.name] });
  expect((await call('contacts/imports', 'POST', adminCookie, { ...input, idempotencyKey: randomUUID(), mappings: { ...input.mappings, jobTitle: 0 } })).status).toBe(400);
});

it('Contact merge preserves historical Product IDs and purchase flags on both the survivor and archived source', async () => {
  const product = await db.productInterest.create({data:{tenantId,name:'Retired catalog product',dealValue:1200,active:false}});
  const primary = await db.contact.create({data:{tenantId,firstName:'Merge',lastName:'Primary',email:'merge-primary@example.test',productsNormalized:true}});
  const secondary = await db.contact.create({data:{tenantId,firstName:'Merge',lastName:'Secondary',email:'merge-secondary@example.test',productsNormalized:true,productLinks:{create:{productInterestId:product.id,position:0,interested:false,activeProduct:true}}}});
  await db.productInterest.create({data:{tenantId,name:product.name,dealValue:900}});
  const before = await db.contact.count();
  expect((await call('merge','POST',adminCookie,{entityType:'contact',primaryId:primary.id,secondaryId:secondary.id,fieldResolutions:{score:'secondary'}})).status).toBe(400);
  const result = await call('merge','POST',adminCookie,{entityType:'contact',primaryId:primary.id,secondaryId:secondary.id,fieldResolutions:{}});
  expect(result.status,JSON.stringify(result.body)).toBe(200);
  expect(await db.contact.count()).toBe(before);
  expect(await db.contact.findUniqueOrThrow({where:{id:secondary.id}})).toMatchObject({isArchived:true});
  for (const id of [primary.id,secondary.id]) {
    expect(await db.contactProductInterest.findMany({where:{contactId:id}})).toEqual([expect.objectContaining({productInterestId:product.id,activeProduct:true,interested:false})]);
  }
  expect((await call(`contacts/${primary.id}`)).body.data.productInterests).toEqual([]);
});

it('Contact interest edits retain historical purchase flags without presenting them as interests', async () => {
  const purchase = await db.productInterest.create({data:{tenantId,name:'Historic purchase',dealValue:12500,active:false}});
  const interest = await db.productInterest.create({data:{tenantId,name:'Current interest',dealValue:500}});
  const contact = await db.contact.create({data:{tenantId,firstName:'Purchase',lastName:'History',email:'purchase-history@example.test',productsNormalized:true,productLinks:{create:{productInterestId:purchase.id,position:0,interested:false,activeProduct:true}}}});
  const updated = await call(`contacts/${contact.id}`,'PUT',adminCookie,{productInterestIds:[interest.id]});
  expect(updated.status,JSON.stringify(updated.body)).toBe(200);
  expect(updated.body.data.productInterests).toEqual(['Current interest']);
  expect(updated.body.data).not.toHaveProperty('activeProducts');
  const links = await db.contactProductInterest.findMany({where:{contactId:contact.id}});
  expect(links).toEqual(expect.arrayContaining([expect.objectContaining({productInterestId:purchase.id,activeProduct:true,interested:false}),expect.objectContaining({productInterestId:interest.id,activeProduct:false,interested:true})]));
});
