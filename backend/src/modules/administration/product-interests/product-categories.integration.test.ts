import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { replayCrmMigrations } from '../../../tests/replay-crm-migrations';

vi.mock('../../../config/database.config', async () => {
  const { installTenantScoping } = await import('../../../core/tenant/tenant-prisma');
  const client = new PrismaClient({ datasources: { db: { url: process.env.PRODUCT_CATEGORIES_TEST_DATABASE_URL! } } });
  installTenantScoping(client);
  return { default: client };
});

let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, server: Server, base: string;
const endpoint = '/administration/product-interests';
const requestedDatabase = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const nativeDatabase = process.env.LEADCRM_QA_RUN === '1' && requestedDatabase.hostname === '127.0.0.1' && /^\/leadcrm_product_categories_test_\d+$/.test(requestedDatabase.pathname);
beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-product-category-test-key';
  if (nativeDatabase) process.env.PRODUCT_CATEGORIES_TEST_DATABASE_URL = requestedDatabase.toString();
  else {
    pg = await PGlite.create();
    await replayCrmMigrations(pg);
    socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 });
    await socket.start();
    process.env.PRODUCT_CATEGORIES_TEST_DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  }
  db = (await import('../../../config/database.config')).default;
  server = (await import('../../../app')).default.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
}, 120_000);
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await db?.$disconnect(); await socket?.stop(); await pg?.close();
});

