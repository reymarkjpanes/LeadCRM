import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import { hashSync } from 'bcryptjs';
import { replayCrmMigrations } from '../../../tests/replay-crm-migrations';
import { createHash } from 'node:crypto';
const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

vi.mock('../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.SECURITY_TEST_DATABASE_URL! } } }) }));
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, http: Server, url: string;
let cookie = '', otherCookie = '', userId = '', tenantId = '';
const initialPassword = 'Temporary1!';
const newPassword = ' Camxian2026! ';
const email = 'security@camxian.com';
const cleanupMigration = '20261016000000_remove_two_factor_and_obsolete_account_fields';
const preservedTables = ['User', 'Account', 'Session', 'EmailVerificationToken', 'PasswordResetToken', 'AuditLog', 'RolePermission'];
const snapshots = new Map<string, unknown[]>();
const removedUserFields = ['mfaEnabled', 'mfaEnabledAt', 'mfaLastCounter', 'mfaPendingExpiresAt', 'mfaPendingSecretEncrypted', 'mfaSecretEncrypted'];
const removedAccountFields = ['taxId', 'customerType', 'customerSince'];
async function snapshot(table: string) {
  const removed = table === 'User' ? removedUserFields : table === 'Account' ? removedAccountFields : [];
  const result = await pg.query<Record<string, unknown>>(`SELECT * FROM "${table}" ORDER BY id`);
  return result.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !removed.includes(key))));
}
async function call(path: string, body?: unknown, auth = cookie) {
  const response = await fetch(`${url}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: auth } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null,
    cookies: response.headers.getSetCookie().map(value => value.split(';')[0]) };
}
async function login(password = newPassword) { return call('/auth/login', { email, password }, ''); }

beforeAll(async () => {
  process.env.JWT_SECRET = 'disposable-security-test-signing-key';
  pg = await PGlite.create();
  await replayCrmMigrations(pg, '20261007000000');
  // Preserve populated unrelated data and verify permission cleanup, not just empty DDL.
  await pg.exec(`INSERT INTO "Tenant" (id,name,slug,"updatedAt",domain) VALUES ('migration-tenant','Migration','migration',NOW(),'company.example');
    INSERT INTO "RoleDefinition" (id,"tenantId",name,"updatedAt") VALUES ('migration-role','migration-tenant','Sales',NOW());
    INSERT INTO "RolePermission" (id,"tenantId","roleId",module) VALUES ('retired','migration-tenant','migration-role','billing'),('retained','migration-tenant','migration-role','contacts');
    INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('migration-user','migration-tenant','migration@camxian.com','Migration','User','Sales',NOW());
    INSERT INTO "Invoice" (id,"tenantId","invoiceNumber",amount,"totalAmount",frequency,"startDate","updatedAt") VALUES ('retired-invoice','migration-tenant','OLD-001',100,100,'Monthly',NOW(),NOW());
    INSERT INTO "Activity" (id,"tenantId","createdById",type,title,"invoiceId") VALUES ('keep-activity','migration-tenant','migration-user','note','Historical record','retired-invoice');`);
  for (const name of readdirSync(resolve(__dirname, '../../../../prisma/migrations')).filter(name => name >= '20261007000000' && /^\d/.test(name)).sort()) {
    const migrationPath = resolve(__dirname, '../../../../prisma/migrations', name, 'migration.sql');
    if (!existsSync(migrationPath)) continue;
    // This fixture first proves the older security cleanup preserves tokens.
    // The later unreachable-flow retirement requires those fixtures cleared.
    if (name === '20261031000000_retire_obsolete_infrastructure') await pg.exec('DELETE FROM "EmailVerificationToken"');
    // This in-memory fixture exercises the new code directly, without a hosted deployment.
    if (name === '20261102000000_retire_relationship_compatibility') await pg.exec(`COMMENT ON TABLE "MailboxThreadAssociation" IS 'canonical-crm-relations-api-verified-v1'`);
    if (name === '20261112000000_retire_lead_nonform_columns') await pg.exec(`COMMENT ON TABLE "Lead" IS 'lead-form-contract-api-verified-v1'`);
    if (name === cleanupMigration) {
      await pg.query(`UPDATE "User" SET "passwordHash"=$1, "mfaEnabled"=true, "mfaSecretEncrypted"='old-secret', "passwordChangedAt"=NOW() WHERE id='migration-user'`, [hashSync(initialPassword, 4)]);
      await pg.exec(`
        INSERT INTO "MfaChallenge" (id,"userId","tokenHash","expiresAt") VALUES ('old-challenge','migration-user','old-challenge-hash',NOW());
        INSERT INTO "MfaRecoveryCode" (id,"userId","codeHash") VALUES ('old-code','migration-user','old-code-hash');
        INSERT INTO "Account" (id,"tenantId",name,"taxId","customerType","customerSince","updatedAt",tags,"productInterests","activeProducts") VALUES ('migration-account','migration-tenant','Preserved Account','012345678','Active Customer',NOW(),NOW(),ARRAY['keep'],ARRAY[]::TEXT[],ARRAY['CCTV']);
        INSERT INTO "Session" (id,"tenantId","userId","tokenHash","expiresAt") VALUES ('keep-session','migration-tenant','migration-user','keep-session-hash',NOW()+INTERVAL '1 day');
        INSERT INTO "EmailVerificationToken" (id,"userId",email,"tokenHash","expiresAt") VALUES ('keep-verification','migration-user','migration@camxian.com','keep-verification-hash',NOW()+INTERVAL '1 day');
        INSERT INTO "PasswordResetToken" (id,"userId",email,token,expires) VALUES ('keep-reset','migration-user','migration@camxian.com','keep-reset-token',NOW()+INTERVAL '1 day');
        INSERT INTO "AuditLog" (id,"tenantId","userId",action,"entityType") VALUES ('keep-audit','migration-tenant','migration-user','MFA_ENABLED','User');
      `);
      for (const table of preservedTables) snapshots.set(table, await snapshot(table));
    }
    await pg.exec(readFileSync(migrationPath, 'utf8'));
    if (name === cleanupMigration) {
      for (const table of preservedTables) expect(await snapshot(table)).toEqual(snapshots.get(table));
    }
  }
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 });
  await socket.start();
  process.env.SECURITY_TEST_DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  db = (await import('../../../config/database.config')).default;
  const { hashPassword } = await import('../../../shared/helpers/crypto');
  const tenant = await db.tenant.create({ data: { name: 'Security test', slug: 'security-test', status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  tenantId = tenant.id;
  const user = await db.user.create({ data: { tenantId, email, firstName: 'Security', lastName: 'Test', role: 'Client Admin', passwordHash: await hashPassword(initialPassword), mustChangePassword: false, onboardingCompletedAt: new Date() } });
  userId = user.id;
  http = createServer((await import('../../../app')).default);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/v1`;
}, 60_000);
afterAll(async () => { if (http) await new Promise<void>(resolve => http.close(() => resolve())); await db?.$disconnect(); await socket?.stop(); await pg?.close(); });

