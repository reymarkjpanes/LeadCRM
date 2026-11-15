import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { STAFF_PHONE_CONFLICT } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import app from '../../app';
import { issueAuthSession } from '../../core/auth/auth-session';
import { salesPipeline, salesTransaction } from './leads/lead-automation.service';
import { assertExternalCustomerPhone } from './record-validation';
import { validateImportRow } from './imports/import-rows.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
describe.skipIf(url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_forms_test_2')('CRM phone and product metadata on disposable PostgreSQL', () => {
  let tenantId: string, actorId: string, token: string, editorId: string, editorToken: string, deniedToken: string, base: string, server: Server;
  const request = async (path: string, method = 'GET', body?: unknown, auth = token) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Phone category QA', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } })).id;
    for (const name of ['Client Admin', 'Phone Editor', 'No Access']) {
      const role = await prisma.roleDefinition.create({ data: { tenantId, name, isSystemRole: name === 'Client Admin',
        permissions: name === 'Phone Editor' ? { create: ['leads', 'contacts', 'deals'].map(module => ({ module, canView: true, canViewAll: true, canEdit: true })) } : undefined } });
      const user = await prisma.user.create({ data: { tenantId, firstName: name, lastName: 'QA', email: randomUUID() + '@camxian.com', role: name,
        mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId: role.id } } } });
      const session = await issueAuthSession(user);
      if (name === 'Client Admin') { token = session.token; actorId = user.id; }
      else if (name === 'Phone Editor') { editorToken = session.token; editorId = user.id; }
      else deniedToken = session.token;
    }
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });

  it.each(['+639171234567', '0917 123 4567', '917-123-4567'])('normalizes stored staff phone %s and includes inactive hidden staff', async phone => {
    const staff = await prisma.user.create({ data: { tenantId, firstName: 'Hidden', lastName: 'Staff', role: 'No Access', status: 'INACTIVE', email: randomUUID() + '@camxian.com', phone } });
    try {
      const result = await request('/crm/phone-availability?module=leads&phone=%2B639171234567', 'GET', undefined, editorToken);
      expect(result).toMatchObject({ status: 200, body: { success: true, data: { available: false, reason: 'STAFF_PHONE_NOT_ALLOWED' } } });
      expect(Object.keys(result.body.data).sort()).toEqual(['available', 'reason']);
      await expect(assertExternalCustomerPhone(prisma, tenantId, '9171234567')).rejects.toMatchObject({ issues: [{ path: ['phone'], message: STAFF_PHONE_CONFLICT }] });
    } finally { await prisma.user.delete({ where: { id: staff.id } }); }
  });

  it('requires module create/edit, accepts optional empty, isolates tenants and never truncates comparison', async () => {
    expect((await request('/crm/phone-availability?module=contacts&phone=9171234567', 'GET', undefined, deniedToken)).status).toBe(403);
    expect((await request('/crm/phone-availability?module=contacts&phone=')).body.data).toEqual({ available: true });
    const foreign = await prisma.tenant.create({ data: { name: 'Foreign phone', slug: randomUUID() } });
    await prisma.user.create({ data: { tenantId: foreign.id, firstName: 'Foreign', lastName: 'Staff', role: 'Custom', email: randomUUID() + '@camxian.com', phone: '+639181234567' } });
    expect((await request('/crm/phone-availability?module=contacts&phone=9181234567', 'GET', undefined, editorToken)).body.data).toEqual({ available: true });
    await prisma.user.create({ data: { tenantId, firstName: 'Legacy', lastName: 'Too long', role: 'Custom', email: randomUUID() + '@camxian.com', phone: '+6391812345678' } });
    await expect(assertExternalCustomerPhone(prisma, tenantId, '+639181234567')).resolves.toBeUndefined();
  });

  it.each(['leads', 'contacts'])('enforces %s create/edit, late conflicts and rollback without staff directory permission', async module => {
    const payload = { requestId: randomUUID(), firstName: 'Customer', lastName: 'Phone', email: randomUUID() + '@example.test', phone: '+639191234567' };
    expect((await request(`/crm/phone-availability?module=${module}&phone=9191234567`)).body.data.available).toBe(true);
    const created = await request('/crm/' + module, 'POST', payload);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const staff = await prisma.user.create({ data: { tenantId, firstName: 'Late', lastName: 'Staff', role: 'No Access', email: randomUUID() + '@camxian.com', phone: '09191234567' } });
    const failed = await request('/crm/' + module, 'POST', { ...payload, requestId: randomUUID(), email: randomUUID() + '@example.test', newAccount: { requestId: randomUUID(), name: 'Must roll back ' + module } });
    expect(failed).toMatchObject({ status: 400, body: { fieldErrors: { phone: [STAFF_PHONE_CONFLICT] } } });
    expect(await prisma.account.count({ where: { tenantId, name: 'Must roll back ' + module } })).toBe(0);
    const unchanged = await request(`/crm/${module}/${id}`, 'PUT', { firstName: 'Should fail' }, editorToken);
    expect(unchanged).toMatchObject({ status: 400, body: { fieldErrors: { phone: [STAFF_PHONE_CONFLICT] } } });
    const fixed = await request(`/crm/${module}/${id}`, 'PUT', { phone: '9201234567' }, editorToken);
    expect(fixed.status).toBe(200); expect(fixed.body.data.phone).toBe('+639201234567');
    expect((await request(`/crm/${module}/${id}`, 'PUT', { firstName: 'Allowed edit' }, editorToken)).status).toBe(200);
    expect((await request(`/crm/${module}/${id}`, 'PUT', { phone: '' }, editorToken)).status).toBe(200);
    await prisma.user.delete({ where: { id: staff.id } });
  });

  it.each(['leads', 'contacts'].flatMap(module => ['invalid', '+639123', '+6391234567890', '8123456789'].map(phone => ({ module, phone }))))('rejects malformed $module phone $phone on create and edit', async ({ module, phone }) => {
    const data = { requestId: randomUUID(), firstName: 'Invalid', lastName: 'Phone', email: randomUUID() + '@example.test', phone };
    expect((await request('/crm/' + module, 'POST', data)).status).toBe(400);
    const created = await request('/crm/' + module, 'POST', { ...data, requestId: randomUUID(), phone: '' });
    expect(created.status).toBe(201);
    expect((await request(`/crm/${module}/${created.body.data.id}`, 'PUT', { phone })).status).toBe(400);
  });

  it('projects canonical categories for Lead, Contact and Deal, including inactive products and reused names', async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: 'Retained CCTV', category: 'Security', dealValue: 100, active: false } });
    await prisma.productInterest.create({ data: { tenantId, name: 'Retained CCTV', category: 'Wrong replacement', dealValue: 200 } });
    const blank = await prisma.productInterest.create({ data: { tenantId, name: 'Legacy blank', category: '', dealValue: 0 } });
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Product', lastName: 'Lead', assignedUserId: editorId, productsNormalized: true,
      productLinks: { create: [{ productInterestId: product.id, position: 0 }, { productInterestId: blank.id, position: 1 }] } } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Product', lastName: 'Contact', assignedUserId: editorId, productsNormalized: true,
      productLinks: { create: [{ productInterestId: product.id, position: 0, interested: true }, { productInterestId: blank.id, position: 1, interested: false, activeProduct: true }] } } });
    const pipeline = await salesTransaction(tx => salesPipeline(tx, tenantId));
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Product Deal', assignedUserId: editorId, pipelineId: pipeline.pipeline.id, stageId: pipeline.initial.id, productInterestId: product.id, productsNormalized: true } });
    for (const [module, record] of [['leads', lead], ['contacts', contact], ['deals', deal]] as const) {
      const result = await request(`/crm/${module}/${record.id}`);
      expect(result.status).toBe(200);
      expect(result.body.data.productInterestRecords).toEqual(module === 'leads'
        ? [{ id: product.id, name: product.name, category: 'Security' }, { id: blank.id, name: blank.name, category: '' }]
        : [{ id: product.id, name: product.name, category: 'Security' }]);
      const staffRead = await request(`/crm/${module}/${record.id}`, 'GET', undefined, editorToken);
      expect(staffRead.status).toBe(200);
      expect(staffRead.body.data.productInterestRecords).toEqual(result.body.data.productInterestRecords);
    }
  });

  it.each(['lead', 'contact'] as const)('rejects staff phones in %s imports and merges without partial writes', async entityType => {
    const phone = entityType === 'lead' ? '+639211234567' : '+639221234567';
    await prisma.user.create({ data: { tenantId, firstName: 'Staff', lastName: entityType, role: 'No Access', email: randomUUID() + '@camxian.com', phone } });
    const checked = await validateImportRow(prisma, entityType === 'lead' ? 'leads' : 'contacts', tenantId, { data: { firstName: 'Import', lastName: 'Phone', email: randomUUID() + '@example.test', phone, companyName: 'Company', address: 'Street' } });
    expect(checked.isValid).toBe(false); expect(JSON.stringify(checked.errors)).toContain(STAFF_PHONE_CONFLICT);
    const data = { tenantId, firstName: 'Merge', lastName: entityType, phone };
    const primary = entityType === 'lead' ? await prisma.lead.create({ data }) : await prisma.contact.create({ data });
    const secondary = entityType === 'lead' ? await prisma.lead.create({ data: { ...data, phone: null } }) : await prisma.contact.create({ data: { ...data, phone: null } });
    const merged = await request('/crm/merge', 'POST', { entityType, primaryId: primary.id, secondaryId: secondary.id, fieldResolutions: { phone: 'primary' } });
    expect(merged).toMatchObject({ status: 400, body: { fieldErrors: { phone: [STAFF_PHONE_CONFLICT] } } });
    const stored = entityType === 'lead' ? await prisma.lead.findUniqueOrThrow({ where: { id: secondary.id } }) : await prisma.contact.findUniqueOrThrow({ where: { id: secondary.id } });
    expect(stored.isArchived).toBe(false);
  });

  it('rejects conversion of a legacy Lead with a staff phone before creating a Contact', async () => {
    const phone = '+639231234567';
    await prisma.user.create({ data: { tenantId, firstName: 'Conversion', lastName: 'Staff', role: 'No Access', email: randomUUID() + '@camxian.com', phone } });
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Convert', lastName: 'Phone', email: randomUUID() + '@example.test', phone } });
    const before = await prisma.contact.count({ where: { tenantId } });
    const result = await request(`/crm/leads/${lead.id}/convert`, 'POST', { skipAccountCreation: true });
    expect(result).toMatchObject({ status: 400, body: { fieldErrors: { phone: [STAFF_PHONE_CONFLICT] } } });
    expect(await prisma.contact.count({ where: { tenantId } })).toBe(before);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedAt).toBeNull();
  });
});
