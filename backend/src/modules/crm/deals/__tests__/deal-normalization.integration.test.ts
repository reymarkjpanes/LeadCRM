import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { replayCrmMigrations } from '../../../../tests/replay-crm-migrations';
import { installTenantScoping } from '../../../../core/tenant/tenant-prisma';
import { tenantContext } from '../../../../core/tenant/tenant-context';

vi.mock('../../../../config/database.config', () => ({ default: new PrismaClient({ datasources: { db: { url: process.env.DEAL_NORMALIZATION_TEST_DATABASE_URL! } } }) }));
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient;
let update: typeof import('../deals.repository').updateDeal;
let contactList: typeof import('../../contacts-v2/contacts-v2.repository').findAllContacts;
beforeAll(async () => {
  pg = await PGlite.create(); await replayCrmMigrations(pg);
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
  process.env.DEAL_NORMALIZATION_TEST_DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  db = (await import('../../../../config/database.config')).default;
  installTenantScoping(db);
  update = (await import('../deals.repository')).updateDeal;
  contactList = (await import('../../contacts-v2/contacts-v2.repository')).findAllContacts;
  await db.tenant.createMany({ data: [{ id: 'tenant-a', name: 'A', slug: 'a' }, { id: 'tenant-b', name: 'B', slug: 'b' }] });
  await db.user.create({ data: { id: 'actor', tenantId: 'tenant-a', email: 'actor@camxian.com', firstName: 'Actor', lastName: 'Test', role: 'Client Admin' } });
  await db.pipeline.create({ data: { id: 'pipeline', tenantId: 'tenant-a', name: 'Sales' } });
  await db.stage.create({ data: { id: 'stage', tenantId: 'tenant-a', pipelineId: 'pipeline', name: 'Lead', order: 0 } });
  await db.lead.createMany({ data: ['old-lead', 'new-lead'].map(id => ({ id, tenantId: 'tenant-a', firstName: id, lastName: 'Test' })) });
  await db.contact.createMany({ data: [
    { id: 'old-contact', tenantId: 'tenant-a', firstName: 'Old', lastName: 'Test' },
    { id: 'new-contact', tenantId: 'tenant-a', firstName: 'New', lastName: 'Test' },
    { id: 'foreign-contact', tenantId: 'tenant-b', firstName: 'Foreign', lastName: 'Test' },
  ] });
  await db.deal.create({ data: { id: 'deal', tenantId: 'tenant-a', title: 'Original', pipelineId: 'pipeline', stageId: 'stage', leadDeals: { create: { leadId: 'old-lead', position: 0 } }, contactDeals: { create: { contactId: 'old-contact', position: 0 } }, value: 12500 } });
}, 60000);
afterAll(async () => { await db?.$disconnect(); await socket?.stop(); await pg?.close(); });

