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
import { ClosingFieldInputSchema, EMAIL_AVAILABILITY_MESSAGES, FORM_PRODUCT_INTERESTS, LEAD_SOURCES, SELECTABLE_LEAD_SOURCES, leadCatalogFormField, type FormField } from '@leadcrm/shared';
import { ensureSalesGroup } from '../../administration/groups/sales-group';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_forms_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('Forms database and HTTP integration', () => {
  let tenantId: string, otherTenant: string, userId: string, token: string, denied: string, base: string, server: Server;
  let rejectSubmissionEmail = '';
  let rejectInquiryDealTitle = '';
  let rejectEmailLookupEmail = '';
  const scoped = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const draft = () => scoped(() => service.createForm(tenantId, userId, { name: 'Contact Us' }));
  const publish = (id: string) => scoped(() => service.publishForm(id, tenantId, userId));
  const productIds: Record<string, string> = {};
  const values = (email = `${randomUUID()}@example.com`) => ({ firstName: 'Test', lastName: 'Visitor', email, productInterest: productIds['Smart Lock'], address: 'Makati' });
  const submit = (publicId: string, data: Record<string, string | boolean | string[]> = values(), version = 1) => submitPublicForm(publicId, { requestId: randomUUID(), version, values: data });
  async function request(path: string, method = 'GET', body?: unknown, auth = token) {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json(), headers: r.headers };
  }
  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      if (params.model === 'FormSubmission' && params.action === 'create' && params.args.data.email === rejectSubmissionEmail) throw new Error('Simulated submission persistence failure');
      if (rejectInquiryDealTitle && params.model === 'Deal' && params.action === 'create' && params.args.data.automationKey?.startsWith('form:') && params.args.data.title === rejectInquiryDealTitle) throw new Error('Simulated inquiry Deal failure');
      if (rejectEmailLookupEmail && params.model === 'User' && params.action === 'findMany' && params.args.where.email?.contains === rejectEmailLookupEmail) throw new Error('Simulated staff lookup failure');
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
  async function customField(name: string, type: 'Text' | 'Long Text' | 'Number' | 'Date' | 'Dropdown' = 'Number', module = 'leads', owner = tenantId, extra = {}) {
    const definition = { ...ClosingFieldInputSchema.parse({ name, type, module, group: 'Basic Information', required: false, ...(type === 'Dropdown' ? { options: ['One', 'Two'] } : {}), ...extra }), id: 'qa_' + randomUUID(), version: 1, technicalAlias: 'qa_' + randomUUID().replaceAll('-', '') };
    await prisma.closingFieldDefinition.create({ data: { tenantId: owner, id: definition.id, definition } });
    return definition;
  }
  async function removeFields(ids: string[]) {
    await prisma.customFieldValue.deleteMany({ where: { fieldId: { in: ids } } });
    await prisma.closingFieldDefinition.deleteMany({ where: { id: { in: ids } } });
  }
  it('enforces trimmed names over HTTP without clearing saved fields or publishing invalid definitions', async () => {
    expect((await request('/marketing/forms', 'POST', { name: '   ' })).status).toBe(400);
    const form = await draft();
    const invalid = await request('/marketing/forms/' + form.id, 'PUT', { name: '   ', revision: 0 });
    expect(invalid.status).toBe(400);
    expect((await service.getFormById(form.id, tenantId)).fields).toEqual(form.fields);
    await prisma.marketingForm.update({ where: { id: form.id }, data: { name: ' ' } });
    expect((await request('/marketing/forms/' + form.id + '/publish', 'PATCH')).status).toBe(400);
  });
  it.each([false, true])('rejects invalid mapped person names through public HTTP (full name=%s)', async fullName => {
    const form = await draft();
    let fields = form.fields as FormField[];
    if (fullName) fields = [{ id: 'person', type: 'contact-name', label: 'Your name', mapToField: 'fullName', required: true }, ...fields.filter(field => !['firstName', 'lastName'].includes(field.mapToField ?? ''))];
    else fields = fields.map(field => field.mapToField === 'firstName' ? { ...field, id: 'given', label: 'Given name' } : field.mapToField === 'lastName' ? { ...field, id: 'family', label: 'Family name' } : field);
    await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: 0, fields }));
    const published = await publish(form.id);
    const email = `${randomUUID()}@example.test`;
    const { firstName: _first, lastName: _last, ...other } = values(email);
    const valid = { ...other, ...(fullName ? { person: 'María O’Connor' } : { given: 'María', family: 'O’Connor' }) };
    for (const field of fullName ? ['person'] : ['given', 'family']) {
      for (const [value, reason] of [['John@1', 'numbers'], ['John@', 'special characters']]) {
        const response = await request(`/public/forms/${form.publicId}/submissions`, 'POST', { requestId: randomUUID(), version: published.publishedVersion, values: { ...valid, [field]: value } }, '');
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(response.body.fieldErrors[field]).toContain(`must not contain ${reason}.`);
      }
    }
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
    expect(await prisma.lead.count({ where: { tenantId, email } })).toBe(0);
    const response = await request(`/public/forms/${form.publicId}/submissions`, 'POST', { requestId: randomUUID(), version: published.publishedVersion, values: valid }, '');
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await prisma.lead.findFirstOrThrow({ where: { tenantId, email } })).toMatchObject({ firstName: 'María', lastName: 'O’Connor' });
  });

  it('returns current Lead labels only and enforces catalog authentication, permissions and availability', async () => {
    const age = await customField('Age'), contact = await customField('Contact Only', 'Text', 'contacts'), hidden = await customField('Hidden', 'Text', 'leads', tenantId, { visibleInForm: false }), disabled = await customField('Disabled', 'Text', 'leads', tenantId, { active: false });
    try {
      expect((await request('/marketing/forms/field-catalog', 'GET', undefined, '')).status).toBe(401);
      expect((await request('/marketing/forms/field-catalog', 'GET', undefined, denied)).status).toBe(403);
      const result = await request('/marketing/forms/field-catalog'); expect(result.status).toBe(200);
      expect(result.body.data.every((field: { module: string }) => field.module === 'leads')).toBe(true);
      expect(result.body.data.map((field: { label: string }) => field.label)).toContain('First Name');
      expect(result.body.data.map((field: { label: string }) => field.label)).toContain('Age');
      expect(result.body.data.map((field: { label: string }) => field.label)).not.toEqual(expect.arrayContaining(['Contact Only', 'Hidden', 'Disabled']));
      await prisma.closingFieldDefinition.update({ where: { tenantId_id: { tenantId, id: age.id } }, data: { definition: { ...age, name: 'Age in years' } } });
      const refreshed = await request('/marketing/forms/field-catalog');
      expect(refreshed.body.data).toContainEqual(expect.objectContaining({ label: 'Age in years', customFieldId: age.id }));
    } finally { await removeFields([age.id, contact.id, hidden.id, disabled.id]); }
  });

  it('preserves saved Lead Source definitions, published snapshots, answers and attribution across later draft edits', async () => {
    const form = await draft();
    const source: FormField = { id: 'historicalSource', type: 'dropdown', label: 'Lead Source', mapToField: 'source', options: [...LEAD_SOURCES], required: true };
    await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: form.revision, fields: [...form.fields as FormField[], source] }));
    const published = await publish(form.id);
    // Simulate a published version created before the source was retired.
    const oldConfig = { ...(published.publishedConfig as object), fields: [...form.fields as FormField[], source] };
    await prisma.marketingForm.update({ where: { id: form.id }, data: { publishedConfig: oldConfig } });
    const before = await getPublicForm(form.publicId);
    expect(before.fields.find(field => field.id === source.id)?.options).toEqual(SELECTABLE_LEAD_SOURCES);
    await expect(submit(form.publicId, { ...values(), historicalSource: 'Direct Mail' }, published.publishedVersion))
      .rejects.toMatchObject({ fieldErrors: { historicalSource: 'Select an available option.' } });
    const answers = { ...values(), historicalSource: 'Referral' };
    await submit(form.publicId, answers, published.publishedVersion);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: answers.email } });
    expect(lead.source).toBe('Referral');
    const submission = await prisma.formSubmission.findFirstOrThrow({ where: { tenantId, formId: form.id } });
    expect(submission.values).toMatchObject({ historicalSource: 'Referral' });
    await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: published.revision, name: 'Later draft name' }));
    expect((await service.getFormById(form.id, tenantId)).fields).toContainEqual({ ...source, options: SELECTABLE_LEAD_SOURCES });
    expect(await getPublicForm(form.publicId)).toEqual(before);
    expect((await prisma.marketingForm.findUniqueOrThrow({ where: { id: form.id } })).publishedConfig).toEqual(oldConfig);
    expect(await prisma.formSubmission.findUniqueOrThrow({ where: { id: submission.id } })).toEqual(submission);
  });
  it('persists every supported Lead Custom type, layout content and order through reload, publish and repeat submission', async () => {
    const definitions = await Promise.all([customField('Age', 'Number', 'leads', tenantId, { required: true }), customField('Nickname', 'Text'), customField('Details', 'Long Text'), customField('Birthday', 'Date'), customField('Choice', 'Dropdown')]);
    try {
      const form = await draft(), catalog = await scoped(() => service.getLeadFormFieldCatalog(tenantId));
      const custom = definitions.map((definition, index) => ({ ...leadCatalogFormField(catalog.find(field => field.customFieldId === definition.id)!)!, id: `custom${index}` }));
      const fields: FormField[] = [{ id: 'header', type: 'header', label: 'Welcome' }, ...custom, ...(form.fields as FormField[]).slice().reverse(), { id: 'separator', type: 'divider', label: 'Separator line' }, { id: 'paragraph', type: 'paragraph', label: 'Please send your details.' }];
      const updated = await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: form.revision, fields }));
      expect((await service.getFormById(form.id, tenantId)).fields).toEqual(updated.fields);
      const published = await publish(form.id), publicForm = await getPublicForm(form.publicId);
      expect(publicForm.fields.map(field => field.id)).toEqual(fields.map(field => field.id));
      const answers = { ...values(), custom0: '29', custom1: 'Anne', custom2: 'Long details', custom3: '1997-10-11', custom4: 'One' };
      await submit(form.publicId, answers, published.publishedVersion);
      await submit(form.publicId, { ...answers, custom0: '30' }, published.publishedVersion);
      const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: answers.email } });
      expect(lead).toMatchObject({ firstName: 'Test', lastName: 'Visitor', address: 'Makati' });
      const rows = await prisma.customFieldValue.findMany({ where: { tenantId, module: 'leads', leadId: lead.id } });
      expect(rows).toHaveLength(5); expect(rows.find(row => row.fieldId === definitions[0].id)?.value).toBe(29);
      expect(rows.map(row => row.fieldId).sort()).toEqual(definitions.map(field => field.id).sort());
      expect(await prisma.lead.count({ where: { tenantId, email: answers.email } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { tenantId, entityId: lead.id, action: 'custom_field.values_updated' } })).toBe(1);
      const repeat = await prisma.formSubmission.findFirstOrThrow({ where: { tenantId, formId: form.id, values: { path: ['custom0'], equals: '30' } } });
      expect(repeat.values).toHaveProperty('custom0', '30');
      await vi.waitFor(async () => {
        const history = await prisma.auditLog.findMany({ where: { tenantId, entityId: form.id }, select: { action: true } });
        expect(history.map(entry => entry.action)).toEqual(expect.arrayContaining(['form.created', 'form.updated', 'form.published']));
      });
      const submission = await prisma.formSubmission.findFirstOrThrow({ where: { tenantId, formId: form.id } });
      expect(submission.values).not.toHaveProperty('header'); expect(submission.values).not.toHaveProperty('paragraph');
      expect(submission.values).not.toHaveProperty('separator');
      await expect(submit(form.publicId, { ...answers, custom0: '' }, published.publishedVersion)).rejects.toHaveProperty('fieldErrors.custom0');
      await expect(submit(form.publicId, { ...answers, custom4: 'Injected' }, published.publishedVersion)).rejects.toHaveProperty('fieldErrors.custom4');
      await expect(submit(form.publicId, { ...answers, header: 'Injected' }, published.publishedVersion)).rejects.toHaveProperty('fieldErrors.header');
      await expect(submit(form.publicId, { ...answers, separator: 'Injected' }, published.publishedVersion)).rejects.toHaveProperty('fieldErrors.separator');
    } finally { await removeFields(definitions.map(field => field.id)); }
  });
  it('rejects foreign tenant/module, inactive, hidden and incompatible custom identities at save and submission boundaries', async () => {
    const definitions = await Promise.all([customField('Other tenant', 'Number', 'leads', otherTenant), customField('Contact age', 'Number', 'contacts'), customField('Account age', 'Number', 'accounts'), customField('Deal age', 'Number', 'deals'), customField('Disabled age', 'Number', 'leads', tenantId, { active: false }), customField('Hidden age', 'Number', 'leads', tenantId, { visibleInForm: false }), customField('Age')]);
    try {
      const form = await draft(), age = definitions.at(-1)!;
      for (const definition of definitions.slice(0, -1)) {
        expect((await request('/marketing/forms/' + form.id, 'PUT', { revision: 0, fields: [...form.fields as FormField[], { id: 'age', type: 'number', label: 'Age', customFieldId: definition.id }] })).status).toBe(400);
      }
      expect((await request('/marketing/forms/' + form.id, 'PUT', { revision: 0, fields: [...form.fields as FormField[], { id: 'age', type: 'single-line', label: 'Age', customFieldId: age.id }] })).status).toBe(400);
      await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: 0, fields: [...form.fields as FormField[], { id: 'age', type: 'number', label: 'Age', customFieldId: age.id }] }));
      await publish(form.id);
      await prisma.closingFieldDefinition.update({ where: { tenantId_id: { tenantId, id: age.id } }, data: { definition: { ...age, active: false } } });
      const answer = { ...values(), age: '25' };
      await expect(submit(form.publicId, answer)).rejects.toMatchObject({ statusCode: 400 });
      expect(await prisma.lead.count({ where: { tenantId, email: answer.email } })).toBe(0);
    } finally { await removeFields(definitions.map(field => field.id)); }
  });
  it('requires configured Lead Custom Fields before publishing and prevents downgrading their validators', async () => {
    const age = await customField('Required Age', 'Number', 'leads', tenantId, { required: true });
    try {
      const form = await draft();
      await expect(publish(form.id)).rejects.toThrow('Required Age');
      await expect(scoped(() => service.updateForm(form.id, tenantId, userId, { revision: 0, fields: [...form.fields as FormField[], { id: 'age', type: 'number', label: 'Age', customFieldId: age.id, required: false }] }))).rejects.toThrow('required');
      expect((await service.getFormById(form.id, tenantId)).revision).toBe(0);
    } finally { await removeFields([age.id]); }
  });
  it('preserves returning Contact inquiries without duplicating Leads or substituting Lead Custom definitions into Contacts', async () => {
    const age = await customField('Age');
    try {
      const form = await draft(), answers = { ...values(), age: '35' };
      const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Existing', lastName: 'Customer', email: answers.email } });
      await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: 0, fields: [...form.fields as FormField[], { id: 'age', type: 'number', label: 'Age', customFieldId: age.id }] }));
      await publish(form.id); await submit(form.publicId, answers);
      const inquiry = await prisma.formSubmission.findFirstOrThrow({ where: { tenantId, formId: form.id } });
      expect(inquiry.contactId).toBe(contact.id); expect(inquiry.values).toHaveProperty('age', '35');
      expect(await prisma.lead.count({ where: { tenantId, email: answers.email } })).toBe(0);
      expect(await prisma.customFieldValue.count({ where: { tenantId, fieldId: age.id } })).toBe(0);
    } finally { await removeFields([age.id]); }
  });
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
  it('reads current tenant product categories without writing preferences or changing published forms', async () => {
    const form = await publish((await draft()).id);
    const before = await prisma.marketingForm.findUniqueOrThrow({ where: { id: form.id } });
    const categoryKey = { tenantId, module: 'product-interests', key: 'categories' };
    const preferenceBefore = await prisma.tenantPreference.findUnique({ where: { tenantId_module_key: categoryKey } });
    const smartLock = await prisma.productInterest.findUniqueOrThrow({ where: { id: productIds['Smart Lock'] } });
    const foreign = await prisma.productInterest.create({ data: { tenantId: otherTenant, name: 'Private product', category: 'Private category', dealValue: 1 } });
    try {
      await prisma.tenantPreference.deleteMany({ where: categoryKey });
      await prisma.productInterest.update({ where: { id: smartLock.id }, data: { category: 'Security' } });
      const fallback = await getPublicForm(form.publicId);
      expect(fallback.productCatalog?.categories).toEqual(['Security']);
      expect(await prisma.tenantPreference.findUnique({ where: { tenantId_module_key: categoryKey } })).toBeNull();
      expect(fallback.productCatalog?.products).toContainEqual({ id: smartLock.id, name: smartLock.name, category: 'Security' });
      expect(fallback.productCatalog?.products.some(product => product.id === foreign.id)).toBe(false);
      expect(fallback.productCatalog?.categories).not.toContain('Private category');
      expect(Object.keys(fallback.productCatalog!.products[0]).sort()).toEqual(['category', 'id', 'name']);
      await prisma.tenantPreference.create({ data: { ...categoryKey, value: ['Security', 'Empty category'] } });
      expect((await getPublicForm(form.publicId)).productCatalog?.categories).toEqual(['Security', 'Empty category']);
      await prisma.tenantPreference.update({ where: { tenantId_module_key: categoryKey }, data: { value: ['Security', 'Empty category', 'Added later'] } });
      expect((await getPublicForm(form.publicId)).productCatalog?.categories).toContain('Added later');
      await prisma.tenantPreference.update({ where: { tenantId_module_key: categoryKey }, data: { value: [] } });
      expect((await getPublicForm(form.publicId)).productCatalog?.categories).toEqual([]);
      expect(await prisma.marketingForm.findUniqueOrThrow({ where: { id: form.id } })).toEqual(before);
    } finally {
      await prisma.productInterest.update({ where: { id: smartLock.id }, data: { category: smartLock.category } });
      await prisma.productInterest.delete({ where: { id: foreign.id } });
      await prisma.tenantPreference.deleteMany({ where: categoryKey });
      if (preferenceBefore) await prisma.tenantPreference.create({ data: preferenceBefore });
    }
  });
  it('keeps required multi-product submission IDs and Website attribution without persisting category metadata', async () => {
    const form = await publish((await draft()).id);
    const ids = [productIds['Smart Lock'], productIds.Biometrics];
    const answers = { ...values(), productInterest: ids };
    await expect(submitPublicForm(form.publicId, { requestId: randomUUID(), version: 1, values: { ...answers, productInterest: [] } })).rejects.toMatchObject({ fieldErrors: { productInterest: 'Select approved product interests.' } });
    await submitPublicForm(form.publicId, { requestId: randomUUID(), version: 1, values: answers });
    const inquiry = await prisma.formSubmission.findFirstOrThrow({ where: { formId: form.id } });
    expect(inquiry.values).toMatchObject({ productInterest: ids });
    expect(inquiry.values).not.toHaveProperty('productCategory');
    expect(inquiry.publishedConfig).not.toHaveProperty('productCatalog');
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: inquiry.leadId! } });
    expect(lead.source).toBe('Website');
    expect((await prisma.leadProductInterest.findMany({ where: { leadId: lead.id } })).map(row => row.productInterestId).sort()).toEqual(ids.slice().sort());
    const withoutProducts = await draft();
    await scoped(() => service.updateForm(withoutProducts.id, tenantId, userId, { revision: 0, fields: (withoutProducts.fields as FormField[]).filter(field => field.mapToField !== 'productInterest') }));
    await publish(withoutProducts.id);
    expect(await getPublicForm(withoutProducts.publicId)).not.toHaveProperty('productCatalog');
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
    expect(lead.productInterestIds).toEqual([productIds['Smart Lock']]);
    const deals = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } });
    expect(deals).toHaveLength(2);
    await submit(form.publicId, v);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } })).toBe(3);
  });

  it('sorts persisted repeat Lead activity before pagination and preserves explicit sorting, filters, and creation dates', async () => {
    const marker = `Activity${randomUUID().replace(/[0-9]/g, 'a')}`, form = await publish((await draft()).id), v = { ...values(), lastName: marker };
    const old = await prisma.lead.create({ data: { tenantId, firstName: 'Returning', lastName: marker, email: v.email, status: 'Hot', source: 'Website', createdAt: new Date('2020-01-01') } });
    const newer = await prisma.lead.create({ data: { tenantId, firstName: 'Newer', lastName: marker, status: 'Hot', source: 'Website', createdAt: new Date('2024-01-01') } });
    const page = async (sort = '', page = 1) => request(`/crm/leads?search=${marker}&limit=1&page=${page}${sort ? '&sort=' + sort : ''}`);
    expect((await page()).body.data[0].id).toBe(newer.id);
    await prisma.lead.update({ where: { id: old.id }, data: { address: 'Ordinary profile edit' } });
    expect((await page()).body.data[0].id).toBe(newer.id);
    await submit(form.publicId, { ...v, productInterest: [productIds['Smart Lock'], productIds.Biometrics] });
    const firstPage = await page();
    expect(firstPage.status, JSON.stringify(firstPage.body)).toBe(200);
    expect(firstPage.body.data[0]).toMatchObject({ id: old.id, createdAt: old.createdAt.toISOString() });
    const deals = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: old.id } } } });
    expect(deals).toHaveLength(2);
    expect(firstPage.body.data[0].lastSalesActivityAt).toBe(new Date(Math.max(...deals.map(deal => +deal.createdAt))).toISOString());
    expect((await page('', 2)).body.data[0].id).toBe(newer.id);
    expect((await page('createdAt:desc')).body.data[0].id).toBe(newer.id);
    expect((await request(`/crm/leads?search=${marker}&filter[source]=equals:Website&sort=lastSalesActivityAt:desc&limit=1`)).body.data[0].id).toBe(old.id);
    await prisma.lead.update({ where: { id: newer.id }, data: { address: 'Later ordinary edit' } });
    expect((await page()).body.data[0].id).toBe(old.id);
    await prisma.deal.updateMany({ where: { id: { in: deals.map(deal => deal.id) } }, data: { createdAt: newer.createdAt } });
    expect((await page()).body.data[0].id).toBe([old.id, newer.id].sort()[0]);
  });

  it('creates one receipt and one Deal per Product for concurrent retries, rejects changed content, and rolls back a failed repeat Deal', async () => {
    const form = await publish((await draft()).id), v = values(), requestId = randomUUID();
    await submit(form.publicId, v);
    const person = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: v.email } });
    const retry = { requestId, version: 1, values: { ...v, productInterest: [productIds['Smart Lock'], productIds.Biometrics] } };
    await Promise.all([submitPublicForm(form.publicId, retry), submitPublicForm(form.publicId, retry)]);
    expect(await prisma.formSubmission.count({ where: { tenantId, formId: form.id, requestKey: requestId } })).toBe(1);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: person.id } } } })).toBe(3);
    await expect(submitPublicForm(form.publicId, { ...retry, values: { ...retry.values, address: 'Different intent' } })).rejects.toMatchObject({ statusCode: 409 });
    const before = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: person.id } } }, orderBy: { id: 'asc' } });
    rejectInquiryDealTitle = `${person.firstName} ${person.lastName} – Smart Lock`;
    try { await expect(submit(form.publicId, v)).rejects.toThrow('Simulated inquiry Deal failure'); }
    finally { rejectInquiryDealTitle = ''; }
    expect(await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: person.id } } }, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.formSubmission.count({ where: { tenantId, leadId: person.id } })).toBe(2);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: person.id } })).createdAt).toEqual(person.createdAt);
  });

  it('promotes returning Contacts and derives canonical converted-Lead Deal activity', async () => {
    const marker = `ContactActivity${randomUUID().replace(/[0-9]/g, 'a')}`, form = await publish((await draft()).id), v = { ...values(), lastName: marker };
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Returning', lastName: marker, email: v.email, createdAt: new Date('2020-01-01') } });
    const newer = await prisma.contact.create({ data: { tenantId, firstName: 'Newer', lastName: marker, createdAt: new Date('2024-01-01') } });
    const page = () => request(`/crm/contacts?search=${marker}&limit=1`);
    expect((await page()).body.data[0].id).toBe(newer.id);
    await submit(form.publicId, v);
    expect((await page()).body.data[0].id).toBe(contact.id);
    const linked = await prisma.deal.findFirstOrThrow({ where: { tenantId, contactDeals: { some: { contactId: contact.id } } } });
    const source = await prisma.lead.create({ data: { tenantId, firstName: 'Canonical', lastName: marker, contactId: newer.id, convertedAt: new Date() } });
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Converted source Deal', pipelineId: linked.pipelineId, stageId: linked.stageId, createdAt: new Date('2099-01-01'), leadDeals: { create: { leadId: source.id } } } });
    expect((await page()).body.data[0]).toMatchObject({ id: newer.id, lastSalesActivityAt: deal.createdAt.toISOString() });
    expect((await request(`/crm/contacts?search=${marker}&sort=createdAt:asc&limit=1`)).body.data[0].id).toBe(contact.id);
  });

  it('uses only authorized Deal dates and includes converted sources without disclosing the Lead profile', async () => {
    const marker = `ScopedActivity${randomUUID()}`;
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: marker, permissions: { create: [
      { module: 'contacts', canView: true, canViewAll: true }, { module: 'deals', canView: true, canViewMy: true },
    ] } } });
    const observer = await prisma.user.create({ data: { tenantId, role: marker, firstName: 'Observer', lastName: marker, email: `${marker}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId: role.id } } } });
    const auth = (await issueAuthSession(observer)).token;
    const old = await prisma.contact.create({ data: { tenantId, firstName: 'Old', lastName: marker, createdAt: new Date('2020-01-01') } });
    const newer = await prisma.contact.create({ data: { tenantId, firstName: 'New', lastName: marker, createdAt: new Date('2024-01-01') } });
    const source = await prisma.lead.create({ data: { tenantId, firstName: 'Hidden', lastName: marker, contactId: old.id, convertedAt: new Date() } });
    const pipeline = await prisma.pipeline.findFirstOrThrow({ where: { tenantId, isArchived: false } });
    const stage = await prisma.stage.findFirstOrThrow({ where: { tenantId, pipelineId: pipeline.id } });
    await prisma.deal.create({ data: { tenantId, title: 'Private Deal', pipelineId: pipeline.id, stageId: stage.id, createdAt: new Date('2099-01-01'), leadDeals: { create: { leadId: source.id } } } });
    const list = () => request(`/crm/contacts?search=${marker}&limit=1`, 'GET', undefined, auth);
    expect((await list()).body.data[0].id).toBe(newer.id);
    await prisma.deal.create({ data: { tenantId, title: 'Authorized Deal', pipelineId: pipeline.id, stageId: stage.id, assignedUserId: observer.id, createdAt: new Date('2025-01-01'), leadDeals: { create: { leadId: source.id } } } });
    expect((await list()).body.data[0]).toMatchObject({ id: old.id, lastSalesActivityAt: '2025-01-01T00:00:00.000Z' });
    expect((await request(`/crm/leads/${source.id}`, 'GET', undefined, auth)).status).toBe(403);
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
    expect(await prisma.contactProductInterest.count({ where: { contactId: c.id, productInterestId: productIds['Smart Lock'] } })).toBe(0);
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
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, wonConfirmedAt: new Date('2025-01-01'), wonConfirmedById: userId, hasEverBeenWon: true, wonHistoryVerified: true, leadDeals: { create: { leadId: l.id, position: 0 } }, title: 'Historic sale', productInterests: ['CCTV'], tags: [] } });
    await submit(form.publicId, v); await submit(form.publicId, v);
    const repaired = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } }); expect(repaired.contactId).toBeTruthy();
    expect(repaired.status).toBe('Closed Deal');
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: repaired.contactId! } })).toMatchObject({ status: 'INQUIRY', lifecycleStage: 'CUSTOMER', customerSince: new Date('2025-01-01') });
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
    await expect(submitPublicForm(form.publicId, { requestId: randomUUID(), version: 1, values: { ...v, phone: '9123456789' } })).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
  });
  it('reuses an existing customer linked to a historical won deal', async () => {
    const f = await publish((await draft()).id), v = values();
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Customer', lastName: 'Old email', email: v.email, productInterest: [] } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Customer', lastName: 'New email', email: randomUUID() + '@example.com', productInterests: [] } });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Historical' } });
    const won = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Closed Deal', order: 1, isWon: true, requiredFields: [] } });
    const current = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'After sale', order: 2, requiredFields: [] } });
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: current.id, wonConfirmedAt: new Date('2025-01-01'), wonConfirmedById: userId, hasEverBeenWon: true, wonHistoryVerified: true, title: 'Old purchase', productInterests: [], tags: [] } });
    await prisma.leadDeal.create({ data: { tenantId, dealId: deal.id, leadId: lead.id } });
    await prisma.contactDeal.create({ data: { tenantId, dealId: deal.id, contactId: contact.id } });
    await prisma.dealStageHistory.create({ data: { tenantId, dealId: deal.id, newStageId: won.id, movedById: userId } });
    await submit(f.publicId, v);
    expect(await prisma.formSubmission.findFirst({ where: { formId: f.id } })).toMatchObject({ contactId: contact.id, leadId: null });
    expect(await prisma.deal.findUnique({ where: { id: deal.id }, include: { contactDeals: true } })).toMatchObject({ id: deal.id, stageId: deal.stageId, value: deal.value, productInterests: deal.productInterests, contactDeals: [{ contactId: contact.id }] });
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toMatchObject({ status: 'Inquiry', contactId: contact.id });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ status: 'INQUIRY', lifecycleStage: 'CUSTOMER', customerSince: new Date('2025-01-01') });
  });
  it('matches legacy formatted phones and whitespace-normalized email', async () => {
    const f = await publish((await draft()).id), v = values();
    const c = await prisma.contact.create({ data: { tenantId, firstName: 'Legacy', lastName: 'Person', email: ' ' + v.email.toUpperCase() + ' ', phone: '+63 955 111 2233', productInterests: [] } });
    await submitPublicForm(f.publicId, { requestId: randomUUID(), version: 1, values: { ...v, phone: '9551112233' } });
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
    expect((await request('/public/forms/' + f.publicId + '/submissions', 'POST', { requestId: randomUUID(), version: 1, values: { junk: 'x'.repeat(66000) } }, '')).status).toBe(413);
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
    await submitPublicForm(f.publicId, { requestId: randomUUID(), version: 1, values: values(), tracking: { utm_campaign: 'September' } });
    expect(await prisma.formSubmission.findFirst({ where: { formId: f.id } })).toMatchObject({ tracking: { utm_campaign: 'September' }, notificationStatus: 'failed' });
  });
  it('enforces auth/RBAC and exposes only published public data', async () => {
    expect((await request('/marketing/forms', 'GET', undefined, '')).status).toBe(401);
    expect((await request('/marketing/forms', 'GET', undefined, denied)).status).toBe(403);
    expect((await request('/marketing/forms', 'POST', { name: 'Denied' }, denied)).status).toBe(403);
    const f = await publish((await draft()).id), r = await request('/public/forms/' + f.publicId, 'GET', undefined, '');
    expect((await request('/marketing/forms/' + f.id, 'PUT', { name: 'Denied edit', revision: f.revision }, denied)).status).toBe(403);
    expect((await request('/marketing/forms/' + f.id + '/publish', 'PATCH', undefined, denied)).status).toBe(403);
    const outsider = await prisma.user.create({ data: { tenantId: otherTenant, firstName: 'Other', lastName: 'Admin', email: 'forms-other-admin@camxian.com', role: 'Client Admin', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } });
    const outsiderToken = (await issueAuthSession(outsider)).token;
    expect((await request('/marketing/forms/' + f.id, 'GET', undefined, outsiderToken)).status).toBe(404);
    expect((await request('/marketing/forms/' + f.id, 'PUT', { name: 'Cross-tenant edit', revision: f.revision }, outsiderToken)).status).toBe(404);
    expect((await request('/marketing/forms/' + f.id + '/publish', 'PATCH', undefined, outsiderToken)).status).toBe(404);
    expect(r.status).toBe(200); expect(r.body.data).not.toHaveProperty('tenantId'); expect(r.body.data).not.toHaveProperty('settings');
    const bad = await request('/public/forms/' + f.publicId + '/submissions', 'POST', { requestId: randomUUID(), version: 1, values: { ...values(), firstName: ' ' } }, '');
    expect(bad.status).toBe(400); expect(bad.body.fieldErrors.firstName).toBeTruthy();
    const bot = values();
    await expect(submitPublicForm(f.publicId, { requestId: randomUUID(), version: 1, values: bot, website: 'bot-filled-honeypot' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.lead.count({ where: { tenantId, email: bot.email } })).toBe(0);
  });
  it('rotates only eligible Sales members, preserves request idempotency and inquiry/Deal ownership', async () => {
    const group = await scoped(() => prisma.$transaction(tx => ensureSalesGroup(tx, tenantId), { isolationLevel: 'Serializable' }));
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Form eligible agent' } });
    await prisma.rolePermission.createMany({ data: ['leads', 'deals'].map(module => ({ tenantId, roleId: role.id, module, canView: true, canEdit: true })) });
    const makeAgent = (prefix: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') => prisma.user.create({ data: { id: prefix + randomUUID(), tenantId,
      email: randomUUID() + '@camxian.com', firstName: prefix, lastName: 'Agent', role: role.name, status,
      userRoles: { create: { roleId: role.id } } } });
    const a = await makeAgent('a-'), b = await makeAgent('b-'), outside = await makeAgent('0-'), inactive = await makeAgent('c-', 'INACTIVE');
    await prisma.tenantGroupMember.createMany({ data: [a, b, inactive].map(user => ({ tenantId, groupId: group.id, userId: user.id })) });
    const f = await publish((await draft()).id), first = values(), requestId = randomUUID();
    const cursor = { tenantId, module: 'form-lead-assignment', key: `sales:${group.id}` };
    const savedLead = (email: string) => prisma.lead.findFirstOrThrow({ where: { tenantId, email } });
    await submitPublicForm(f.publicId, { version: 1, values: first, requestId });
    expect((await savedLead(first.email)).assignedUserId).toBe(a.id);
    const beforeRetry = await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursor } });
    await submitPublicForm(f.publicId, { version: 1, values: first, requestId });
    expect((await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursor } })).value).toBe(beforeRetry.value);
    expect(await prisma.formSubmission.count({ where: { formId: f.id, requestKey: requestId } })).toBe(1);
    const rejected = values(); rejectSubmissionEmail = rejected.email;
    try { await expect(submit(f.publicId, rejected)).rejects.toThrow('Simulated submission persistence failure'); }
    finally { rejectSubmissionEmail = ''; }
    expect(await prisma.lead.count({ where: { tenantId, email: rejected.email } })).toBe(0);
    expect((await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursor } })).value).toBe(beforeRetry.value);
    // Display name is editable; routing follows SALES, never the label.
    await prisma.tenantGroup.update({ where: { id: group.id }, data: { name: 'Revenue team' } });
    const second = values(); await submit(f.publicId, second);
    const third = values(); await submit(f.publicId, third);
    expect((await savedLead(second.email)).assignedUserId).toBe(b.id);
    expect((await savedLead(third.email)).assignedUserId).toBe(a.id);
    const simultaneous = [values(), values()];
    await Promise.all(simultaneous.map(value => submitPublicForm(f.publicId, { version: 1, values: value, requestId: randomUUID() })));
    expect(new Set(await Promise.all(simultaneous.map(async value => (await savedLead(value.email)).assignedUserId)))).toEqual(new Set([a.id, b.id]));
    for (const value of [first, second, third, ...simultaneous]) {
      const lead = await savedLead(value.email);
      expect(lead.assignedUserId).not.toBe(outside.id); expect(lead.assignedUserId).not.toBe(inactive.id);
      const deals = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { tenantId, leadId: lead.id } } } });
      expect(deals).toHaveLength(1); expect(deals[0].assignedUserId).toBe(lead.assignedUserId);
    }
    const beforeReturn = (await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursor } })).value;
    await submit(f.publicId, first);
    expect((await savedLead(first.email)).assignedUserId).toBe(a.id);
    const customerValues = values();
    const customer = await prisma.contact.create({ data: { tenantId, firstName: 'Returning', lastName: 'Customer', email: customerValues.email, assignedUserId: outside.id } });
    await submit(f.publicId, customerValues);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } })).assignedUserId).toBe(outside.id);
    expect((await prisma.deal.findMany({ where: { tenantId, contactDeals: { some: { tenantId, contactId: customer.id } } } }))[0].assignedUserId).toBe(outside.id);
    expect((await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursor } })).value).toBe(beforeReturn);
    // Provisioning repeats preserve ID, name and manually-managed memberships.
    expect((await scoped(() => prisma.$transaction(tx => ensureSalesGroup(tx, tenantId)))).id).toBe(group.id);
    expect(await prisma.tenantGroupMember.count({ where: { tenantId, groupId: group.id } })).toBe(3);
    await prisma.tenantGroupMember.deleteMany({ where: { tenantId, groupId: group.id } });
    const empty = values(); await submit(f.publicId, empty);
    const unassigned = await savedLead(empty.email); expect(unassigned.assignedUserId).toBeNull();
    expect((await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { tenantId, leadId: unassigned.id } } } }))[0].assignedUserId).toBeNull();
    expect(await prisma.activity.count({ where: { tenantId, leadId: unassigned.id, type: 'assignment', title: 'Lead awaiting assignment' } })).toBe(1);
    expect((await prisma.tenantPreference.findUniqueOrThrow({ where: { tenantId_module_key: cursor } })).value).toBe(beforeReturn);
  });
  it('checks only staff ownership anonymously within the published tenant without exposing account details', async () => {
    const form = await draft();
    const check = (email: string, id = form.publicId) => request(`/public/forms/${id}/email-availability?${new URLSearchParams({ email })}`, 'GET', undefined, '');
    expect((await check('forms-admin@camxian.com')).status).toBe(404);
    await publish(form.id);
    const denied = await check('  FORMS-ADMIN@CAMXIAN.COM  ');
    expect(denied.status).toBe(200); expect(denied.headers.get('cache-control')).toBe('no-store');
    expect(denied.body).toEqual({ success: true, data: { available: false, reason: 'STAFF_EMAIL_NOT_ALLOWED' } });
    const inactiveEmail = randomUUID() + '@example.com';
    await prisma.user.create({ data: { tenantId, email: inactiveEmail, firstName: 'Inactive', lastName: 'Staff', role: 'Sales', status: 'INACTIVE' } });
    expect((await check(inactiveEmail)).body).toEqual(denied.body);
    const customerEmail = randomUUID() + '@example.com';
    await prisma.lead.create({ data: { tenantId, email: customerEmail, firstName: 'Existing', lastName: 'Lead' } });
    await prisma.contact.create({ data: { tenantId, email: customerEmail, firstName: 'Existing', lastName: 'Contact' } });
    expect((await check(customerEmail)).body).toEqual({ success: true, data: { available: true } });
    const foreignEmail = randomUUID() + '@camxian.com';
    await prisma.user.create({ data: { tenantId: otherTenant, email: foreignEmail, firstName: 'Foreign', lastName: 'Staff', role: 'Sales' } });
    expect((await check(foreignEmail)).body).toEqual({ success: true, data: { available: true } });
    await submit(form.publicId, values(foreignEmail));
    expect(await prisma.lead.count({ where: { tenantId, email: foreignEmail } })).toBe(1);
    for (const query of ['email=bad', 'email=one%40example.com&email=two%40example.com', 'email=valid%40example.com&tenantId=other']) {
      expect((await request(`/public/forms/${form.publicId}/email-availability?${query}`, 'GET', undefined, '')).status).toBe(400);
    }
    expect((await check(customerEmail, randomUUID())).status).toBe(404);
    await scoped(() => service.unpublishForm(form.id, tenantId, userId));
    expect((await check(customerEmail)).status).toBe(404);
    await publish(form.id);
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    try { expect((await check(customerEmail)).status).toBe(404); }
    finally { await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } }); }
    await prisma.marketingForm.update({ where: { id: form.id }, data: { isArchived: true } });
    expect((await check(customerEmail)).status).toBe(404);
  });
  it('rejects staff submissions below the configured email field even when a customer already shares that email', async () => {
    const form = await draft();
    await scoped(() => service.updateForm(form.id, tenantId, userId, { revision: 0, fields: (form.fields as FormField[]).map(field => field.mapToField === 'email' ? { ...field, id: 'visitorEmail' } : field) }));
    await publish(form.id);
    const staffEmail = randomUUID() + '@camxian.com';
    await prisma.user.create({ data: { tenantId, email: staffEmail, firstName: 'Protected', lastName: 'Staff', role: 'Sales' } });
    const lead = await prisma.lead.create({ data: { tenantId, email: staffEmail, firstName: 'Historical', lastName: 'Lead' } });
    const contact = await prisma.contact.create({ data: { tenantId, email: staffEmail, firstName: 'Historical', lastName: 'Contact' } });
    const { email, ...rest } = values(staffEmail);
    const response = await request(`/public/forms/${form.publicId}/submissions`, 'POST', { requestId: randomUUID(), version: 1, values: { ...rest, visitorEmail: ` ${email.toUpperCase()} ` } }, '');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: 'Please check the highlighted fields.', fieldErrors: { visitorEmail: EMAIL_AVAILABILITY_MESSAGES.STAFF_EMAIL_NOT_ALLOWED } });
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toEqual(lead);
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).toEqual(contact);
    expect(await prisma.deal.count({ where: { tenantId, OR: [{ leadDeals: { some: { leadId: lead.id } } }, { contactDeals: { some: { contactId: contact.id } } }] } })).toBe(0);
  });
  it('fails safely when staff lookup fails without accepting or persisting the inquiry', async () => {
    const form = await publish((await draft()).id), answer = values(); rejectEmailLookupEmail = answer.email;
    try {
      const response = await request(`/public/forms/${form.publicId}/email-availability?${new URLSearchParams({ email: answer.email })}`, 'GET', undefined, '');
      expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain('Simulated staff lookup failure');
      await expect(submit(form.publicId, answer)).rejects.toThrow('Simulated staff lookup failure');
    } finally { rejectEmailLookupEmail = ''; }
    expect(await prisma.lead.count({ where: { tenantId, email: answer.email } })).toBe(0);
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
  });
  it.each(['lead', 'contact'] as const)('preserves the returning %s profile and associates every selected Product Deal with its existing Account', async kind => {
    const form = await publish((await draft()).id), answer = values();
    const account = await prisma.account.create({ data: { tenantId, name: 'Existing account' } });
    const profile = { tenantId, accountId: account.id, firstName: 'Saved', lastName: 'Customer', email: ` ${answer.email.toUpperCase()} `, address: 'Saved address', phone: '+639551112233', companyName: 'Saved company', assignedUserId: userId };
    const customer = kind === 'lead' ? await prisma.lead.create({ data: { ...profile, productInterest: ['Original interest'] } })
      : await prisma.contact.create({ data: { ...profile, productInterests: ['Original interest'] } });
    const selected = [productIds['Smart Lock'], productIds.Biometrics];
    for (let i = 0; i < 2; i++) await submit(form.publicId, { ...answer, company: 'Visitor company', address: 'Visitor address', productInterest: selected });
    const saved = kind === 'lead' ? await prisma.lead.findUniqueOrThrow({ where: { id: customer.id } }) : await prisma.contact.findUniqueOrThrow({ where: { id: customer.id } });
    expect(saved).toMatchObject({ ...profile, ...(kind === 'lead' ? { productInterest: ['Original interest'] } : { productInterests: ['Original interest'] }) });
    const relation = kind === 'lead' ? { leadDeals: { some: { leadId: customer.id } } } : { contactDeals: { some: { contactId: customer.id } } };
    const deals = await prisma.deal.findMany({ where: { tenantId, ...relation } });
    expect(deals).toHaveLength(4);
    expect(deals.every(deal => deal.accountId === account.id && deal.assignedUserId === userId && deal.ownerId === userId)).toBe(true);
    expect(deals.map(deal => deal.productInterestId).sort()).toEqual([...selected, ...selected].sort());
    expect(await prisma.lead.count({ where: { tenantId, email: { contains: answer.email, mode: 'insensitive' } } })).toBe(kind === 'lead' ? 1 : 0);
    expect(await prisma.contact.count({ where: { tenantId, email: { contains: answer.email, mode: 'insensitive' } } })).toBe(kind === 'contact' ? 1 : 0);
  });
  it('reuses one new customer across concurrent distinct inquiries through different published forms', async () => {
    const first = await publish((await draft()).id), second = await publish((await draft()).id), answer = values();
    await Promise.all([
      submit(first.publicId, answer),
      submit(second.publicId, { ...answer, email: answer.email.toUpperCase() }),
    ]);
    const people = await prisma.lead.findMany({ where: { tenantId, email: answer.email } });
    expect(people).toHaveLength(1);
    expect(await prisma.contact.count({ where: { tenantId, email: answer.email } })).toBe(0);
    expect(await prisma.formSubmission.count({ where: { tenantId, leadId: people[0].id } })).toBe(2);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: people[0].id } } } })).toBe(2);
  });
  it('replays concurrent first-submission retries without creating duplicate people or Deals', async () => {
    const form = await publish((await draft()).id), answer = values(), requestId = randomUUID();
    const body = { requestId, version: 1, values: answer };
    await Promise.all([submitPublicForm(form.publicId, body), submitPublicForm(form.publicId, body)]);
    const people = await prisma.lead.findMany({ where: { tenantId, email: answer.email } });
    expect(people).toHaveLength(1);
    expect(await prisma.formSubmission.count({ where: { tenantId, formId: form.id, requestKey: requestId } })).toBe(1);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: people[0].id } } } })).toBe(1);
  });
  it('does not consume submission allowance during live email checks', async () => {
    const form = await publish((await draft()).id);
    for (let i = 0; i < 25; i++) {
      const result = await request(`/public/forms/${form.publicId}/email-availability?email=visitor%40example.com`, 'GET', undefined, '');
      expect(result.status).toBe(200);
    }
    const response = await request(`/public/forms/${form.publicId}/submissions`, 'POST', { requestId: randomUUID(), version: 1, values: values() }, '');
    expect(response.status).toBe(201);
  });
  it('attributes tagged captures, retains first touch, snapshots repeat Deal sources, and checks PDF access', async () => {
    const f = await publish((await draft()).id), v = values(), observedAt = new Date().toISOString();
    const context = (source: string, medium: string) => ({ first: { params: { utm_source: source, utm_medium: medium, utm_campaign: 'demo' }, observedAt }, last: { params: { utm_source: source, utm_medium: medium, utm_campaign: 'demo' }, observedAt }, storage: 'session' });
    const input = { requestId: randomUUID(), version: f.publishedVersion, values: v, attribution: context('google', 'cpc') };
    await submitPublicForm(f.publicId, input); await submitPublicForm(f.publicId, input);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: v.email } });
    expect(lead.source).toBe('Google Ads'); expect(lead.attribution).toMatchObject({ first: { source: 'google' }, last: { source: 'google' } });
    expect(await prisma.formSubmission.count({ where: { formId: f.id } })).toBe(1);
    await submitPublicForm(f.publicId, { ...input, requestId: randomUUID(), attribution: context('newsletter', 'email') });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).attribution).toMatchObject({ first: { source: 'google' }, last: { source: 'newsletter' } });
    expect(await prisma.deal.findMany({ where: { tenantId, automationKey: { startsWith: 'form:' }, leadDeals: { some: { tenantId, leadId: lead.id } } } })).toEqual(expect.arrayContaining([expect.objectContaining({ leadSource: 'Email Campaign' })]));
    expect((await request(`/marketing/forms/${f.id}/source-links`, 'GET', undefined, denied)).status).toBe(403);
    const manifest = (await request(`/marketing/forms/${f.id}/source-links`)).body;
    expect(manifest.campaign).toBe('');
    expect(manifest.rows).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'Direct Email', link: 'mailto:leadcrm.tech@gmail.com?subject=Product%20inquiry' })]));
    for (const row of manifest.rows.filter((row: { category: string }) => row.category !== 'Direct Email')) {
      const link = new URL(row.link);
      expect(link.searchParams.has('utm_campaign')).toBe(false);
      expect(link.searchParams.get('utm_source')).toBe(row.source);
      expect(link.searchParams.get('utm_medium')).toBe(row.medium);
    }
    const legacy = await request(`/marketing/forms/${f.id}/source-links?campaign=existing_campaign`);
    expect(legacy.body.campaign).toBe('existing_campaign');
    expect(new URL(legacy.body.rows[0].link).searchParams.get('utm_campaign')).toBe('existing_campaign');
    expect((await request(`/marketing/forms/${f.id}/source-links?campaign=invalid%20campaign`)).status).toBe(400);
    const pdf = await fetch(base + `/marketing/forms/${f.id}/source-links.pdf`, { headers: { Authorization: 'Bearer ' + token } });
    expect(pdf.status).toBe(200); expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('preserves source and Product Deal relationships when converting a captured Lead', async () => {
    const f = await publish((await draft()).id), v = values(), observedAt = new Date().toISOString();
    const touch = { params: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'conversion_demo' }, observedAt };
    const capture = await request('/public/forms/' + f.publicId + '/submissions', 'POST', { requestId: randomUUID(), version: f.publishedVersion, values: v, attribution: { first: touch, last: touch, storage: 'session' } }, '');
    expect(capture.status).toBe(201);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, email: v.email } });
    const linked = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { tenantId, leadId: lead.id } } } });
    expect(linked.length).toBeGreaterThan(0);
    const converted = await request('/crm/leads/' + lead.id + '/convert', 'POST', { skipAccountCreation: true, createContact: true, createDeal: false });
    expect(converted.status).toBe(200);
    const contact = await prisma.contact.findFirstOrThrow({ where: { tenantId, email: v.email } });
    expect(contact.attribution).toMatchObject({ first: { source: 'google' }, last: { campaign: 'conversion_demo' } });
    expect(await prisma.contactProductInterest.findMany({ where: { tenantId, contactId: contact.id } })).toEqual(expect.arrayContaining([expect.objectContaining({ productInterestId: v.productInterest })]));
    for (const deal of linked) expect(await prisma.contactDeal.findFirst({ where: { tenantId, contactId: contact.id, dealId: deal.id } })).not.toBeNull();
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ contactId: contact.id, convertedAt: expect.any(Date) });
  });
  it('persists staff-created Call and SMS details under Others', async () => {
    for (const sourceDetail of ['Call', 'SMS']) {
      const result = await request('/crm/leads', 'POST', { firstName: 'Manual', lastName: sourceDetail, email: `${randomUUID()}@example.test`, source: 'Others', sourceDetail });
      expect(result.status).toBe(201);
      expect(result.body.data).toMatchObject({ source: 'Others', sourceDetail, attribution: { captureMethod: 'manual', first: { source: sourceDetail } } });
    }
  });
  it('reports a legacy mailbox disconnected and never uses its credentials to sync the replacement address', async () => {
    const { syncBusinessEmail, finishBusinessEmail } = await import('../../../integrations/gmail/business-email.service');
    const { encryptToken } = await import('../../../core/encryption/crypto.service');
    const { hashToken } = await import('../../../core/auth/session.service');
    const oauth = await import('../../../integrations/gmail/gmail.oauth');
    const connection = await prisma.businessEmailConnection.create({ data: { tenantId, connectedById: userId, email: 'goldenbits.1993@gmail.com', accessToken: 'legacy-token', refreshToken: 'legacy-refresh', tokenExpiresAt: new Date(0), lastSyncAt: new Date(), nextPageToken: 'old-mailbox-page', startsAt: new Date(Date.now() - 60000) } });
    try {
      const status = await request('/integrations/business-email/status');
      expect(status.body).toMatchObject({ email: 'leadcrm.tech@gmail.com', connected: false, lastSyncAt: null });
      const provider = vi.spyOn(globalThis, 'fetch');
      try {
        await expect(scoped(() => syncBusinessEmail(tenantId))).rejects.toMatchObject({ statusCode: 409 });
        expect(provider).not.toHaveBeenCalled();
      } finally { provider.mockRestore(); }
      expect(await prisma.businessEmailConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ email: 'goldenbits.1993@gmail.com', accessToken: 'legacy-token', refreshToken: 'legacy-refresh', isActive: true });
      const exchange = vi.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'replacement-token', refresh_token: 'replacement-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly', token_type: 'Bearer' });
      const info = vi.spyOn(oauth, 'getUserInfo').mockResolvedValue({ email: 'goldenbits.1993@gmail.com', verified_email: true });
      const profile = vi.spyOn(oauth, 'getMailboxProfile').mockResolvedValue({ emailAddress: 'goldenbits.1993@gmail.com' });
      const challenge = async () => {
        const state = randomUUID();
        await prisma.businessEmailOAuthState.create({ data: { stateHash: hashToken(state), tenantId, userId, sessionHash: hashToken(token), verifier: encryptToken('disposable-verifier'), expiresAt: new Date(Date.now() + 60000) } });
        return state;
      };
      try {
        await expect(finishBusinessEmail(await challenge(), 'disposable-code')).rejects.toMatchObject({ statusCode: 400 });
        info.mockResolvedValue({ email: 'leadcrm.tech@gmail.com', verified_email: true });
        profile.mockResolvedValue({ emailAddress: 'leadcrm.tech@gmail.com' });
        await finishBusinessEmail(await challenge(), 'disposable-code');
        const replacement = await prisma.businessEmailConnection.findUniqueOrThrow({ where: { id: connection.id } });
        expect(replacement).toMatchObject({ email: 'leadcrm.tech@gmail.com', lastSyncAt: null, nextPageToken: null, isActive: true });
        expect(+replacement.startsAt).toBeGreaterThan(+connection.startsAt);
      } finally { exchange.mockRestore(); info.mockRestore(); profile.mockRestore(); }
    } finally { await prisma.businessEmailConnection.delete({ where: { id: connection.id } }); }
  });
  it('captures unknown business senders separately and creates one reviewed Lead', async () => {
    const { encryptToken } = await import('../../../core/encryption/crypto.service');
    const { syncBusinessEmail } = await import('../../../integrations/gmail/business-email.service');
    const sender = `${randomUUID()}@example.test`;
    await prisma.businessEmailConnection.create({ data: { tenantId, connectedById: userId, email: 'leadcrm.tech@gmail.com', accessToken: encryptToken('disposable'), refreshToken: encryptToken('disposable'), tokenExpiresAt: new Date(Date.now() + 3600000), startsAt: new Date(Date.now() - 60000) } });
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ messages: [{ id: 'inquiry1' }] })).mockImplementation(async (url: string | URL | Request) => String(url).includes('inquiry1') ? Response.json({ id: 'inquiry1', snippet: 'Please send pricing.', labelIds: ['INBOX'], internalDate: String(Date.now() - 1000), payload: { headers: [{ name: 'From', value: `New Prospect <${sender}>` }, { name: 'To', value: 'leadcrm.tech@gmail.com' }, { name: 'Subject', value: 'Product inquiry' }] } }) : Response.json({ messages: [{ id: 'inquiry1' }] })));
    try { await scoped(() => syncBusinessEmail(tenantId)); await scoped(() => syncBusinessEmail(tenantId)); }
    finally { vi.stubGlobal('fetch', original); }
    expect(await prisma.lead.count({ where: { tenantId, email: sender } })).toBe(0);
    const inquiries = await request('/integrations/business-email/inquiries'); expect(inquiries.status).toBe(200);
    const inquiry = inquiries.body.data.find((row: { sender: string }) => row.sender === sender); expect(inquiry).toBeTruthy();
    expect((await request('/integrations/business-email/inquiries', 'GET', undefined, denied)).status).toBe(403);
    const body = { action: 'create', lead: { firstName: 'New', lastName: 'Prospect', email: sender, source: 'Direct Email', status: 'Inquiry' } };
    const reviewed = await request(`/integrations/business-email/inquiries/${inquiry.id}/review`, 'POST', body); expect(reviewed.status).toBe(200);
    expect((await request(`/integrations/business-email/inquiries/${inquiry.id}/review`, 'POST', body)).body.leadId).toBe(reviewed.body.leadId);
    expect(await prisma.lead.count({ where: { tenantId, email: sender } })).toBe(1);
    expect(await prisma.lead.findFirst({ where: { tenantId, email: sender } })).toMatchObject({ source: 'Direct Email', attribution: { captureMethod: 'business_email' } });
    const limited = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', limited);
    try {
      await expect(scoped(() => syncBusinessEmail(tenantId))).rejects.toMatchObject({ statusCode: 503 });
      expect(await scoped(() => syncBusinessEmail(tenantId))).toMatchObject({ busy: true });
      expect(limited).toHaveBeenCalledTimes(1);
    } finally { vi.stubGlobal('fetch', original); }
  });
  it('protects inquiry data, credentials and review actions across tenant and role boundaries', async () => {
    const { encryptToken } = await import('../../../core/encryption/crypto.service');
    const sender = randomUUID() + '@example.test';
    const connection = await prisma.businessEmailConnection.upsert({ where: { tenantId }, create: { tenantId, connectedById: userId, email: 'leadcrm.tech@gmail.com', accessToken: encryptToken('private-provider-token'), refreshToken: encryptToken('private-refresh-token'), tokenExpiresAt: new Date(Date.now()+3600000) }, update: {} });
    const inquiry = await prisma.businessEmailInquiry.create({ data: { tenantId, connectionId: connection.id, providerMessageId: randomUUID(), sender, senderName: 'Private Prospect', subject: 'Private inquiry', snippet: 'Private pricing request', receivedAt: new Date() } });
    const outsider = await prisma.user.create({ data: { tenantId: otherTenant, email: randomUUID()+'@camxian.com', firstName: 'Other', lastName: 'Admin', role: 'Client Admin', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } });
    const foreignToken = (await issueAuthSession(outsider)).token;
    for (const endpoint of ['/status', '/inquiries']) {
      expect((await request('/integrations/business-email'+endpoint, 'GET', undefined, '')).status).toBe(401);
      expect((await request('/integrations/business-email'+endpoint, 'GET', undefined, denied)).status).toBe(403);
    }
    const foreignList = await request('/integrations/business-email/inquiries', 'GET', undefined, foreignToken);
    expect(foreignList.status).toBe(200); expect(JSON.stringify(foreignList.body)).not.toContain(sender);
    expect((await request('/integrations/business-email/inquiries/'+inquiry.id+'/review', 'POST', { action: 'dismiss' }, foreignToken)).status).toBe(404);
    expect((await request('/integrations/business-email/disconnect', 'POST', {}, denied)).status).toBe(403);
    expect((await prisma.businessEmailInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe('review');
    const status = await request('/integrations/business-email/status');
    expect(status.headers.get('cache-control')).toBe('no-store');
    for (const secret of ['accessToken', 'refreshToken', 'private-provider-token', 'private-refresh-token']) expect(JSON.stringify(status.body)).not.toContain(secret);
  });
  it('rejects OAuth callbacks for expired, revoked and idle sessions before contacting Google', async () => {
    const { finishBusinessEmail } = await import('../../../integrations/gmail/business-email.service');
    const { hashToken } = await import('../../../core/auth/session.service');
    const { encryptToken } = await import('../../../core/encryption/crypto.service');
    const { SESSION_IDLE_MS } = await import('@leadcrm/shared');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    for (const invalid of [{ revokedAt: new Date() }, { expiresAt: new Date(Date.now()-1000) }, { lastActiveAt: new Date(Date.now()-SESSION_IDLE_MS-1000) }]) {
      const session = await issueAuthSession(user), state = randomUUID();
      await prisma.session.update({ where: { tokenHash: hashToken(session.token) }, data: invalid });
      await prisma.businessEmailOAuthState.create({ data: { stateHash: hashToken(state), tenantId, userId, sessionHash: hashToken(session.token), verifier: encryptToken('disposable-verifier'), expiresAt: new Date(Date.now()+60000) } });
      const provider = vi.spyOn(globalThis, 'fetch');
      try {
        await expect(finishBusinessEmail(state, 'never-exchange-this-code')).rejects.toMatchObject({ statusCode: 401 });
        expect(provider).not.toHaveBeenCalled();
        await expect(finishBusinessEmail(state, 'replay')).rejects.toMatchObject({ statusCode: 400 });
      } finally { provider.mockRestore(); }
    }
  });
  it('rejects abusive public payloads and honeypots without storing Leads or exposing submitted data', async () => {
    const form = await publish((await draft()).id), answer = values();
    const path = '/public/forms/'+form.publicId+'/submissions';
    for (const [body, expected] of [[{ requestId: randomUUID(), version: 1, values: answer, website: 'bot' }, 400], [{ values: { private: 'x'.repeat(70000) } }, 413], [{ values: Array(10001).fill('x') }, 413]] as const) {
      const result = await request(path, 'POST', body, '');
      expect(result.status).toBe(expected); expect(JSON.stringify(result.body)).not.toContain(answer.email);
    }
    expect(await prisma.lead.count({ where: { tenantId, email: answer.email } })).toBe(0);
    expect(await prisma.formSubmission.count({ where: { formId: form.id } })).toBe(0);
  });
  it('rate limits anonymous submissions with 429', async () => {
    let status = 0;
    for (let i = 0; i < 22; i++) { status = (await request('/public/forms/' + randomUUID() + '/submissions', 'POST', { requestId: randomUUID(), version: 1, values: values() }, '')).status; if (status === 429) break; }
    expect(status).toBe(429);
  });
});
