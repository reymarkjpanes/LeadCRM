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
describe.skipIf(!disposable)('user administration over authenticated HTTP', () => {
  let server: Server, base: string, tenantId: string, otherTenant: string, token: string, readerToken: string, readerId: string;
  let userId: string, otherUserId: string;
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
    expect((await call(`/administration/users/${userId}`, 'PUT', { jobTitle: ' Manager ' })).status).toBe(400);
    expect((await call(`/administration/users/${userId}`)).body.data.jobTitle).toBe('Sales');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).jobTitle).toBe('Sales');
    expect((await call(`/administration/users/${userId}`, 'PUT', { lastName: ' Reyes ' })).body.data.lastName).toBe('Reyes');
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: userId, action: { in: ['user.created', 'user.updated'] } } })).toBe(2);
    expect((await call(`/administration/users/${userId}`, 'PUT', { role: 'Other role' })).status).toBe(404);
    expect((await call(`/administration/users/${otherUserId}`, 'PUT', { firstName: 'Cross tenant' })).status).toBe(404);
    expect((await call(`/administration/users/${userId}`, 'PUT', { role: 'Sales manager', status: 'INACTIVE' })).status).toBe(200);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { userRoles: { include: { role: true } } } });
    expect(updated.status).toBe('INACTIVE');
    expect(updated.userRoles.map(assignment => assignment.role.name)).toEqual(['Sales manager']);
    expect((await call(`/administration/users/${userId}`, 'PUT', { status: 'ACTIVE' })).status).toBe(200);
  });

  it('rejects unsupported staff domains and normalizes allowed domains over HTTP', async () => {
    for (const domain of ['yahoo.com', 'outlook.com', 'company.com', 'sub.camxian.com', 'gmail.com.fake']) {
      const result = await call('/administration/users', 'POST', { ...valid, email: 'new.staff@' + domain });
      expect(result.status).toBe(400);
      expect(result.body.fieldErrors.email).toContain('Only @gmail.com and @camxian.com email addresses are allowed.');
    }
    const unsupported = await call('/administration/users/email-availability?email=staff%40company.com&purpose=staff-creation');
    expect(unsupported.status).toBe(400);
    expect((await call('/administration/users/email-availability?email=staff%40company.com')).body.data).toEqual({ available: true });
    const available = await call('/administration/users/email-availability?email=New.Staff%40GMAIL.COM&purpose=staff-creation');
    expect(available.body.data).toEqual({ available: true });
    const delegateRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Staff provisioner', permissions: { create: [
      { module: 'users', canView: true, canCreate: true }, { module: 'roles', canView: true, canAssign: true },
    ] } } });
    const delegate = await prisma.user.create({ data: {
      tenantId, email: 'staff-provisioner@camxian.com', firstName: 'Staff', lastName: 'Provisioner',
      role: delegateRole.name, mustChangePassword: false, onboardingCompletedAt: new Date(),
    } });
    await prisma.userRole.create({ data: { tenantId, userId: delegate.id, roleId: delegateRole.id } });
    const delegateToken = (await issueAuthSession(delegate)).token;
    const denied = await call('/administration/users', 'POST', { ...valid, email: 'New.Staff@GMAIL.COM' }, delegateToken);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain('Only Client Admin users can approve an external staff email.');
    expect((await call('/administration/users', 'POST', { ...valid, email: 'delegated.staff@camxian.com' }, delegateToken)).status).toBe(201);
    const created = await call('/administration/users', 'POST', { ...valid, email: 'New.Staff@GMAIL.COM' });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('new.staff@gmail.com');
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: created.body.data.id, action: 'user.staff_approved' } })).toBe(1);
  });

  it('rejects newly submitted invalid names and keeps historical names during unrelated staff edits', async () => {
    for (const field of ['firstName', 'lastName']) {
      for (const value of ['John@1', 'John@']) {
        const response = await call('/administration/users', 'POST', { ...valid, email: `${randomUUID()}@camxian.com`, [field]: value });
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(`${field === 'firstName' ? 'First name' : 'Last name'} must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().`);
        expect((await call(`/administration/users/${userId}`, 'PUT', { [field]: value })).status).toBe(400);
      }
    }
    const previous = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    try {
      await prisma.user.update({ where: { id: userId }, data: { firstName: 'Old@1', lastName: 'Smith#' } });
      expect((await call(`/administration/users/${userId}`, 'PUT', { phone: '9181234567' })).status).toBe(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ firstName: 'Old@1', lastName: 'Smith#' });
      expect((await call(`/administration/users/${userId}`, 'PUT', { firstName: 'María' })).status).toBe(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ firstName: 'María', lastName: 'Smith#' });
    } finally { await prisma.user.update({ where: { id: userId }, data: { firstName: previous.firstName, lastName: previous.lastName, phone: previous.phone } }); }
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

});
