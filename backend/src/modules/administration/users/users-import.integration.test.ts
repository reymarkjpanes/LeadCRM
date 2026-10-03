import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
const mail = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../shared/services/email.service', () => ({ sendMail: mail.send, buildPasswordResetEmail: (url: string) => url }));
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../../../core/auth/auth-session';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_account_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('user administration and deal imports over authenticated HTTP', () => {
  let server: Server, base: string, tenantId: string, otherTenant: string, token: string, readerToken: string;
  let userId: string, otherUserId: string, pipelineId: string, stageId: string, otherStageId: string;
  let otherAccountId: string, otherContactId: string;
  async function call(path: string, method = 'GET', body?: unknown, bearer = token) {
    const response = await fetch(base + path, { method, headers: {
      'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'User/import test', slug: `users-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other', slug: `users-other-${Date.now()}` } })).id;
    const admin = await prisma.user.create({ data: { tenantId, email: 'admin@camxian.com', firstName: 'Admin', lastName: 'Test', role: 'Client Admin', mustChangePassword: false } });
    token = (await issueAuthSession(admin)).token;
    const reader = await prisma.user.create({ data: { tenantId, email: 'reader@camxian.com', firstName: 'Reader', lastName: 'Test', role: 'Reader', mustChangePassword: false } });
    readerToken = (await issueAuthSession(reader)).token;
    await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales representative' } });
    await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales manager' } });
    await prisma.roleDefinition.create({ data: { tenantId: otherTenant, name: 'Other role' } });
    otherUserId = (await prisma.user.create({ data: { tenantId: otherTenant, email: 'juan@camxian.com', firstName: 'Other', lastName: 'Juan', role: 'Client Admin' } })).id;
    otherAccountId = (await prisma.account.create({ data: { tenantId: otherTenant, name: 'Other account', } })).id;
    otherContactId = (await prisma.contact.create({ data: { tenantId: otherTenant, firstName: 'Other', lastName: 'Contact', email: 'contact@camxian.com', } })).id;
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Sales', } })).id;
    stageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0, } })).id;
    const productionPipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Production', } });
    otherStageId = (await prisma.stage.create({ data: { tenantId, pipelineId: productionPipeline.id, name: 'Production', order: 1, } })).id;
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });
  const valid = { firstName: ' Juan ', lastName: ' Dela Cruz ', email: ' JUAN@camxian.com ', phone: '9171234567', role: 'Sales representative', jobTitle: ' Sales ', department: ' Manila ' };

  it('validates and persists normalized users, canonical roles, edits, and audit events', async () => {
    for (const patch of [{ firstName: ' ' }, { lastName: '\nJuan' }, { email: 'juan@' }, { phone: '' }, { phone: '+6309171234567' }, { role: 'Other role' }, { tenantId: otherTenant }]) {
      expect((await call('/administration/users', 'POST', { ...valid, ...patch })).status).toBe(400);
    }
    const created = await call('/administration/users', 'POST', valid);
    expect(created.status).toBe(201);
    userId = created.body.data.id;
    expect(created.body.data).toMatchObject({ firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@camxian.com', phone: '+639171234567', jobTitle: 'Sales', department: 'Manila', setupEmailSent: true });
    expect(created.body.data).not.toHaveProperty('passwordHash');
    expect(await prisma.userRole.count({ where: { userId, tenantId } })).toBe(1);
    expect((await call('/administration/users', 'POST', valid)).status).toBe(409);
    expect((await call(`/administration/users/${userId}`, 'PUT', { jobTitle: ' Manager ' })).status).toBe(200);
    expect((await call(`/administration/users/${userId}`)).body.data.jobTitle).toBe('Manager');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).jobTitle).toBe('Manager');
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: userId, action: { in: ['user.created', 'user.updated'] } } })).toBe(2);
    expect((await call(`/administration/users/${userId}`, 'PUT', { role: 'Other role' })).status).toBe(404);
    expect((await call(`/administration/users/${otherUserId}`, 'PUT', { jobTitle: 'Cross tenant' })).status).toBe(404);
    expect((await call(`/administration/users/${userId}`, 'PUT', { role: 'Sales manager', status: 'INACTIVE' })).status).toBe(200);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { userRoles: { include: { role: true } } } });
    expect(updated.status).toBe('INACTIVE');
    expect(updated.userRoles.map(assignment => assignment.role.name)).toEqual(['Sales manager']);
    expect((await call(`/administration/users/${userId}`, 'PUT', { status: 'ACTIVE' })).status).toBe(200);
  });

  it('protects recovery, binds tokens to the selected tenant user, and returns no token', async () => {
    expect((await call(`/administration/users/${otherUserId}/password-reset`, 'POST', {})).status).toBe(404);
    expect((await call(`/administration/users/${userId}/password-reset`, 'POST', {}, readerToken)).status).toBe(403);
    expect((await call(`/administration/users/${userId}/password-reset`, 'POST', {}, '')).status).toBe(401);
    const result = await call(`/administration/users/${userId}/password-reset`, 'POST', { email: 'arbitrary@example.com' });
    expect(result).toEqual({ status: 202, body: { success: true, message: 'Password reset email sent.' } });
    expect(mail.send.mock.lastCall?.[0].to).toBe('juan@camxian.com');
    const reset = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
    expect(reset.email).toBe('juan@camxian.com');
    expect(await prisma.passwordResetToken.count({ where: { userId: otherUserId } })).toBe(0);
    const otherBefore = await prisma.user.findUniqueOrThrow({ where: { id: otherUserId } });
    expect((await call('/auth/reset-password', 'POST', { token: reset.token, password: 'Local-test-only-42!Secure' }, '')).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mustChangePassword).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: otherUserId } })).passwordHash).toBe(otherBefore.passwordHash);
    expect(await prisma.passwordResetToken.count({ where: { token: reset.token } })).toBe(0);
    mail.send.mockRejectedValueOnce(new Error('provider secret'));
    const failure = await call(`/administration/users/${userId}/password-reset`, 'POST', {});
    expect(failure.status).toBe(400);
    expect(JSON.stringify(failure.body)).not.toContain('provider secret');
  });

  it('imports two persisted deals and records numeric, stage and invalid-reference failures', async () => {
    const rows = [
      { rowNumber: 2, title: ' Deal one ', pipeline: pipelineId, stage: stageId, value: '100.25' },
      { rowNumber: 3, title: '=Plain text', pipeline: 'Sales', stage: 'Lead', priority: 'high', expectedCloseDate: '2026-10-01' },
      { rowNumber: 4, title: 'Invalid value', pipeline: 'Sales', stage: 'Lead', value: 'Infinity' },
      { rowNumber: 5, title: 'Invalid stage', pipeline: 'Sales', stage: 'missing' },
      { rowNumber: 6, title: 'Wrong pipeline', pipeline: 'Sales', stage: otherStageId },
      { rowNumber: 7, title: 'Invalid date', pipeline: 'Sales', stage: 'Lead', expectedCloseDate: '2026-02-30' },
      { rowNumber: 8, title: 'Wrong account', pipeline: 'Sales', stage: 'Lead', account: otherAccountId },
      { rowNumber: 9, title: 'Wrong contact', pipeline: 'Sales', stage: 'Lead', contact: otherContactId },
      { rowNumber: 10, title: 'Wrong assignee', pipeline: 'Sales', stage: 'Lead', assignedUser: otherUserId },
    ];
    const result = await call('/crm/deals/imports', 'POST', { fileName: 'deals.csv', rows });
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ totalRecords: 9, successfulRecords: 2, failedRecords: 7, status: 'completed_with_errors', });
    const deals = await prisma.deal.findMany({ where: { tenantId } });
    expect(deals).toHaveLength(2);
    expect(deals.every(deal => deal.pipelineId === pipelineId && deal.stageId === stageId)).toBe(true);
    expect(deals.map(deal => deal.title)).toContain('=Plain text');
    const id = result.body.data.id;
    expect((await call(`/crm/deals/imports/${id}/results`)).body.data).toHaveLength(9);
    expect((await call('/crm/deals/imports', 'POST', { fileName: 'forbidden.csv', rows }, readerToken)).status).toBe(403);
    expect((await call('/crm/deals/imports', 'POST', { tenantId: otherTenant, fileName: 'injected.csv', rows })).status).toBe(400);
  });
});
