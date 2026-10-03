import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../../../core/auth/auth-session';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_account_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('organization and account settings over authenticated HTTP', () => {
  let server: Server, base: string, tenantId: string, otherTenantId: string, token: string, readerToken: string;
  async function call(path: string, method = 'GET', body?: unknown, bearer = token) {
    const response = await fetch(base + path, { method, headers: {
      'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Original', slug: `settings-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } });
    tenantId = tenant.id;
    otherTenantId = (await prisma.tenant.create({ data: { name: 'Other tenant', slug: `settings-other-${Date.now()}` } })).id;
    const createUser = (role: string, email: string) => prisma.user.create({ data: {
      tenantId, role, email, firstName: 'Settings', lastName: 'Test', mustChangePassword: false,
    } });
    token = (await issueAuthSession(await createUser('Client Admin', 'settings-admin@camxian.com'))).token;
    const reader = await createUser('Settings reader', 'settings-reader@camxian.com');
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: reader.role, permissions: { create: { tenantId, module: 'settings', canView: true } } } });
    await prisma.userRole.create({ data: { tenantId, userId: reader.id, roleId: role.id } });
    readerToken = (await issueAuthSession(reader)).token;
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('persists all six fields, reloads them, audits changes, and leaves another tenant unchanged', async () => {
    const values = { name: ' Saved ', industry: 'IT', email: 'info@example.com', phone: '+63 (28) 123-3488', domain: 'example.com', address: 'Manila' };
    const saved = await call('/administration/organization-settings', 'PATCH', values);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ ...values, name: 'Saved', phone: '+63281233488', id: tenantId });
    expect((await call('/administration/organization-settings')).body.data).toEqual(saved.body.data);
    expect(await prisma.tenant.findUnique({ where: { id: tenantId } })).toMatchObject({ domain: 'example.com', address: 'Manila' });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: otherTenantId } })).name).toBe('Other tenant');
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'organization.updated' } })).toBe(1);
    expect((await call('/auth/me')).body.data.user).toMatchObject({ tenantName: 'Saved', industry: 'IT' });
    expect((await call('/administration/organization-settings', 'PATCH', { phone: '', domain: '', email: '   ' })).body.data).toMatchObject({ phone: null, domain: null, email: null });
  });

  it('enforces authentication, read/edit permissions, and the strict tenant-safe whitelist', async () => {
    expect((await call('/administration/organization-settings', 'GET', undefined, '')).status).toBe(401);
    expect((await call('/administration/organization-settings', 'GET', undefined, readerToken)).status).toBe(200);
    expect((await call('/administration/organization-settings', 'PATCH', { name: 'Forbidden' }, readerToken)).status).toBe(403);
    for (const payload of [{ id: otherTenantId }, { tenantId: otherTenantId }, { status: 'ACTIVE' }, { name: ' ' }, { email: 'invalid' }]) {
      expect((await call('/administration/organization-settings', 'PATCH', payload)).status).toBe(400);
    }
  });

  it('rejects malformed telephones before persistence and normalizes supported landline formats', async () => {
    for (const phone of ['fbdfbdgddfg', '123', '+639123456789', '+1 281233488', '(28 123-3488', '28/123/3488', '<script>281233488</script>', 281233488]) {
      const before = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const result = await call('/administration/organization-settings', 'PATCH', { phone });
      expect(result.status).toBe(400); expect(result.body.fieldErrors.phone.length).toBeGreaterThan(0);
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).phone).toBe(before.phone);
    }
    for (const phone of ['+63 (28) 123-3488', '(28) 123-3488', '02 8123 3488']) {
      expect((await call('/administration/organization-settings', 'PATCH', { phone })).body.data.phone).toBe('+63281233488');
    }
    expect((await call('/administration/organization-settings', 'PATCH', { phone: '(32) 123-4567' })).body.data.phone).toBe('+63321234567');
  });

  it('removes timezone from database/auth and rejects obsolete profile payloads', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'timeZone'`;
    expect(columns).toEqual([]);
    expect((await call('/auth/me')).body.data.user).not.toHaveProperty('timeZone');
    expect((await call('/auth/profile', 'PATCH', { firstName: 'Valid', timeZone: 'Asia/Manila' })).status).toBe(400);
  });

  it('creates and updates Accounts without retired fields or response properties', async () => {
    const created = await call('/crm/accounts', 'POST', { name: 'Account', country: 'Philippines' });
    expect(created.status).toBe(201);
    const accountId = created.body.data.id;
    const updated = await call(`/crm/accounts/${accountId}`, 'PUT', { name: 'Saved account', industry: 'IT' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ name: 'Saved account', industry: 'IT', country: 'Philippines' });
    const saved = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    for (const value of [created.body.data, updated.body.data, saved]) {
      for (const field of ['taxId', 'customerType', 'customerSince']) expect(value).not.toHaveProperty(field);
    }
  });
});
