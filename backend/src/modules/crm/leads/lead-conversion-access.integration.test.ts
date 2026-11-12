import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Prisma } from '@prisma/client';
import { EMPTY_PERMISSION_FLAGS } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import app from '../../../app';
import { issueAuthSession } from '../../../core/auth/auth-session';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/leadcrm_forms_test_2';
describe.skipIf(!disposable)('Lead conversion Account linking with authenticated PostgreSQL sessions', () => {
  let server: Server, base: string, tenantId: string, foreignTenant: string;
  let a: Awaited<ReturnType<typeof person>>, b: typeof a, admin: typeof a;
  let productId: string, priorProductId: string, pipelineId: string, stageId: string;
  const convertedAt = new Date('2026-10-01T08:00:00Z');

  async function person(name: string, clientAdmin = false) {
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: clientAdmin ? 'Client Admin' : name,
      crmAssignmentRestricted: !clientAdmin, isSystemRole: clientAdmin, permissions: { create: ['leads', 'contacts', 'accounts', 'deals'].map(module =>
        ({ module, ...EMPTY_PERMISSION_FLAGS, canView: true, canViewAll: true, canEdit: true, canCreate: true, canArchive: true })) } } });
    const user = await prisma.user.create({ data: { tenantId, role: role.name, email: `${randomUUID()}@camxian.com`, firstName: name, lastName: 'QA',
      mustChangePassword: false, onboardingCompletedAt: new Date(), userRoles: { create: { roleId: role.id } } } });
    return { ...user, roleId: role.id, token: (await issueAuthSession(user)).token };
  }
  async function call(path: string, body: unknown = {}, actor = a, method = 'POST') {
    const response = await fetch(`${base}/crm${path}`, { method, headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const convert = (id: string, body: unknown = {}, actor = a) => call(`/leads/${id}/convert`, body, actor);
  const lead = (extra: Partial<Prisma.LeadUncheckedCreateInput> = {}) => prisma.lead.create({ data: {
    tenantId, firstName: 'Conversion', lastName: 'Customer', email: `${randomUUID()}@example.test`, status: 'Warm', assignedUserId: a.id,
    productsNormalized: true, productLinks: { create: { productInterestId: productId, position: 0 } }, ...extra,
  } });
  const account = (extra: Partial<Prisma.AccountUncheckedCreateInput> = {}) => prisma.account.create({ data: {
    tenantId, name: `Existing ${randomUUID()}`,  industry: 'Technology', address: 'Makati', notes: 'Preserve this Account',
      ...extra,
  } });
  const contact = (accountId: string | null, extra: Partial<Prisma.ContactUncheckedCreateInput> = {}) => prisma.contact.create({ data: {
    tenantId, firstName: 'Existing', lastName: 'Contact', email: `${randomUUID()}@example.test`, assignedUserId: a.id, accountId, convertedAt,
    productsNormalized: true, productLinks: { create: { productInterestId: productId, position: 4, interested: true, activeProduct: true } }, ...extra,
  } });
  const deal = (leadId: string, extra: Partial<Prisma.DealUncheckedCreateInput> = {}) => prisma.deal.create({ data: {
    tenantId, title: 'Preserved original Deal', pipelineId, stageId, assignedUserId: a.id, ownerId: b.id, value: 100, currency: 'PHP',
    productInterestId: productId, productsNormalized: true, leadDeals: { create: { leadId } }, ...extra,
  } });
  async function snapshot() {
    return Promise.all([
      prisma.lead.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      prisma.contact.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      prisma.account.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      prisma.deal.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
      ...['leadProductInterest', 'contactProductInterest', 'leadDeal', 'contactDeal', 'activity', 'auditLog',
        'dealStageHistory', 'notificationEvent', 'notificationDelivery', 'workflowTriggerRecord', 'workflowExecutionRun'].map(async model =>
        (await (prisma as any)[model].findMany({ where: { tenantId } })).map((row: unknown) => JSON.stringify(row)).sort()),
    ]);
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Conversion authorization QA', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    foreignTenant = (await prisma.tenant.create({ data: { name: 'Foreign conversion QA', slug: randomUUID() } })).id;
    a = await person('Conversion Sales A'); b = await person('Conversion Sales B'); admin = await person('Admin', true);
    productId = (await prisma.productInterest.create({ data: { tenantId, name: 'Lead Product', dealValue: 100 } })).id;
    priorProductId = (await prisma.productInterest.create({ data: { tenantId, name: 'Existing Account Product', dealValue: 250 } })).id;
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Conversion pipeline' } })).id;
    stageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Qualified', order: 0 } })).id;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  }, 60000);
  afterAll(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await prisma.$disconnect(); });

  it('links a tenant Account without Account edit permission or Account changes', async () => {
    const existing = await account();
    const source = await lead();
    const accountBefore = await prisma.account.findUniqueOrThrow({ where: { id: existing.id } });
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'accounts' }, data: { canEdit: false } });
    try {
      const result = await convert(source.id, { accountId: existing.id });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.data.contact).toMatchObject({ assignedUserId: a.id, accountId: existing.id, productInterests: ['Lead Product'] });
      expect(await prisma.contactProductInterest.findMany({ where: { contactId: result.body.data.contact.id } })).toMatchObject([{ productInterestId: productId, interested: true }]);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(accountBefore);
      expect((await call(`/accounts/${existing.id}`, { name: 'Forbidden edit' }, a, 'PUT')).status).toBe(403);
    } finally { await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'accounts' }, data: { canEdit: true } }); }
    expect((await call(`/accounts/${existing.id}`, { name: 'Granted module edit' }, a, 'PUT')).status).toBe(200);
  });
  it('reuses a matching existing company without merging or reassigning its Account', async () => {
    const existing = await account();
    const before = await prisma.account.findUniqueOrThrow({ where: { id: existing.id } });
    const source = await lead({ companyName: `  ${existing.name.toUpperCase()}  ` });
    const result = await convert(source.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.contact.accountId).toBe(existing.id);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(before);
  });
  it('creates an Account without assignment or products and retains the Lead assignment and canonical Product ID on its Contact', async () => {
    const retired = await prisma.productInterest.create({ data: { tenantId, name: 'Retired conversion product', active: false, dealValue: 50 } });
    await prisma.productInterest.create({ data: { tenantId, name: retired.name, active: true, dealValue: 75 } });
    const source = await lead({ companyName: `New ${randomUUID()}`, productLinks: { create: { productInterestId: retired.id } } });
    const result = await convert(source.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.account).not.toHaveProperty('assignedUserId');
    expect(result.body.data.account).not.toHaveProperty('productInterests');
    expect(result.body.data.contact.assignedUserId).toBe(a.id);
    expect(await prisma.contactProductInterest.findMany({ where: { contactId: result.body.data.contact.id } })).toMatchObject([{ productInterestId: retired.id, interested: true, activeProduct: false }]);
  });
  it('preserves original Deal ownership, stage, product, history and Lead association while adding authorized links', async () => {
    const existing = await account(); const source = await lead({ address: 'Original personal address' }); const original = await deal(source.id, { addressSource: { type: 'lead', id: source.id }, address: 'Project override' });
    const histories = await prisma.dealStageHistory.findMany({ where: { dealId: original.id }, orderBy: { id: 'asc' } });
    const result = await convert(source.id, { accountId: existing.id });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const saved = await prisma.deal.findUniqueOrThrow({ where: { id: original.id } });
    expect({ ...saved, accountId: original.accountId, updatedAt: original.updatedAt }).toEqual(original);
    expect(saved.accountId).toBe(existing.id);
    expect(await prisma.dealStageHistory.findMany({ where: { dealId: original.id }, orderBy: { id: 'asc' } })).toEqual(histories);
    expect(await prisma.leadDeal.count({ where: { leadId: source.id, dealId: original.id } })).toBe(1);
    expect(await prisma.contactDeal.count({ where: { contactId: result.body.data.contact.id, dealId: original.id } })).toBe(1);
  });
  it('skips satisfied Contact and Deal writes despite other-agent ownership and missing edit grants', async () => {
    const existing = await account(); const target = await contact(existing.id, { assignedUserId: b.id });
    const source = await lead(); const original = await deal(source.id, { assignedUserId: b.id, accountId: existing.id });
    await prisma.contactDeal.create({ data: { tenantId, contactId: target.id, dealId: original.id, addedById: b.id } });
    const contactBefore = await prisma.contact.findUniqueOrThrow({ where: { id: target.id } });
    const productBefore = await prisma.contactProductInterest.findMany({ where: { contactId: target.id } });
    const linkBefore = await prisma.contactDeal.findMany({ where: { dealId: original.id } });
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: { in: ['contacts', 'deals'] } }, data: { canEdit: false } });
    try {
      const result = await convert(source.id, { contactId: target.id, accountId: existing.id });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(await prisma.contact.findUniqueOrThrow({ where: { id: target.id } })).toEqual(contactBefore);
      expect(await prisma.contactProductInterest.findMany({ where: { contactId: target.id } })).toEqual(productBefore);
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
      expect(await prisma.contactDeal.findMany({ where: { dealId: original.id } })).toEqual(linkBefore);
    } finally { await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: { in: ['contacts', 'deals'] } }, data: { canEdit: true } }); }
  });
  it('merges Lead Product Interests into an editable existing Contact while preserving its prior products and assignment', async () => {
    const existing = await account(); const target = await contact(existing.id, { productLinks: { create: { productInterestId: priorProductId, activeProduct: true } } });
    const source = await lead();
    const result = await convert(source.id, { contactId: target.id, accountId: existing.id });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.contact).toMatchObject({ id: target.id, assignedUserId: a.id });
    const products = await prisma.contactProductInterest.findMany({ where: { contactId: target.id } });
    expect(products.map(row => row.productInterestId).sort()).toEqual([productId, priorProductId].sort());
    expect(products.find(row => row.productInterestId === priorProductId)?.activeProduct).toBe(true);
  });
  it.each(['products', 'account', 'conversion details'])('denies an actual other-agent Contact %s update and rolls back', async operation => {
    const existing = await account();
    const target = await contact(operation === 'account' ? null : existing.id, { assignedUserId: b.id,
      ...(operation === 'products' ? { productLinks: { create: { productInterestId: priorProductId } } } : {}),
      ...(operation === 'conversion details' ? { convertedAt: null } : {}),
    });
    const source = await lead(); const before = await snapshot();
    const result = await convert(source.id, { contactId: target.id, accountId: existing.id });
    // Out-of-scope records are intentionally hidden to prevent record-ID probing.
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Record not found.');
    expect(await snapshot()).toEqual(before);
  });
  it.each(['participant', 'account'])('denies a necessary other-agent Deal %s change and atomically rolls back', async operation => {
    const existing = await account(); const source = await lead({ companyName: `Rollback ${randomUUID()}` });
    const original = await deal(source.id, { assignedUserId: b.id, accountId: operation === 'participant' ? existing.id : null });
    let target;
    if (operation === 'account') {
      target = await contact(existing.id);
      await prisma.contactDeal.create({ data: { tenantId, contactId: target.id, dealId: original.id } });
    }
    const before = await snapshot();
    const result = await convert(source.id, { accountId: existing.id, ...(target ? { contactId: target.id } : {}) });
    // A Deal outside the caller's ownership scope is indistinguishable from a missing Deal.
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Record not found.');
    expect(await snapshot()).toEqual(before);
  });
  it('rolls back a newly created Account and Contact when a later Deal link is denied', async () => {
    const source = await lead({ companyName: `Rollback new Account ${randomUUID()}` });
    await deal(source.id, { assignedUserId: b.id }); const before = await snapshot();
    expect((await convert(source.id)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.account.count({ where: { tenantId, name: source.companyName! } })).toBe(0);
  });
  it.each(['missing', 'foreign', 'archived', 'deleted'])('rejects a %s Account before any conversion changes', async kind => {
    const accountId = kind === 'missing' ? randomUUID() : (await account(kind === 'foreign'
      ? { tenantId: foreignTenant }
      : kind === 'archived' ? { isArchived: true } : { deletedAt: new Date() })).id;
    const source = await lead(); const before = await snapshot();
    const result = await convert(source.id, { accountId });
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Active Account not found');
    expect(await snapshot()).toEqual(before);
  });
  it('denies conversion of another-agent Lead and revoked Lead edit permission without side effects', async () => {
    const source = await lead({ assignedUserId: b.id }); const before = await snapshot();
    expect((await convert(source.id)).status).toBe(404); expect(await snapshot()).toEqual(before);
    const own = await lead();
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'leads' }, data: { canEdit: false } });
    const ownBefore = await snapshot();
    try { expect((await convert(own.id)).status).toBe(403); expect(await snapshot()).toEqual(ownBefore); }
    finally { await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module: 'leads' }, data: { canEdit: true } }); }
  });
  it('requires existing Account view and Contact create permissions', async () => {
    for (const [module, flag] of [['accounts', 'canView'], ['contacts', 'canCreate']] as const) {
      const existing = await account(); const source = await lead();
      await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module }, data: { [flag]: false } });
      const before = await snapshot();
      try { expect((await convert(source.id, { accountId: existing.id })).status).toBe(403); expect(await snapshot()).toEqual(before); }
      finally { await prisma.rolePermission.updateMany({ where: { tenantId, roleId: a.roleId, module }, data: { [flag]: true } }); }
    }
  });
  it('retains Client Admin access without reassigning the existing Account or Contact', async () => {
    const existing = await account(); const target = await contact(existing.id, { assignedUserId: b.id, productLinks: { create: { productInterestId: priorProductId } } });
    const source = await lead({ assignedUserId: b.id });
    const result = await convert(source.id, { contactId: target.id, accountId: existing.id }, admin);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.contact.assignedUserId).toBe(b.id);
    expect(result.body.data.account).not.toHaveProperty('assignedUserId');
  });
  it('deduplicates simultaneous conversion and later retries, retaining one Contact, Account and conversion audit', async () => {
    const source = await lead({ companyName: `Concurrent ${randomUUID()}` });
    const results = await Promise.all([convert(source.id), convert(source.id)]);
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(results[0].body.data.contact.id).toBe(results[1].body.data.contact.id);
    const before = await snapshot();
    expect((await convert(source.id, { accountId: randomUUID(), contactId: randomUUID() })).status).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.contact.count({ where: { tenantId, email: source.email } })).toBe(1);
    expect(await prisma.account.count({ where: { tenantId, name: source.companyName! } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: source.id, action: 'lead.converted' } })).toBe(1);
  });
});
