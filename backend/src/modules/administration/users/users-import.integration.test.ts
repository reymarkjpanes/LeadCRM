import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
const mail = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ submitted: true }) }));
vi.mock('../../../shared/services/email.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/services/email.service')>(), sendMail: mail.send,
}));
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../../../core/auth/auth-session';
import * as usersService from './users.service';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_(?:polish_test|account_test_\d+)$/.test(url.pathname);
describe.skipIf(!disposable)('user administration and deal imports over authenticated HTTP', () => {
  let server: Server, base: string, tenantId: string, otherTenant: string, token: string, readerToken: string, readerId: string;
  let userId: string, otherUserId: string, pipelineId: string, stageId: string, otherStageId: string;
  let accountId: string, productId: string, otherAccountId: string, otherContactId: string;
  async function call(path: string, method = 'GET', body?: unknown, bearer = token) {
    const response = await fetch(base + path, { method, headers: {
      'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'User/import test', slug: `users-${Date.now()}`, onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other', slug: `users-other-${Date.now()}` } })).id;
    const admin = await prisma.user.create({ data: { tenantId, email: 'admin@camxian.com', firstName: 'Admin', lastName: 'Test', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    token = (await issueAuthSession(admin)).token;
    const reader = await prisma.user.create({ data: { tenantId, email: 'reader@camxian.com', firstName: 'Reader', lastName: 'Test', role: 'Reader', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    readerId = reader.id;
    readerToken = (await issueAuthSession(reader)).token;
    await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales representative' } });
    await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales manager' } });
    await prisma.roleDefinition.create({ data: { tenantId: otherTenant, name: 'Other role' } });
    otherUserId = (await prisma.user.create({ data: { tenantId: otherTenant, email: 'juan@camxian.com', firstName: 'Other', lastName: 'Juan', role: 'Client Admin' } })).id;
    otherAccountId = (await prisma.account.create({ data: { tenantId: otherTenant, name: 'Other account', } })).id;
    otherContactId = (await prisma.contact.create({ data: { tenantId: otherTenant, firstName: 'Other', lastName: 'Contact', email: 'contact@camxian.com', } })).id;
    accountId = (await prisma.account.create({ data: { tenantId, name: 'Import customer' } })).id;
    productId = (await prisma.productInterest.create({ data: { tenantId, name: 'Import Product', dealValue: 100.25 } })).id;
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Sales', } })).id;
    stageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0, } })).id;
    const productionPipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Production', } });
    otherStageId = (await prisma.stage.create({ data: { tenantId, pipelineId: productionPipeline.id, name: 'Production', order: 1, } })).id;
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });
  const valid = { firstName: ' Juan ', lastName: ' Dela Cruz ', email: ' JUAN@camxian.com ', phone: '9171234567', role: 'Sales representative', jobTitle: ' Sales ' };

  it('validates and persists normalized users, canonical roles, edits, and audit events', async () => {
    for (const patch of [{ firstName: ' ' }, { lastName: '\nJuan' }, { email: 'juan@' }, { phone: '' }, { phone: '+6309171234567' }, { role: 'Other role' }, { tenantId: otherTenant }]) {
      expect((await call('/administration/users', 'POST', { ...valid, ...patch })).status).toBe(400);
    }
    const created = await call('/administration/users', 'POST', valid);
    expect(created.status).toBe(201);
    userId = created.body.data.id;
    expect(created.body.data).toMatchObject({ firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@camxian.com', phone: '+639171234567', jobTitle: 'Sales', groups: [], setupEmailSent: true });
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

  it('allows Client Admin status changes while preserving one active administrator', async () => {
    const currentAdmin = await prisma.user.findFirstOrThrow({ where: { tenantId, role: 'Client Admin', status: 'ACTIVE' } });
    const additionalAdmin = await prisma.user.create({ data: {
      tenantId, email: `second-admin-${randomUUID()}@camxian.com`, firstName: 'Second', lastName: 'Admin',
      role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date(),
    } });

    await usersService.update(additionalAdmin.id, tenantId, readerId, { status: 'INACTIVE' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: additionalAdmin.id } })).status).toBe('INACTIVE');
    await usersService.update(additionalAdmin.id, tenantId, readerId, { status: 'ACTIVE' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: additionalAdmin.id } })).status).toBe('ACTIVE');

    await usersService.update(additionalAdmin.id, tenantId, readerId, { status: 'INACTIVE' });
    await expect(usersService.update(currentAdmin.id, tenantId, readerId, { status: 'INACTIVE' }))
      .rejects.toThrow('At least one active Client Admin must remain.');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: currentAdmin.id } })).status).toBe('ACTIVE');
    expect(await prisma.user.count({ where: { tenantId, role: 'Client Admin', status: 'ACTIVE' } })).toBe(1);
  });

  it('protects recovery, binds tokens to the selected tenant user, and returns no token', async () => {
    expect((await call(`/administration/users/${otherUserId}/password-reset`, 'POST', {})).status).toBe(404);
    expect((await call(`/administration/users/${userId}/password-reset`, 'POST', {}, readerToken)).status).toBe(403);
    expect((await call(`/administration/users/${userId}/password-reset`, 'POST', {}, '')).status).toBe(401);
    const result = await call(`/administration/users/${userId}/password-reset`, 'POST', { email: 'arbitrary@example.com' });
    expect(result).toEqual({ status: 202, body: { success: true, message: 'Password reset email requested.' } });
    expect(mail.send.mock.lastCall?.[0].to).toBe('juan@camxian.com');
    const reset = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
    expect(reset.email).toBe('juan@camxian.com');
    expect(await prisma.passwordResetToken.count({ where: { userId: otherUserId } })).toBe(0);
    const otherBefore = await prisma.user.findUniqueOrThrow({ where: { id: otherUserId } });
    const token = mail.send.mock.lastCall?.[0].html.match(/reset-password\?token=([a-f0-9]{64})/)?.[1];
    expect((await call('/auth/reset-password', 'POST', { token, password: 'Local-test-only-42!Secure' }, '')).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mustChangePassword).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: otherUserId } })).passwordHash).toBe(otherBefore.passwordHash);
    expect(await prisma.passwordResetToken.count({ where: { token: reset.token } })).toBe(0);
    mail.send.mockRejectedValueOnce(new Error('provider secret'));
    const failure = await call(`/administration/users/${userId}/password-reset`, 'POST', {});
    expect(failure.status).toBe(400);
    expect(JSON.stringify(failure.body)).not.toContain('provider secret');
  });

  it('imports two Product-priced deals and records Product, stage and invalid-reference failures', async () => {
    const rows = [
      { title: ' Deal one ', pipeline: pipelineId, stage: stageId },
      { title: '=Plain text', priority: 'high', expectedCloseDate: '2026-10-01' },
      { title: 'Invalid Product', productInterest: 'Missing Product' },
      { title: 'Invalid stage', stage: 'missing' },
      { title: 'Wrong pipeline', stage: otherStageId },
      { title: 'Invalid date', expectedCloseDate: '2026-02-30' },
      { title: 'Wrong account', account: otherAccountId },
      { title: 'Wrong contact', contact: otherContactId },
      { title: 'Wrong assignee', assignedUser: otherUserId },
    ].map(patch => ({ pipeline: 'Sales', stage: 'Lead', productInterest: productId, account: accountId, ...patch }));
    const fields = ['title', 'pipeline', 'stage', 'productInterest', 'account', 'contact', 'assignedUser', 'priority', 'expectedCloseDate'];
    const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
    const payload = { fileName: 'deals.csv', idempotencyKey: randomUUID(),
      mappings: Object.fromEntries(fields.map((field, index) => [field, index])),
      csvText: [fields.join(','), ...rows.map(row => fields.map(field => quote((row as Record<string, string>)[field] ?? '')).join(','))].join('\n'),
    };
    const result = await call('/crm/deals/imports', 'POST', payload);
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ totalRecords: 9, successfulRecords: 2, failedRecords: 7, status: 'completed_with_errors', });
    const deals = await prisma.deal.findMany({ where: { tenantId } });
    expect(deals).toHaveLength(2);
    expect(deals.every(deal => deal.pipelineId === pipelineId && deal.stageId === stageId)).toBe(true);
    expect(deals.every(deal => deal.productInterestId === productId && deal.value === 100.25)).toBe(true);
    expect(deals.map(deal => deal.title)).toContain('=Plain text');
    const id = result.body.data.id;
    expect((await call(`/crm/deals/imports/${id}/results`)).body.data).toHaveLength(9);
    expect((await call('/crm/deals/imports', 'POST', payload, readerToken)).status).toBe(403);
    expect((await call('/crm/deals/imports', 'POST', { ...payload, tenantId: otherTenant })).status).toBe(400);
  });
});
