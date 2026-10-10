import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { salesPipeline, salesTransaction } from '../leads/lead-automation.service';
import { CUSTOM_FIELD_BUILT_IN_GROUPS, type ClosingField, type CustomFieldModule } from '@leadcrm/shared';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
describe.skipIf(url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_custom_fields_test')('module custom fields with real SQL and authenticated HTTP', () => {
  let server: Server, base: string, tenantId: string, actorId: string, token: string;
  async function call(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function field(module: CustomFieldModule, name: string, extra: Record<string, unknown> = {}): Promise<ClosingField> {
    const result = await call('/administration/closing-requirements', 'POST', { module, group: CUSTOM_FIELD_BUILT_IN_GROUPS[module][0], name, type: 'Text', required: false, ...extra });
    expect(result.status, JSON.stringify(result.body)).toBe(200); return result.body.data;
  }
  const person = () => ({ firstName: 'Custom', lastName: 'Tester', email: `${randomUUID()}@example.test` });
  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  beforeEach(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Custom fields', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    const admin = await prisma.user.create({ data: { tenantId, firstName: 'Admin', lastName: 'Test', email: `${randomUUID()}@camxian.com`, role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    actorId = admin.id; token = (await issueAuthSession(admin)).token;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });

  it('saves Lead numeric values atomically, reloads edits and preserves hidden/disabled history', async () => {
    const budget = await field('leads', 'Project Budget', { type: 'Number', required: true });
    const invalid = await call('/crm/leads', 'POST', person());
    expect(invalid.status).toBe(400); expect(await prisma.lead.count({ where: { tenantId } })).toBe(0);
    const created = await call('/crm/leads', 'POST', { ...person(), customFieldValues: { [budget.id]: 25000 } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect((await call(`/crm/leads/${id}/custom-fields`)).body.data.values[budget.id]).toBe(25000);
    expect((await call(`/crm/leads/${id}`, 'PUT', { customFieldValues: { [budget.id]: 30000 } })).status).toBe(200);
    expect((await call(`/administration/closing-requirements/${budget.id}`, 'PATCH', { visibleInForm: false })).status).toBe(200);
    expect((await call('/crm/leads', 'POST', person())).status).toBe(201);
    expect((await call(`/crm/leads/${id}`, 'PUT', { customFieldValues: {} })).status).toBe(200);
    const hidden = (await call(`/crm/leads/${id}/custom-fields`)).body.data;
    expect(hidden.values[budget.id]).toBe(30000); expect(hidden.fields.find((f: ClosingField) => f.id === budget.id).visibleInForm).toBe(false);
    await call(`/administration/closing-requirements/${budget.id}`, 'PATCH', { visibleInForm: true });
    expect((await call(`/crm/leads/${id}/custom-fields`)).body.data.values[budget.id]).toBe(30000);
    await call(`/administration/closing-requirements/${budget.id}`, 'PATCH', { active: false });
    expect((await call(`/crm/leads/${id}/custom-fields`)).body.data.values[budget.id]).toBe(30000);
    expect(await prisma.closingFieldDefinition.count({ where: { tenantId, id: budget.id } })).toBe(1);
  });

  it('scopes groups and definitions by module; normalizes names and rejects unsafe changes', async () => {
    const original = await field('contacts', '  Preferred Contact Time  ', { group: '  Additional Information  ' });
    const sameGroup = await field('contacts', 'Capacity', { group: 'additional information' });
    expect(sameGroup.group).toBe('Additional Information'); expect(original.name).toBe('Preferred Contact Time');
    expect((await call('/administration/closing-requirements', 'POST', { module: 'contacts', group: 'additional information', name: ' preferred contact time ', type: 'Text', required: false })).status).toBe(400);
    await field('leads', 'Preferred Contact Time', { group: 'Additional Information' });
    const list = (await call('/crm/contacts/custom-fields')).body.data as ClosingField[];
    expect(list.every(f => f.module === 'contacts')).toBe(true);
    for (const patch of [{ module: 'leads' }, { type: 'Number' }, { name: '   ' }, { group: '  ' }, { name: 'x'.repeat(101) }]) expect((await call(`/administration/closing-requirements/${original.id}`, 'PATCH', patch)).status).toBe(400);
    const created = await call('/crm/contacts', 'POST', { ...person(), customFieldValues: { [original.id]: 'Morning' } });
    expect(created.status).toBe(201);
    expect((await call(`/crm/contacts/${created.body.data.id}/custom-fields`)).body.data.values[original.id]).toBe('Morning');
    expect((await call('/crm/leads', 'POST', { ...person(), customFieldValues: { [original.id]: 'Wrong module' } })).status).toBe(400);
  });

  it('persists custom Account groups and validates every supported scalar type', async () => {
    const number = await field('accounts', 'Server Count', { type: 'Number', group: 'Basic Information' });
    const date = await field('accounts', 'Inspection', { type: 'Date', group: 'Basic Information' });
    const choice = await field('accounts', 'Service', { type: 'Dropdown', options: ['Gold', 'Silver'] });
    const text = await field('accounts', 'Short text');
    const long = await field('accounts', 'Long text', { type: 'Long Text' });
    for (const [id, value] of [[number.id, '12'], [date.id, '2026-02-30'], [choice.id, 'Bronze'], [text.id, 'x'.repeat(1001)], [long.id, 'x'.repeat(10001)]]) {
      expect((await call('/crm/accounts', 'POST', { name: 'Invalid', customFieldValues: { [id]: value } })).status).toBe(400);
    }
    expect(await prisma.account.count({ where: { tenantId } })).toBe(0);
    const created = await call('/crm/accounts', 'POST', { name: 'Office', customFieldValues: { [number.id]: 8, [date.id]: '2026-10-07', [choice.id]: 'Gold', [long.id]: 'x'.repeat(1500) } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    await call(`/administration/closing-requirements/${choice.id}`, 'PATCH', { options: ['Silver'] });
    expect((await call(`/crm/accounts/${id}`, 'PUT', { customFieldValues: { [number.id]: 12 } })).status).toBe(200);
    const values = (await call(`/crm/accounts/${id}/custom-fields`)).body.data.values;
    expect(values[number.id]).toBe(12); expect(values[date.id]).toBe('2026-10-07');
    expect(values[choice.id]).toBe('Gold');
    expect((await call(`/crm/accounts/${id}`, 'PUT', { customFieldValues: { [choice.id]: 'Gold' } })).status).toBe(400);
    await call(`/crm/accounts/${id}/archive`, 'PATCH');
    expect((await call(`/crm/accounts/${id}/custom-fields`)).body.data.values[number.id]).toBe(12);
  });

  it('keeps Closed Won requirements separate, required even when hidden, and frozen after closing', async () => {
    const normal = await field('deals', 'Site code', { group: 'Deal Information', required: true });
    const product = await prisma.productInterest.create({ data: { tenantId, name: 'Camera', dealValue: 100 } });
    const pipeline = await tenantContext.run({ tenantId }, () => salesTransaction(tx => salesPipeline(tx, tenantId)));
    const stages = await prisma.stage.findMany({ where: { tenantId, pipelineId: pipeline.pipeline.id } });
    const leadStage = stages.find(s => s.name === 'Lead')!, qualified = stages.find(s => s.name === 'Qualified')!, won = stages.find(s => s.isWon)!;
    const input = { title: 'Installation', pipelineId: pipeline.pipeline.id, stageId: leadStage.id, productInterestIds: [product.id] };
    expect((await call('/crm/deals/batch', 'POST', { ...input, idempotencyKey: randomUUID() })).status).toBe(400);
    const created = await call('/crm/deals/batch', 'POST', { ...input, idempotencyKey: randomUUID(), customFieldValues: { [normal.id]: 'SITE-1' } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.deals[0].id;
    expect((await call(`/crm/deals/${id}/custom-fields`)).body.data.values[normal.id]).toBe('SITE-1');
    expect((await call(`/crm/deals/${id}/closing-requirements`)).body.data.fields.some((f: ClosingField) => f.id === normal.id)).toBe(false);
    await call('/administration/closing-requirements/reference-number', 'PATCH', { required: true, visibleInForm: false });
    await prisma.deal.update({ where: { id }, data: { stageId: qualified.id } });
    expect((await call(`/crm/deals/${id}/stage`, 'PATCH', { stageId: won.id })).status).toBe(400);
    const closed = await call(`/crm/deals/${id}/closing-requirements`, 'PATCH', { values: { 'reference-number': 'REF-1', 'confirmation-date': '2026-10-07', 'confirmation-type': 'Approved Quotation' } });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200); expect(closed.body.data.locked).toBe(true);
    const snapshot = (await prisma.deal.findUniqueOrThrow({ where: { id } })).closingSnapshot;
    expect((await call(`/crm/deals/${id}/closing-requirements`, 'PATCH', { values: { 'reference-number': 'changed' } })).status).toBe(400);
    await call('/administration/closing-requirements/reference-number', 'PATCH', { name: 'Renamed evidence', required: false });
    expect((await prisma.deal.findUniqueOrThrow({ where: { id } })).closingSnapshot).toEqual(snapshot);
    expect((await prisma.customFieldValue.findFirstOrThrow({ where: { tenantId, dealId: id, fieldId: 'reference-number' } })).value).toBe('REF-1');
  });

  it('enforces configuration permissions while CRM users can fill their module fields', async () => {
    const custom = await field('leads', 'Customer note');
    const agent = await prisma.user.create({ data: { tenantId, firstName: 'Rep', lastName: 'Test', email: `${randomUUID()}@camxian.com`, role: 'Sales Rep', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales Rep' } });
    await prisma.rolePermission.create({ data: { tenantId, roleId: role.id, module: 'leads', canView: true, canCreate: true, canEdit: true } });
    await prisma.userRole.create({ data: { tenantId, roleId: role.id, userId: agent.id } });
    const auth = (await issueAuthSession(agent)).token;
    expect((await call('/administration/closing-requirements', 'GET', undefined, auth)).status).toBe(403);
    for (const patch of [{ visibleInForm: false }, { active: false }, { name: 'Changed' }]) expect((await call(`/administration/closing-requirements/${custom.id}`, 'PATCH', patch, auth)).status).toBe(403);
    expect((await call('/crm/leads/custom-fields', 'GET', undefined, auth)).status).toBe(200);
    expect((await call('/crm/leads', 'POST', { ...person(), customFieldValues: { [custom.id]: 'Filled by rep' } }, auth)).status).toBe(201);
    expect((await call('/crm/accounts/custom-fields', 'GET', undefined, auth)).status).toBe(403);
    const foreign = await prisma.tenant.create({ data: { name: 'Foreign', slug: randomUUID() } });
    const record = await prisma.lead.create({ data: { tenantId: foreign.id, ...person() } });
    expect((await call(`/crm/leads/${record.id}/custom-fields`)).status).toBe(404);
  });

  it('uses secure upload validation and claims only uploader-owned module files', async () => {
    const document = await field('accounts', 'Site plan', { type: 'File Upload', required: true });
    vi.stubEnv('SUPABASE_URL', 'https://storage.example.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only'); vi.stubEnv('SUPABASE_RECORD_FILES_BUCKET', 'test');
    const originalFetch = globalThis.fetch;
    const storage = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https://storage.example.test') ? Promise.resolve(new Response('stored', { status: 200 })) : originalFetch(input, init));
    try {
      const upload = async (bytes: string) => {
        const response = await fetch(`${base}/crm/accounts/custom-field-uploads?name=site.pdf&type=application/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: bytes });
        return { status: response.status, body: await response.json() };
      };
      expect((await upload('not a PDF')).status).toBe(400);
      const pending = await upload('%PDF-test fixture'); expect(pending.status).toBe(201);
      const id = pending.body.data.id;
      expect((await prisma.recordFile.findUniqueOrThrow({ where: { id } })).pendingModule).toBe('accounts');
      const other = await prisma.user.create({ data: { tenantId, firstName: 'Other', lastName: 'Admin', email: `${randomUUID()}@camxian.com`, role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
      const otherToken = (await issueAuthSession(other)).token;
      expect((await call('/crm/accounts', 'POST', { name: 'Wrong uploader', customFieldValues: { [document.id]: id } }, otherToken)).status).toBe(400);
      expect((await prisma.recordFile.findUniqueOrThrow({ where: { id } })).pendingModule).toBe('accounts');
      const created = await call('/crm/accounts', 'POST', { name: 'File account', customFieldValues: { [document.id]: id } });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const saved = await prisma.recordFile.findUniqueOrThrow({ where: { id } });
      expect(saved.pendingModule).toBeNull(); expect(saved.accountId).toBe(created.body.data.id);
      expect((await call('/crm/accounts', 'POST', { name: 'Other record', customFieldValues: { [document.id]: id } })).status).toBe(400);
      const state = (await call(`/crm/accounts/${created.body.data.id}/custom-fields`)).body.data;
      expect(state.files[0].name).toBe('site.pdf'); expect(state.values[document.id]).toBe(id);
      const expired = await upload('%PDF-expired fixture');
      await prisma.recordFile.update({ where: { id: expired.body.data.id }, data: { uploadedAt: new Date(Date.now() - 2 * 86400000) } });
      expect((await call('/crm/accounts', 'POST', { name: 'Expired file', customFieldValues: { [document.id]: expired.body.data.id } })).status).toBe(400);
    } finally { storage.mockRestore(); vi.unstubAllEnvs(); }
  });

  it('attaches one pending upload to every Deal in an atomic, replayable product batch', async () => {
    const document = await field('deals', 'Site plan', { type: 'File Upload', group: 'Deal Information', required: true });
    const products = await Promise.all(['Camera', 'Recorder'].map(name => prisma.productInterest.create({ data: { tenantId, name, dealValue: 100 } })));
    const pipeline = await tenantContext.run({ tenantId }, () => salesTransaction(tx => salesPipeline(tx, tenantId)));
    const stage = await prisma.stage.findFirstOrThrow({ where: { tenantId, pipelineId: pipeline.pipeline.id, name: 'Lead' } });
    vi.stubEnv('SUPABASE_URL', 'https://storage.example.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only'); vi.stubEnv('SUPABASE_RECORD_FILES_BUCKET', 'test');
    const originalFetch = globalThis.fetch;
    const storage = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input).startsWith('https://storage.example.test') ? Promise.resolve(new Response('stored', { status: 200 })) : originalFetch(input, init));
    try {
      const upload = await fetch(`${base}/crm/deals/custom-field-uploads?name=site.pdf&type=application/pdf`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: '%PDF-batch fixture' });
      expect(upload.status).toBe(201);
      const fileId = (await upload.json()).data.id;
      const input = { title: 'Installation', pipelineId: pipeline.pipeline.id, stageId: stage.id, productInterestIds: products.map(p => p.id), idempotencyKey: randomUUID(), customFieldValues: { [document.id]: fileId } };
      const created = await call('/crm/deals/batch', 'POST', input);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const ids = created.body.data.deals.map((deal: { id: string }) => deal.id);
      const values = await prisma.customFieldValue.findMany({ where: { tenantId, fieldId: document.id, dealId: { in: ids } } });
      expect(values).toHaveLength(2); expect(new Set(values.map(row => row.value)).size).toBe(2);
      const files = await prisma.recordFile.findMany({ where: { tenantId, dealId: { in: ids } } });
      expect(files).toHaveLength(2); expect(new Set(files.map(file => file.objectKey)).size).toBe(1);
      const replay = await call('/crm/deals/batch', 'POST', input);
      expect(replay.status).toBe(200); expect(replay.body.data.replayed).toBe(true);
      expect(await prisma.recordFile.count({ where: { tenantId } })).toBe(2);
    } finally { storage.mockRestore(); vi.unstubAllEnvs(); }
  });
  it('preserves legacy groups on edit but prevents creating arbitrary or mismatched groups', async () => {
    const existing = await field('contacts', 'Legacy note');
    await prisma.closingFieldDefinition.update({ where: { tenantId_id: { tenantId, id: existing.id } }, data: { definition: { ...existing, group: 'Legacy Section' } } });
    expect((await call(`/administration/closing-requirements/${existing.id}`, 'PATCH', { name: 'Renamed legacy' })).status).toBe(200);
    const list = (await call('/administration/closing-requirements')).body.data as ClosingField[];
    expect(list.find(f => f.id === existing.id)?.group).toBe('Legacy Section');
    for (const group of ['Legacy Section', 'Closed Won Requirements', 'New arbitrary section']) {
      expect((await call('/administration/closing-requirements', 'POST', { module: 'contacts', group, name: 'Invalid group', type: 'Text', required: false })).status).toBe(400);
    }
  });
  it('automatically assigns Accounts through the existing sales rotation and excludes Client Admin', async () => {
    const agents = [];
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales Agent' } });
    for (const module of ['leads', 'deals']) await prisma.rolePermission.create({ data: { tenantId, roleId: role.id, module, canView: true, canEdit: true } });
    for (let i = 0; i < 2; i++) {
      const agent = await prisma.user.create({ data: { tenantId, firstName: 'Agent', lastName: String(i), email: `${randomUUID()}@camxian.com`, role: 'Sales Agent', status: 'ACTIVE' } });
      await prisma.userRole.create({ data: { tenantId, userId: agent.id, roleId: role.id } });
      agents.push(agent.id);
    }
    const first = await call('/crm/accounts', 'POST', { name: 'First automatic' });
    const second = await call('/crm/accounts', 'POST', { name: 'Second automatic' });
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(new Set([first.body.data.assignedUserId, second.body.data.assignedUserId])).toEqual(new Set(agents));
    expect(first.body.data.assignedUserId).not.toBe(actorId);
    expect((await call(`/crm/accounts/${first.body.data.id}`)).body.data.assignedUserId).toBe(first.body.data.assignedUserId);
  });

});
