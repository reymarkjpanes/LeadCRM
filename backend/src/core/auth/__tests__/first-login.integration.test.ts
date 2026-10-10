import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import { replayCrmMigrations } from '../../../tests/replay-crm-migrations';

// Provider boundary only: these tests never send messages to real recipients.
const mail = vi.hoisted(() => vi.fn().mockResolvedValue({ submitted: true, messageId: 'test-provider-id' }));
vi.mock('../../../shared/services/email.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/services/email.service')>(), sendMail: mail,
}));
vi.mock('../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.FIRST_LOGIN_TEST_DATABASE_URL! } } }) }));
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, http: Server, base: string, tenantId: string, adminCookie: string;
const testers = [
  { email: 'tironjulieann10@gmail.com', firstName: 'Julie Ann', lastName: 'Tiron' },
  { email: 'reymarkjpanes@gmail.com', firstName: 'Reymark', lastName: 'Panes' },
];
async function call(path: string, body?: unknown, cookie = adminCookie) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json(), cookie: res.headers.getSetCookie().find(c => c.startsWith('leadcrm_token='))?.split(';')[0] ?? '' };
}
function credentialFor(email: string) {
  const args = mail.mock.calls.findLast(([args]) => args.to === email)?.[0];
  const password = args?.html.match(/Temporary Password:<\/strong><br \/><span[^>]*>([^<]+)<\/span>/)?.[1];
  if (!password) throw new Error('Expected a transient credential in the mocked welcome submission');
  return password as string;
}
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('JWT_SECRET', 'disposable-first-login-test-signing-key');
  vi.stubEnv('APP_URL', 'https://lead-crm.tech');
  vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'true');
  vi.stubEnv('LEADCRM_TEST_EMAIL_ALLOWLIST', testers.map(user => user.email).join(','));
  vi.stubEnv('LEADCRM_PRODUCTION_AUTH_ENABLED', 'false');
  pg = await PGlite.create();
  await replayCrmMigrations(pg, '20261104000000');
  // Verify the migration preserves established users and leaves temporary users pending.
  await pg.exec(`INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('existing-tenant','Existing','existing',NOW());
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"mustChangePassword","updatedAt") VALUES
    ('established','existing-tenant','existing@camxian.com','Existing','User','Client Admin',false,NOW()),
    ('pending','existing-tenant','pending@camxian.com','Pending','User','Sales',true,NOW());`);
  await replayCrmMigrations(pg, '20261112000000', '20261104000000');
  // Disposable fixture serves the current Lead contract; production guards stay intact.
  await pg.exec(`COMMENT ON TABLE "Lead" IS 'lead-form-contract-api-verified-v1'`);
  await replayCrmMigrations(pg, undefined, '20261112000000');
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 });
  await socket.start();
  vi.stubEnv('FIRST_LOGIN_TEST_DATABASE_URL', `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`);
  db = (await import('../../../config/database.config')).default;
  tenantId = (await db.tenant.create({ data: { name: 'First login tests', slug: 'first-login', status: 'ACTIVE' } })).id;
  await db.roleDefinition.create({ data: { tenantId, name: 'Client Admin', isSystemRole: true } });
  await db.roleDefinition.create({ data: { tenantId, name: 'Limited tester', isSystemRole: false } });
  const { hashPassword } = await import('../../../shared/helpers/crypto');
  const admin = await db.user.create({ data: { tenantId, email: 'admin@camxian.com', firstName: 'Existing', lastName: 'Admin', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date(), passwordHash: await hashPassword('ExistingAdmin1!') } });
  const { issueAuthSession } = await import('../auth-session');
  adminCookie = `leadcrm_token=${(await issueAuthSession(admin)).token}`;
  http = (await import('../../../app')).default.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => http.once('listening', resolve));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/v1`;
}, 60_000);
afterAll(async () => {
  if (http) await new Promise<void>(resolve => http.close(() => resolve()));
  await db?.$disconnect(); await socket?.stop(); await pg?.close(); vi.unstubAllEnvs();
});

describe.sequential('first login with real sessions and migrated disposable PostgreSQL', () => {
  it('grandfathers established accounts without resetting credentials or temporary-password flags', async () => {
    expect((await db.user.findUniqueOrThrow({ where: { id: 'established' } })).onboardingCompletedAt).toBeInstanceOf(Date);
    expect(await db.user.findUniqueOrThrow({ where: { id: 'pending' } })).toMatchObject({ mustChangePassword: true, onboardingCompletedAt: null });
  });
  it('creates the selected custom role atomically, stores only a hash, and keeps RBAC after onboarding', async () => {
    const input = { firstName: 'New', lastName: 'Employee', email: 'new@camxian.com', phone: '9171234567', role: 'Limited tester' };
    const response = await call('/administration/users', input);
    expect(response.status).toBe(201);
    expect(response.body.data.setupEmailSent).toBe(true);
    const password = credentialFor(input.email);
    expect(password).toMatch(/^new\.employee\d{2}$/);
    const stored = await db.user.findUniqueOrThrow({ where: { id: response.body.data.id }, include: { userRoles: { include: { role: true } } } });
    expect(stored).toMatchObject({ mustChangePassword: true, onboardingCompletedAt: null });
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.userRoles.map(r => r.role.name)).toEqual(['Limited tester']);
    const { comparePassword } = await import('../../../shared/helpers/crypto');
    expect(await comparePassword(password, stored.passwordHash!)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(password);
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: stored.id } }))).not.toContain(password);
    expect((await call('/administration/users', input)).status).toBe(409);
    let auth = await call('/auth/login', { email: input.email, password }, '');
    expect(auth.status).toBe(200);
    const cookie = auth.cookie;
    expect((await call('/crm/leads', undefined, cookie)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await call('/auth/change-password', { password: 'NewPermanent1!' }, cookie)).status).toBe(200);
    expect((await call('/administration/users', undefined, cookie)).body.error.code).toBe('ONBOARDING_REQUIRED');
    expect((await call('/auth/onboarding/complete', {}, cookie)).status).toBe(200);
    expect((await call('/administration/users', undefined, cookie)).status).toBe(403);
    expect((await call('/crm/leads', undefined, cookie)).status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: stored.id } })).role).toBe('Limited tester');
  });
  it.each(['not-submitted', 'rejected', 'network'])('returns safe account-created status when welcome transport is %s', async mode => {
    if (mode === 'not-submitted') mail.mockResolvedValueOnce({ submitted: false });
    else mail.mockRejectedValueOnce(new Error('private provider failure'));
    const input = { firstName: 'Email', lastName: 'Failure', email: `${mode}@camxian.com`, phone: '9171234567', role: 'Limited tester' };
    const result = await call('/administration/users', input);
    expect(result.status).toBe(201);
    expect(result.body.data.setupEmailSent).toBe(false);
    expect(JSON.stringify(result.body)).not.toMatch(/private provider failure|passwordHash|email\.failure\d{2}/);
    expect(await db.user.count({ where: { tenantId, email: input.email } })).toBe(1);
    expect((await call('/administration/users', input)).status).toBe(409);
  });
  it.each(testers)('exercises the complete flow for $email in a disposable development fixture', async tester => {
    const { provisionTestUser } = await import('../provision-test-user.service');
    const provisioned = await provisionTestUser({ tenantId, ...tester });
    expect(provisioned).toMatchObject({ status: 'created', submitted: true });
    const password = credentialFor(tester.email);
    let auth = await call('/auth/login', { email: tester.email, password }, '');
    expect(auth.status).toBe(200);
    expect(auth.body.data.user.mustChangePassword).toBe(true);
    const cookie = auth.cookie;
    const id = auth.body.data.user.id;
    const other = await call('/auth/login', { email: tester.email, password }, '');
    for (const path of ['/crm/leads', '/crm/contacts', '/crm/deals', '/administration/users', '/auth/onboarding/status']) {
      expect((await call(path, undefined, cookie)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    expect((await call('/auth/onboarding/complete', {}, cookie)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const reuse = await call('/auth/change-password', { password }, cookie);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toMatchObject({ code: 'PASSWORD_REUSE', message: 'You cannot reuse your temporary password. Please choose a new password.' });
    expect((await call('/auth/change-password', { password: 'weak' }, cookie)).status).toBe(400);
    await db.passwordResetToken.create({ data: { userId: id, email: tester.email, token: `old-reset-${id}`, expires: new Date(Date.now() + 60_000) } });
    const permanent = 'DifferentPermanent1!';
    const changed = await call('/auth/change-password', { password: permanent }, cookie);
    expect(changed.status).toBe(200);
    expect(changed.body.data.user).toMatchObject({ mustChangePassword: false, onboardingCompletedAt: null });
    expect((await call('/auth/me', undefined, other.cookie)).status).toBe(401);
    expect(await db.passwordResetToken.count({ where: { userId: id } })).toBe(0);
    expect((await call('/crm/leads', undefined, cookie)).body.error.code).toBe('ONBOARDING_REQUIRED');
    expect((await call('/auth/onboarding/status', undefined, cookie)).status).toBe(200);
    const completed = await call('/auth/onboarding/complete', {}, cookie);
    expect(completed.status).toBe(200);
    expect(completed.body.data.user.onboardingCompletedAt).toBeTruthy();
    expect((await call('/auth/onboarding/complete', {}, cookie)).body.data.user.onboardingCompletedAt).toBe(completed.body.data.user.onboardingCompletedAt);
    expect((await call('/crm/leads', undefined, cookie)).status).toBe(200);
    expect((await call('/auth/logout', {}, cookie)).status).toBe(200);
    auth = await call('/auth/login', { email: tester.email, password: permanent }, '');
    expect(auth.status).toBe(200);
    expect(auth.body.data.user).toMatchObject({ mustChangePassword: false, onboardingCompletedAt: completed.body.data.user.onboardingCompletedAt });
    expect((await call('/auth/login', { email: tester.email, password }, '')).status).toBe(401);
    expect(await db.auditLog.count({ where: { userId: id, action: 'PASSWORD_CHANGED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: id, action: 'ONBOARDING_COMPLETED' } })).toBe(1);
    const before = await db.user.findUniqueOrThrow({ where: { id } });
    expect(await provisionTestUser({ tenantId, ...tester, email: tester.email.toUpperCase() })).toMatchObject({ status: 'preserved', submitted: false });
    expect(await db.user.findUniqueOrThrow({ where: { id } })).toEqual(before);
    vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'false');
    expect((await call('/auth/me', undefined, auth.cookie)).status).toBe(403);
    expect((await call('/auth/login', { email: tester.email, password: permanent }, '')).status).toBe(403);
    vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    expect((await call('/auth/me', undefined, auth.cookie)).status).toBe(403);
    await expect(provisionTestUser({ tenantId, ...tester, reissue: true })).rejects.toHaveProperty('statusCode', 403);
    vi.stubEnv('NODE_ENV', 'test');
  }, 20_000);
  it('rejects non-allowlisted Gmail provisioning', async () => {
    const { provisionTestUser } = await import('../provision-test-user.service');
    await expect(provisionTestUser({ tenantId, email: 'other@gmail.com', firstName: 'Other', lastName: 'User' })).rejects.toHaveProperty('statusCode', 403);
    expect(await db.user.count({ where: { email: 'other@gmail.com' } })).toBe(0);
  });
  it.each(testers)('supports separately authorized production access for $email with normal gates', async tester => {
    const { provisionTestUser } = await import('../provision-test-user.service');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEADCRM_PRODUCTION_AUTH_ENABLED', 'true');
    vi.stubEnv('LEADCRM_PRODUCTION_EMAIL_ALLOWLIST', testers.map(t => t.email).join(','));
    try {
      await expect(provisionTestUser({ tenantId, ...tester })).rejects.toHaveProperty('statusCode', 403);
      await expect(provisionTestUser({ tenantId, email: 'other@gmail.com', firstName: 'Other', lastName: 'User', production: true })).rejects.toHaveProperty('statusCode', 403);
      expect(await provisionTestUser({ tenantId, ...tester, reissue: true, production: true })).toMatchObject({ status: 'reissued', submitted: true });
      const password = credentialFor(tester.email);
      expect((await call('/auth/login', { email: tester.email, password: 'Wrong1!' }, '')).status).toBe(401);
      const auth = await call('/auth/login', { email: tester.email, password }, '');
      expect(auth.status).toBe(200);
      expect((await call('/crm/leads', undefined, auth.cookie)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await call('/auth/change-password', { password }, auth.cookie)).body.error.code).toBe('PASSWORD_REUSE');
      expect((await call('/auth/change-password', { password: 'ProductionPermanent1!' }, auth.cookie)).status).toBe(200);
      expect((await call('/crm/leads', undefined, auth.cookie)).body.error.code).toBe('ONBOARDING_REQUIRED');
      expect((await call('/auth/onboarding/complete', {}, auth.cookie)).status).toBe(200);
      expect((await call('/crm/leads', undefined, auth.cookie)).status).toBe(200);
      vi.stubEnv('LEADCRM_PRODUCTION_AUTH_ENABLED', 'false');
      expect((await call('/auth/me', undefined, auth.cookie)).status).toBe(403);
      expect((await call('/auth/login', { email: tester.email, password: 'ProductionPermanent1!' }, '')).status).toBe(403);
    } finally {
      vi.stubEnv('LEADCRM_PRODUCTION_AUTH_ENABLED', 'false');
      vi.stubEnv('NODE_ENV', 'test');
    }
  }, 20_000);
  it('reissues fresh credentials deliberately, revokes prior sessions, and rejects a repeated random draw', async () => {
    const { provisionTestUser } = await import('../provision-test-user.service');
    const generator = await import('../temporary-password');
    const tester = testers[0];
    await provisionTestUser({ tenantId, ...tester, reissue: true });
    const oldPassword = credentialFor(tester.email);
    const auth = await call('/auth/login', { email: tester.email, password: oldPassword }, '');
    expect(auth.status).toBe(200);
    const digits = ((Number(oldPassword.slice(-2)) + 1) % 100).toString().padStart(2, '0');
    const nextPassword = oldPassword.slice(0, -2) + digits;
    const generate = vi.spyOn(generator, 'generateTemporaryPassword').mockReturnValueOnce(oldPassword).mockReturnValueOnce(nextPassword);
    try {
      expect(await provisionTestUser({ tenantId, ...tester, reissue: true })).toMatchObject({ status: 'reissued', submitted: true });
      expect(generate).toHaveBeenCalledTimes(2);
      expect((await call('/auth/me', undefined, auth.cookie)).status).toBe(401);
      expect((await call('/auth/login', { email: tester.email, password: oldPassword }, '')).status).toBe(401);
      const fresh = await call('/auth/login', { email: tester.email, password: nextPassword }, '');
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.user).toMatchObject({ mustChangePassword: true, onboardingCompletedAt: null });
      expect(await db.user.count({ where: { tenantId, email: tester.email } })).toBe(1);
    } finally { generate.mockRestore(); }
  });
  it('password recovery establishes a strong password but does not bypass onboarding', async () => {
    const target = await db.user.findFirstOrThrow({ where: { tenantId, email: 'not-submitted@camxian.com' } });
    expect((await call('/auth/forgot-password', { email: target.email }, '')).status).toBe(200);
    const token = mail.mock.calls.findLast(([args]) => args.to === target.email)?.[0].html.match(/reset-password\?token=([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();
    expect((await call('/auth/reset-password', { token, password: 'Recovered1!' }, '')).status).toBe(200);
    const auth = await call('/auth/login', { email: target.email, password: 'Recovered1!' }, '');
    expect(auth.body.data.user).toMatchObject({ mustChangePassword: false, onboardingCompletedAt: null });
    expect((await call('/crm/leads', undefined, auth.cookie)).body.error.code).toBe('ONBOARDING_REQUIRED');
  });
});
