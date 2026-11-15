import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { CUSTOMER_PHONE_CONFLICT, STAFF_PHONE_CONFLICT } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import app from '../../app';
import { issueAuthSession } from '../../core/auth/auth-session';
import { tenantContext } from '../../core/tenant/tenant-context';
import { runAuthorizedWorkflow } from './access/crm-record-access.service';
import { salesTransaction } from './leads/lead-automation.service';
import { updateContact as updateLead } from './contacts/contacts.repository';
import { csvRowValidator, validateImportRow, createImportRow } from './imports/import-rows.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
type Module = 'leads' | 'contacts';
const modules: Module[] = ['leads', 'contacts'];
describe.skipIf(url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_forms_test_2')('Internal phone availability on disposable PostgreSQL', () => {
  let tenantId: string, actorId: string, token: string, editorId: string, editorToken: string, deniedToken: string, creatorToken: string, base: string, server: Server;
  let sequence = 0;
  const phone = () => `9${String(++sequence).padStart(9, '0')}`;
  const payload = (number: string) => ({ requestId: randomUUID(), firstName: 'New', lastName: 'Customer', email: `${randomUUID()}@example.test`, phone: number });
  const request = async (path: string, method = 'GET', body?: unknown, auth = token) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const raw = (module: Module, number: string | null, extra = {}, owner = tenantId) => {
    const data = { tenantId: owner, firstName: 'Existing', lastName: 'Customer', email: `${randomUUID()}@example.test`, phone: number, ...extra };
    return module === 'leads' ? prisma.lead.create({ data }) : prisma.contact.create({ data });
  };
  const available = (module: Module, number: string, excludeId?: string, auth = token) =>
    request(`/crm/phone-availability?${new URLSearchParams({ module, phone: number, ...(excludeId ? { excludeId } : {}) })}`, 'GET', undefined, auth);
  const expectConflict = (result: { status: number; body: any }) =>
    expect(result).toMatchObject({ status: 400, body: { fieldErrors: { phone: [CUSTOMER_PHONE_CONFLICT] } } });

  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Phone uniqueness QA', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } })).id;
    for (const name of ['Client Admin', 'Phone Editor', 'Phone Creator', 'No Access']) {
      const role = await prisma.roleDefinition.create({ data: { tenantId, name, isSystemRole: name === 'Client Admin',
        permissions: name.startsWith('Phone') ? { create: modules.map(module => ({ module, canView: true, canViewAll: true, canEdit: name === 'Phone Editor', canCreate: name === 'Phone Creator' })) } : undefined } });
      const user = await prisma.user.create({ data: { tenantId, firstName: 'Phone', lastName: 'Tester', email: `${randomUUID()}@camxian.com`, role: name,
        mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId: role.id } } } });
      const session = await issueAuthSession(user);
      if (name === 'Client Admin') { token = session.token; actorId = user.id; }
      else if (name === 'Phone Editor') { editorToken = session.token; editorId = user.id; }
      else if (name === 'Phone Creator') creatorToken = session.token;
      else deniedToken = session.token;
    }
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });

  it.each(modules)('%s allows unused and optional empty numbers and requires authorization', async module => {
    expect((await available(module, phone())).body.data).toEqual({ available: true });
    expect((await available(module, '')).body.data).toEqual({ available: true });
    expect((await available(module, phone(), undefined, deniedToken)).status).toBe(403);
    expect((await available(module, '123')).status).toBe(400);
    expect((await request(`/crm/${module}`, 'POST', payload(''))).status).toBe(201);
  });

  it.each(modules.flatMap(module => modules.map(existing => ({ module, existing }))))('blocks existing $existing on manual $module create and preflight without exposing identity', async ({ module, existing }) => {
    const number = phone(); await raw(existing, `0${number}`);
    const result = await available(module, `+63${number}`, undefined, editorToken);
    expect(result.body.data).toEqual({ available: false, reason: 'CUSTOMER_PHONE_CONFLICT' });
    expect(JSON.stringify(result.body)).not.toContain('Existing');
    expectConflict(await request(`/crm/${module}`, 'POST', payload(number)));
  });

  it.each(['local', 'national', 'international', 'formatted'])('compares exact normalized historical %s numbers, including records beyond warning samples', async format => {
    const number = phone();
    const formatted = format === 'local' ? number : format === 'national' ? `0${number}` : format === 'international' ? `+63${number}`
      : `+63 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`;
    await prisma.lead.createMany({ data: Array.from({ length: 55 }, () => ({ tenantId, firstName: 'Earlier', lastName: 'Row', phone: `+63${phone()}` })) });
    await raw('leads', formatted);
    expect((await available('contacts', number)).body.data.reason).toBe('CUSTOMER_PHONE_CONFLICT');
    const different = phone();
    await raw('contacts', `+63${different}8`);
    await raw('contacts', different.slice(-7));
    expect((await available('leads', different)).body.data).toEqual({ available: true });
  });

  it.each(modules.flatMap(module => ['archived', 'deleted', 'merged'].map(history => ({ module, history }))))('includes $history $module history', async ({ module, history }) => {
    const number = phone();
    await raw(module, `+63${number}`, history === 'deleted' ? { deletedAt: new Date() }
      : history === 'merged' && module === 'leads' ? { status: 'Merged', isArchived: true } : { isArchived: true });
    expect((await available('leads', number)).body.data.reason).toBe('CUSTOMER_PHONE_CONFLICT');
  });

  it.each(modules)('%s permits unchanged historical duplicates, excludes self, and blocks changed conflicts', async module => {
    const number = phone(), otherNumber = phone();
    const own = await raw(module, `0${number}`, { assignedUserId: editorId });
    await raw(module === 'leads' ? 'contacts' : 'leads', `+63${number}`);
    await raw('contacts', `+63${otherNumber}`);
    expect((await available(module, number, own.id, editorToken)).body.data).toEqual({ available: true });
    expect((await request(`/crm/${module}/${own.id}`, 'PUT', { firstName: 'Retained', phone: `+63${number}` }, editorToken)).status).toBe(200);
    expectConflict(await request(`/crm/${module}/${own.id}`, 'PUT', { phone: otherNumber }, editorToken));
    expect((await request(`/crm/${module}/${own.id}`, 'PUT', { phone: '' }, editorToken)).status).toBe(200);
  });

  it('scopes exclusions and conflicts to the tenant and requires edit permission for exclusion', async () => {
    const foreignTenant = (await prisma.tenant.create({ data: { name: 'Foreign phones', slug: randomUUID() } })).id;
    const number = phone(), foreign = await raw('contacts', `+63${number}`, {}, foreignTenant);
    expect((await available('leads', number)).body.data).toEqual({ available: true });
    expect((await available('contacts', number, foreign.id)).status).toBe(404);
    const own = await raw('leads', null);
    expect((await available('leads', phone(), own.id, creatorToken)).status).toBe(403);
    expect((await available('contacts', phone(), own.id)).status).toBe(404);
    expect((await available('leads', phone(), randomUUID())).status).toBe(404);
  });

  it.each(modules)('%s still blocks staff conflicts even on unchanged or unrelated edits', async module => {
    const number = phone(), own = await raw(module, `+63${number}`);
    await prisma.user.create({ data: { tenantId, firstName: 'Private', lastName: 'Staff', role: 'No Access', status: 'INACTIVE', email: `${randomUUID()}@camxian.com`, phone: `0${number}` } });
    expect((await available(module, number, own.id)).body.data).toEqual({ available: false, reason: 'STAFF_PHONE_NOT_ALLOWED' });
    expect(await request(`/crm/${module}/${own.id}`, 'PUT', { firstName: 'Unrelated' })).toMatchObject({ status: 400, body: { fieldErrors: { phone: [STAFF_PHONE_CONFLICT] } } });
  });

  it('retains linked conversion identity when the Contact changes back to its historical Lead phone', async () => {
    const number = phone(), source = await raw('leads', `+63${number}`);
    const converted = await request(`/crm/leads/${source.id}/convert`, 'POST', { skipAccountCreation: true });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: source.id } });
    expect(lead.contactId).toBeTruthy();
    expect((await request(`/crm/contacts/${lead.contactId}`, 'PUT', { phone: phone() })).status).toBe(200);
    expect((await available('contacts', number, lead.contactId!)).body.data).toEqual({ available: true });
    expect((await request(`/crm/contacts/${lead.contactId}`, 'PUT', { phone: number })).status).toBe(200);
    expectConflict(await request('/crm/leads', 'POST', payload(number)));
  });

  it.each(modules)('preserves %s merge provenance without releasing the archived phone to new customers', async module => {
    const number = phone(), primary = await raw(module, null), secondary = await raw(module, `+63${number}`);
    const merge = await request('/crm/merge', 'POST', { entityType: module === 'leads' ? 'lead' : 'contact', primaryId: primary.id, secondaryId: secondary.id, fieldResolutions: { phone: 'secondary' } });
    expect(merge.status, JSON.stringify(merge.body)).toBe(200);
    expect((await request(`/crm/${module}/${primary.id}`, 'PUT', { phone: phone() })).status).toBe(200);
    expect((await request(`/crm/${module}/${primary.id}`, 'PUT', { phone: number })).status).toBe(200);
    expectConflict(await request(`/crm/${module}`, 'POST', payload(number)));
  });

  it('does not infer shared identity from email, names or Account', async () => {
    const number = phone(), own = await raw('leads', null);
    await raw('contacts', `+63${number}`, { email: own.email, firstName: own.firstName, lastName: own.lastName });
    expect((await available('leads', number, own.id)).body.data.reason).toBe('CUSTOMER_PHONE_CONFLICT');
  });

  it('preserves creation retries and rolls back linked Accounts on conflicts', async () => {
    const data = payload(phone());
    const first = await request('/crm/leads', 'POST', data);
    const replay = await request('/crm/leads', 'POST', data);
    expect(first.status).toBe(201); expect(replay.body.data.id).toBe(first.body.data.id);
    const contactData = payload(phone());
    const contact = await request('/crm/contacts', 'POST', contactData);
    const contactReplay = await request('/crm/contacts', 'POST', contactData);
    expect(contact.status).toBe(201); expect(contactReplay.body.data.id).toBe(contact.body.data.id);
    expectConflict(await request('/crm/contacts', 'POST', { ...payload(data.phone), newAccount: { requestId: randomUUID(), name: 'Rejected Account' } }));
    expect(await prisma.account.count({ where: { tenantId, name: 'Rejected Account' } })).toBe(0);
  });

  it.each([['leads', 'leads'], ['contacts', 'contacts'], ['leads', 'contacts']] as const)('serializes concurrent %s and %s creation', async (left, right) => {
    const number = phone();
    const results = await Promise.all([request(`/crm/${left}`, 'POST', payload(number)), request(`/crm/${right}`, 'POST', payload(`+63${number}`))]);
    expect(results.map(result => result.status).sort()).toEqual([201, 400]);
    expectConflict(results.find(result => result.status === 400)!);
    expect(await prisma.lead.count({ where: { tenantId, phone: `+63${number}` } }) + await prisma.contact.count({ where: { tenantId, phone: `+63${number}` } })).toBe(1);
  });

  it('serializes concurrent updates and create-versus-update across customer modules', async () => {
    const left = await raw('leads', null), right = await raw('contacts', null), number = phone();
    const updated = await Promise.all([request(`/crm/leads/${left.id}`, 'PUT', { phone: number }), request(`/crm/contacts/${right.id}`, 'PUT', { phone: number })]);
    expect(updated.map(result => result.status).sort()).toEqual([200, 400]);
    expectConflict(updated.find(result => result.status === 400)!);
    const next = phone(), other = await raw('contacts', null);
    const created = await Promise.all([request('/crm/leads', 'POST', payload(next)), request(`/crm/contacts/${other.id}`, 'PUT', { phone: next })]);
    expect(created.filter(result => result.status === 400), JSON.stringify(created)).toHaveLength(1);
    expect(created.filter(result => result.status === 200 || result.status === 201)).toHaveLength(1);
    expectConflict(created.find(result => result.status === 400)!);
  });

  it('keeps automated workflow phone updates under their existing policy', async () => {
    const number = phone(), own = await raw('leads', null); await raw('contacts', `+63${number}`);
    await tenantContext.run({ tenantId }, () => runAuthorizedWorkflow(tenantId, randomUUID(), () => updateLead(own.id, tenantId, { phone: `+63${number}` }, actorId), actorId));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: own.id } })).phone).toBe(`+63${number}`);
  });

  it.each(modules)('%s CSV review and commit block customer phones and batch duplicates while ignoring invalid/failed rows', async module => {
    const number = phone(); await raw('contacts', `0${number}`);
    const row = (rowNumber: number, value: string, extra = {}) => ({ rowNumber, data: { firstName: 'CSV', lastName: 'Customer', email: `${randomUUID()}@example.test`, phone: value, companyName: 'Company', address: 'Street', ...extra } });
    const conflict = await validateImportRow(prisma, module, tenantId, row(2, number));
    expect(conflict.status).toBe('duplicate'); expect(conflict.errors.join(' ')).toContain(CUSTOMER_PHONE_CONFLICT);
    const fresh = phone(), rows = [row(2, fresh), row(3, `+63${fresh}`)];
    expect((await csvRowValidator(module, tenantId, rows)(prisma, rows[1])).status).toBe('duplicate');
    const invalid = [row(2, fresh, { productInterest: 'Unknown Product' }), row(3, fresh)];
    expect((await csvRowValidator(module, tenantId, invalid)(prisma, invalid[1])).isValid).toBe(true);
    expect((await csvRowValidator(module, tenantId, rows, async () => true)(prisma, rows[1])).isValid).toBe(true);
    await tenantContext.run({ tenantId }, () => salesTransaction(async tx => {
      const checked = await validateImportRow(tx, module, tenantId, rows[0]);
      expect(checked.isValid).toBe(true);
      await createImportRow(tx, module, tenantId, actorId, randomUUID(), checked);
    }));
    expect((await validateImportRow(prisma, module, tenantId, rows[1])).status).toBe('duplicate');
  });
});