async function actor(grants?: { canView?: boolean; canCreate?: boolean; canEdit?: boolean; canArchive?: boolean }) {
  const tenantId = (await db.tenant.create({ data: { name: 'Product categories', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
  const role = grants ? await db.roleDefinition.create({ data: { tenantId, name: randomUUID(), permissions: { create: [{ module: 'products', ...grants }] } } }) : null;
  const user = await db.user.create({ data: { tenantId, email: `${randomUUID()}@camxian.com`, firstName: 'Category', lastName: 'Tester', role: role?.name ?? 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  if (role) await db.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
  const { issueAuthSession } = await import('../../../core/auth/auth-session');
  const cookie = `leadcrm_token=${(await issueAuthSession(user)).token}`;
  const request = async (path = '', method = 'GET', body?: unknown, authenticated = true) => {
    const response = await fetch(base + endpoint + path, { method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const change = (body: unknown) => request('/categories', 'PATCH', body);
  return { tenantId, userId: user.id, request, change };
}

describe.sequential('Product Category persistence and HTTP authorization', () => {
  it.each([99, 99.2, 99.25, 0.5, 1500.75, 0, 999_999_999_999, 999_999_999_998.99])('creates and reloads numeric Product amount %s with exact stored cents', async dealValue => {
    const a = await actor();
    await a.change({ action: 'add', name: 'Security' });
    const created = await a.request('', 'POST', { name: 'Camera', category: 'Security', dealValue });
    expect(created.status).toBe(200);
    const saved = created.body.data[0];
    expect(saved.dealValue).toBe(dealValue);
    const stored = await db.productInterest.findUniqueOrThrow({ where: { id: saved.id } });
    expect(stored.dealValue.toFixed(2)).toBe(dealValue.toFixed(2));
    expect((await a.request()).body.data[0].dealValue).toBe(dealValue);
    expect((await a.request(`/${saved.id}`)).body.data.dealValue).toBe(dealValue);
  });

  it('rejects invalid create and update amounts before persistence and retains decimal editing', async () => {
    const a = await actor();
    await a.change({ action: 'add', name: 'Security' });
    const created = await a.request('', 'POST', { name: 'Camera', category: 'Security', dealValue: 99.25 });
    expect(created.status).toBe(200);
    const id = created.body.data[0].id;
    for (const dealValue of [99.256, -99.25, 999_999_999_999.01, 1_000_000_000_000, '99.25', 'abc', '', null]) {
      expect((await a.request('', 'POST', { name: 'Invalid Product', category: 'Security', dealValue })).status).toBe(400);
      expect((await a.request(`/${id}`, 'PATCH', { dealValue })).status).toBe(400);
    }
    expect((await a.request('', 'POST', { name: 'Missing Value', category: 'Security' })).status).toBe(400);
    expect(await db.productInterest.count({ where: { tenantId: a.tenantId } })).toBe(1);
    expect((await db.productInterest.findUniqueOrThrow({ where: { id } })).dealValue.toFixed(2)).toBe('99.25');
    const updated = await a.request(`/${id}`, 'PATCH', { dealValue: 1500.75 });
    expect(updated.status).toBe(200);
    expect(updated.body.data[0].dealValue).toBe(1500.75);
    expect((await db.productInterest.findUniqueOrThrow({ where: { id } })).dealValue.toFixed(2)).toBe('1500.75');
  });

  it('initializes existing category values once, including archived Products, without assigning Uncategorized records', async () => {
    const a = await actor();
    const original = await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Camera', category: 'Security', dealValue: 25 } });
    await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Old Camera', category: 'security', active: false, dealValue: 10 } });
    await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Unclassified', dealValue: 0 } });
    const result = await a.request();
    expect(result.status).toBe(200);
    expect(result.body.meta.categories.map((name: string) => name.toLowerCase())).toEqual(['security']);
    expect(await db.productInterest.findUnique({ where: { id: original.id } })).toMatchObject({ category: 'Security', dealValue: original.dealValue });
    expect(result.body.data.find((p: { name: string }) => p.name === 'Unclassified').category).toBe('');
    expect(await db.tenantPreference.count({ where: { tenantId: a.tenantId, module: 'product-interests', key: 'categories' } })).toBe(1);
  });

  it('adds an unused trimmed category, persists it across reads and rejects blank/duplicate names', async () => {
    const a = await actor();
    expect((await a.change({ action: 'add', name: '  Networking  ' })).status).toBe(200);
    expect((await a.request()).body.meta.categories).toEqual(['Networking']);
    expect((await a.change({ action: 'add', name: 'networking' })).status).toBe(409);
    expect((await a.change({ action: 'add', name: '   ' })).status).toBe(400);
    expect(await db.productInterest.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  it('renames active and archived assignments while preserving Product IDs, values and Deal relationships', async () => {
    const a = await actor();
    const product = await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Camera', category: 'Security', description: 'Original', dealValue: 1250.5 } });
    const archived = await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Old', category: 'security', dealValue: 12, active: false } });
    const pipeline = await db.pipeline.create({ data: { tenantId: a.tenantId, name: 'Sales' } });
    const stage = await db.stage.create({ data: { tenantId: a.tenantId, pipelineId: pipeline.id, name: 'New', order: 0 } });
    const deal = await db.deal.create({ data: { tenantId: a.tenantId, title: 'Existing Deal', pipelineId: pipeline.id, stageId: stage.id, productInterestId: product.id, value: 999 } });
    const result = await a.change({ action: 'rename', name: 'SECURITY', newName: '  CCTV  ' });
    expect(result.status).toBe(200); expect(result.body.meta.categories).toEqual(['CCTV']);
    expect(result.body.data[0]).toMatchObject({ id: product.id, category: 'CCTV', name: 'Camera', description: 'Original', dealValue: 1250.5 });
    expect(await db.productInterest.findUnique({ where: { id: archived.id } })).toMatchObject({ category: 'CCTV', active: false });
    expect(await db.deal.findUnique({ where: { id: deal.id } })).toMatchObject({ productInterestId: product.id, value: 999 });
    expect(await db.auditLog.findFirst({ where: { tenantId: a.tenantId, action: 'product_categories.rename' } })).toMatchObject({ userId: a.userId });
  });

  it('rejects duplicate renames, supports capitalization changes and rejects missing categories', async () => {
    const a = await actor();
    await a.change({ action: 'add', name: 'Security' }); await a.change({ action: 'add', name: 'Networks' });
    expect((await a.change({ action: 'rename', name: 'Security', newName: 'networks' })).status).toBe(409);
    expect((await a.change({ action: 'rename', name: 'Security', newName: 'SECURITY' })).status).toBe(200);
    expect((await a.change({ action: 'rename', name: 'Missing', newName: 'New' })).status).toBe(404);
  });

  it.each([true, false])('blocks deletion when an active=%s Product uses the category', async active => {
    const a = await actor();
    const product = await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Camera', category: 'Security', dealValue: 25, active } });
    const result = await a.change({ action: 'delete', name: 'security' });
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain('This category cannot be deleted because it is currently assigned to one or more products.');
    expect(await db.productInterest.findUnique({ where: { id: product.id } })).toMatchObject({ category: 'Security', active });
  });

  it('deletes unused categories and keeps an empty persisted catalog empty after refresh', async () => {
    const a = await actor();
    await a.change({ action: 'add', name: 'Temporary' });
    expect((await a.change({ action: 'delete', name: 'Temporary' })).body.meta.categories).toEqual([]);
    expect((await a.request()).body.meta.categories).toEqual([]);
    expect((await a.change({ action: 'delete', name: 'Temporary' })).status).toBe(404);
  });

  it('requires a valid category on creation and every edit, including edits with category omitted', async () => {
    const a = await actor();
    const old = await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Uncategorized Product', dealValue: 7 } });
    const payload = { name: 'New Product', dealValue: 25 };
    for (const category of [undefined, null, '', ' ', 'Unknown']) expect((await a.request('', 'POST', { ...payload, category })).status).toBe(400);
    expect((await a.request(`/${old.id}`, 'PATCH', { description: 'Cannot save without category' })).status).toBe(400);
    expect(await db.productInterest.findUnique({ where: { id: old.id } })).toMatchObject({ category: '', description: '' });
    await a.change({ action: 'add', name: 'Security' });
    expect((await a.request(`/${old.id}`, 'PATCH', { category: 'security', description: 'Now classified' })).status).toBe(200);
    expect((await a.request(`/${old.id}`, 'PATCH', { dealValue: 7.5 })).status).toBe(200);
    expect((await a.request(`/${old.id}`, 'PATCH', { category: '' })).status).toBe(400);
    expect((await a.request('', 'POST', { ...payload, category: 'Security' })).status).toBe(200);
  });

  it('enforces action-specific Product permissions on direct requests', async () => {
    for (const grants of [{ canView: true }, { canView: true, canCreate: true }, { canView: true, canEdit: true }, { canView: true, canArchive: true }]) {
      const a = await actor(grants);
      await db.productInterest.create({ data: { tenantId: a.tenantId, name: 'Camera', category: 'Security', dealValue: 1 } });
      expect((await a.change({ action: 'add', name: 'New' })).status).toBe('canCreate' in grants ? 200 : 403);
      expect((await a.change({ action: 'rename', name: 'Security', newName: 'CCTV' })).status).toBe('canEdit' in grants ? 200 : 403);
      expect((await a.change({ action: 'delete', name: 'Missing' })).status).toBe('canArchive' in grants ? 404 : 403);
      expect((await a.request('/categories', 'PATCH', { action: 'add', name: 'Unauthorized' }, false)).status).toBe(401);
    }
  });

  it('isolates identical category names, mutations, Product assignments and usage checks between tenants', async () => {
    const a = await actor(), b = await actor();
    const foreign = await db.productInterest.create({ data: { tenantId: b.tenantId, name: 'Camera', category: 'Shared name', dealValue: 30 } });
    await a.change({ action: 'add', name: 'Shared name' });
    expect((await a.change({ action: 'delete', name: 'Shared name' })).status).toBe(200);
    expect((await b.request()).body.meta.categories).toEqual(['Shared name']);
    expect((await a.change({ action: 'rename', name: 'Shared name', newName: 'Other' })).status).toBe(404);
    expect((await a.request(`/${foreign.id}`, 'PATCH', { category: 'Other' })).status).toBe(404);
    expect(await db.productInterest.findUnique({ where: { id: foreign.id } })).toMatchObject({ category: 'Shared name' });
  });

  it('serializes concurrent case-insensitive duplicate additions', async () => {
    const a = await actor(); await a.request();
    const results = await Promise.all([a.change({ action: 'add', name: 'Security' }), a.change({ action: 'add', name: 'SECURITY' })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await a.request()).body.meta.categories).toHaveLength(1);
  });

  it('keeps assignments valid when Product creation races category deletion', async () => {
    const a = await actor(); await a.change({ action: 'add', name: 'Security' });
    const [created, deleted] = await Promise.all([
      a.request('', 'POST', { name: 'Camera', category: 'Security', dealValue: 25 }),
      a.change({ action: 'delete', name: 'Security' }),
    ]);
    const catalog = await a.request();
    if (created.status === 200) {
      expect(deleted.status).toBe(409); expect(catalog.body.meta.categories).toContain('Security');
      expect(catalog.body.data[0].category).toBe('Security');
    } else {
      expect(created.status).toBe(400); expect(deleted.status).toBe(200);
      expect(catalog.body.data).toEqual([]); expect(catalog.body.meta.categories).toEqual([]);
    }
  });
});
