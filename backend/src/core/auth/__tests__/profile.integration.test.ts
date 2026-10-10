import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../auth-session';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_(?:polish_test|account_test_\d+)$/.test(url.pathname);
describe.skipIf(!disposable)('profile and sorting persistence through authenticated HTTP', () => {
  let server: Server, storage: Server, base: string, tenantId: string, userId: string, token: string;
  const objects = new Map<string, Buffer>();
  const oldStorage = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.SUPABASE_AVATAR_BUCKET };
  async function request(path: string, method = 'GET', body?: unknown, auth = true) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Profile test', slug: `profile-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } });
    tenantId = tenant.id;
    const user = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: 'profile-test@camxian.com', firstName: 'Before', lastName: 'Test', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    userId = user.id; token = (await issueAuthSession(user)).token;
    storage = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      if (req.headers.authorization !== 'Bearer fixture-key') { res.writeHead(401).end(); return; }
      const key = req.url!.replace('/storage/v1/object/authenticated/', '').replace('/storage/v1/object/', '');
      if (req.method === 'POST') { objects.set(key, bytes); res.end('{}'); }
      else if (req.method === 'DELETE') { for (const prefix of JSON.parse(bytes.toString()).prefixes) objects.delete(`avatars/${prefix}`); res.end('{}'); }
      else if (objects.has(key)) { res.setHeader('Content-Type', 'image/webp'); res.end(objects.get(key)); }
      else res.writeHead(404).end('{}');
    }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => storage.once('listening', resolve));
    process.env.SUPABASE_URL = `http://127.0.0.1:${(storage.address() as any).port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key'; process.env.SUPABASE_AVATAR_BUCKET = 'avatars';
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  }, 30000);
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (storage) await new Promise<void>(resolve => storage.close(() => resolve()));
    for (const [key, value] of Object.entries({ SUPABASE_URL: oldStorage.url, SUPABASE_SERVICE_ROLE_KEY: oldStorage.key, SUPABASE_AVATAR_BUCKET: oldStorage.bucket })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await prisma.$disconnect();
  });
  it('persists safe fields across fresh auth reads and sessions, rejecting privileged changes', async () => {
    expect((await request('/auth/profile', 'PATCH', { firstName: 'Ada', phone: '9171234567', jobTitle: 'Engineer' })).status).toBe(200);
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(dbUser).toMatchObject({ firstName: 'Ada', phone: '+639171234567', jobTitle: 'Engineer' });
    token = (await issueAuthSession(dbUser)).token;
    const restored = (await request('/auth/me')).body.data.user;
    expect(restored).toMatchObject({ firstName: 'Ada', groups: [] }); expect(restored).not.toHaveProperty('passwordHash');
    expect((await request('/auth/profile', 'PATCH', { department: 'Research' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { groupIds: [] })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { role: 'Client Admin' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { tenantId: 'other', firstName: 'Other' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { firstName: 'Anonymous' }, false)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { userId, action: 'profile.updated' } })).toBe(1);
  });
  it('stores optimized avatar bytes, persists the reference and reloads the image through authenticated HTTP', async () => {
    const png = await sharp({ create: { width: 700, height: 700, channels: 3, background: '#123abc' } }).png().toBuffer();
    const response = await fetch(base + '/auth/profile/avatar', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: png });
    expect(response.status).toBe(200);
    const reference = (await response.json()).data.user.avatarUrl;
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } }); expect(stored.avatarUrl).toBe(reference);
    token = (await issueAuthSession(stored)).token;
    expect((await request('/auth/me')).body.data.user.avatarUrl).toBe(reference);
    const image = await fetch(base + reference.replace('/api/proxy', ''), { headers: { Authorization: `Bearer ${token}` } });
    expect(image.status).toBe(200);
    expect(await sharp(Buffer.from(await image.arrayBuffer())).metadata()).toMatchObject({ width: 512, height: 512, format: 'webp' });
    expect((await request(reference.replace('/api/proxy', ''), 'GET', undefined, false)).status).toBe(401);
    expect(objects.size).toBe(1);
  });
  it('serves saved team avatars only to authorized users in the same tenant', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const avatarId = owner.avatarUrl!.split('/').pop();
    const viewer = await prisma.user.create({ data: { tenantId, email: 'team-avatar-viewer@camxian.com', firstName: 'Team', lastName: 'Viewer', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const viewerToken = (await issueAuthSession(viewer)).token;
    const path = `/administration/users/${userId}/avatar/${avatarId}`;
    const image = await fetch(base + path, { headers: { Authorization: `Bearer ${viewerToken}` } });
    expect(image.status).toBe(200);
    expect(image.headers.get('cache-control')).toBe('private, no-store');
    expect(await sharp(Buffer.from(await image.arrayBuffer())).metadata()).toMatchObject({ width: 512, height: 512, format: 'webp' });
    expect((await request(path, 'GET', undefined, false)).status).toBe(401);
    expect((await request(path.replace(avatarId!, '00000000-0000-0000-0000-000000000000'))).status).toBe(404);
    const otherTenant = await prisma.tenant.create({ data: { name: 'Other avatar tenant', slug: `avatar-other-${Date.now()}` } });
    const outsider = await prisma.user.create({ data: { tenantId: otherTenant.id, email: 'other-avatar@camxian.com', firstName: 'Other', lastName: 'User', role: 'Sales', avatarUrl: owner.avatarUrl } });
    expect((await request(`/administration/users/${outsider.id}/avatar/${avatarId}`)).status).toBe(404);
    await prisma.user.update({ where: { id: viewer.id }, data: { role: 'Sales' } });
    const denied = await fetch(base + path, { headers: { Authorization: `Bearer ${viewerToken}` } });
    expect(denied.status).toBe(403);
  });
  it('rejects oversized image requests with a clear error before storage', async () => {
    const response = await fetch(base + '/auth/profile/avatar', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: Buffer.alloc(5 * 1024 * 1024 + 1) });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('5 MB');
    expect(objects.size).toBe(1);
  });
  it('sorts all seven lead columns across server pages with filters, search without a dataset selection', async () => {
    for (const [index, name] of ['zulu', 'Alpha', 'beta'].entries()) {
      await prisma.lead.create({ data: { tenantId, firstName: name, lastName: 'Sort', email: `${name}@test.example`, phone: String([300, 100, 200][index]), companyName: name, status: ['WARM', 'COLD', 'HOT'][index], source: name, createdAt: new Date(`2026-0${[3, 1, 2][index]}-01`), } });
    }
    for (const field of ['firstName', 'email', 'phone', 'companyName', 'status', 'createdAt', 'source']) {
      for (const [direction, expected] of [['asc', ['Alpha', 'beta', 'zulu']], ['desc', ['zulu', 'beta', 'Alpha']]] as const) {
        const rows: string[] = [];
        for (const page of [1, 2, 3]) {
          const result = await request(`/crm/leads?page=${page}&pageSize=1&search=Sort&sort=${field}:${direction}`);
          expect(result.status).toBe(200); expect(result.body.meta.total).toBe(3); expect(result.body.data).toHaveLength(1);
          rows.push(result.body.data[0].firstName);
        }
        expect(rows).toEqual(expected);
      }
    }
    const filtered = await request('/crm/leads?sort=firstName:asc&filter[source]=equals:beta');
    expect(filtered.body.data.map((row: any) => row.firstName)).toEqual(['beta']);
  }, 30000);
  it('sorts Accounts on the server before pagination', async () => {
    for (const name of ['zulu', 'Alpha', 'beta']) await prisma.account.create({ data: { tenantId, name, } });
    for (const [direction, expected] of [['asc', ['Alpha', 'beta', 'zulu']], ['desc', ['zulu', 'beta', 'Alpha']]] as const) {
      const names: string[] = [];
      for (const page of [1, 2, 3]) {
        const result = await request(`/crm/accounts?page=${page}&pageSize=1&sort=name:${direction}`);
        expect(result.status).toBe(200);
        names.push(result.body.data[0].name);
      }
      expect(names).toEqual(expected);
    }
  });
});
