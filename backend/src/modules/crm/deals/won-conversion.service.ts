import type { Deal, Prisma } from '@prisma/client';
import { crmScope } from '../leads/lead-automation.service';
import { changeCustomerStatus } from '../engagement.service';
import { ConflictError } from '../../../shared/errors/http-error';

/** Called inside the same serializable transaction as the actual Won transition. */
export async function resolveWonRelationships(tx: Prisma.TransactionClient, deal: Deal, actorId: string) {
  const scope = crmScope(deal.tenantId);
  const links = await tx.leadDeal.findMany({ where: { ...scope, dealId: deal.id } });
  const leadIds = [...new Set([deal.leadId, ...links.map(link => link.leadId)].filter((id): id is string => !!id))];
  const leads = await tx.lead.findMany({ where: { ...scope, id: { in: leadIds } } });
  let accountId = deal.accountId;
  const conflict = () => new ConflictError('Multiple or archived matching records found. Resolve the Contact/Account association before marking this Deal won.');
  for (const lead of leads) {
    await changeCustomerStatus(tx, deal.tenantId, actorId, { leadId: lead.id }, 'Closed', 'All configured Closed Won requirements completed and validated.', new Date());
    const converted = await tx.lead.findFirstOrThrow({ where: { ...scope, id: lead.id } });
    accountId ??= converted.accountId;
  }
  // Retain legacy singular Contact associations alongside the junction model.
  if (deal.contactId) {
    const contact = await tx.contact.findFirst({ where: { ...scope, id: deal.contactId, isArchived: false } });
    if (!contact) throw conflict();
    await tx.contactDeal.upsert({ where: { contactId_dealId: { contactId: contact.id, dealId: deal.id } },
      create: { ...scope, contactId: contact.id, dealId: deal.id, addedById: actorId }, update: {} });
  }
  // Contact-only manual Deals can also resolve their company Account.
  const contactLinks = await tx.contactDeal.findMany({ where: { ...scope, dealId: deal.id }, include: { contact: true } });
  for (const { contact } of contactLinks) {
    if (contact.isArchived) throw conflict();
    let linkedAccount = contact.accountId ?? accountId;
    if (!linkedAccount && contact.company?.trim()) {
      const name = contact.company.trim().replace(/\s+/g, ' ');
      const matches = (await tx.account.findMany({ where: { ...scope, name: { contains: name.split(' ')[0], mode: 'insensitive' } } })).filter(account => account.name.trim().replace(/\s+/g, ' ').toLowerCase() === name.toLowerCase());
      if (matches.length > 1 || matches[0]?.isArchived) throw conflict();
      linkedAccount = matches[0]?.id ?? (await tx.account.create({ data: { ...scope, name, assignedUserId: deal.assignedUserId, tags: [], productInterests: contact.productInterests, activeProducts: [] } })).id;
    }
    if (!contact.accountId && linkedAccount) await tx.contact.update({ where: { ...scope, id: contact.id }, data: { accountId: linkedAccount } });
    accountId ??= linkedAccount;
  }
  if (accountId) {
    const account = await tx.account.findFirst({ where: { ...scope, id: accountId, isArchived: false } });
    if (!account) throw conflict();
    await tx.account.update({ where: { ...scope, id: accountId }, data: {
      activeProducts: [...new Set([...account.activeProducts, ...deal.productInterests])] } });
    await tx.deal.update({ where: { ...scope, id: deal.id }, data: { accountId } });
  }
}
