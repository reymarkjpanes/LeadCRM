import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../config/database.config';
import app from '../../../app';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { CreateLeadSchema, NewAccountSchema } from '@leadcrm/shared';
import { CreateClientContactSchema } from '../contacts-v2/contacts-v2.dto';
import { crmActor } from '../access/crm-record-access.service';
import * as merges from '../merge/merge.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = url.hostname === '127.0.0.1' && /^\/leadcrm_crm_polish_test(?:_\d+)?$/.test(url.pathname);
describe.skipIf(!disposable)('Atomic organization creation over authenticated HTTP', () => {
  let tenantId: string, adminId: string, adminToken: string, staffToken: string, server: Server, base: string, roleId: string, productId: string;
  const scope = <T>(run: () => T) => tenantContext.run({ tenantId }, run);
  const person = () => ({ firstName: 'Person', lastName: 'Polish', email: `${randomUUID()}@example.test`, status: 'Warm', requestId: randomUUID() });
  const company = () => ({ requestId: randomUUID(), name: `Company ${randomUUID()}`, industry: 'Technology', size: '11-50', website: 'https://company.test', address: '42 Main Street\nMakati, Philippines' });
  async function call(path: string, method: string, body: unknown, token = adminToken) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Polish acceptance', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    const admin = await prisma.user.create({ data: { tenantId, firstName: 'Test', lastName: 'Admin', role: 'Client Admin', email: `${randomUUID()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    adminToken = (await issueAuthSession(admin)).token;
    adminId = admin.id;
    productId = (await scope(() => prisma.productInterest.create({ data: { tenantId, name: 'Polish Product', dealValue: 2500 } }))).id;
    const role = await scope(() => prisma.roleDefinition.create({ data: { tenantId, name: 'Person intake' } })); roleId = role.id;
    await scope(() => prisma.rolePermission.createMany({ data: ['leads', 'contacts'].map(module => ({ tenantId, roleId, module, canView: true, canCreate: true, canEdit: true })) }));
    const staff = await prisma.user.create({ data: { tenantId, firstName: 'Test', lastName: 'Staff', role: role.name, email: `${randomUUID()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId } } } });
    staffToken = (await issueAuthSession(staff)).token;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  }, 30000);
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('shares strict contracts and rejects conflicting Account input', () => {
    const newAccount = company();
    expect(NewAccountSchema.safeParse(newAccount).success).toBe(true);
    expect(NewAccountSchema.safeParse({ ...newAccount, website: 'bad' }).success).toBe(false);
    expect(NewAccountSchema.safeParse({ ...newAccount, address: 'a'.repeat(2001) }).success).toBe(false);
    expect(NewAccountSchema.safeParse({ ...newAccount, address: 'Bad\u0000address' }).success).toBe(false);
    expect(CreateLeadSchema.safeParse({ ...person(), accountId: randomUUID(), newAccount }).success).toBe(false);
    expect(CreateClientContactSchema.safeParse({ ...person(), accountId: randomUUID(), newAccount }).success).toBe(false);
  });

  it('replays standalone Account creation without duplicate records, receipts or audit entries', async () => {
    const input = company();
    const first = await call('/crm/accounts', 'POST', input);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const replay = await call('/crm/accounts', 'POST', input);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: input.name } }))).toBe(1);
    expect(await scope(() => prisma.accountCreationReceipt.count({ where: { tenantId, requestId: input.requestId } }))).toBe(1);
    expect(await scope(() => prisma.auditLog.count({ where: { tenantId, entityId: first.body.data.id, action: 'account.created' } }))).toBe(1);
    const conflict = await call('/crm/accounts', 'POST', { ...input, name: `Changed ${input.name}` });
    expect(conflict.status).toBe(409);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: `Changed ${input.name}` } }))).toBe(0);
  });

  it('deduplicates concurrent standalone Account creation and preserves older linked receipts', async () => {
    const input = company();
    const responses = await Promise.all(Array.from({ length: 3 }, () => call('/crm/accounts', 'POST', input)));
    expect(responses.every(response => [200, 201].includes(response.status)), JSON.stringify(responses)).toBe(true);
    expect(new Set(responses.map(response => response.body.data.id)).size).toBe(1);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: input.name } }))).toBe(1);

    const legacy = await scope(() => prisma.account.create({ data: { tenantId, name: 'Legacy linked Account' } }));
    const requestId = randomUUID();
    await scope(() => prisma.accountCreationReceipt.create({ data: { tenantId, requestId, actorId: adminId, accountId: legacy.id,
      requestHash: createHash('sha256').update('{"name":"Legacy linked Account"}').digest('hex') } }));
    const replay = await call('/crm/accounts', 'POST', { requestId, name: legacy.name });
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.data.id).toBe(legacy.id);
  });

  it('distinguishes omitted Company Size from an explicit clear and persists the clear', async () => {
    const created = await call('/crm/accounts', 'POST', company());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    const unchanged = await call(`/crm/accounts/${id}`, 'PUT', { industry: 'Retail' });
    expect(unchanged.status, JSON.stringify(unchanged.body)).toBe(200);
    expect(unchanged.body.data.size).toBe('11-50');
    const cleared = await call(`/crm/accounts/${id}`, 'PUT', { size: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.data.size).toBeNull();
    expect((await scope(() => prisma.account.findUniqueOrThrow({ where: { id, tenantId } }))).size).toBeNull();
  });

  it('filters Accounts before paging and reports complete Deal totals beyond the browser cache', async () => {
    const prefix = `Paged ${randomUUID()}`;
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const [empty, linked] = await scope(() => Promise.all([
      prisma.account.create({ data: { tenantId, name: prefix + ' A', industry: 'Paged industry', createdAt, updatedAt: createdAt } }),
      prisma.account.create({ data: { tenantId, name: prefix + ' Z', industry: 'Paged industry', createdAt, updatedAt: new Date('2026-01-02T00:00:00Z') } }),
    ]));
    const pipeline = await scope(() => prisma.pipeline.create({ data: { tenantId, name: prefix } }));
    const stage = await scope(() => prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Open', order: 0, requiredFields: [] } }));
    await scope(() => prisma.deal.createMany({ data: Array.from({ length: 106 }, (_, index) => ({ tenantId, accountId: linked.id, pipelineId: pipeline.id,
      stageId: stage.id, title: prefix + index, value: 10, tags: [], productInterests: [], isArchived: index === 105 })) }));
    const query = `/crm/accounts?search=${encodeURIComponent(prefix)}&pageSize=1&sort=name:asc`;
    const all = await call(query, 'GET', undefined);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.meta.total).toBe(2); expect(all.body.data[0].id).toBe(empty.id);
    expect(all.body.facets).toMatchObject({ touched: 1, untouched: 1, has_deals: 1, 'industry:Paged industry': 2 });
    for (const filter of ['related]=in:has_deals', 'system]=in:touched']) {
      const filtered = await call(query + '&filter[' + filter, 'GET', undefined);
      expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
      expect(filtered.body.meta.total).toBe(1);
      expect(filtered.body.data[0]).toMatchObject({ id: linked.id, dealCount: 105, dealValue: 1050 });
    }
    const untouched = await call(query + '&filter[system]=in:untouched', 'GET', undefined);
    expect(untouched.body.data.map((row: { id: string }) => row.id)).toEqual([empty.id]);
    expect((await call(`/crm/accounts/${linked.id}`, 'GET', undefined)).body.data).toMatchObject({ dealCount: 105, dealValue: 1050 });

    await scope(() => prisma.rolePermission.create({ data: { tenantId, roleId, module: 'accounts', canView: true } }));
    const restricted = await call(query, 'GET', undefined, staffToken);
    expect(restricted.status).toBe(200);
    expect(restricted.body.data[0]).not.toHaveProperty('dealCount');
    expect(restricted.body.facets.has_deals).toBe(0);
    expect((await call(query + '&filter[related]=in:has_deals', 'GET', undefined, staffToken)).body.meta.total).toBe(0);
    await scope(() => prisma.rolePermission.deleteMany({ where: { tenantId, roleId, module: 'accounts' } }));
  });

  it('binds standalone receipts to the actor and tenant and rolls back invalid custom values', async () => {
    const input = company();
    const created = await call('/crm/accounts', 'POST', input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const otherActor = await prisma.user.create({ data: { tenantId, firstName: 'Other', lastName: 'Creator', role: 'Client Admin', email: `${randomUUID()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const otherToken = (await issueAuthSession(otherActor)).token;
    expect((await call('/crm/accounts', 'POST', input, otherToken)).status).toBe(409);
    const otherTenant = await prisma.tenant.create({ data: { name: 'Other Account workspace', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } });
    const foreignActor = await prisma.user.create({ data: { tenantId: otherTenant.id, firstName: 'Other', lastName: 'Workspace', role: 'Client Admin', email: `${randomUUID()}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const foreignToken = (await issueAuthSession(foreignActor)).token;
    const independent = await call('/crm/accounts', 'POST', input, foreignToken);
    expect(independent.status, JSON.stringify(independent.body)).toBe(201);
    expect(independent.body.data.tenantId).toBe(otherTenant.id);
    expect(independent.body.data.id).not.toBe(created.body.data.id);
    expect((await call(`/crm/accounts/${created.body.data.id}`, 'GET', undefined, foreignToken)).status).toBe(404);

    const invalid = { ...company(), customFieldValues: { nonexistent: 'invalid' } };
    expect((await call('/crm/accounts', 'POST', invalid)).status).toBe(400);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: invalid.name } }))).toBe(0);
    expect(await scope(() => prisma.accountCreationReceipt.count({ where: { tenantId, requestId: invalid.requestId } }))).toBe(0);
    const retried = await call('/crm/accounts', 'POST', { ...invalid, customFieldValues: {} });
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
  });

  it.each(['leads', 'contacts'])('creates %s plus one Account, returns company details and replays safely', async module => {
    const input = { ...person(), newAccount: company(), ...(module === 'leads' ? { productInterest: [productId] } : { productInterestIds: [productId] }) };
    const first = await call(`/crm/${module}`, 'POST', input);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const retry = await call(`/crm/${module}`, 'POST', input);
    expect([200, 201]).toContain(retry.status); expect(retry.body.data.id).toBe(first.body.data.id);
    expect(first.body.data.account).toMatchObject({ name: input.newAccount.name, industry: 'Technology', size: '11-50', website: 'https://company.test' });
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: input.newAccount.name } }))).toBe(1);
    expect((await scope(() => prisma.account.findFirstOrThrow({ where: { tenantId, id: first.body.data.accountId } }))).address).toBe(input.newAccount.address);
    expect(first.body.data.address || '').toBe('');
    const deals = await scope(() => prisma.deal.findMany({ where: { tenantId, accountId: first.body.data.accountId } }));
    expect(deals).toHaveLength(1); expect(Number(deals[0].value)).toBe(2500);
    const updated = { newAccount: company() };
    const edit = await call(`/crm/${module}/${first.body.data.id}`, 'PUT', updated);
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const replayEdit = await call(`/crm/${module}/${first.body.data.id}`, 'PUT', updated);
    expect(replayEdit.status, JSON.stringify(replayEdit.body)).toBe(200);
    expect(replayEdit.body.data.accountId).toBe(edit.body.data.accountId);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: updated.newAccount.name } }))).toBe(1);
  });

  it.each(['leads', 'contacts'])('deduplicates concurrent %s submissions with one linked Account', async module => {
    const input = { ...person(), newAccount: company() };
    const responses = await Promise.all(Array.from({ length: 3 }, () => call(`/crm/${module}`, 'POST', input)));
    expect(responses.every(response => [200, 201, 409].includes(response.status)), JSON.stringify(responses)).toBe(true);
    const successes = responses.filter(response => response.status < 300);
    expect(successes.length).toBeGreaterThan(0);
    expect(new Set(successes.map(response => response.body.data.id)).size).toBe(1);
    const retry = await call(`/crm/${module}`, 'POST', input);
    expect(retry.body.data.id).toBe(successes[0].body.data.id);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: input.newAccount.name } }))).toBe(1);
    expect(await scope(() => prisma.accountCreationReceipt.count({ where: { tenantId, requestId: input.newAccount.requestId } }))).toBe(1);
  });

  it.each(['leads', 'contacts'])('links an existing Account to %s using only accountId and preserves the link on retry', async module => {
    const account = await scope(() => prisma.account.create({ data: { tenantId, name: `Selected Account ${randomUUID()}` } }));
    const input = { ...person(), accountId: account.id };
    const receiptCount = await scope(() => prisma.accountCreationReceipt.count({ where: { tenantId } }));
    const created = await call(`/crm/${module}`, 'POST', input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const retry = await call(`/crm/${module}`, 'POST', input);
    expect(retry.body.data.id).toBe(created.body.data.id);
    const where = { id: created.body.data.id, tenantId };
    const saved = module === 'leads' ? await scope(() => prisma.lead.findUniqueOrThrow({ where })) : await scope(() => prisma.contact.findUniqueOrThrow({ where }));
    expect(saved.accountId).toBe(account.id);
    expect(saved.companyName).toBe(account.name);
    expect(await scope(() => prisma.accountCreationReceipt.count({ where: { tenantId } }))).toBe(receiptCount);
  });

  it('rolls back the Account and its receipt if the person save fails', async () => {
    const newAccount = company();
    const response = await call('/crm/leads', 'POST', { ...person(), newAccount, customFieldValues: { nonexistent: 'invalid' } });
    expect(response.status).toBe(400);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: newAccount.name } }))).toBe(0);
    expect(await scope(() => prisma.accountCreationReceipt.count({ where: { tenantId, requestId: newAccount.requestId } }))).toBe(0);
  });

  it('enforces Account permissions and rejects hidden Account metadata', async () => {
    for (const module of ['leads', 'contacts']) {
      const nested = { ...person(), newAccount: company() };
      expect((await call(`/crm/${module}`, 'POST', nested, staffToken)).status).toBe(403);
      expect(await scope(() => prisma.account.count({ where: { tenantId, name: nested.newAccount.name } }))).toBe(0);
      const linked = await call(`/crm/${module}`, 'POST', nested);
      expect(linked.status, JSON.stringify(linked.body)).toBe(201);
      const response = await fetch(`${base}/crm/${module}/${linked.body.data.id}`, { headers: { Authorization: `Bearer ${staffToken}` } });
      const hidden = await response.json(); expect(response.status).toBe(200); expect(hidden.data.account).toBeNull();
    }
  });

  it('rejects cross-tenant Account selections and tenant injection', async () => {
    const foreign = await prisma.tenant.create({ data: { name: 'Foreign', slug: randomUUID() } });
    const account = await prisma.account.create({ data: { tenantId: foreign.id, name: 'Foreign secret' } });
    for (const module of ['leads', 'contacts']) {
      const selected = await call(`/crm/${module}`, 'POST', { ...person(), accountId: account.id });
      expect([400, 404]).toContain(selected.status);
      const injected = await call(`/crm/${module}`, 'POST', { ...person(), newAccount: { ...company(), tenantId: foreign.id } });
      expect(injected.status).toBe(400);
    }
  });

  it('moves imported notes through Account merges without duplication or forged provenance', async () => {
    const primary = await scope(() => prisma.account.create({ data: { tenantId, name: 'Surviving company' } }));
    const secondary = await scope(() => prisma.account.create({ data: { tenantId, name: 'Merged company', notes: 'Original company note' } }));
    const params = { tenantId, entityType: 'account' as const, primaryId: primary.id, secondaryId: secondary.id };
    const preview = await scope(() => merges.preview(params));
    expect(preview.fieldComparisons.map(field => field.field)).not.toContain('notes');
    expect((await call('/crm/activities', 'POST', { type: 'note', title: 'Forged import', accountId: primary.id, metadata: { legacyAccountNote: 'v1' } })).status).toBe(403);
    await crmActor.run({ tenantId, userId: adminId }, () => scope(() => merges.execute({ ...params, userId: adminId, fieldResolutions: {} })));
    const notes = await scope(() => prisma.activity.findMany({ where: { tenantId, accountId: primary.id, type: 'note' } }));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ description: 'Original company note', createdById: null, metadata: { sourceAccountId: secondary.id } });
    const [destination] = await prisma.$queryRawUnsafe<Array<{ valid: boolean }>>('SELECT crm_history.account_note_destination($1,$2,$3) AS valid', tenantId, secondary.id, primary.id);
    expect(destination.valid).toBe(true);
  });

  it('enforces required Account custom fields and request identity without leaving partial records', async () => {
    const fieldId = randomUUID();
    await scope(() => prisma.closingFieldDefinition.create({ data: { tenantId, id: fieldId, definition: { id: fieldId, name: 'Company context', module: 'accounts', type: 'Text', group: 'Additional Information', groupId: 'accounts:additional-information', required: true, active: true, visibleInForm: true, visibleInDetails: true, options: [], order: 0 } } }));
    const input = { ...person(), newAccount: company() };
    const missing = await call('/crm/contacts', 'POST', input); expect(missing.status, JSON.stringify(missing.body)).toBe(400);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: input.newAccount.name } }))).toBe(0);
    const complete = { ...input, newAccount: { ...input.newAccount, customFieldValues: { [fieldId]: 'Required company context' } } };
    const saved = await call('/crm/contacts', 'POST', complete); expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect((await call('/crm/contacts', 'POST', { ...person(), newAccount: { ...complete.newAccount, name: 'Changed receipt input' } })).status).toBe(409);
    const optional = await call('/crm/leads', 'POST', { ...person(), companyName: 'Legacy company text' });
    expect(optional.status, JSON.stringify(optional.body)).toBe(201); expect(optional.body.data.accountId).toBeNull();
    expect((await call(`/crm/leads/${optional.body.data.id}`, 'PUT', { address: 'Updated address' })).status).toBe(200);
    const rejectedConversion = await call(`/crm/leads/${optional.body.data.id}/convert`, 'POST', {});
    expect(rejectedConversion.status, JSON.stringify(rejectedConversion.body)).toBe(400);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: 'Legacy company text' } }))).toBe(0);
    expect(await scope(() => prisma.contact.count({ where: { tenantId, email: optional.body.data.email } }))).toBe(0);
    expect((await scope(() => prisma.lead.findUniqueOrThrow({ where: { id: optional.body.data.id, tenantId } }))).convertedAt).toBeNull();
    const conversionAccount = { ...company(), customFieldValues: { [fieldId]: 'Conversion company context' } };
    const converted = await call(`/crm/leads/${optional.body.data.id}/convert`, 'POST', { newAccount: conversionAccount });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    expect(converted.body.data.account.name).toBe(conversionAccount.name);
    expect(await scope(() => prisma.customFieldValue.findFirst({ where: { tenantId, accountId: converted.body.data.account.id, fieldId } }))).toMatchObject({ value: 'Conversion company context' });
    const replay = await call(`/crm/leads/${optional.body.data.id}/convert`, 'POST', { newAccount: conversionAccount });
    expect(replay.status).toBe(200);
    expect(replay.body.data.account.id).toBe(converted.body.data.account.id);
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: conversionAccount.name } }))).toBe(1);
    const existing = await scope(() => prisma.account.create({ data: { tenantId, name: `Existing historical Account ${randomUUID()}` } }));
    const linkedLead = await call('/crm/leads', 'POST', person());
    const linked = await call(`/crm/leads/${linkedLead.body.data.id}/convert`, 'POST', { accountId: existing.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data.account.id).toBe(existing.id);
    expect(await scope(() => prisma.customFieldValue.count({ where: { tenantId, accountId: existing.id } }))).toBe(0);
    const textOnlyLead = await call('/crm/leads', 'POST', { ...person(), companyName: `Intake text ${randomUUID()}` });
    const withoutNewAccount = await call(`/crm/leads/${textOnlyLead.body.data.id}/convert`, 'POST', { skipAccountCreation: true });
    expect(withoutNewAccount.status, JSON.stringify(withoutNewAccount.body)).toBe(200);
    expect(withoutNewAccount.body.data.account).toBeNull();
    expect(await scope(() => prisma.account.count({ where: { tenantId, name: 'Legacy company text' } }))).toBe(0);
  });
});
