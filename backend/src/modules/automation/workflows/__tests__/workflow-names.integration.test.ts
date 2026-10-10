import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../../config/database.config';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import app from '../../../../app';
import { WORKFLOW_NAME_CONFLICT } from '../workflow-names';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);

describe.skipIf(!disposable)('workflow names through authenticated HTTP and disposable PostgreSQL', { timeout: 20000 }, () => {
  let tenantId: string, foreignTenantId: string, token: string, viewerToken: string, deniedToken: string, base: string;
  let server: Server;
  const draft = (name: string) => ({ name, trigger: 'lead.created', actions: [], isActive: false });
  async function call(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: `leadcrm_token=${auth}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  async function availability(name: string, excludeId?: string, auth = token) {
    return call(`/workflow-name-availability?${new URLSearchParams({ name, ...(excludeId ? { excludeId } : {}) })}`, 'GET', undefined, auth);
  }

  beforeAll(async () => {
    const stamp = randomUUID();
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow names', slug: `workflow-names-${stamp}`, status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    foreignTenantId = (await prisma.tenant.create({ data: { name: 'Other workflow names', slug: `other-workflow-names-${stamp}` } })).id;
    const createUser = (label: string, role: string) => prisma.user.create({ data: {
      tenantId, role, email: `workflow-names-${label}-${stamp}@camxian.com`, firstName: label, lastName: 'Test',
      mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date(),
    } });
    const admin = await createUser('admin', 'Client Admin');
    const viewer = await createUser('viewer', 'Workflow Name Viewer');
    const denied = await createUser('denied', 'Workflow Name Denied');
    const viewRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Workflow Name Viewer', permissions: { create: {
      module: 'workflows', canView: true, canCreate: false, canEdit: false, canDelete: false,
    } } } });
    const deniedRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Workflow Name Denied' } });
    await prisma.userRole.createMany({ data: [{ tenantId, userId: viewer.id, roleId: viewRole.id }, { tenantId, userId: denied.id, roleId: deniedRole.id }] });
    token = (await issueAuthSession(admin)).token;
    viewerToken = (await issueAuthSession(viewer)).token;
    deniedToken = (await issueAuthSession(denied)).token;
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/automation`;
  }, 30000);

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  it('reserves archived names, returns available copy suggestions, and rejects conflicting saves', async () => {
    const created = await call('/workflows', 'POST', draft('  Qualified   Follow-up  '));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.name).toBe('Qualified Follow-up');
    const id = created.body.data.id;
    expect((await availability('qualified follow-up', id)).body.data).toEqual({ available: true });
    expect((await call(`/workflows/${id}`, 'PUT', { name: 'QUALIFIED follow-up' })).status).toBe(200);
    expect((await call(`/workflows/${id}/archive`, 'PATCH')).status).toBe(200);
    expect((await availability(' qualified  follow-up ')).body.data).toEqual({ available: false, suggestedName: 'qualified follow-up (Copy)' });
    const duplicate = await call('/workflows', 'POST', draft('qualified follow-up'));
    expect(duplicate.status).toBe(400);
    expect(JSON.stringify(duplicate.body)).toContain(WORKFLOW_NAME_CONFLICT);
    expect((await call('/workflows', 'POST', draft('Qualified Follow-up (Copy)'))).status).toBe(201);
    expect((await availability('Qualified Follow-up')).body.data.suggestedName).toBe('Qualified Follow-up (Copy 2)');
    const rename = await call('/workflows', 'POST', draft('Available name'));
    expect((await call(`/workflows/${rename.body.data.id}`, 'PUT', { name: 'qualified follow-up' })).status).toBe(400);
  });

  it('scopes names and excluded IDs to the authenticated workspace', async () => {
    const foreign = await prisma.workflow.create({ data: { tenantId: foreignTenantId, name: 'Foreign-only follow-up', trigger: 'lead.created', actions: [] } });
    expect((await availability(foreign.name)).body.data).toEqual({ available: true });
    expect((await availability(foreign.name, foreign.id)).status).toBe(404);
    expect((await call('/workflows', 'POST', draft(foreign.name))).status).toBe(201);
  });

  it('requires view permission and validates query values without changing data', async () => {
    expect((await availability('New name', undefined, '')).status).toBe(401);
    expect((await availability('New name', undefined, deniedToken)).status).toBe(403);
    expect((await availability('New name', undefined, viewerToken)).status).toBe(200);
    expect((await availability('   ')).status).toBe(400);
    expect((await availability('New name', 'invalid-id')).status).toBe(400);
    expect((await call('/workflow-name-availability?name=one&name=two')).status).toBe(400);
    expect(await prisma.workflow.count({ where: { tenantId, name: 'New name' } })).toBe(0);
  });

  it('accepts only one simultaneous equivalent-name save and reports the other as validation', async () => {
    const responses = await Promise.all([
      call('/workflows', 'POST', draft('Concurrent Follow-up')),
      call('/workflows', 'POST', draft(' concurrent   FOLLOW-UP ')),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 400]);
    expect(JSON.stringify(responses.find(response => response.status === 400)?.body)).toContain(WORKFLOW_NAME_CONFLICT);
    expect(await prisma.workflow.count({ where: { tenantId, name: { contains: 'Concurrent', mode: 'insensitive' } } })).toBe(1);
  });
});