describe('normalized Deal writes', () => {
  it('rolls back scalar and contact edits when a later lead association fails', async () => {
    const before = await db.deal.findUniqueOrThrow({ where: { id: 'deal' } });
    await expect(update('deal', 'tenant-a', { title: 'Must roll back', contactIds: ['new-contact'], leadIds: ['missing-lead'] }, 'actor')).rejects.toThrow();
    expect(await db.deal.findUniqueOrThrow({ where: { id: 'deal' } })).toEqual(before);
    expect((await db.contactDeal.findMany()).map(row => row.contactId)).toEqual(['old-contact']);
    expect((await db.leadDeal.findMany()).map(row => row.leadId)).toEqual(['old-lead']);
  });
  it('rejects cross-tenant associations without partially updating the Deal', async () => {
    await expect(update('deal', 'tenant-a', { title: 'Foreign', contactIds: ['foreign-contact'] }, 'actor')).rejects.toThrow();
    expect((await db.deal.findUniqueOrThrow({ where: { id: 'deal' } })).title).toBe('Original');
  });
  it('commits multi-person junctions and their compatibility projections together', async () => {
    const saved = await update('deal', 'tenant-a', { title: 'Changed', contactIds: ['new-contact', 'old-contact'], leadIds: ['new-lead'] }, 'actor');
    expect(saved).toMatchObject({ title: 'Changed', leadId: 'new-lead', contactId: 'new-contact', value: 12500 });
    expect(saved?.contactDeals.map(link => link.contactId).sort()).toEqual(['new-contact', 'old-contact']);
    expect(saved?.leadDeals.map(link => link.leadId)).toEqual(['new-lead']);
  });
  it('clears legacy references when all junction links are removed', async () => {
    const saved = await update('deal', 'tenant-a', { contactIds: [], leadIds: [] }, 'actor');
    expect(saved).toMatchObject({ leadId: null, contactId: null, leadDeals: [], contactDeals: [], value: 12500 });
  });
  it('inherits scoped tenant ownership during nested creation and rejects foreign connections', async () => {
    const nested = await tenantContext.run({ tenantId: 'tenant-a' }, async () => await db.pipeline.create({
      data: { tenantId: 'tenant-b', name: 'Nested', stages: { create: { name: 'Scoped stage', order: 0 } } },
      include: { stages: true },
    }));
    expect(nested.tenantId).toBe('tenant-a');
    expect(nested.stages).toHaveLength(1);
    expect(nested.stages[0].tenantId).toBe('tenant-a');
    const foreign = await db.pipeline.create({
      data: { tenantId: 'tenant-b', name: 'Foreign', stages: { create: { name: 'Foreign stage', order: 0 } } },
      include: { stages: true },
    });
    await expect(tenantContext.run({ tenantId: 'tenant-a' }, async () => await db.pipeline.update({
      where: { id: nested.id }, data: { stages: { connect: { id: foreign.stages[0].id } } },
    }))).rejects.toThrow();
    expect(await db.stage.findUniqueOrThrow({ where: { id: foreign.stages[0].id } })).toMatchObject({ tenantId: 'tenant-b', pipelineId: foreign.id });
  });
});

it('paginates and filters Contact records and returns full-scope facets from the database', async () => {
  const createdAt = new Date('2026-10-01T00:00:00Z');
  await db.contact.createMany({ data: Array.from({ length: 125 }, (_, index) => ({
    id: `paged-${index}`, tenantId: 'tenant-a', firstName: 'Paged', lastName: String(index),
    assignedUserId: 'actor', status: 'COLD' as const, createdAt,
    updatedAt: index === 0 ? new Date('2026-10-02T00:00:00Z') : createdAt,
  })) });
  const all = await contactList('tenant-a', { page: 2, limit: 25, search: 'Paged' });
  expect(all.data).toHaveLength(25); expect(all.total).toBe(125);
  expect(all.facets).toMatchObject({ 'status:Cold': 125, 'owner:actor': 125, touched: 1, untouched: 124 });
  const touched = await contactList('tenant-a', { search: 'Paged', currentUserId: 'actor', filter: { scope: 'equals:my', status: 'in:Cold', system: 'in:touched' }, sort: 'createdAt:asc' });
  expect(touched.data.map(contact => contact.id)).toEqual(['paged-0']);
  await db.contactDeal.create({ data: { tenantId: 'tenant-a', dealId: 'deal', contactId: 'paged-0', position: 0 } });
  const linked = await contactList('tenant-a', { search: 'Paged', filter: { related: 'in:has_deals' } });
  expect(linked.data.map(contact => contact.id)).toEqual(['paged-0']);
  await db.deal.update({ where: { id: 'deal' }, data: { isArchived: true } });
  expect((await contactList('tenant-a', { search: 'Paged', filter: { related: 'in:has_deals' } })).data).toEqual([]);
});

