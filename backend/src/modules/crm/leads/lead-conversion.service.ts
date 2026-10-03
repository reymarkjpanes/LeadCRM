import type { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../../shared/errors/http-error';

const companyIdentity = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Runs in the caller's serializable sales transaction. Original records and FKs are retained. */
export async function convertClosedLead(tx: Prisma.TransactionClient, tenantId: string, leadId: string, actorId: string) {
  const lead = await tx.lead.findFirst({ where: { tenantId, id: leadId } });
  if (!lead) throw new NotFoundError('Lead');
  if (lead.status !== 'Closed') throw new ConflictError('Persist Closed status before converting this Lead.');
  const deals = await tx.deal.findMany({ where: { tenantId, OR: [{ leadId }, { leadDeals: { some: { tenantId, leadId } } }] }, include: { stage: true } });
  const conflict = () => new ConflictError('Multiple, archived, or conflicting Contact/Account matches found. Resolve the CRM relationship before closing this Lead.');
  let contact = lead.contactId ? await tx.contact.findFirst({ where: { tenantId, id: lead.contactId } }) : null;
  if (lead.contactId && !contact) throw conflict();
  if (!contact && lead.email?.trim()) {
    const email = lead.email.trim().toLowerCase();
    const matches = (await tx.contact.findMany({ where: { tenantId, email: { contains: email, mode: 'insensitive' } } }))
      .filter(row => row.email?.trim().toLowerCase() === email);
    if (matches.length > 1) throw conflict();
    contact = matches[0] ?? null;
  }
  if (contact?.isArchived || contact?.deletedAt) throw conflict();
  if (lead.accountId && contact?.accountId && lead.accountId !== contact.accountId) throw conflict();
  let accountId = lead.accountId ?? contact?.accountId ?? null;
  if (!accountId) {
    const relatedAccounts = [...new Set(deals.map(deal => deal.accountId).filter((id): id is string => !!id))];
    if (relatedAccounts.length > 1) throw conflict();
    accountId = relatedAccounts[0] ?? null;
  }
  if (!accountId && lead.companyName?.trim()) {
    const name = lead.companyName.trim().replace(/\s+/g, ' ');
    const matches = (await tx.account.findMany({ where: { tenantId, name: { contains: name.split(' ')[0], mode: 'insensitive' } } }))
      .filter(row => companyIdentity(row.name) === companyIdentity(name));
    if (matches.length > 1 || matches[0]?.isArchived || matches[0]?.deletedAt) throw conflict();
    accountId = matches[0]?.id ?? (await tx.account.create({ data: { tenantId, name, assignedUserId: lead.assignedUserId,
      tags: [], productInterests: lead.productInterest, activeProducts: [] } })).id;
  }
  if (accountId && !await tx.account.findFirst({ where: { tenantId, id: accountId, isArchived: false, deletedAt: null } })) throw conflict();
  const now = new Date();
  if (!contact) contact = await tx.contact.create({ data: { tenantId, firstName: lead.firstName, lastName: lead.lastName,
    email: lead.email?.trim().toLowerCase(), phone: lead.phone, company: lead.companyName, address: lead.address,
    source: lead.source, notes: lead.description, assignedUserId: lead.assignedUserId, accountId,
    productInterests: lead.productInterest, activeProducts: [], status: 'CLOSED', lifecycleStage: 'CUSTOMER',
    customerType: 'Customer', customerSince: now, convertedAt: now, lastStatusChangedAt: now } });
  else contact = await tx.contact.update({ where: { tenantId, id: contact.id }, data: { accountId,
    status: 'CLOSED', lifecycleStage: 'CUSTOMER', customerType: 'Customer', customerSince: contact.customerSince ?? now,
    convertedAt: contact.convertedAt ?? now, lastStatusChangedAt: contact.status === 'CLOSED' ? contact.lastStatusChangedAt : now,
    productInterests: [...new Set([...contact.productInterests, ...lead.productInterest])] } });
  // Link every original Deal, including archived/terminal history, without changing its sales data.
  const activeProducts = [...new Set([...contact.activeProducts, ...deals.filter(d => d.stage.isWon).flatMap(d => d.productInterests)])];
  contact = await tx.contact.update({ where: { tenantId, id: contact.id }, data: { activeProducts } });
  for (const deal of deals) {
    await tx.contactDeal.upsert({ where: { contactId_dealId: { contactId: contact.id, dealId: deal.id } },
      create: { tenantId, contactId: contact.id, dealId: deal.id, addedById: actorId }, update: {} });
    await tx.deal.update({ where: { tenantId, id: deal.id }, data: {
      ...(!deal.contactId ? { contactId: contact.id } : {}), ...(!deal.accountId && accountId ? { accountId } : {}) } });
  }
  const convertedLead = await tx.lead.update({ where: { tenantId, id: leadId }, data: { contactId: contact.id, accountId,
    convertedAt: lead.convertedAt ?? now, convertedById: lead.convertedById ?? actorId } });
  if (!lead.convertedAt) {
    const metadata = { contactId: contact.id, accountId, convertedAt: now.toISOString(), sourceLeadId: leadId };
    await tx.activity.create({ data: { tenantId, leadId, createdById: actorId, type: 'conversion', title: 'Lead converted to Contact',
      description: 'Lead reached Closed status after successful sales completion.', metadata } });
    await tx.activity.create({ data: { tenantId, contactId: contact.id, createdById: actorId, type: 'conversion', title: 'Contact linked to converted Lead',
      description: 'Original Lead, email, activity and Deal history retained.', metadata } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'lead.converted', entityType: 'Lead', entityId: leadId, metadata } });
  }
  return { lead: convertedLead, contact, accountId };
}
