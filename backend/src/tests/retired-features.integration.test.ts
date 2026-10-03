import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { replayCrmMigrations } from './replay-crm-migrations';

vi.mock('../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.RETIREMENT_TEST_DATABASE_URL! } } }) }));
const migration = '20261025000000_remove_system_admin_and_legacy_auth_documents';
const removed = ['SystemAdmin', 'TenantDocument', 'RegistrationOtpToken', 'OAuthAccount', 'VerificationToken'];
const preserved = ['Activity', 'AuditLog', 'EmailAccount', 'MailboxMessage', 'MailboxOAuthState', 'RecordFile', 'DealStageHistory', 'PasswordResetToken', 'EmailVerificationToken', 'Task', 'Lead', 'Contact', 'Account', 'Deal'];
const snapshots = new Map<string, unknown[]>();
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient, server: Server, url: string, token: string;
let tenantId: string, userId: string, operatorId: string, seedOperatorId: string, staffId: string;
let records: { leads: string; contacts: string; accounts: string; deals: string };
async function snapshot(table: string) { return (await pg.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows; }
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
  const identity = async (email: string, role: string, tenant = tenantId) => db.user.create({ data: { tenantId: tenant, email, role, firstName: 'Preserved', lastName: 'Identity', mustChangePassword: false, passwordHash: 'unchanged-hash' } });
  userId = (await identity('admin@camxian.com', 'Client Admin')).id;
  operatorId = (await identity('legacy@camxian.com', 'System Admin')).id;
  const isolatedTenant = (await db.tenant.create({ data: { name: 'Legacy seed tenant', slug: 'leadcrm-system' } })).id;
  seedOperatorId = (await identity('operator@example.test', 'SYSTEM_ADMIN', isolatedTenant)).id;
  staffId = (await identity('sales@camxian.com', 'Sales')).id;
  const oldRole = await db.roleDefinition.create({ data: { tenantId, name: 'System-Admin', isSystemRole: true } });
  const salesRole = await db.roleDefinition.create({ data: { tenantId, name: 'Sales' } });
  await db.rolePermission.create({ data: { tenantId, roleId: salesRole.id, module: 'contacts', canView: true } });
  for (const id of [operatorId, staffId]) await db.userRole.create({ data: { tenantId, userId: id, roleId: oldRole.id } });
  await db.userRole.create({ data: { tenantId, userId: staffId, roleId: salesRole.id } });
  await db.rolePermission.create({ data: { tenantId, roleId: oldRole.id, module: 'admin', canView: true } });
  const { issueAuthSession } = await import('../core/auth/auth-session');
  for (const id of [userId, operatorId, seedOperatorId, staffId]) {
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (id === userId) token = (await issueAuthSession(user)).token;
    else await db.session.create({ data: { userId: id, tenantId: user.tenantId, tokenHash: `old-session-${id}`, expiresAt: new Date(Date.now() + 60000) } });
  }
  const account = await db.account.create({ data: { tenantId, name: 'Preserved company' } });
  const lead = await db.lead.create({ data: { tenantId, accountId: account.id, firstName: 'Lead', lastName: 'History', email: 'lead@example.test' } });
  const contact = await db.contact.create({ data: { tenantId, accountId: account.id, firstName: 'Contact', lastName: 'History', email: 'contact@example.test' } });
  const pipeline = await db.pipeline.create({ data: { tenantId, name: 'Sales' } });
  const stage = await db.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
  const deal = await db.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, title: 'Preserved deal', leadId: lead.id, contactId: contact.id, accountId: account.id, value: 20 } });
  records = { leads: lead.id, contacts: contact.id, accounts: account.id, deals: deal.id };
  const links = { leadId: lead.id, contactId: contact.id, accountId: account.id, dealId: deal.id };
  const task = await db.task.create({ data: { tenantId, title: 'Preserved task', dueDate: new Date(), assignedUserId: userId, ...links } });
  const mailbox = await db.emailAccount.create({ data: { tenantId, userId, email: 'admin@camxian.com', accessToken: 'encrypted-access-unchanged', refreshToken: 'encrypted-refresh-unchanged', scopes: ['gmail.modify'], syncCursor: 'preserved-cursor' } });
  const message = await db.mailboxMessage.create({ data: { tenantId, accountId: mailbox.id, providerMessageId: 'gmail-message', threadId: 'thread', direction: 'inbound', from: 'lead@example.test', recipients: ['admin@camxian.com'], subject: 'Preserved email', body: 'Original email body', snippet: 'Original', labels: ['INBOX'], sentAt: new Date(), leadId: lead.id, contactId: contact.id } });
  await db.mailboxOAuthState.create({ data: { tenantId, userId, stateHash: 'preserved-state', sessionHash: 'session-hash', verifier: 'encrypted-verifier', expiresAt: new Date(Date.now() + 60000) } });
  for (const type of ['email', 'task', 'stage_change', 'workflow', 'note']) await db.activity.create({ data: { tenantId, createdById: userId, type, title: `Preserved ${type}`, ...links, taskId: task.id, metadata: type === 'email' ? { mailboxMessageId: message.id } : {} } });
  await db.auditLog.create({ data: { tenantId, userId, action: 'record.updated', entityType: 'Lead', entityId: lead.id } });
  await db.dealStageHistory.create({ data: { tenantId, dealId: deal.id, newStageId: stage.id, movedById: userId } });
  await db.recordFile.create({ data: { tenantId, uploadedById: userId, leadId: lead.id, name: 'preserved.pdf', size: 12, type: 'application/pdf', objectKey: 'preserved-object-key' } });
  await db.passwordResetToken.create({ data: { userId, email: 'admin@camxian.com', token: 'preserved-reset', expires: new Date(Date.now() + 60000) } });
  await db.emailVerificationToken.create({ data: { userId, email: 'admin@camxian.com', tokenHash: 'preserved-verification', expiresAt: new Date(Date.now() + 60000) } });
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
  server = (await import('../app')).default.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
}, 60000);
afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await db?.$disconnect(); await socket?.stop(); await pg?.close(); });

describe('forward retirement migration and retained APIs', () => {
  it('drops obsolete models and tables while preserving populated history, email tokens, files, and records exactly', async () => {
    for (const table of removed) expect((await pg.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename=$1', [table])).rows).toEqual([]);
    for (const table of preserved) expect(await snapshot(table), table).toEqual(snapshots.get(table));
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
    expect(await db.rolePermission.findMany({ where: { module: 'contacts' } })).toHaveLength(1);
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
