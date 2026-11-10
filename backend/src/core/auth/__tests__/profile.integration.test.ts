import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { type Server } from 'node:http';
import sharp from 'sharp';
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../auth-session';
import app from '../../../app';
import { createPrivateStorageFixture } from '../../../tests/private-storage-fixture';
import { hashPassword } from '../../../shared/helpers/crypto';
import { sendMail } from '../../../shared/services/email.service';

vi.mock('../../../shared/services/email.service', async original => ({
  ...await original<object>(), sendMail: vi.fn(),
}));

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_(?:polish_test|account_test_\d+)$/.test(url.pathname);
describe.skipIf(!disposable)('profile and sorting persistence through authenticated HTTP', () => {
  let server: Server, storage: Awaited<ReturnType<typeof createPrivateStorageFixture>>, base: string, tenantId: string, userId: string, token: string;
  async function request(path: string, method = 'GET', body?: unknown, auth = true) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Profile test', slug: `profile-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } });
    tenantId = tenant.id;
    const user = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: 'profile-test@camxian.com', firstName: 'Before', lastName: 'Test', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    userId = user.id; token = (await issueAuthSession(user)).token;
    storage = await createPrivateStorageFixture();
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  }, 30000);
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await storage?.cleanup();
    await prisma.$disconnect();
  });
  it('persists safe fields across fresh auth reads and sessions, rejecting privileged changes', async () => {
    expect((await request('/auth/profile', 'PATCH', { firstName: 'Ada', phone: '9171234567' })).status).toBe(200);
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(dbUser).toMatchObject({ firstName: 'Ada', phone: '+639171234567' });
    token = (await issueAuthSession(dbUser)).token;
    const restored = (await request('/auth/me')).body.data.user;
    expect(restored).toMatchObject({ firstName: 'Ada', groups: [] }); expect(restored).not.toHaveProperty('passwordHash');
    expect((await request('/auth/profile', 'PATCH', { jobTitle: 'Engineer' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { email: 'change@camxian.com' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { department: 'Research' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { groupIds: [] })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { role: 'Client Admin' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { tenantId: 'other', firstName: 'Other' })).status).toBe(400);
    expect((await request('/auth/profile', 'PATCH', { firstName: 'Anonymous' }, false)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { userId, action: 'profile.updated' } })).toBe(1);
  });
  it('verifies a Client Admin’s new email and revokes the old login and recovery state', async () => {
    const password = 'Disposable!Profile2026';
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: 'profile-old@camxian.com',
      firstName: 'Email', lastName: 'Admin', passwordHash: await hashPassword(password), mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const staff = await prisma.user.create({ data: { tenantId, role: 'Sales', email: 'profile-staff@camxian.com',
      firstName: 'Email', lastName: 'Staff', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const adminSession = await issueAuthSession(admin), staffSession = await issueAuthSession(staff);
    const otherAdminSession = await issueAuthSession(admin);
    const email = 'profile-verified@example.test';
    const codePath = '/auth/profile/email';
    const call = async (path: string, authToken: string, body?: unknown) => fetch(base + path, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const issue = (authToken: string, data = { email, currentPassword: password }) => call(codePath + '/request', authToken, data);
    const confirm = (authToken: string, code: string) => call(codePath + '/confirm', authToken, { code });
    vi.mocked(sendMail).mockResolvedValue({ submitted: true, messageId: 'fixture-email' });
    expect((await issue(staffSession.token)).status).toBe(403);
    expect((await confirm(staffSession.token, '000000')).status).toBe(403);
    expect((await issue(adminSession.token, { email, currentPassword: 'wrong' })).status).toBe(400);
    expect((await issue(adminSession.token, { email: staff.email, currentPassword: password })).status).toBe(409);
    await prisma.passwordResetToken.create({ data: { userId: admin.id, email: admin.email, token: 'fixture-profile-recovery', expires: new Date(Date.now() + 60_000) } });
    const requestedAt = Date.now();
    expect((await issue(adminSession.token)).status).toBe(200);
    const preference = { tenantId, userId: admin.id, module: 'auth', key: 'profile-email-change' };
    const pending = await prisma.userPreference.findFirstOrThrow({ where: preference });
    const code = () => /<strong>([0-9]{6})<\/strong>/.exec(vi.mocked(sendMail).mock.lastCall![0].html)![1];
    expect(vi.mocked(sendMail).mock.lastCall?.[0]).toMatchObject({ to: email, subject: 'Confirm your LeadCRM email address', category: 'profile-email-change', requireDelivery: true });
    const html = vi.mocked(sendMail).mock.lastCall![0].html;
    expect(html).toContain('>Confirm your LeadCRM email address</h1>');
    expect(html).toContain('Camxian Technologies');
    expect(html).toContain('This code expires in 15 minutes.');
    expect(html).not.toContain('/reset-password');
    expect(code()).toMatch(/^[0-9]{6}$/);
    expect((pending.value as { expiresAt: number }).expiresAt).toBeGreaterThanOrEqual(requestedAt + 15 * 60_000);
    expect((pending.value as { expiresAt: number }).expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    const sentCount = vi.mocked(sendMail).mock.calls.length;
    expect((await issue(adminSession.token)).status).toBe(429);
    expect(vi.mocked(sendMail).mock.calls.length).toBe(sentCount);
    expect(JSON.stringify(pending.value)).not.toContain(code());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).email).toBe(admin.email);
    expect((await confirm(otherAdminSession.token, code())).status).toBe(400);
    await prisma.userPreference.update({ where: { id: pending.id }, data: {
      value: { ...(pending.value as Record<string, string | number>), expiresAt: Date.now() - 1000 },
      updatedAt: new Date(Date.now() - 61_000),
    } });
    expect((await confirm(adminSession.token, code())).status).toBe(400);
    expect((await issue(adminSession.token)).status).toBe(200);
    expect((await confirm(adminSession.token, code())).status).toBe(200);
    expect((await confirm(adminSession.token, code())).status).toBe(401);
    expect((await call('/auth/me', otherAdminSession.token)).status).toBe(401);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({ email, emailVerified: expect.any(Date) });
    expect(await prisma.userPreference.count({ where: preference })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: admin.id } })).toBe(0);
    expect((await request('/auth/login', 'POST', { email: admin.email, password }, false)).status).toBe(401);
    expect((await request('/auth/login', 'POST', { email, password }, false)).status).toBe(200);
  });
  it('persists five-attempt exhaustion across HTTP requests without extending or bypassing the resend cooldown', async () => {
    const password = 'Disposable!Otp2026';
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: 'profile-otp@camxian.com',
      firstName: 'OTP', lastName: 'Admin', passwordHash: await hashPassword(password), mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const session = await issueAuthSession(admin), otherSession = await issueAuthSession(admin);
    const call = (path: string, body: unknown, token = session.token) => fetch(base + '/auth/profile/email/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    const email = 'profile-otp@example.test';
    const issue = () => call('request', { email, currentPassword: password });
    const confirm = (code: string, token = session.token) => call('confirm', { code }, token);
    const preference = { tenantId, userId: admin.id, module: 'auth', key: 'profile-email-change' };
    const read = () => prisma.userPreference.findFirstOrThrow({ where: preference });
    const code = () => /<strong>([0-9]{6})<\/strong>/.exec(vi.mocked(sendMail).mock.lastCall![0].html)![1];
    vi.mocked(sendMail).mockResolvedValue({ submitted: true, messageId: 'fixture-otp' });
    expect((await issue()).status).toBe(200);
    const original = code();
    const wrong = original === '000000' ? '000001' : '000000';
    expect((await confirm(original, otherSession.token)).status).toBe(400);
    expect((await confirm('12345')).status).toBe(400);
    expect((await confirm('A'.repeat(32))).status).toBe(400);
    let row = await read();
    const issuedAt = (row.value as { issuedAt: number }).issuedAt;
    expect((row.value as { failedAttempts: number }).failedAttempts).toBe(0);
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await confirm(wrong)).status).toBe(400);
      expect(((await read()).value as { failedAttempts: number }).failedAttempts).toBe(attempt);
    }
    const concurrent = await Promise.all([confirm(wrong), confirm(wrong)]);
    expect(concurrent.map(response => response.status).sort()).toEqual([400, 429]);
    row = await read();
    expect(row.value).toMatchObject({ failedAttempts: 5, issuedAt });
    const exhausted = await confirm(original);
    expect(exhausted.status).toBe(429);
    expect((await exhausted.json()).error).toMatchObject({ code: 'PROFILE_EMAIL_CODE_ATTEMPTS_EXCEEDED' });
    expect((await issue()).status).toBe(429);
    // A recent counter update must not extend the issuance cooldown.
    await prisma.userPreference.update({ where: { id: row.id }, data: {
      value: { ...(row.value as Record<string, string | number>), issuedAt: Date.now() - 61_000 },
    } });
    expect((await issue()).status).toBe(200);
    const replacement = code();
    expect(replacement).not.toBe(original);
    expect(((await read()).value as { failedAttempts: number }).failedAttempts).toBe(0);
    expect((await confirm(original)).status).toBe(400);
    const verified = await Promise.all([confirm(replacement), confirm(replacement)]);
    expect(verified.filter(response => response.status === 200)).toHaveLength(1);
    expect(await prisma.userPreference.count({ where: preference })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).email).toBe(email);
  });
  it('requires a fresh code for a legacy challenge while retaining its resend cooldown', async () => {
    const password = 'Disposable!Legacy2026';
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: 'profile-legacy@camxian.com',
      firstName: 'Legacy', lastName: 'Admin', passwordHash: await hashPassword(password), mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const session = await issueAuthSession(admin);
    const preference = { tenantId, userId: admin.id, module: 'auth', key: 'profile-email-change' };
    const row = await prisma.userPreference.create({ data: { ...preference, value: { codeHash: '0'.repeat(64), expiresAt: Date.now() + 15 * 60_000 } } });
    const call = (path: string, body: unknown) => fetch(base + '/auth/profile/email/' + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify(body) });
    expect((await call('confirm', { code: '000000' })).status).toBe(400);
    const input = { email: 'profile-legacy@example.test', currentPassword: password };
    expect((await call('request', input)).status).toBe(429);
    await prisma.userPreference.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 61_000) } });
    expect((await call('request', input)).status).toBe(200);
    expect((await prisma.userPreference.findFirstOrThrow({ where: preference })).value).toMatchObject({ failedAttempts: 0, issuedAt: expect.any(Number) });
  });
  it.each(['rejected', 'not-submitted'] as const)('cleans up a %s verification delivery and allows retry without changing the email', async failure => {
    const password = 'Disposable!Delivery2026';
    const admin = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: `profile-delivery-${failure}@camxian.com`,
      firstName: 'Delivery', lastName: 'Admin', passwordHash: await hashPassword(password), mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const session = await issueAuthSession(admin);
    const email = `profile-delivery-${failure}@example.test`;
    const issue = () => fetch(base + '/auth/profile/email/request', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ email, currentPassword: password }) });
    if (failure === 'rejected') vi.mocked(sendMail).mockRejectedValueOnce(new Error('Provider unavailable'));
    else vi.mocked(sendMail).mockResolvedValueOnce({ submitted: false, messageId: null });
    expect((await issue()).status).toBe(503);
    const preference = { tenantId, userId: admin.id, module: 'auth', key: 'profile-email-change' };
    expect(await prisma.userPreference.count({ where: preference })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).email).toBe(admin.email);
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(1);
    vi.mocked(sendMail).mockResolvedValue({ submitted: true, messageId: 'fixture-email' });
    expect((await issue()).status).toBe(200);
    expect(await prisma.userPreference.count({ where: preference })).toBe(1);
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
    expect(await storage.countAvatars()).toBe(1);
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
    expect(await storage.countAvatars()).toBe(1);
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
