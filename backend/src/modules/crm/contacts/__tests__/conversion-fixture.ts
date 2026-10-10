import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { randomUUID } from 'node:crypto';
import { replayCrmMigrations } from '../../../../tests/replay-crm-migrations';
import { installProductProjections } from '../../../../core/tenant/product-projections';
import { installTenantScoping } from '../../../../core/tenant/tenant-prisma';

export async function conversionFixture() {
  const pg = await PGlite.create(); await replayCrmMigrations(pg);
  const socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
  process.env.CONVERSION_TEST_DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
  const db = (await import('../../../../config/database.config')).default;
  installProductProjections(db); installTenantScoping(db);
  const { convertContact, getContacts } = await import('../contacts.service');
  await db.tenant.createMany({ data: [{ id: 'conversion', name: 'Conversion', slug: 'conversion' }, { id: 'foreign', name: 'Foreign', slug: 'foreign' }] });
  await db.user.create({ data: { id: 'actor', tenantId: 'conversion', email: 'actor@example.test', firstName: 'Actor', lastName: 'Test', role: 'Client Admin' } });
  await db.pipeline.create({ data: { id: 'p', tenantId: 'conversion', name: 'Sales' } });
  await db.stage.createMany({ data: [{ id: 'open', pipelineId: 'p', tenantId: 'conversion', name: 'Lead', order: 0 }, { id: 'won', pipelineId: 'p', tenantId: 'conversion', name: 'Closed Won', order: 1, isWon: true }] });
  await db.productInterest.create({ data: { id: 'product', tenantId: 'conversion', name: 'CRM Enterprise', dealValue: 12500 } });
  const inquiry = async (companyName = 'Customer company', won = true) => {
    const id = randomUUID();
    const lead = await db.lead.create({ data: { tenantId: 'conversion', firstName: 'John', lastName: 'Smith', email: `${id}@example.test`, phone: '+639000000001', companyName,
      address: 'Makati', source: 'Website', assignedUserId: 'actor', status: 'Warm', productsNormalized: true,
      productLinks: { create: { productInterestId: 'product', position: 0 } } } });
    await db.closingFieldDefinition.upsert({ where: { tenantId_id: { tenantId: 'conversion', id: 'retired-lead-description' } }, create: { tenantId: 'conversion', id: 'retired-lead-description', definition: { id: 'retired-lead-description', active: false, module: 'leads' } }, update: {} });
    await db.customFieldValue.create({ data: { tenantId: 'conversion', leadId: lead.id, fieldId: 'retired-lead-description', module: 'leads', value: 'Original inquiry' } });
    const deal = await db.deal.create({ data: { tenantId: 'conversion', title: 'Original sale', pipelineId: 'p', stageId: won ? 'won' : 'open',
      wonConfirmedAt: won ? new Date() : null, hasEverBeenWon: won, wonHistoryVerified: true, value: 12500, productInterestId: 'product', productsNormalized: true,
      leadDeals: { create: { leadId: lead.id, position: 0 } } } });
    return { lead, deal };
  };
  const convert = (id: string, extra: Record<string, unknown> = {}) => convertContact(id, 'conversion', 'actor', { createContact: true, createDeal: false, ...extra } as never);
  return { db, inquiry, convert, getContacts, close: async () => { await db.$disconnect(); await socket.stop(); await pg.close(); } };
}
