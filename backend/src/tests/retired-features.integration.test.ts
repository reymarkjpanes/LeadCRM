import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { replayCrmMigrations } from './replay-crm-migrations';

vi.mock('../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.RETIREMENT_TEST_DATABASE_URL! } } }) }));
const migration = '20261025000000_remove_system_admin_and_legacy_auth_documents';
const removed = ['SystemAdmin', 'TenantDocument', 'RegistrationOtpToken', 'OAuthAccount', 'VerificationToken'];
const preserved = ['Activity', 'AuditLog', 'EmailAccount', 'MailboxMessage', 'MailboxOAuthState', 'RecordFile', 'DealStageHistory', 'PasswordResetToken', 'EmailVerificationToken', 'Task', 'Lead', 'Contact', 'Account', 'Deal'];
const snapshots = new Map<string, unknown[]>();
let historicalRowsPreserved = false;
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, server: Server, url: string, token: string;
let tenantId: string, userId: string, operatorId: string, seedOperatorId: string, staffId: string;
let records: { leads: string; contacts: string; accounts: string; deals: string };
async function snapshot(table: string) { return (await pg.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows; }
// Historical fixtures use the historical catalog rather than today's generated client.
async function historicalCreate(table: string, data: Record<string, unknown>): Promise<any> {
  const columns = (await pg.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1', [table])).rows.map(row => row.column_name);
  const values = { id: randomUUID(), updatedAt: new Date(), ...data };
  const keys = Object.keys(values).filter(key => columns.includes(key));
  const names = keys.map(key => `"${key}"`).join(',');
  return (await pg.query(`INSERT INTO "${table}" (${names}) SELECT ${names} FROM jsonb_populate_record(NULL::"${table}",$1::jsonb) RETURNING *`, [JSON.stringify(Object.fromEntries(keys.map(key => [key, values[key as keyof typeof values]])))])).rows[0];
}
async function call(path: string, body?: unknown) {
  const res = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-retirement-test-signing-key';
  pg = await PGlite.create(); await replayCrmMigrations(pg, migration);
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
  process.env.RETIREMENT_TEST_DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  db = (await import('../config/database.config')).default;
  tenantId = (await db.tenant.create({ data: { name: 'Retirement regression', slug: 'retirement', status: 'ACTIVE', onboardingCompletedAt: new Date(), onboardingStep: 3 } })).id;
  const identity = async (email: string, role: string, tenant = tenantId) => historicalCreate('User', { tenantId: tenant, email, role, firstName: 'Preserved', lastName: 'Identity', mustChangePassword: false, passwordHash: 'unchanged-hash' });
  userId = (await identity('admin@camxian.com', 'Client Admin')).id;
  operatorId = (await identity('legacy@camxian.com', 'System Admin')).id;
  const isolatedTenant = (await db.tenant.create({ data: { name: 'Legacy seed tenant', slug: 'leadcrm-system' } })).id;
  seedOperatorId = (await identity('operator@example.test', 'SYSTEM_ADMIN', isolatedTenant)).id;
  staffId = (await identity('sales@camxian.com', 'Sales')).id;
  const oldRole = await db.roleDefinition.create({ data: { tenantId, name: 'System-Admin', isSystemRole: true } });
  const salesRole = await db.roleDefinition.create({ data: { tenantId, name: 'Sales' } });
  await historicalCreate('RolePermission', { tenantId, roleId: salesRole.id, module: 'contacts', canView: true });
  for (const id of [operatorId, staffId]) await db.userRole.create({ data: { tenantId, userId: id, roleId: oldRole.id } });
  await db.userRole.create({ data: { tenantId, userId: staffId, roleId: salesRole.id } });
  await historicalCreate('RolePermission', { tenantId, roleId: oldRole.id, module: 'admin', canView: true });
  const { createAuthSessionToken } = await import('../core/auth/auth-session');
  for (const id of [userId, operatorId, seedOperatorId, staffId]) {
    const user = await db.user.findUniqueOrThrow({ where: { id }, select: { id: true, tenantId: true, role: true, email: true } });
    if (id === userId) token = await createAuthSessionToken(user);
    else await db.session.create({ data: { userId: id, tenantId: user.tenantId, tokenHash: `old-session-${id}`, expiresAt: new Date(Date.now() + 60000) } });
  }
  const account = await historicalCreate('Account', { tenantId, name: 'Preserved company' });
  const lead = await historicalCreate('Lead', { tenantId, accountId: account.id, firstName: 'Lead', lastName: 'History', email: 'lead@example.test' });
  const contact = await historicalCreate('Contact', { tenantId, accountId: account.id, firstName: 'Contact', lastName: 'History', email: 'contact@example.test' });
  const pipeline = await db.pipeline.create({ data: { tenantId, name: 'Sales' } });
  const stage = await db.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
  const deal = await historicalCreate('Deal', { tenantId, pipelineId: pipeline.id, stageId: stage.id, title: 'Preserved deal', leadId: lead.id, contactId: contact.id, accountId: account.id, value: 20 });
  records = { leads: lead.id, contacts: contact.id, accounts: account.id, deals: deal.id };
  const links = { leadId: lead.id, contactId: contact.id, accountId: account.id, dealId: deal.id };
  const task = await historicalCreate('Task', { tenantId, title: 'Preserved task', dueDate: new Date(), assignedUserId: userId, ...links });
  const mailbox = await historicalCreate('EmailAccount', { tenantId, userId, email: 'admin@camxian.com', accessToken: 'encrypted-access-unchanged', refreshToken: 'encrypted-refresh-unchanged', scopes: ['gmail.modify'], syncCursor: 'preserved-cursor' });
  const message = await historicalCreate('MailboxMessage', { tenantId, accountId: mailbox.id, providerMessageId: 'gmail-message', threadId: 'thread', direction: 'inbound', from: 'lead@example.test', recipients: ['admin@camxian.com'], subject: 'Preserved email', body: 'Original email body', snippet: 'Original', labels: ['INBOX'], sentAt: new Date(), leadId: lead.id, contactId: contact.id });
  await db.mailboxOAuthState.create({ data: { tenantId, userId, stateHash: 'preserved-state', sessionHash: 'session-hash', verifier: 'encrypted-verifier', expiresAt: new Date(Date.now() + 60000) } });
  for (const type of ['email', 'task', 'stage_change', 'workflow', 'note']) await db.activity.create({ data: { tenantId, createdById: userId, type, title: `Preserved ${type}`, ...links, taskId: task.id, metadata: type === 'email' ? { mailboxMessageId: message.id } : {} } });
  await db.auditLog.create({ data: { tenantId, userId, action: 'user.updated', entityType: 'User', entityId: userId } });
  await db.dealStageHistory.create({ data: { tenantId, dealId: deal.id, newStageId: stage.id, movedById: userId } });
  await historicalCreate('RecordFile', { tenantId, uploadedById: userId, leadId: lead.id, name: 'preserved.pdf', size: 12, type: 'application/pdf', objectKey: 'preserved-object-key' });
  await db.passwordResetToken.create({ data: { userId, email: 'admin@camxian.com', token: 'preserved-reset', expires: new Date(Date.now() + 60000) } });
  await pg.query('INSERT INTO "EmailVerificationToken" (id,"userId",email,"tokenHash","expiresAt") VALUES ($1,$2,$3,$4,$5)', ['preserved-verification',userId,'admin@camxian.com','preserved-verification',new Date(Date.now()+60000)]);
  await pg.query('INSERT INTO "TenantDocument" (id,"tenantId","documentKey","fileName","filePath") VALUES ($1,$2,$3,$4,$5)', ['old-doc', tenantId, 'business', 'business.pdf', '/retired/document']);
  await pg.exec(`INSERT INTO "RegistrationOtpToken" (id,email,"codeHash",expires) VALUES ('old-otp','retired@example.test','old-hash',NOW());
    INSERT INTO "VerificationToken" (id,identifier,token,expires) VALUES ('old-token','retired@example.test','old-token',NOW());`);
  await pg.query('INSERT INTO "OAuthAccount" (id,"userId","tenantId",provider,"providerAccountId","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())', ['old-oauth', operatorId, tenantId, 'google', 'old-provider']);
  for (const table of preserved) snapshots.set(table, await snapshot(table));
  const sql = readFileSync(resolve(__dirname, '../../prisma/migrations', migration, 'migration.sql'), 'utf8');
  await pg.exec(`INSERT INTO "SystemAdmin" (id,email,"firstName","lastName","passwordHash","updatedAt") VALUES ('unmapped','unmapped@example.test','Legacy','Operator','hash',NOW())`);
  await expect(pg.exec(sql)).rejects.toThrow('Map standalone operator identities');
  await pg.exec('ROLLBACK');
  expect((await snapshot('SystemAdmin')).length).toBe(1);
  await pg.exec('DELETE FROM "SystemAdmin" WHERE id=\'unmapped\'');
  await pg.exec(sql);
  for (const table of preserved) expect(await snapshot(table), table).toEqual(snapshots.get(table));
  historicalRowsPreserved = true;
  // The assertion above belongs to this historical migration. API regressions use
  // the current schema, including its independent, guarded retirement phases.
  await replayCrmMigrations(pg, '20261031000000_retire_obsolete_infrastructure', '20261026000000');
  await pg.exec('DELETE FROM "EmailVerificationToken"');
  await replayCrmMigrations(pg, '20261102000000_retire_relationship_compatibility', '20261031000000');
  await pg.exec(`COMMENT ON TABLE "MailboxThreadAssociation" IS 'canonical-crm-relations-api-verified-v1'`);
  await replayCrmMigrations(pg, '20261112000000_retire_lead_nonform_columns', '20261102000000');
  await pg.exec(`COMMENT ON TABLE "Lead" IS 'lead-form-contract-api-verified-v1'`);
  await replayCrmMigrations(pg, undefined, '20261112000000');
  server = (await import('../app')).default.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
}, 60000);
afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await db?.$disconnect(); await socket?.stop(); await pg?.close(); });

