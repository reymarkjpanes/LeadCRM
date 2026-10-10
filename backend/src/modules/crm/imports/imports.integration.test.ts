import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { CreateCrmImportSchema, importRowSchemas, mapImportCsv, parseImportCsv, type CrmImportModule } from '@leadcrm/shared';
vi.mock('../../../shared/services/email.service', () => ({ sendMail: vi.fn() }));
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { salesTransaction, salesPipeline } from '../leads/lead-automation.service';
import app from '../../../app';
import { purgeExpiredImportUploads } from './import-cleanup.service';

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
  it('validates structure, normalized headers, mapping, size, row limits and physical lines', () => {
    expect(parseImportCsv('\ufeffName,Note\r\n\r\nA,"first\nsecond"\r\nB,end').rowNumbers).toEqual([3, 5]);
    for (const content of ['Name,name\nA,B', 'Name,\nA,B', 'A,B\nx', 'A\n"unclosed']) expect(() => parseImportCsv(content)).toThrow();
    expect(() => mapImportCsv('accounts', { ...csv([{ name: 'Acme' }]), mappings: {} })).toThrow('Missing required');
    expect(() => parseImportCsv('Name\n' + Array(5001).fill('a').join('\n'))).toThrow('5000');
    expect(CreateCrmImportSchema.safeParse({ ...csv([{ name: 'Acme' }]), fileName: 'test.exe' }).success).toBe(false);
    expect(CreateCrmImportSchema.safeParse({ ...csv([{ name: 'Acme' }]), csvText: 'a'.repeat(10 * 1024 * 1024 + 1) }).success).toBe(false);
    expect(importRowSchemas.deals.safeParse({ title: 'A', pipeline: 'Sales', stage: 'Lead', productInterest: 'CCTV', value: '999' }).success).toBe(false);
  });
});