it('Contact merge preserves conversion, Deal projections and Inbox history on the survivor', async () => {
  const { execute } = await import('../../merge/merge.service');
  await db.contact.createMany({ data: ['merge-primary', 'merge-secondary'].map(id => ({ id, tenantId: 'tenant-a', firstName: id, lastName: 'Merge' })) });
  await db.lead.create({ data: { id: 'converted-merge', tenantId: 'tenant-a', firstName: 'Converted', lastName: 'Merge', contactId: 'merge-secondary', convertedAt: new Date() } });
  await db.deal.create({ data: { id: 'merge-deal', tenantId: 'tenant-a', title: 'Merge Deal', pipelineId: 'pipeline', stageId: 'stage', contactDeals: { create: [
    { contactId: 'merge-secondary', position: 0 }, { contactId: 'merge-primary', position: 1 },
  ] } } });
  await db.emailAccount.create({ data: { id: 'merge-mailbox', tenantId: 'tenant-a', userId: 'actor', email: 'actor@camxian.com', accessToken: 'disposable-not-a-provider-token', scopes: [] } });
  await db.mailboxMessage.create({ data: { id: 'merge-message', tenantId: 'tenant-a', accountId: 'merge-mailbox', providerMessageId: 'test-message', threadId: 'test-thread', direction: 'inbound', from: 'customer@example.com', recipients: ['actor@camxian.com'], subject: 'History', body: 'History', snippet: 'History', labels: [], sentAt: new Date(), contactId: 'merge-secondary' } });
  const sourceBeforeMerge = await db.contact.findUniqueOrThrow({ where: { id: 'merge-secondary' } });
  await execute({ tenantId: 'tenant-a', userId: 'actor', entityType: 'contact', primaryId: 'merge-primary', secondaryId: 'merge-secondary', fieldResolutions: {} });
  expect(await db.contact.findUniqueOrThrow({ where: { id: 'merge-secondary' } })).toMatchObject({ isArchived: true, deletedBy: 'actor', status: sourceBeforeMerge.status });
  expect(await db.lead.findUniqueOrThrow({ where: { id: 'converted-merge' } })).toMatchObject({ contactId: 'merge-primary' });
  expect(await db.contactDeal.findMany({ where: { dealId: 'merge-deal' } })).toHaveLength(1);
  const linkedDeal = await (await import('../deals.repository')).findDealById('merge-deal', 'tenant-a');
  expect(linkedDeal).toMatchObject({ contactId: 'merge-primary' });
  expect(await db.mailboxMessage.findUniqueOrThrow({ where: { id: 'merge-message' } })).toMatchObject({ contactId: 'merge-primary', body: 'History' });
  expect(await db.emailAccount.findUniqueOrThrow({ where: { id: 'merge-mailbox' } })).toMatchObject({ mailboxVersion: 1 });
});

it('Account merge rejects the same account and preserves customer links when merging distinct accounts', async () => {
  const { execute } = await import('../../merge/merge.service');
  await db.account.createMany({ data: ['account-primary', 'account-secondary'].map(id => ({ id, tenantId: 'tenant-a', name: id })) });
  const input = { tenantId: 'tenant-a', userId: 'actor', entityType: 'account' as const, primaryId: 'account-primary', secondaryId: 'account-primary', fieldResolutions: {} };
  await expect(execute(input)).rejects.toThrow('different Accounts');
  expect(await db.account.findUniqueOrThrow({ where: { id: 'account-primary' } })).toMatchObject({ isArchived: false });
  await db.contact.update({ where: { id: 'merge-primary' }, data: { accountId: 'account-secondary' } });
  await execute({ ...input, secondaryId: 'account-secondary' });
  expect(await db.contact.findUniqueOrThrow({ where: { id: 'merge-primary' } })).toMatchObject({ accountId: 'account-primary' });
  expect(await db.account.findUniqueOrThrow({ where: { id: 'account-secondary' } })).toMatchObject({ isArchived: true, deletedBy: 'actor' });
  expect(await db.auditLog.count({ where: { tenantId: 'tenant-a', action: 'account.merged', entityId: 'account-primary' } })).toBe(1);
});