describe('forward retirement migration and retained APIs', () => {
  it('drops obsolete models and tables while preserving populated history, email tokens, files, and records exactly', async () => {
    for (const table of removed) expect((await pg.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename=$1', [table])).rows).toEqual([]);
    expect(historicalRowsPreserved).toBe(true);
    for (const model of removed) expect(Prisma.dmmf.datamodel.models.some(item => item.name === model)).toBe(false);
  });
  it('preserves all identities and normal grants, synchronizes role junctions, and revokes only affected sessions', async () => {
    expect(await db.user.count()).toBe(4);
    for (const id of [operatorId, seedOperatorId]) {
      const user = await db.user.findUniqueOrThrow({ where: { id }, include: { userRoles: { include: { role: true } }, sessions: true } });
      expect(user).toMatchObject({ role: 'Client Admin', passwordHash: 'unchanged-hash', mustChangePassword: true });
      expect(user.userRoles.some(r => r.tenantId === user.tenantId && r.role.name === 'Client Admin')).toBe(true);
      expect(user.sessions.every(s => s.revokedAt)).toBe(true);
    }
    expect(await db.user.findUniqueOrThrow({ where: { id: staffId } })).toMatchObject({ role: 'Sales', mustChangePassword: false });
    const salesGrant = await db.rolePermission.findMany({ where: { module: 'contacts', role: { name: 'Sales' } } });
    expect(salesGrant).toHaveLength(1);
    expect(salesGrant[0].canView).toBe(true);
    expect(await db.session.findMany({ where: { userId, revokedAt: null } })).toHaveLength(1);
    expect((await call('/auth/me')).status).toBe(200);
    expect((await call('/administration/roles')).status).toBe(200);
  });
  it.each(['leads', 'contacts', 'accounts', 'deals'] as const)('reads historical %s activity and writes/retrieves a new event through tenant APIs', async module => {
    const field = ({ leads: 'leadId', contacts: 'contactId', accounts: 'accountId', deals: 'dealId' } as const)[module];
    const path = `/crm/activities?${field}=${records[module]}`;
    const history = await call(path); expect(history.status).toBe(200);
    expect(history.body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['email', 'task', 'stage_change', 'workflow', 'note']));
    expect(history.body.data.find((a: { type: string }) => a.type === 'email').metadata.email.body).toBe('Original email body');
    for (const type of ['email', 'task', 'stage_change']) {
      const filtered = await call(`${path}&type=${type}`); expect(filtered.status).toBe(200);
      expect(filtered.body.data).toHaveLength(1); expect(filtered.body.data[0].type).toBe(type);
    }
    const created = await call('/crm/activities', { type: 'note', title: `New ${module} event`, [field]: records[module] });
    expect(created.status).toBe(201);
    expect((await call(path)).body.data.some((a: { title: string }) => a.title === `New ${module} event`)).toBe(true);
    expect((await call(`/crm/${module}/${records[module]}/relationships?limit=50`)).status).toBe(200);
  });
  it('retains Team Management history and record Files APIs', async () => {
    expect((await call('/administration/audit')).body.data).toHaveLength(1);
    expect((await call(`/crm/leads/${records.leads}/files`)).body.data[0].name).toBe('preserved.pdf');
    for (const path of ['/admin/tenants', '/admin/audit-logs', '/auth/oauth/google', '/auth/send-registration-otp']) expect((await call(path)).status).toBe(404);
  });
});