describe.skipIf(!disposable)('CRM CSV import database and HTTP', () => {
  let tenantId: string, actorId: string, token: string, denied: string, foreign: string, base: string, server: Server;
  let pipeline: string, stage: string, cctv: string, bio: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
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
    const sales = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    pipeline = sales.pipeline.name; stage = sales.initial.name;
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

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
    const input = csv([{ title: 'Fresh price', customer: 'parallel@example.com', productInterest: priceProduct.id, pipeline, stage }]);
    expect((await request('deals', '/preview', 'POST', input)).body.data[0].resolvedValue).toBe(100);
    await prisma.productInterest.update({ where: { id: priceProduct.id }, data: { dealValue: 200 } });
    expect((await run('deals', input)).successfulRecords).toBe(1);
    expect((await prisma.deal.findFirstOrThrow({ where: { tenantId, title: 'Fresh price' } })).value).toBe(200);
    const next = csv([{ title: 'Inactive since preview', customer: 'parallel@example.com', productInterest: priceProduct.id, pipeline, stage }]);
    expect((await request('deals', '/preview', 'POST', next)).body.data[0].isValid).toBe(true);
    await prisma.productInterest.update({ where: { id: priceProduct.id }, data: { active: false } });
    expect((await run('deals', next)).failedRecords).toBe(1);
    expect(await prisma.deal.count({ where: { tenantId, title: 'Inactive since preview' } })).toBe(0);
  });
  it('imports Contact/Account snapshots from canonical Products and blocks normalized reimports and cross-person duplicates', async () => {
    const input = csv([person('contact@example.com')]);
    expect((await run('contacts', input)).successfulRecords).toBe(1);
    expect((await prisma.contact.findFirstOrThrow({ where: { tenantId, email: 'contact@example.com' } })).productInterests).toEqual(['CCTV Surveillance System', 'Biometrics']);
    expect((await run('contacts', csv([person('CONTACT@example.com')]))).duplicateRecords).toBe(1);
    expect((await run('leads', csv([person('CONTACT@example.com')]))).duplicateRecords).toBe(1);
    expect((await run('contacts', csv([person('one@example.com')]))).duplicateRecords).toBe(1);
    expect((await run('accounts', csv([{ name: 'ABC Corporation', productInterest: 'CCTV Surveillance System; Biometrics', size: '11-50' }]))).successfulRecords).toBe(1);
    expect((await run('accounts', csv([{ name: ' abc  corporation ', productInterest: 'Biometrics' }]))).duplicateRecords).toBe(1);
    const account = await prisma.account.findFirstOrThrow({ where: { tenantId, name: 'ABC Corporation' } });
    expect(account.productInterests).toHaveLength(2); expect(account.size).toBe('11-50');
  });
  it('resolves each Deal price, permits repeat opportunities and preserves historical prices after changes', async () => {
    const row = { title: 'CCTV Project', customer: 'CONTACT@example.com', productInterest: 'CCTV Surveillance System', pipeline, stage };
    const input = csv([row, { ...row, title: 'Biometrics Project', productInterest: 'Biometrics' }, row]);
    const preview = await request('deals', '/preview', 'POST', input);
    expect(preview.body.data.map((r: { resolvedValue?: number }) => r.resolvedValue)).toEqual([25000, 15000, undefined]);
    const result = await run('deals', input); expect(result.successfulRecords).toBe(2); expect(result.duplicateRecords).toBe(1);
    expect((await run('deals', input)).id).toBe(result.id);
    const old = await prisma.deal.findFirstOrThrow({ where: { tenantId, title: row.title }, include: { contactDeals: true } });
    await prisma.productInterest.update({ where: { id: cctv }, data: { dealValue: 30000 } });
    const second = await run('deals', csv([{ ...row, title: '2027 CCTV Expansion' }])); expect(second.successfulRecords).toBe(1);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: old.id } })).value).toBe(25000);
    const next = await prisma.deal.findFirstOrThrow({ where: { tenantId, title: '2027 CCTV Expansion' }, include: { contactDeals: true } });
    expect(next.value).toBe(30000); expect(next.productInterestId).toBe(cctv);
    expect(next.contactDeals.map(link => link.contactId)).toEqual(old.contactDeals.map(link => link.contactId));
    expect(old.contactDeals).toHaveLength(1);
    expect(await prisma.contactDeal.count({ where: { tenantId, contactId: old.contactDeals[0].contactId } })).toBe(3);
  });
  it('reports unknown/inactive Products, missing relationships, invalid dates and field lengths per row', async () => {
    const result = await request('leads', '/preview', 'POST', csv([person('unknown@example.com', 'Unknown CCTV Package'), person('inactive@example.com', 'Archived Product'), { ...person('bad-email'), firstName: 'x'.repeat(101) }]));
    expect(result.body.data[0].errors.join()).toContain('Unknown Product Interest');
    expect(result.body.data[1].errors.join()).toContain('Inactive Product');
    expect(result.body.data[2].errors.join()).toContain('email');
    const baseRow = { title: 'Invalid', customer: 'missing@example.com', productInterest: 'Biometrics', pipeline, stage };
    for (const patch of [{}, { pipeline: 'Unknown' }, { stage: 'Unknown' }, { expectedCloseDate: '2026-02-30' }, { account: 'Unknown' }, { assignedUser: 'missing@camxian.com', customer: 'contact@example.com' }]) {
      const preview = await request('deals', '/preview', 'POST', csv([{ ...baseRow, ...patch }]));
      expect(preview.status).toBe(200); expect(preview.body.data[0].status).toBe('invalid'); expect(preview.body.data[0].errors.length).toBeGreaterThan(0);
    }
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
    expect(account.productInterests.sort()).toEqual(['Biometrics', 'CCTV Surveillance System']);
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
  it('resumes batches after interruption and exposes truthful tenant-scoped history for all four modules', async () => {
    const input = csv(Array.from({ length: 27 }, (_, i) => ({ name: `Batch account ${i}` })));
    const partial = await request('accounts', '', 'POST', input);
    expect(partial.status).toBe(202); expect(partial.body.data.successfulRecords).toBe(25);
    const done = await run('accounts', input); expect(done.successfulRecords).toBe(27); expect(done.id).toBe(partial.body.data.id);
    for (const module of ['leads', 'contacts', 'accounts', 'deals'] as const) {
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
      accounts: csv([{ name: 'Shared job account', productInterest: 'Biometrics' }]),
      deals: csv([{ title: 'Shared job Deal', customer: 'contact@example.com', productInterest: 'Biometrics', pipeline, stage }]),
    };
    const modules = { leads: 'LEAD', contacts: 'CONTACT', accounts: 'ACCOUNT', deals: 'DEAL' } as const;
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
      for (const other of Object.keys(modules).filter(m => m !== module) as CrmImportModule[]) {
        expect((await request(other, `/${first.id}`)).status).toBe(404);
        expect((await request(other, `/${first.id}/results`)).status).toBe(404);
      }
    }
    expect(new Set(ids).size).toBe(4);
    expect(await prisma.crmImportJob.count({ where: { tenantId, idempotencyKey: key } })).toBe(4);
    expect(await prisma.crmImportRowResult.count({ where: { importJobId: { in: ids } } })).toBe(4);
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
  });
});