describe.sequential('security flows on migrated PostgreSQL', () => {
  it('drops only the retired tables and columns, preserving populated auth and Account data', async () => {
    expect(snapshots.size).toBe(preservedTables.length);
    expect((await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('MfaChallenge','MfaRecoveryCode')`)).rows).toEqual([]);
    const columns = (await pg.query<{ table_name: string; column_name: string }>(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`)).rows;
    for (const [table, fields] of [['User', removedUserFields], ['Account', removedAccountFields]] as const) {
      for (const field of fields) expect(columns).not.toContainEqual({ table_name: table, column_name: field });
    }
    expect(columns).toContainEqual({ table_name: 'User', column_name: 'passwordChangedAt' });
    expect(columns).toContainEqual({ table_name: 'Contact', column_name: 'customerType' });
    expect(columns).toContainEqual({ table_name: 'Contact', column_name: 'customerSince' });
  });
  it('allows a formerly enrolled user to sign in normally with a password', async () => {
    const result = await call('/auth/login', { email: 'migration@camxian.com', password: initialPassword }, '');
    expect(result.status).toBe(200);
    expect(result.body.data.user.id).toBe('migration-user');
    expect(result.body.data).not.toHaveProperty('mfaRequired');
    expect(result.cookies.some(cookie => cookie.startsWith('leadcrm_token='))).toBe(true);
  });
  it.each(['status', 'setup', 'enable', 'verify', 'disable', 'recovery-codes/regenerate'])('does not expose retired %s routes', async path => {
    expect((await call(`/auth/mfa/${path}`, path === 'status' ? undefined : {}, '')).status).toBe(404);
  });
  it('drops retired structures and permissions while preserving company domain and CRM permission data', async () => {
    expect((await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('PricingPlan','PlanFeature','Invoice','Subscription','PaymentMethod','PaymentTransaction','StripeWebhookEvent','TenantDomain','TenantDomainSettings')`)).rows).toHaveLength(0);
    expect((await db.rolePermission.findMany({ where: { roleId: 'migration-role' } })).map(p => p.module).sort()).toEqual(['contacts', 'leads']);
    expect(await db.tenant.findUnique({ where: { id: 'migration-tenant' } })).toHaveProperty('domain', 'company.example');
    expect(await db.activity.findUnique({ where: { id: 'keep-activity' } })).toHaveProperty('title', 'Historical record');
  });
  it('logs in and keeps the active session while changing password', async () => {
    const first = await login(initialPassword); cookie = first.cookies.find(c => c.startsWith('leadcrm_token='))!;
    otherCookie = (await login(initialPassword)).cookies.find(c => c.startsWith('leadcrm_token='))!;
    const result = await call('/auth/change-password', { password: newPassword });
    expect(result.status).toBe(200);
    expect(result.body.data.user.passwordChangedAt).toBeTruthy();
    expect((await call('/auth/me')).status).toBe(200);
    expect((await call('/auth/me', undefined, otherCookie)).status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordChangedAt).toBeInstanceOf(Date);
  });
  it.each(['Ab1!', 'camxian2026!', 'CAMXIAN2026!', 'CamxianPassword!', 'Camxian2026'])('rejects invalid password %s without changing the database', async password => {
    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect((await call('/auth/change-password', { password })).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe(before.passwordHash);
  });
  it('rejects unauthenticated password changes and password reuse', async () => {
    expect((await call('/auth/change-password', { password: 'Another2026!' }, '')).status).toBe(401);
    expect((await call('/auth/change-password', { password: newPassword })).status).toBe(400);
  });
  it('creates, edits and reads Accounts without retired fields and enforces tenant and permission checks', async () => {
    const created = await call('/crm/accounts', { name: 'Clean Account', country: 'Philippines' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const response = await fetch(`${url}/crm/accounts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Updated Account', industry: 'IT', taxId: 'obsolete', customerType: 'obsolete', customerSince: 'obsolete' }) });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.data).toMatchObject({ name: 'Updated Account', industry: 'IT', country: 'Philippines' });
    const detail = await call(`/crm/accounts/${id}`);
    const list = await call('/crm/accounts');
    expect(detail.status).toBe(200);
    expect(list.status).toBe(200);
    for (const value of [created.body.data, updated.data, detail.body.data, ...list.body.data, await db.account.findUniqueOrThrow({ where: { id } })]) {
      for (const field of removedAccountFields) expect(value).not.toHaveProperty(field);
    }
    expect((await call('/crm/accounts/migration-account')).status).toBe(404);
    expect((await call('/crm/accounts', undefined, '')).status).toBe(401);
    const reader = await db.user.create({ data: { tenantId, email: 'reader@camxian.com', firstName: 'Read', lastName: 'Only', role: 'Viewer', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const { issueAuthSession } = await import('../auth-session');
    const readCookie = `leadcrm_token=${(await issueAuthSession(reader)).token}`;
    expect((await call('/crm/accounts', { name: 'Forbidden' }, readCookie)).status).toBe(403);
  });
  it('rejects invalid and expired reset links without changing the password', async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect((await call('/auth/reset-password', { token: 'missing-reset', password: 'NewPassword2026!' }, '')).status).toBe(400);
    await db.passwordResetToken.create({ data: { userId, email, token: hashResetToken('expired-reset'), expires: new Date(Date.now() - 60_000) } });
    expect((await call('/auth/reset-password', { token: 'expired-reset', password: 'NewPassword2026!' }, '')).status).toBe(400);
    expect(await db.passwordResetToken.findUnique({ where: { token: hashResetToken('expired-reset') } })).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe(before.passwordHash);
  });
  it('resets a password with a one-use token, revokes sessions, then supports login and logout', async () => {
    const token = 'a'.repeat(64);
    await db.passwordResetToken.create({ data: { userId, email, token: hashResetToken(token), expires: new Date(Date.now() + 60_000) } });
    const password = 'ResetPassword2026!';
    expect((await call('/auth/reset-password', { token, password }, '')).status).toBe(200);
    expect((await call('/auth/me')).status).toBe(401);
    expect((await call('/auth/reset-password', { token, password }, '')).status).toBe(400);
    expect((await login(newPassword)).status).toBe(401);
    const signedIn = await login(password);
    expect(signedIn.status).toBe(200);
    cookie = signedIn.cookies.find(value => value.startsWith('leadcrm_token='))!;
    expect((await call('/auth/me')).status).toBe(200);
    expect((await call('/auth/logout', {})).status).toBe(200);
    expect((await call('/auth/me')).status).toBe(401);
    expect(await db.auditLog.count({ where: { userId, action: 'PASSWORD_CHANGED' } })).toBe(1);
  });
});
