import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
vi.mock('../../../shared/services/email.service', () => ({ sendMail: vi.fn().mockResolvedValue({ submitted: true }) }));
import prisma from '../../../config/database.config';
import app from '../../../app';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { dispatchAction } from '../../automation/actions/action-dispatcher';
import { resolveAudience } from '../../marketing/campaigns/audiences.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
describe.skipIf(url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_forms_test_2')('Normalized Products through database and HTTP', () => {
  let tenantId: string, otherTenant: string, actorId: string, token: string, server: Server, base: string;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Normalization acceptance', slug: randomUUID(), onboardingCompletedAt: new Date(), onboardingStep: 3 } });
    tenantId = tenant.id;
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other', slug: randomUUID() } })).id;
    const actor = await prisma.user.create({ data: { tenantId, email: 'normalization@camxian.com', firstName: 'Test', lastName: 'Admin', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    actorId = actor.id; token = (await issueAuthSession(actor)).token;
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('saves CCTV 25000, reloads it, creates separate 25000/15000 Deals, and freezes the older price', async () => {
    const cctv = await prisma.productInterest.create({ data: { tenantId, name: 'CCTV Surveillance System', dealValue: 0 } });
    const bio = await prisma.productInterest.create({ data: { tenantId, name: 'Biometrics', dealValue: 15000 } });
    const path = '/administration/product-interests/' + cctv.id;
    expect((await request(path, 'PATCH', { dealValue: 25000 })).status).toBe(200);
    expect((await prisma.productInterest.findUniqueOrThrow({ where: { id: cctv.id } })).dealValue.toFixed(2)).toBe('25000.00');
    expect((await request(path)).body.data.dealValue).toBe(25000);
    expect((await request('/administration/product-interests')).body.data.find((p: any) => p.id === cctv.id).dealValue).toBe(25000);
    const lead = await request('/crm/leads', 'POST', { firstName: 'Price', lastName: 'Snapshot', email: 'snapshot@example.test', productInterest: [cctv.id, bio.id] });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    expect(lead.body.data.productInterestIds).toEqual([cctv.id, bio.id]);
    expect(await prisma.leadProductInterest.count({ where: { leadId: lead.body.data.id } })).toBe(2);
    const deals = await prisma.deal.findMany({ where: { tenantId, leadDeals: { some: { leadId: lead.body.data.id } } }, orderBy: { value: 'desc' } });
    expect(deals.map(d => d.value)).toEqual([25000, 15000]);
    expect((await request(path, 'PATCH', { name: 'CCTV Renamed', dealValue: 30000 })).status).toBe(200);
    expect((await request('/crm/leads/' + lead.body.data.id)).body.data.productInterest).toEqual(['CCTV Renamed', 'Biometrics']);
    const audience = await tenantContext.run({ tenantId }, () => resolveAudience(tenantId, { source: 'LEADS', conditions: [{ field: 'productInterest', operator: 'equals', value: [cctv.id] }] }));
    expect(audience.breakdown.matched).toBe(1);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[0].id } })).value).toBe(25000);
    const next = await request('/crm/deals', 'POST', { title: 'Deal B', pipelineId: deals[0].pipelineId, stageId: deals[0].stageId, productInterestId: cctv.id, value: 1 });
    expect(next.status, JSON.stringify(next.body)).toBe(201); expect(next.body.data.value).toBe(30000);
    const copy = await request('/crm/deals/' + deals[0].id + '/duplicate', 'POST', {});
    expect(copy.status, JSON.stringify(copy.body)).toBe(201); expect(copy.body.data.value).toBe(30000);
    const legacy = await prisma.deal.create({ data: { tenantId, title: 'Legacy conflict', pipelineId: deals[0].pipelineId, stageId: deals[0].stageId,
      productInterestId: cctv.id, productInterestIds: [bio.id], productInterests: ['Biometrics'], value: 777 } });
    expect((await request('/crm/deals/' + legacy.id + '/duplicate', 'POST', {})).status).toBe(400);
    expect((await request('/crm/deals/' + legacy.id, 'PUT', { title: 'Historical context retained' })).status).toBe(200);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: legacy.id } })).value).toBe(777);
    expect(await tenantContext.run({ tenantId }, () => dispatchAction({ type: 'update_field', config: { field: 'value', value: 999 } }, { 'deal.id': deals[0].id }, tenantId, actorId))).toMatchObject({ success: false, error: expect.stringContaining('historical snapshots') });
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[0].id } })).value).toBe(25000);
    for (const value of ['₱25,000', '', null, -1, 1.001]) expect((await request(path, 'PATCH', { dealValue: value })).status).toBe(400);
    expect((await request(path)).body.data.dealValue).toBe(30000);
  });

  it('keeps Account interests and active Products distinct through create, edit and rename', async () => {
    const first = await prisma.productInterest.create({ data: { tenantId, name: 'Account interest', dealValue: 10 } });
    const second = await prisma.productInterest.create({ data: { tenantId, name: 'Account purchase', dealValue: 20 } });
    const created = await request('/crm/accounts', 'POST', { name: 'Normalized Account', productInterests: [first.name], activeProducts: [second.name] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ productInterests: [first.name], activeProducts: [second.name] });
    const updated = await request('/crm/accounts/' + id, 'PUT', { activeProducts: [first.name] });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data).toMatchObject({ productInterests: [first.name], activeProducts: [first.name] });
    const links = await prisma.accountProductInterest.findMany({ where: { accountId: id } });
    expect(links).toHaveLength(1); expect(links[0]).toMatchObject({ productInterestId: first.id, interested: true, activeProduct: true });
    await prisma.productInterest.update({ where: { id: first.id }, data: { name: 'Renamed Account Product' } });
    expect((await request('/crm/accounts/' + id)).body.data).toMatchObject({ productInterests: ['Renamed Account Product'], activeProducts: ['Renamed Account Product'] });
  });

  it('rejects foreign selections and preserves retired Product identity and nested projections', async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: 'Link checks', dealValue: 25 } });
    const foreign = await prisma.productInterest.create({ data: { tenantId: otherTenant, name: 'Foreign', dealValue: 0 } });
    const contact = await request('/crm/contacts', 'POST', { firstName: 'Linked', lastName: 'Contact', email: 'links@example.test', productInterests: [product.name] });
    expect(contact.status, JSON.stringify(contact.body)).toBe(201);
    const id = contact.body.data.id;
    expect(await prisma.contactProductInterest.count({ where: { contactId: id } })).toBe(1);
    expect((await request('/crm/leads', 'POST', { firstName: 'Foreign', lastName: 'Selection', email: 'foreign@example.test', productInterest: [foreign.id] })).status).toBe(400);
    await prisma.productInterest.update({ where: { id: product.id }, data: { name: 'Current catalog name', active: false } });
    const nested = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { contacts: { where: { id }, select: { productInterests: true } } } });
    expect(nested.contacts[0].productInterests).toEqual(['Current catalog name']);
    const replacement = await prisma.productInterest.create({ data: { tenantId, name: 'Current catalog name', dealValue: 50 } });
    expect((await request('/crm/contacts/' + id, 'PUT', { productInterests: ['Current catalog name'] })).status).toBe(200);
    expect(await prisma.contactProductInterest.count({ where: { contactId: id } })).toBe(1);
    expect((await prisma.contactProductInterest.findMany({ where: { contactId: id } })).map(p => p.productInterestId)).toEqual([product.id]);
    const fresh = await request('/crm/contacts', 'POST', { firstName: 'New', lastName: 'Selection', email: 'fresh@example.test', productInterests: [replacement.name] });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect((await prisma.contactProductInterest.findMany({ where: { contactId: fresh.body.data.id } })).map(p => p.productInterestId)).toEqual([replacement.id]);
  });
});
