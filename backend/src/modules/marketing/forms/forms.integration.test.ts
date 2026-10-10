import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
vi.mock('../../../shared/services/email.service', () => ({ sendMail: vi.fn().mockRejectedValue(new Error('provider unavailable')) }));
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { issueAuthSession } from '../../../core/auth/auth-session';
import * as service from './forms.service';
import { getPublicForm, submitPublicForm } from './public-forms.service';
import app from '../../../app';
import { FORM_PRODUCT_INTERESTS } from '@leadcrm/shared';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_forms_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('Forms database and HTTP integration', () => {
  let tenantId: string, otherTenant: string, userId: string, token: string, denied: string, base: string, server: Server;
  let rejectSubmissionEmail = '';
  const scoped = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const draft = () => scoped(() => service.createForm(tenantId, userId, { name: 'Contact Us' }));
  const publish = (id: string) => scoped(() => service.publishForm(id, tenantId, userId));
  const productIds: Record<string, string> = {};
  const values = (email = `${randomUUID()}@example.com`) => ({ firstName: 'Test', lastName: 'Visitor', email, productInterest: productIds['Smart Lock'], address: 'Makati' });
  const submit = (publicId: string, data = values(), version = 1) => submitPublicForm(publicId, { version, values: data });
  async function request(path: string, method = 'GET', body?: unknown, auth = token) {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  }
  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      if (params.model === 'FormSubmission' && params.action === 'create' && params.args.data.email === rejectSubmissionEmail) throw new Error('Simulated submission persistence failure');
      return next(params);
    });
    tenantId = (await prisma.tenant.create({ data: { name: 'Forms test', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    for (const name of FORM_PRODUCT_INTERESTS) {
      const product = await prisma.productInterest.create({ data: { tenantId, name, dealValue: 0 } }); productIds[name] = product.id;
    }
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other', slug: randomUUID() } })).id;
    const user = await prisma.user.create({ data: { tenantId, firstName: 'Admin', lastName: 'Test', email: 'forms-admin@camxian.com', role: 'Client Admin', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } });
    userId = user.id; token = (await issueAuthSession(user)).token;
    const staff = await prisma.user.create({ data: { tenantId, firstName: 'Staff', lastName: 'Test', email: 'forms-staff@camxian.com', role: 'Sales', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } });
    denied = (await issueAuthSession(staff)).token;
    server = app.listen(0); await new Promise<void>(r => server.once('listening', r)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(r => server.close(() => r())); await prisma.$disconnect(); });
  it('permanently deletes a draft over HTTP and enforces authentication, permission and ownership', async () => {
    const form = await draft();
    expect((await request('/marketing/forms/' + form.id, 'DELETE', undefined, '')).status).toBe(401);
    expect((await request('/marketing/forms/' + form.id, 'DELETE', undefined, denied)).status).toBe(403);
    await expect(service.deleteForm(form.id, otherTenant, userId)).rejects.toMatchObject({ statusCode: 404 });
    expect((await request('/marketing/forms/' + form.id, 'DELETE')).status).toBe(200);
    expect(await prisma.marketingForm.findUnique({ where: { id: form.id } })).toBeNull();
    expect((await request('/marketing/forms/' + form.id, 'DELETE')).status).toBe(404);
  });
  it('blocks published deletion, then atomically removes unpublished forms and their submissions while retaining CRM records', async () => {
    const form = await publish((await draft()).id); await submit(form.publicId);
    const submission = await prisma.formSubmission.findFirstOrThrow({ where: { formId: form.id } });
    const blocked = await request('/marketing/forms/' + form.id, 'DELETE');
    expect(blocked.status).toBe(409); expect(blocked.body.error).toBe('Published forms must be unpublished before they can be deleted.');
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(1);
    expect((await request('/marketing/forms/' + form.id + '/unpublish', 'PATCH', undefined, denied)).status).toBe(403);
    const result = await request('/marketing/forms/' + form.id + '/unpublish', 'PATCH');
    expect(result.status).toBe(200); expect(result.body.data.status).toBe('draft');
    await expect(getPublicForm(form.publicId)).rejects.toMatchObject({ statusCode: 404 });
    expect((await request('/marketing/forms/' + form.id, 'DELETE')).status).toBe(200);
    expect(await prisma.marketingForm.findUnique({ where: { id: form.id } })).toBeNull();
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
    expect(await prisma.lead.findUnique({ where: { id: submission.leadId! } })).not.toBeNull();
  });
  it('persists the template, duplicates independently and refuses draft public access', async () => {
    const form = await draft(); expect((await scoped(() => service.getFormById(form.id, tenantId))).fields).toHaveLength(7);
    await expect(getPublicForm(form.publicId)).rejects.toMatchObject({ statusCode: 404 }); await expect(submit(form.publicId)).rejects.toMatchObject({ statusCode: 404 });
    const copy = await scoped(() => service.duplicateForm(form.id, tenantId, userId)); expect(copy.id).not.toBe(form.id); expect(copy.publicId).not.toBe(form.publicId); expect(copy.fields).toEqual(form.fields); expect(copy.publishedVersion).toBe(0);
  });
  it('keeps draft edits private until publish and rejects stale saves/versions', async () => {
    const form = await publish((await draft()).id);
    await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: 0, name: 'Draft only' }));
    expect((await getPublicForm(form.publicId)).name).toBe('Contact Us');
    await expect(scoped(() => service.updateForm(form.id, tenantId, userId, { revision: 0, name: 'Stale' }))).rejects.toMatchObject({ statusCode: 409 });
    await publish(form.id); expect((await getPublicForm(form.publicId)).name).toBe('Draft only');
    await expect(submit(form.publicId)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('creates one lead and retains separate product/address history on repeat', async () => {
    const form = await publish((await draft()).id), v = values();
    await submit(form.publicId, v); await submit(form.publicId, { ...v, email: v.email.toUpperCase(), productInterest: productIds.Biometrics, address: 'Taguig' });
    expect(await prisma.lead.count({ where: { tenantId, email: v.email } })).toBe(1);
    const history = await scoped(() => service.getSubmissions(form.id, tenantId, {})); expect(history.data).toHaveLength(2);
    expect(history.data.map(s => (s.values as Record<string, string>).productInterest).sort()).toEqual([productIds.Biometrics, productIds['Smart Lock']].sort());
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: v.email } });
    expect(lead.productInterestIds.sort()).toEqual([productIds.Biometrics, productIds['Smart Lock']].sort());
    const deals = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } });
    expect(deals).toHaveLength(2);
    await submit(form.publicId, v);
    expect(await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } })).toEqual(deals);
  });

  it('labels paginated submission Products including archived ones without rewriting values or exposing other tenants', async () => {
    const form = await publish((await draft()).id);
    await submit(form.publicId);
    const row = await prisma.formSubmission.findFirstOrThrow({ where: { formId: form.id } });
    const archived = await prisma.productInterest.create({ data: { tenantId, name: 'Archived historical product', dealValue: 12, active: false } });
    const foreign = await prisma.productInterest.create({ data: { tenantId: otherTenant, name: 'Private foreign product', dealValue: 20 } });
    const raw = [productIds['Smart Lock'], archived.id, foreign.id];
    await prisma.formSubmission.update({ where: { id: row.id }, data: { values: { ...values(), productInterest: raw } } });
    const result = await scoped(() => service.getSubmissions(form.id, tenantId, { page: 1, limit: 1 }));
    expect(result.data).toHaveLength(1);
    expect(result.data[0].productLabels).toEqual({ [raw[0]]: 'Smart Lock', [archived.id]: archived.name });
    expect((result.data[0].values as any).productInterest).toEqual(raw);
    expect(((await prisma.formSubmission.findUniqueOrThrow({ where: { id: row.id } })).values as any).productInterest).toEqual(raw);
    await prisma.formSubmission.update({ where: { id: row.id }, data: { values: { ...values(), productInterest: raw.join(',') } } });
    expect((await scoped(() => service.getSubmissions(form.id, tenantId, {}))).data[0].productLabels).toEqual(result.data[0].productLabels);
    await expect(service.getSubmissions(form.id, otherTenant, {})).rejects.toMatchObject({ statusCode: 404 });
  });
  it('reuses contacts and converted lead links', async () => {
    const form = await publish((await draft()).id), v = values();
    const c = await prisma.contact.create({ data: { tenantId, firstName: 'Existing', lastName: 'Person', email: v.email, productInterests: [] } });
    await prisma.lead.create({ data: { tenantId, firstName: 'Historic', lastName: 'Person', email: v.email, productInterest: [], contactId: c.id } });
    await submit(form.publicId, v);
    expect(await prisma.formSubmission.findFirst({ where: { formId: form.id } })).toMatchObject({ contactId: c.id, leadId: null });
    expect(await prisma.contactProductInterest.count({ where: { contactId: c.id, productInterestId: productIds['Smart Lock'] } })).toBe(1);
    const product = await prisma.productInterest.findUniqueOrThrow({ where: { id: productIds['Smart Lock'] } });
    const deals = await prisma.deal.findMany({ where: { contactDeals: { some: { contactId: c.id } } } });
    expect(deals).toHaveLength(1); expect(deals[0].value).toBe(Number(product.dealValue));
    const requestId = randomUUID();
    await submitPublicForm(form.publicId, { version: 1, values: v, requestId });
    await submitPublicForm(form.publicId, { version: 1, values: v, requestId });
    expect(await prisma.deal.count({ where: { contactDeals: { some: { contactId: c.id } } } })).toBe(2);
  });
  it('routes a historically won lead to Contact without altering its deal', async () => {
    const form = await publish((await draft()).id), v = values();
    const l = await prisma.lead.create({ data: { tenantId, firstName: 'Customer', lastName: 'Test', email: v.email, productInterest: ['CCTV'] } });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Sales' } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Won', order: 1, isWon: true, requiredFields: [] } });
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, leadDeals: { create: { leadId: l.id, position: 0 } }, title: 'Historic sale', productInterests: ['CCTV'], tags: [] } });
    await submit(form.publicId, v); await submit(form.publicId, v);
    const repaired = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } }); expect(repaired.contactId).toBeTruthy();
    expect(repaired.status).toBe('Closed');
    expect(await prisma.deal.findUnique({ where: { id: deal.id }, include: { contactDeals: true } })).toMatchObject({
      id: deal.id, stageId: deal.stageId, value: deal.value, productInterests: deal.productInterests, contactDeals: [{ contactId: repaired.contactId }],
    });
    expect(await prisma.contact.count({ where: { tenantId, email: v.email } })).toBe(1);
    expect(await prisma.formSubmission.count({ where: { formId: form.id, contactId: repaired.contactId } })).toBe(2);
  });
  it('rejects conflicting identities without writing an inquiry', async () => {
    const form = await publish((await draft()).id), v = values();
    await prisma.lead.create({ data: { tenantId, firstName: 'A', lastName: 'A', email: v.email, productInterest: [] } });
    await prisma.contact.create({ data: { tenantId, firstName: 'B', lastName: 'B', phone: '+639123456789', productInterests: [] } });
    await expect(submitPublicForm(form.publicId, { version: 1, values: { ...v, phone: '9123456789' } })).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
  });
  it('reuses an existing customer linked to a historical won deal', async () => {
    const f = await publish((await draft()).id), v = values();
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Customer', lastName: 'Old email', email: v.email, productInterest: [] } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Customer', lastName: 'New email', email: randomUUID() + '@example.com', productInterests: [] } });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Historical' } });
    const won = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Closed Won', order: 1, isWon: true, requiredFields: [] } });
    const current = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'After sale', order: 2, requiredFields: [] } });
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: current.id, title: 'Old purchase', productInterests: [], tags: [] } });
    await prisma.leadDeal.create({ data: { tenantId, dealId: deal.id, leadId: lead.id } });
    await prisma.contactDeal.create({ data: { tenantId, dealId: deal.id, contactId: contact.id } });
    await prisma.dealStageHistory.create({ data: { tenantId, dealId: deal.id, newStageId: won.id, movedById: userId } });
    await submit(f.publicId, v);
    expect(await prisma.formSubmission.findFirst({ where: { formId: f.id } })).toMatchObject({ contactId: contact.id, leadId: null });
    expect(await prisma.deal.findUnique({ where: { id: deal.id }, include: { contactDeals: true } })).toMatchObject({ id: deal.id, stageId: deal.stageId, value: deal.value, productInterests: deal.productInterests, contactDeals: [{ contactId: contact.id }] });
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toMatchObject({ status: 'Closed', contactId: contact.id });
  });
  it('matches legacy formatted phones and whitespace-normalized email', async () => {
    const f = await publish((await draft()).id), v = values();
    const c = await prisma.contact.create({ data: { tenantId, firstName: 'Legacy', lastName: 'Person', email: ' ' + v.email.toUpperCase() + ' ', phone: '+63 955 111 2233', productInterests: [] } });
    await submitPublicForm(f.publicId, { version: 1, values: { ...v, phone: '9551112233' } });
    expect(await prisma.formSubmission.findFirst({ where: { formId: f.id } })).toMatchObject({ contactId: c.id });
  });
  it('rejects archived people and does not create replacement records', async () => {
    const f = await publish((await draft()).id), v = values();
    await prisma.lead.create({ data: { tenantId, firstName: 'Archived', lastName: 'Person', email: v.email, isArchived: true, productInterest: [] } });
    await expect(submit(f.publicId, v)).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.lead.count({ where: { tenantId, email: v.email } })).toBe(1);
  });
  it('rolls back person creation when submission persistence fails', async () => {
    const f = await publish((await draft()).id), v = values();
    rejectSubmissionEmail = v.email;
    try { await expect(submit(f.publicId, v)).rejects.toBeTruthy(); expect(await prisma.lead.count({ where: { tenantId, email: v.email } })).toBe(0); }
    finally { rejectSubmissionEmail = ''; }
  });
  it('rejects oversized payloads and disabled workspaces', async () => {
    const f = await publish((await draft()).id);
    expect((await request('/public/forms/' + f.publicId + '/submissions', 'POST', { version: 1, values: { junk: 'x'.repeat(66000) } }, '')).status).toBe(413);
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    try { await expect(submit(f.publicId)).rejects.toMatchObject({ statusCode: 404 }); } finally { await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } }); }
  });
  it('isolates tenant identity lookups/writes', async () => {
    const v = values();
    await prisma.lead.create({ data: { tenantId: otherTenant, firstName: 'Other', lastName: 'Person', email: v.email, productInterest: [] } });
    await prisma.lead.create({ data: { tenantId, firstName: 'Existing', lastName: 'Person', email: v.email, productInterest: [] } });
    const f = await scoped(() => service.createForm(tenantId, userId, { name: 'Contact us' }));
    await scoped(() => service.publishForm(f.id, tenantId, userId)); await submit(f.publicId, v);
    expect(await prisma.lead.count({ where: { tenantId, email: v.email } })).toBe(1);
    expect(await prisma.formSubmission.findFirst({ where: { formId: f.id } })).toMatchObject({ tenantId, });
    expect((await scoped(() => service.getFormById(f.id, tenantId))).id).toBe(f.id);
    await expect(service.getFormById(f.id, otherTenant)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('retains submissions after unpublish and blocks new submissions', async () => {
    const f = await publish((await draft()).id); await submit(f.publicId); await scoped(() => service.unpublishForm(f.id, tenantId, userId));
    expect((await scoped(() => service.getSubmissions(f.id, tenantId, {}))).data).toHaveLength(1);
    await expect(submit(f.publicId)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('records tracking and survives notification failure', async () => {
    const f = await draft(); const { defaultContactForm } = await import('@leadcrm/shared');
    await scoped(() => service.updateForm(f.id, tenantId, userId, { revision: 0, settings: { ...defaultContactForm().settings, notificationEmail: 'alerts@example.com' } })); await publish(f.id);
    await submitPublicForm(f.publicId, { version: 1, values: values(), tracking: { utm_campaign: 'September' } });
    expect(await prisma.formSubmission.findFirst({ where: { formId: f.id } })).toMatchObject({ tracking: { utm_campaign: 'September' }, notificationStatus: 'failed' });
  });
  it('enforces auth/RBAC and exposes only published public data', async () => {
    expect((await request('/marketing/forms', 'GET', undefined, '')).status).toBe(401);
    expect((await request('/marketing/forms', 'POST', { name: 'Denied' }, denied)).status).toBe(403);
    const f = await publish((await draft()).id), r = await request('/public/forms/' + f.publicId, 'GET', undefined, '');
    expect(r.status).toBe(200); expect(r.body.data).not.toHaveProperty('tenantId'); expect(r.body.data).not.toHaveProperty('settings');
    const bad = await request('/public/forms/' + f.publicId + '/submissions', 'POST', { version: 1, values: { ...values(), firstName: ' ' } }, '');
    expect(bad.status).toBe(400); expect(bad.body.fieldErrors.firstName).toBeTruthy();
  });
  it('rate limits anonymous submissions with 429', async () => {
    let status = 0;
    for (let i = 0; i < 22; i++) { status = (await request('/public/forms/' + randomUUID() + '/submissions', 'POST', { version: 1, values: values() }, '')).status; if (status === 429) break; }
    expect(status).toBe(429);
  });
});
