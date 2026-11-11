import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { CreateCrmImportSchema, importRowSchemas, mapImportCsv, parseImportCsv, type CrmImportModule } from '@leadcrm/shared';
vi.mock('../../../shared/services/email.service', () => ({ sendMail: vi.fn() }));
import prisma from '../../../config/database.config';
import { issueAuthSession } from '../../../core/auth/auth-session';
import app from '../../../app';
import { purgeExpiredImportUploads } from './import-cleanup.service';
import { importHandlers, importValidationErrors } from './import-rows.service';
import { ValidationError } from '../../../shared/errors/http-error';
import { databaseImportModule, importModules } from './import-modules';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = url.hostname === '127.0.0.1' && url.pathname === '/leadcrm_forms_test_2';
const csv = (rows: Record<string, string>[]) => {
  const keys = Object.keys(rows[0]);
  const quote = (v: string) => '"' + v.replace(/"/g, '""') + '"';
  return { fileName: 'test.csv', csvText: [keys.join(','), ...rows.map(r => keys.map(k => quote(r[k] ?? '')).join(','))].join('\n'),
    mappings: Object.fromEntries(keys.map((k, i) => [k, i])), idempotencyKey: randomUUID() };
};
const person = (email: string, productInterest = 'CCTV Surveillance System; Biometrics') => ({ firstName: 'John', lastName: 'Doe', email, phone: '9123456789', companyName: 'ABC Corporation', address: 'Manila', productInterest });

describe('shared CSV contract', () => {
  it('rejects retired module discriminators before mapping or database access', () => {
    expect(Object.keys(importModules).sort()).toEqual(['accounts', 'contacts', 'leads']);
    expect(Object.keys(importHandlers).sort()).toEqual(['accounts', 'contacts', 'leads']);
    // @ts-expect-error Deals are not an active import request module.
    const retired: CrmImportModule = 'deals';
    expect(() => databaseImportModule(retired)).toThrow('Unsupported CRM import module');
    expect(() => mapImportCsv(retired, csv([{ name: 'Company' }]))).toThrow('Unsupported CRM import module');
  });
  it('rejects retired Account product and assignment mappings', () => {
    for (const field of ['productInterest', 'productInterests', 'activeProducts', 'productInterestIds', 'assignedUserId', 'tags', 'internalNotes']) {
      expect(() => mapImportCsv('accounts', csv([{ name: 'Company', [field]: 'Legacy value' }]))).toThrow('Unsupported import field');
    }
  });
  it('validates structure, normalized headers, mapping, size, row limits and physical lines', () => {
    expect(parseImportCsv('\ufeffName,Note\r\n\r\nA,"first\nsecond"\r\nB,end').rowNumbers).toEqual([3, 5]);
    for (const content of ['Name,name\nA,B', 'Name,\nA,B', 'A,B\nx', 'A\n"unclosed']) expect(() => parseImportCsv(content)).toThrow();
    expect(() => mapImportCsv('accounts', { ...csv([{ name: 'Acme' }]), mappings: {} })).toThrow('Missing required');
    expect(() => parseImportCsv('Name\n' + Array(5001).fill('a').join('\n'))).toThrow('5000');
    expect(() => parseImportCsv(Array.from({ length: 101 }, (_, i) => `Column ${i}`).join(','))).toThrow('100 CSV columns');
    expect(() => mapImportCsv('leads', { ...csv([person('a@example.com')]), mappings: { firstName: 0, lastName: 1, email: 1 } })).toThrow('mapped once');
    expect(() => mapImportCsv('accounts', { ...csv([{ name: 'Acme' }]), mappings: { name: 1 } })).toThrow('Invalid column mapping');
    expect(() => mapImportCsv('accounts', { ...csv([{ name: 'Acme' }]), mappings: { name: 0, unsupported: 1 } })).toThrow('Unsupported import field');
    expect(CreateCrmImportSchema.safeParse({ ...csv([{ name: 'Acme' }]), fileName: 'test.exe' }).success).toBe(false);
    expect(CreateCrmImportSchema.safeParse({ ...csv([{ name: 'Acme' }]), csvText: 'a'.repeat(10 * 1024 * 1024 + 1) }).success).toBe(false);
    const invalidPhone = importRowSchemas.leads.safeParse({ ...person('phone@example.com'), phone: '123' });
    expect(invalidPhone.success).toBe(false);
    if (!invalidPhone.success) expect(importValidationErrors(invalidPhone.error)?.join()).toContain('Phone Number: Philippine mobile number must start with 9.');
  });
});

describe.skipIf(!disposable)('CRM CSV import database and HTTP', () => {
  let tenantId: string, actorId: string, token: string, denied: string, foreign: string, base: string, server: Server;
  let cctv: string, bio: string;
  async function request(module: CrmImportModule, suffix = '', method = 'GET', body?: unknown, auth = token) {
    const r = await fetch(`${base}/crm/${module}/imports${suffix}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }
  async function run(module: CrmImportModule, body: ReturnType<typeof csv>) {
    let response;
    do { response = await request(module, '', 'POST', body); expect([201, 202]).toContain(response.status); } while (response.body.data.status === 'importing');
    return response.body.data;
  }
  beforeAll(async () => {
    const tenant = process.env.CRM_IMPORT_ROLLOUT_TEST
      ? await prisma.tenant.findUniqueOrThrow({ where: { id: 'import-rollout-tenant' } })
      : await prisma.tenant.create({ data: { name: 'CSV test', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } });
    tenantId = tenant.id;
    const user = process.env.CRM_IMPORT_ROLLOUT_TEST
      ? await prisma.user.findUniqueOrThrow({ where: { id: 'import-rollout-actor' } })
      : await prisma.user.create({ data: { tenantId, firstName: 'Admin', lastName: 'CSV', email: 'csv@camxian.com', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    actorId = user.id; token = (await issueAuthSession(user)).token;
    const viewer = await prisma.user.create({ data: { tenantId, firstName: 'Denied', lastName: 'CSV', email: 'denied-csv@camxian.com', role: 'Viewer', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    denied = (await issueAuthSession(viewer)).token;
    const other = await prisma.tenant.create({ data: { name: 'Other CSV', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } });
    const otherUser = await prisma.user.create({ data: { tenantId: other.id, firstName: 'Other', lastName: 'Admin', email: 'other-csv@camxian.com', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    foreign = (await issueAuthSession(otherUser)).token;
    cctv = (await prisma.productInterest.create({ data: { tenantId, name: 'CCTV Surveillance System', dealValue: 25000 } })).id;
    bio = (await prisma.productInterest.create({ data: { tenantId, name: 'Biometrics', dealValue: 15000 } })).id;
    await prisma.productInterest.create({ data: { tenantId, name: 'Archived Product', dealValue: 10, active: false } });
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it.each(['leads', 'contacts'] as const)('rejects invalid %s CSV names in preview and import without storing them', async module => {
    const input = csv([
      { ...person(`${randomUUID()}@example.test`, ''), firstName: 'John1@' },
      { ...person(`${randomUUID()}@example.test`, ''), lastName: 'Smith_' },
      { ...person(`${randomUUID()}@example.test`, ''), firstName: 'María', lastName: 'O’Connor' },
    ]);
    const preview = await request(module, '/preview', 'POST', input);
    expect(preview.status).toBe(200);
    expect(preview.body.data.map((row: { isValid: boolean }) => row.isValid)).toEqual([false, false, true]);
    expect(preview.body.data[0].errors.join()).toContain('First name must not contain numbers.');
    expect(preview.body.data[1].errors.join()).toContain('Last name must not contain special characters.');
    const result = await run(module, input);
    expect(result.successfulRecords).toBe(1);
    expect(result.failedRecords).toBe(2);
    const email = parseImportCsv(input.csvText).rows[2][2];
    const saved = module === 'leads' ? await prisma.lead.findFirstOrThrow({ where: { tenantId, email } }) : await prisma.contact.findFirstOrThrow({ where: { tenantId, email } });
    expect(saved).toMatchObject({ firstName: 'María', lastName: 'O’Connor' });
  });

  it('imports canonical and old Account templates with identical preview/persistence and retained address/history', async () => {
    const headers = 'Company Name,Industry,Website,Full Address,City,Province / State,Country,Company Size';
    const input = { fileName:'old-accounts.csv', csvText: headers + '\nLegacy Address Account,IT,https://example.test,"10 Street\nToronto",Toronto,Ontario,Canada,1-10',
      mappings:{name:0,industry:1,website:2,address:3,size:7},idempotencyKey:randomUUID() };
    expect((await request('accounts','/preview','POST',input,denied)).status).toBe(403);
    const preview = await request('accounts','/preview','POST',input);
    expect(preview.status).toBe(200);
    expect(preview.body.data[0]).toMatchObject({isValid:true,data:{address:'10 Street\nToronto, Ontario, Canada'}});
    for (const field of ['city','province','country']) expect(preview.body.data[0].data).not.toHaveProperty(field);
    const result = await run('accounts',input);
    expect(result.successfulRecords).toBe(1);
    const account = await prisma.account.findFirstOrThrow({where:{tenantId,name:'Legacy Address Account'},include:{}});
    expect(account.address).toBe(preview.body.data[0].data.address);
    expect(account).not.toHaveProperty('productLinks');
    expect((await run('accounts',input)).id).toBe(result.id);
    expect((await run('accounts',{...input,idempotencyKey:randomUUID()})).duplicateRecords).toBe(1);
    const history = await request('accounts',`/${result.id}/results`);
    expect(history.body.data[0]).toMatchObject({recordId:account.id,data:{address:'10 Street\nToronto',city:'Toronto',province:'Ontario',country:'Canada'}});
    expect((await request('accounts',`/${result.id}`,'GET',undefined,foreign)).status).toBe(404);
    expect(await prisma.account.count({where:{tenantId,name:account.name}})).toBe(1);
    const full = await run('accounts',csv([{name:'Canonical Address Account',address:'42 Queen Street\nParis, France'}]));
    expect(full.successfulRecords).toBe(1);
    expect((await prisma.account.findFirstOrThrow({where:{tenantId,name:'Canonical Address Account'}})).address).toBe('42 Queen Street\nParis, France');
    const country = await run('accounts', {fileName:'country.csv',csvText:'Company Name,Country\nExplicit Country Account,Philippines',mappings:{name:0},idempotencyKey:randomUUID()});
    expect(country.successfulRecords).toBe(1);
    expect((await prisma.account.findFirstOrThrow({where:{tenantId,name:'Explicit Country Account'}})).address).toBe('Philippines');
  });

  it('imports one Lead / one Product with automatic priced Deal', async () => {
    const result = await run('leads', csv([person('one@example.com', 'CCTV Surveillance System')]));
    expect(result.successfulRecords).toBe(1);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: 'one@example.com' }, include: { leadDeals: { include: { deal: true } } } });
    expect(lead.productInterestIds).toEqual([cctv]); expect(lead.leadDeals).toHaveLength(1); expect(lead.leadDeals[0].deal.value).toBe(25000);
  });
  it('deduplicates multiple Products, CSV email case, reimports, and concurrent same-job retries', async () => {
    const input = csv([person(' MULTI@example.com ', 'CCTV Surveillance System; cctv surveillance system;; Biometrics'), person('multi@example.com', 'Biometrics')]);
    const preview = await request('leads', '/preview', 'POST', input);
    expect(preview.body.data.map((r: { status: string }) => r.status)).toEqual(['valid', 'duplicate']);
    const responses = await Promise.all([run('leads', input), run('leads', input)]);
    expect(responses[0].id).toBe(responses[1].id); expect(responses[0].duplicateRecords).toBe(1);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: 'multi@example.com' }, include: { leadDeals: { include: { deal: true } } } });
    expect(lead.productInterestIds.sort()).toEqual([cctv, bio].sort());
    expect(lead.leadDeals.map(({ deal: d }) => d.value).sort()).toEqual([15000, 25000]);
    expect(await prisma.lead.count({ where: { tenantId, email: 'multi@example.com' } })).toBe(1);
    expect((await run('leads', { ...input, idempotencyKey: randomUUID() })).successfulRecords).toBe(0);
    expect((await request('leads', '', 'POST', { ...input, csvText: input.csvText.replace('John', 'Mary') })).status).toBe(409);
  });
  it('prevents concurrent separate jobs from creating the same person and rechecks Products after preview', async () => {
    const payload = csv([person('parallel@example.com', 'Biometrics')]);
    const jobs = await Promise.all([run('leads', payload), run('leads', { ...payload, idempotencyKey: randomUUID() })]);
    expect(jobs.map(j => j.successfulRecords).sort()).toEqual([0, 1]);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: 'parallel@example.com' }, include: { leadDeals: { include: { deal: true } } } });
    expect(lead.leadDeals).toHaveLength(1);
    const priceProduct = await prisma.productInterest.create({ data: { tenantId, name: 'Preview Product', dealValue: 100 } });
    const input = csv([person('fresh-price@example.com', priceProduct.id)]);
    expect((await request('leads', '/preview', 'POST', input)).body.data[0].isValid).toBe(true);
    await prisma.productInterest.update({ where: { id: priceProduct.id }, data: { dealValue: 200 } });
    expect((await run('leads', input)).successfulRecords).toBe(1);
    expect((await prisma.deal.findFirstOrThrow({ where: { tenantId, leadDeals: { some: { lead: { email: 'fresh-price@example.com' } } } } })).value).toBe(200);
    const next = csv([person('inactive-since-preview@example.com', priceProduct.id)]);
    expect((await request('leads', '/preview', 'POST', next)).body.data[0].isValid).toBe(true);
    await prisma.productInterest.update({ where: { id: priceProduct.id }, data: { active: false } });
    expect((await run('leads', next)).failedRecords).toBe(1);
    expect(await prisma.lead.count({ where: { tenantId, email: 'inactive-since-preview@example.com' } })).toBe(0);
  });
  it('imports Contact/Account snapshots from canonical Products and blocks normalized reimports and cross-person duplicates', async () => {
    const input = csv([person('contact@example.com')]);
    expect((await run('contacts', input)).successfulRecords).toBe(1);
    expect((await prisma.contact.findFirstOrThrow({ where: { tenantId, email: 'contact@example.com' } })).productInterests).toEqual(['CCTV Surveillance System', 'Biometrics']);
    expect((await run('contacts', csv([person('CONTACT@example.com')]))).duplicateRecords).toBe(1);
    expect((await run('leads', csv([person('CONTACT@example.com')]))).duplicateRecords).toBe(1);
    expect((await run('contacts', csv([person('one@example.com')]))).duplicateRecords).toBe(1);
    expect((await run('accounts', csv([{ name: 'ABC Corporation', size: '11-50' }]))).successfulRecords).toBe(1);
    expect((await run('accounts', csv([{ name: ' abc  corporation ' }]))).duplicateRecords).toBe(1);
    const account = await prisma.account.findFirstOrThrow({ where: { tenantId, name: 'ABC Corporation' } });
  });
  it('creates only unique Contact Product Deals and replays a completed upload after its parent is deleted', async () => {
    const zero = await prisma.productInterest.create({ data: { tenantId, name: `Zero ${randomUUID()}`, dealValue: 0 } });
    const email = `${randomUUID()}@example.com`, uploadId = randomUUID();
    const input = csv([person(email, `CCTV Surveillance System; Biometrics; ${zero.name}; Biometrics`)]);
    const { csvText, ...metadata } = input;
    expect((await request('contacts', '/upload', 'POST', { uploadId, chunkIndex: 0, totalChunks: 1, content: csvText })).status).toBe(200);
    const payload = { ...metadata, uploadId };
    const created = await request('contacts', '', 'POST', payload);
    expect(created.status).toBe(201); expect(created.body.data.successfulRecords).toBe(1);
    const contact = await prisma.contact.findFirstOrThrow({ where: { tenantId, email } });
    const deals = await prisma.deal.findMany({ where: { tenantId, contactDeals: { some: { contactId: contact.id } } }, include: { stage: true } });
    expect(deals).toHaveLength(3); expect(deals.map(deal => { expect(deal.value).not.toBeNull(); return deal.value!; }).sort((a, b) => a - b)).toEqual([0, 15000, 25000]);
    expect(deals.every(deal => deal.stage.name === 'Lead' && deal.currency === 'PHP')).toBe(true);
    const job = await prisma.crmImportJob.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(job.sourceDigest).toMatch(/^[a-f0-9]{64}$/); expect(job.sourceReference).toBe(uploadId);
    await prisma.crmImportUpload.deleteMany({ where: { tenantId, id: uploadId } });
    expect((await request('contacts', '', 'POST', payload)).body.data.id).toBe(job.id);
    expect(await prisma.deal.count({ where: { tenantId, contactDeals: { some: { contactId: contact.id } } } })).toBe(3);
    expect((await request('contacts', '', 'POST', { ...payload, mappings: { ...payload.mappings, phone: undefined } })).status).toBe(409);
    const emptyEmail = `${randomUUID()}@example.com`;
    expect((await run('contacts', csv([person(emptyEmail, '')]))).successfulRecords).toBe(1);
    const emptyContact = await prisma.contact.findFirstOrThrow({ where: { tenantId, email: emptyEmail } });
    expect(await prisma.deal.count({ where: { tenantId, contactDeals: { some: { contactId: emptyContact.id } } } })).toBe(0);
    const duplicate = await run('contacts', csv([person(email)]));
    expect(duplicate.duplicateRecords).toBe(1);
    expect(await prisma.deal.count({ where: { tenantId, contactDeals: { some: { contactId: contact.id } } } })).toBe(3);
  });
  it('reports unknown/inactive Products, invalid email and field lengths per row', async () => {
    const result = await request('leads', '/preview', 'POST', csv([person('unknown@example.com', 'Unknown CCTV Package'), person('inactive@example.com', 'Archived Product'), { ...person('bad-email'), firstName: 'x'.repeat(101) }]));
    expect(result.body.data[0].errors.join()).toContain('Unknown Product Interest');
    expect(result.body.data[1].errors.join()).toContain('Inactive Product');
    expect(result.body.data[2].errors.join()).toContain('email');
    const job = await run('leads', csv([person('unknown@example.com', 'Unknown CCTV Package')]));
    expect(job.failedRecords).toBe(1); expect(job.successfulRecords).toBe(0);
    expect(await prisma.productInterest.count({ where: { tenantId, name: 'Unknown CCTV Package' } })).toBe(0);
  });
  it('retains Deals, values and Product interests when imported Lead converts to an existing Account', async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: 'multi@example.com' }, include: { leadDeals: { include: { deal: true } } } });
    const qualified = await prisma.stage.findFirstOrThrow({ where: { tenantId, pipelineId: lead.leadDeals[0].deal.pipelineId, name: 'Qualified' } });
    const won = await prisma.stage.findFirstOrThrow({ where: { tenantId, pipelineId: lead.leadDeals[0].deal.pipelineId, isWon: true } });
    const patch = async (suffix: string, body: unknown) => {
      const res = await fetch(`${base}/crm/deals/${lead.leadDeals[0].deal.id}${suffix}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(await res.json())).toBe(200);
    };
    await patch('/stage', { stageId: qualified.id });
    await patch('/closing-requirements', { values: { 'confirmation-type': 'Approved Quotation', 'confirmation-date': '2026-10-04' } });
    await patch('/stage', { stageId: won.id });
    await patch('/stage', { stageId: won.id });
    const converted = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: converted.contactId! } });
    expect(contact.productInterests).toHaveLength(2);
    expect(contact.email).toBe(lead.email);
    expect(contact.assignedUserId).toBe(lead.assignedUserId);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: converted.accountId! } });
    expect(account.name).toBe('ABC Corporation');
    expect(await prisma.activity.count({ where: { tenantId, leadId: lead.id, type: 'conversion' } })).toBe(1);
    expect(await prisma.contactDeal.count({ where: { contactId: contact.id } })).toBe(2);
    expect((await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } })).map(d => [d.id, d.value]).sort()).toEqual(lead.leadDeals.map(({ deal: d }) => [d.id, d.value]).sort());
  });
  it('uploads source in retryable scoped chunks and rejects missing, changed and foreign chunks', async () => {
    const input = csv([{ name: 'Chunk account' }]), uploadId = randomUUID();
    const parts = [input.csvText.slice(0, 10), input.csvText.slice(10)];
    const first = { uploadId, chunkIndex: 0, totalChunks: 2, content: parts[0] };
    expect((await request('accounts', '/upload', 'POST', first)).status).toBe(200);
    expect((await request('accounts', '/upload', 'POST', first)).status).toBe(200);
    const { csvText, ...metadata } = input;
    const payload = { ...metadata, uploadId };
    expect((await request('accounts', '/preview', 'POST', payload)).status).toBe(400);
    expect((await request('accounts', '/upload', 'POST', { ...first, content: 'different' })).status).toBe(409);
    expect((await request('accounts', '/upload', 'POST', { ...first, chunkIndex: 1, content: parts[1] })).status).toBe(200);
    expect((await request('accounts', '/preview', 'POST', payload, foreign)).status).toBe(400);
    expect((await request('accounts', '', 'POST', payload)).body.data.successfulRecords).toBe(1);
    expect(await prisma.crmImportChunk.count({ where: { uploadId } })).toBe(0);
    expect((await request('accounts', '/preview', 'POST', payload)).body.import.successfulRecords).toBe(1);
    expect((await request('accounts', '', 'POST', payload)).body.data.successfulRecords).toBe(1);
  });
  it('resumes batches after interruption and exposes truthful tenant-scoped history for all three active modules', async () => {
    const input = csv(Array.from({ length: 27 }, (_, i) => ({ name: `Batch account ${i}` })));
    const partial = await request('accounts', '', 'POST', input);
    expect(partial.status).toBe(202); expect(partial.body.data.successfulRecords).toBe(25);
    const done = await run('accounts', input); expect(done.successfulRecords).toBe(27); expect(done.id).toBe(partial.body.data.id);
    for (const module of ['leads', 'contacts', 'accounts'] as const) {
      const history = await request(module); expect(history.status).toBe(200); expect(history.body.meta.total).toBeGreaterThan(0);
      const job = history.body.data[0];
      const results = await request(module, `/${job.id}/results?limit=100`);
      expect(results.body.meta.total).toBe(job.totalRecords);
      expect(job.successfulRecords + job.failedRecords + job.duplicateRecords).toBe(job.totalRecords);
      expect((await request(module, `/${job.id}`, 'GET', undefined, foreign)).status).toBe(404);
      expect((await request(module, `/${job.id}/results`, 'GET', undefined, foreign)).status).toBe(404);
      expect((await request(module, '/preview', 'POST', input, denied)).status).toBe(403);
      expect((await request(module, '', 'POST', input, denied)).status).toBe(403);
      expect((await request(module, '', 'POST', input, '')).status).toBe(401);
    }
    for (const csvText of ['name,name\na,b', 'name\n"bad', 'name']) expect((await request('accounts', '', 'POST', { ...input, idempotencyKey: randomUUID(), csvText })).status).toBe(400);
  });
  it('uses one job/result store, isolates module histories, and reuses keys independently per module', async () => {
    const key = randomUUID();
    const inputs = {
      leads: csv([person('shared-lead@example.com', 'Biometrics')]),
      contacts: csv([person('shared-contact@example.com', 'Biometrics')]),
      accounts: csv([{ name: 'Shared job account' }]),
    };
    const modules = { leads: 'LEAD', contacts: 'CONTACT', accounts: 'ACCOUNT' } as const;
    const ids: string[] = [];
    for (const module of Object.keys(modules) as CrmImportModule[]) {
      const payload = { ...inputs[module], idempotencyKey: key };
      const first = await run(module, payload), again = await run(module, payload);
      expect(again.id).toBe(first.id); expect(first.successfulRecords).toBe(1); ids.push(first.id);
      const stored = await prisma.crmImportJob.findUniqueOrThrow({ where: { id: first.id }, include: { results: true } });
      expect(stored.module).toBe(modules[module]); expect(stored.results).toHaveLength(1); expect(stored.results[0].recordId).toBeTruthy();
      const history = await request(module, '?limit=100');
      expect(history.body.data.every((job: { module: string }) => job.module === modules[module])).toBe(true);
      expect(history.body.meta.total).toBe(await prisma.crmImportJob.count({ where: { tenantId, module: modules[module] } }));
      const page1 = await request(module, '?limit=2&page=1'), page2 = await request(module, '?limit=2&page=2');
      expect(page1.body.data.map((job: { id: string }) => job.id)).toEqual(history.body.data.slice(0, 2).map((job: { id: string }) => job.id));
      expect(page2.body.data.map((job: { id: string }) => job.id)).toEqual(history.body.data.slice(2, 4).map((job: { id: string }) => job.id));
      expect(page2.body.meta.total).toBe(history.body.meta.total);
      for (const status of ['completed', 'completed_with_errors']) {
        const filtered = await request(module, `?status=${status}&limit=2`);
        expect(filtered.body.data.every((job: { status: string }) => job.status === status)).toBe(true);
        expect(filtered.body.meta.total).toBe(await prisma.crmImportJob.count({ where: { tenantId, module: modules[module], status } }));
      }
      for (const other of Object.keys(modules).filter(m => m !== module) as CrmImportModule[]) {
        expect((await request(other, `/${first.id}`)).status).toBe(404);
        expect((await request(other, `/${first.id}/results`)).status).toBe(404);
      }
    }
    expect(new Set(ids).size).toBe(3);
    expect(await prisma.crmImportJob.count({ where: { tenantId, idempotencyKey: key } })).toBe(3);
    expect(await prisma.crmImportRowResult.count({ where: { importJobId: { in: ids } } })).toBe(3);
  });
  it('cleans expired upload parents and chunks without deleting job history', async () => {
    const expired = await prisma.crmImportUpload.create({ data: { tenantId, actorId, module: 'ACCOUNT', totalChunks: 1,
      expiresAt: new Date(Date.now() - 1000), chunks: { create: { chunkIndex: 0, content: 'private CSV content' } },
    } });
    const active = await prisma.crmImportUpload.create({ data: { tenantId, actorId, module: 'ACCOUNT', totalChunks: 1,
      expiresAt: new Date(Date.now() + 86400000), chunks: { create: { chunkIndex: 0, content: 'name\nActive' } },
    } });
    const job = await prisma.crmImportJob.create({ data: { tenantId, createdById: actorId, module: 'ACCOUNT', fileName: 'expired.csv', uploadId: expired.id } });
    expect(await purgeExpiredImportUploads()).toBe(1);
    expect(await prisma.crmImportChunk.count({ where: { uploadId: expired.id } })).toBe(0);
    expect((await prisma.crmImportJob.findUniqueOrThrow({ where: { id: job.id } })).uploadId).toBeNull();
    expect(await prisma.crmImportChunk.count({ where: { uploadId: active.id } })).toBe(1);
    expect(await purgeExpiredImportUploads()).toBe(0);
    await prisma.crmImportUpload.delete({ where: { id: active.id } });
  });
  it('persists the applicable ten-row outcome matrix for every module', async () => {
    const scenarios = [[10, 0, 0], [7, 3, 0], [8, 0, 2], [6, 2, 2], [0, 10, 0], [0, 0, 10], [0, 6, 4]];
    for (const module of ['leads', 'contacts', 'accounts'] as const) {
      for (const [valid, duplicate, invalid] of scenarios) {
        const seed = randomUUID();
        const make = (i: number): Record<string, string> => module === 'accounts' ? { name: `Matrix ${seed} ${i}` }
          : person(`matrix-${seed}-${i}@example.com`, 'Biometrics');
        const rows = Array.from({ length: valid }, (_, i) => make(i));
        const invalidRow = (i: number): Record<string, string> => module === 'accounts' ? { name: 'X'.repeat(256) } : { ...make(valid + i), productInterest: 'Missing Matrix Product' };
        if (!valid && duplicate) await run(module, csv([make(0)]));
        const repeated = rows[0] ?? make(0);
        rows.push(...Array.from({ length: duplicate }, () => ({ ...repeated })));
        rows.push(...Array.from({ length: invalid }, (_, i) => invalidRow(i + 1)));
        const input = csv(rows);
        const preview = await request(module, '/preview', 'POST', input);
        expect(preview.status).toBe(200);
        expect(preview.body.data.filter((row: { status: string }) => row.status === 'valid')).toHaveLength(valid);
        expect(preview.body.data.filter((row: { status: string }) => row.status === 'duplicate')).toHaveLength(duplicate);
        const job = await run(module, input);
        expect([job.successfulRecords, job.duplicateRecords, job.failedRecords]).toEqual([valid, duplicate, invalid]);
        expect(job.totalRecords).toBe(10); expect(job.completedAt).toBeTruthy();
        expect(job.status).toBe(!valid ? 'failed' : duplicate + invalid ? 'completed_with_errors' : 'completed');
        const outcomes = await request(module, `/${job.id}/results?limit=100`);
        expect(outcomes.body.data).toHaveLength(10);
        expect(outcomes.body.data.filter((row: { recordId: string | null }) => row.recordId)).toHaveLength(valid);
        const failed = await request(module, `/${job.id}/results?status=failed`);
        expect(failed.body.meta.total).toBe(invalid);
        expect((await run(module, input)).id).toBe(job.id);
        const history = await request(module, `?status=${job.status}&limit=100`);
        expect(history.body.data.some((row: { id: string }) => row.id === job.id)).toBe(true);
      }
    }
  }, 180000);
  it('rolls back a rejected creation and its automatic Deals, records failure, and continues', async () => {
    const bad = `rollback-${randomUUID()}@example.com`, good = `after-${randomUUID()}@example.com`;
    let rolledBackId = '';
    const create = importHandlers.leads.create;
    const spy = vi.spyOn(importHandlers.leads, 'create').mockImplementation(async (...args) => {
      const id = await create(...args);
      if (args[4].rowNumber === 2) { rolledBackId = id; throw new ValidationError('Required relationship is unavailable.'); }
      return id;
    });
    try {
      const job = await run('leads', csv([person(bad), person(bad), person(good)]));
      expect(job.status).toBe('completed_with_errors'); expect(job.successfulRecords).toBe(2); expect(job.failedRecords).toBe(1);
      expect(job.duplicateRecords).toBe(0);
      expect(await prisma.lead.count({ where: { tenantId, email: bad } })).toBe(1);
      const saved = await prisma.crmImportRowResult.findMany({ where: { importJobId: job.id }, orderBy: { rowNumber: 'asc' } });
      expect(saved[0].recordId).toBeNull(); expect(saved[0].remarks).toContain('Row 2: Required relationship');
      expect(saved[1].recordId).toBeTruthy(); expect(saved[1].status).toBe('imported');
      const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: good }, include: { leadDeals: true } });
      expect(lead.leadDeals).toHaveLength(2);
      expect(rolledBackId).toBeTruthy();
      expect(await prisma.deal.count({ where: { tenantId, automationKey: { startsWith: rolledBackId } } })).toBe(0);
      expect(await prisma.leadDeal.count({ where: { tenantId, leadId: rolledBackId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { tenantId, entityId: rolledBackId } })).toBe(0);
    } finally { spy.mockRestore(); }
  });
  it('keeps infrastructure interruption resumable with truthful committed progress', async () => {
    const input = csv([{ name: `Before interruption ${randomUUID()}` }, { name: `After interruption ${randomUUID()}` }]);
    const create = importHandlers.accounts.create;
    const spy = vi.spyOn(importHandlers.accounts, 'create').mockImplementation(async (...args) => {
      if (args[4].rowNumber === 3) throw new Error('Simulated database outage');
      return create(...args);
    });
    try {
      expect((await request('accounts', '', 'POST', input)).status).toBe(500);
      const job = await prisma.crmImportJob.findFirstOrThrow({ where: { tenantId, idempotencyKey: input.idempotencyKey } });
      expect(job.status).toBe('importing'); expect(job.completedAt).toBeNull();
      expect([job.successfulRecords, job.failedRecords, job.duplicateRecords]).toEqual([1, 0, 0]);
    } finally { spy.mockRestore(); }
    const done = await run('accounts', input);
    expect(done.status).toBe('completed'); expect(done.successfulRecords).toBe(2);
    expect(await prisma.account.count({ where: { tenantId, name: { in: input.csvText.match(/"([^"\n]+)"/g)!.map(v => v.slice(1, -1)) } } })).toBe(2);
  });
  it('protects archived/converted identities and serializes cross-module people and Account creation', async () => {
    const email = `archived-${randomUUID()}@example.com`;
    await prisma.contact.create({ data: { tenantId, firstName: 'Archived', lastName: 'Contact', email: ` ${email.toUpperCase()} `, isArchived: true, deletedAt: new Date() } });
    for (const module of ['leads', 'contacts'] as const) expect((await run(module, csv([person(email)]))).duplicateRecords).toBe(1);
    const cross = person(`cross-${randomUUID()}@example.com`, 'Biometrics');
    const people = await Promise.all([run('leads', csv([cross])), run('contacts', csv([cross]))]);
    expect(people.map(job => job.successfulRecords).sort()).toEqual([0, 1]);
    for (let round = 0; round < 3; round++) {
      const name = `Concurrent ${randomUUID()} Account`;
      const accounts = await Promise.all([run('accounts', csv([{ name }])), run('accounts', csv([{ name: ` ${name.toUpperCase().replace(/ /g, '   ')} ` }]))]);
      expect(accounts.map(job => job.successfulRecords).sort()).toEqual([0, 1]);
      await prisma.account.updateMany({ where: { tenantId, name }, data: { isArchived: true, deletedAt: new Date() } });
      expect((await run('accounts', csv([{ name: ` ${name.toUpperCase()} ` }]))).duplicateRecords).toBe(1);
    }
    const invalidFirst = csv([{ ...person(`valid-after-${randomUUID()}@example.com`), firstName: '' }]);
    const mapped = mapImportCsv('leads', invalidFirst)[0].data;
    expect((await run('leads', csv([mapped, { ...mapped, firstName: 'Valid' }]))).successfulRecords).toBe(1);
    const productFirst = person(`product-after-${randomUUID()}@example.com`, 'Missing Product');
    const input = csv([productFirst, { ...productFirst, productInterest: 'Biometrics' }]);
    expect((await request('leads', '/preview', 'POST', input)).body.data.map((r: { status: string }) => r.status)).toEqual(['invalid', 'valid']);
    expect((await run('leads', input)).successfulRecords).toBe(1);
  });
  it('rejects every retired Deal import endpoint without changing historical evidence', async () => {
    const historic = await prisma.crmImportJob.create({ data: {
      tenantId, createdById: actorId, module: 'DEAL', fileName: 'historical-deals.csv', totalRecords: 1,
      successfulRecords: 1, status: 'completed', completedAt: new Date(),
      results: { create: { rowNumber: 2, status: 'imported', data: { title: 'Historical Deal', resolvedValue: '25000', nested: { keep: true } } } },
    } });
    await prisma.auditLog.create({ data: { tenantId, userId: actorId, action: 'deals.import', entityType: 'CrmImportJob', entityId: historic.id, metadata: { module: 'deals', preserved: true } } });
    const snapshot = async () => ({
      jobs: await prisma.crmImportJob.findMany({ where: { tenantId, module: 'DEAL' }, include: { results: true }, orderBy: { id: 'asc' } }),
      audit: await prisma.auditLog.findMany({ where: { tenantId, entityId: historic.id } }),
      uploads: await prisma.crmImportUpload.count({ where: { tenantId, module: 'DEAL' } }),
      deals: await prisma.deal.count({ where: { tenantId } }),
    });
    const before = await snapshot();
    for (const [method, suffix] of [['POST', ''], ['POST', '/upload'], ['POST', '/preview'], ['GET', ''], ['GET', `/${historic.id}`], ['GET', `/${historic.id}/results`]]) {
      const response = await fetch(`${base}/crm/deals/imports${suffix}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(csv([{ title: 'Retired import' }])) } : {}),
      });
      expect(response.status).toBe(404);
    }
    for (const module of ['leads', 'contacts', 'accounts'] as const) {
      expect((await request(module, `/${historic.id}`)).status).toBe(404);
      expect((await request(module, `/${historic.id}/results`)).status).toBe(404);
    }
    expect(await snapshot()).toEqual(before);
  });
  it.skipIf(!process.env.CRM_IMPORT_ROLLOUT_TEST)('verifies migrated History through deployed APIs before approving retirement', async () => {
    const { verifyImportRollout } = require('../../../../scripts/verify-crm-import-rollout.cjs');
    await expect(verifyImportRollout(prisma, base, [])).rejects.toThrow();
    const report = await verifyImportRollout(prisma, base, [token]);
    expect(report.historical).toEqual([
      { module: 'LEAD', jobs: 2, results: 8 },
      { module: 'CONTACT', jobs: 1, results: 2 },
      { module: 'ACCOUNT', jobs: 1, results: 2 },
      { module: 'DEAL', jobs: 1, results: 2 },
    ]);
    expect(report.workspacesVerified).toBe(1);
    await prisma.$executeRawUnsafe(`COMMENT ON TABLE "CrmImportJob" IS 'crm-import-normalization-api-verified-v1'`);
  }, 180000);
});
