import { productRelationData } from './product-relations';
import { isDeepStrictEqual } from 'node:util';
import type { ContactStatus, Deal, Prisma } from '@prisma/client';
import { normalizeCrmStatus, type NewAccountInput } from '@leadcrm/shared';
import { createCompany } from '../companies/companies.service';
import { createLinkedAccount } from '../companies/organization-creation';
import { AppError } from '../../../shared/errors/app-error';
import { ConflictError, NotFoundError } from '../../../shared/errors/http-error';
import { assertCrmRecordMutation } from '../access/crm-record-access.service';
import { fireContactCreated, fireContactStatusChanged, fireContactUpdated, fireDealUpdated, fireLeadStatusChanged, fireLeadUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges } from '../record-updates';
import { salesContext } from './sales-context';

const companyIdentity = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
async function conversionWrite<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof AppError && error.statusCode === 403) {
      throw new AppError(`Cannot convert this Lead: ${operation}. ${error.message}`, error.statusCode, error.code);
    }
    throw error;
  }
}
export interface LeadConversionEvents {
  previousLead?: { status: string };
  /** The Lead edit callback already captures its complete scalar/custom field changes. */
  emitLeadEvents?: boolean;
  /** The Won transition captures this Deal's final stage and relationship changes. */
  dealEventHandledByCaller?: string;
  accountName?: string;
  newAccount?: NewAccountInput;
  skipAccountCreation?: boolean;
}

/** Runs in the caller's serializable sales transaction. Original records and FKs are retained. */
export async function convertLead(tx: Prisma.TransactionClient, tenantId: string, leadId: string, actorId: string, events: LeadConversionEvents = {}, completedSale = false) {
  await assertCrmRecordMutation(tx, 'leads', leadId);
  const lead = await tx.lead.findFirst({ where: { tenantId, id: leadId } });
  if (!lead || lead.isArchived || lead.deletedAt) throw new NotFoundError('Lead');
  if (lead.convertedAt && lead.contactId) {
    const contact = await tx.contact.findFirst({ where: { tenantId, id: lead.contactId } });
    if (!contact) throw new ConflictError('The converted Contact is unavailable.');
    return { lead, contact, accountId: lead.accountId };
  }
  if (completedSale && lead.status !== 'Closed') throw new ConflictError('Persist Closed status before converting this Lead.');
  const deals = await tx.deal.findMany({ where: { tenantId, leadDeals: { some: { tenantId, leadId } } }, include: { stage: true } });
  const source = await tx.lead.findFirstOrThrow({ where: { tenantId, id: leadId }, select: { productsNormalized: true } });
  const initialInterests = source.productsNormalized ? { ids: lead.productInterestIds } : { names: lead.productInterest };
  // Merge canonical IDs, including retired Products, without resolving a reused name.
  const mergedContactProducts = async (record: { id: string; productInterests: string[] }) => {
    if (!lead.productInterest.length && !lead.productInterestIds.length) return;
    const target = await tx.contact.findFirstOrThrow({ where: { tenantId, id: record.id }, select: {
      productsNormalized: true, productLinks: { orderBy: [{ position: 'asc' }, { productInterestId: 'asc' }] },
    } });
    const previous = { ...record, productInterestIds: [...target.productLinks.map(link => link.productInterestId), ...lead.productInterestIds] };
    const canonicalTarget = target.productsNormalized || !record.productInterests.length;
    if (source.productsNormalized && canonicalTarget) {
      if (target.productsNormalized && lead.productInterestIds.every(id => target.productLinks.some(link => link.interested && link.productInterestId === id))) return;
      return productRelationData(tx, 'contact', tenantId, {
        ids: [...new Set([...target.productLinks.filter(link => link.interested).map(link => link.productInterestId), ...lead.productInterestIds])],
      }, previous, true);
    }
    const productInterests = [...new Set([...record.productInterests, ...lead.productInterest])];
    const data = await productRelationData(tx, 'contact', tenantId, { names: productInterests }, { ...previous, productInterests }, true);
    const links = target.productLinks.map(({ productInterestId, position, interested, activeProduct }) => ({ productInterestId, position, interested, activeProduct }));
    if (data.productsNormalized === target.productsNormalized && isDeepStrictEqual(data.productLinks.create, links) &&
      (target.productsNormalized || 'productInterests' in data && isDeepStrictEqual(data.productInterests, record.productInterests))) return;
    return data;
  };
  const conflict = () => new ConflictError('Multiple, archived, or conflicting Contact/Account matches found. Resolve the CRM relationship before converting this Lead.');
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
  const previousContact = contact;
  if (lead.accountId && contact?.accountId && lead.accountId !== contact.accountId) throw conflict();
  let accountId = lead.accountId ?? contact?.accountId ?? null;
  if (!accountId) {
    const relatedAccounts = [...new Set(deals.map(deal => deal.accountId).filter((id): id is string => !!id))];
    if (relatedAccounts.length > 1) throw conflict();
    accountId = relatedAccounts[0] ?? null;
  }
  const accountName = events.newAccount?.name || events.accountName?.trim() || lead.companyName?.trim();
  if (!accountId && accountName && !events.skipAccountCreation) {
    const name = accountName.replace(/\s+/g, ' ');
    const matches = (await tx.account.findMany({ where: { tenantId, name: { contains: name.split(' ')[0], mode: 'insensitive' } } }))
      .filter(row => companyIdentity(row.name) === companyIdentity(name));
    if (matches.length > 1 || matches[0]?.isArchived || matches[0]?.deletedAt) throw conflict();
    // Shared Account creation must join even callers using a raw Prisma transaction.
    accountId = matches[0]?.id ?? (await salesContext.run(tx, () => events.newAccount
      ? createLinkedAccount(tx, tenantId, events.newAccount, actorId)
      : createCompany(tenantId, actorId, { name, tags: [] }))).id;
  }
  if (accountId && !await tx.account.findFirst({ where: { tenantId, id: accountId, isArchived: false, deletedAt: null } })) throw conflict();
  if (accountId && deals.some(deal => deal.accountId && deal.accountId !== accountId)) throw conflict();
  // Linking an existing Account does not authorize editing its fields or Products.
  const legacyDescription = await tx.customFieldValue.findFirst({ where: { tenantId, leadId, fieldId: 'retired-lead-description', module: 'leads' } });
  const now = new Date();
  const firstWon = deals.flatMap(deal => deal.wonConfirmedAt ? [deal.wonConfirmedAt] : []).sort((a, b) => a.getTime() - b.getTime())[0];
  if (completedSale && !firstWon) throw new ConflictError('Confirmed Won evidence is required before conversion.');
  const status = (firstWon ? 'CLOSED' : normalizeCrmStatus(lead.status).toUpperCase()) as ContactStatus;
  if (!contact) contact = await tx.contact.create({ data: { tenantId, firstName: lead.firstName, lastName: lead.lastName,
    email: lead.email?.trim().toLowerCase(), phone: lead.phone, companyName: lead.companyName, companyFromAccount: lead.companyFromAccount, address: lead.address,
    source: lead.source, notes: typeof legacyDescription?.value === 'string' ? legacyDescription.value : undefined, assignedUserId: lead.assignedUserId, accountId,
    ...await productRelationData(tx, 'contact', tenantId, initialInterests, lead), status: !firstWon && status === 'CLOSED' ? 'WARM' : status, lifecycleStage: firstWon ? 'CUSTOMER' : 'CONTACT',
    customerSince: firstWon ?? null, convertedAt: now, lastStatusChangedAt: lead.lastStatusChangedAt } });
  else {
    const current = contact;
    const data = { accountId,
      ...(firstWon ? { status: 'CLOSED' as const, lifecycleStage: 'CUSTOMER' as const, customerSince: current.customerSince && current.customerSince <= firstWon ? current.customerSince : firstWon,
        lastStatusChangedAt: current.status === 'CLOSED' ? current.lastStatusChangedAt : now } : {}),
      convertedAt: current.convertedAt ?? now,
    };
    const products = await mergedContactProducts(current);
    if (products || Object.entries(data).some(([field, value]) => !isDeepStrictEqual(current[field as keyof typeof current], value))) {
      contact = await conversionWrite('updating the existing Contact requires Contact edit access', () =>
        tx.contact.update({ where: { tenantId, id: current.id }, data: { ...data, ...products } }));
    }
  }
  // Link every original Deal, including archived/terminal history, without changing its sales data.
  const updatedDeals: { before: Deal; after: Deal }[] = [];
  for (const deal of deals) {
    const contactId = contact.id;
    if (!await tx.contactDeal.findFirst({ where: { tenantId, contactId, dealId: deal.id } })) {
      await conversionWrite('adding the Contact to a related Deal requires Deal edit access', () =>
        tx.contactDeal.create({ data: { tenantId, contactId, dealId: deal.id, addedById: actorId } }));
    }
    if (!deal.accountId && accountId) updatedDeals.push({ before: deal,
      after: await conversionWrite('setting the Account on a related Deal requires Deal edit access', () =>
        tx.deal.update({ where: { tenantId, id: deal.id }, data: { accountId } })) });
  }
  const convertedLead = await tx.lead.update({ where: { tenantId, id: leadId }, data: { contactId: contact.id, accountId,
    convertedAt: lead.convertedAt ?? now, convertedById: lead.convertedById ?? actorId } });
  if (!lead.convertedAt) {
    const metadata = { contactId: contact.id, accountId, convertedAt: now.toISOString(), sourceLeadId: leadId };
    await tx.activity.create({ data: { tenantId, leadId, createdById: actorId, type: 'conversion', title: 'Lead converted to Contact',
      description: firstWon ? 'Contact linked with existing confirmed Won evidence.' : 'Contact created or linked; existing sales status and Deal stages preserved.', metadata } });
    await tx.activity.create({ data: { tenantId, contactId: contact.id, createdById: actorId, type: 'conversion', title: 'Contact linked to converted Lead',
      description: 'Original Lead, email, activity and Deal history retained.', metadata } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'lead.converted', entityType: 'Lead', entityId: leadId, metadata } });
  }
  // Bind even direct transaction callers: queue insertion must commit or roll back with conversion.
  await salesContext.run(tx, async () => {
    const eventId = `lead-conversion:${leadId}`;
    if (events.emitLeadEvents !== false) {
      const previousLead = events.previousLead ?? lead;
      const changes = recordChanges(previousLead, convertedLead);
      await fireLeadUpdated({ tenantId, actorId, eventId, record: convertedLead, changedFields: changes.changedFields, changes });
      await fireLeadStatusChanged({ tenantId, actorId, eventId, lead: convertedLead, prevStatus: previousLead.status });
    }
    if (!previousContact) await fireContactCreated({ tenantId, actorId, contact });
    else {
      const changes = recordChanges(previousContact, contact);
      await fireContactUpdated({ tenantId, actorId, eventId, record: contact, changedFields: changes.changedFields, changes });
      await fireContactStatusChanged({ tenantId, actorId, eventId, contact, prevStatus: previousContact.status });
    }
    for (const { before, after } of updatedDeals) {
      if (after.id === events.dealEventHandledByCaller || after.isArchived || after.deletedAt) continue;
      const changes = recordChanges(before, after);
      await fireDealUpdated({ tenantId, actorId, eventId: `${eventId}:deal:${after.id}`, record: after, changedFields: changes.changedFields, changes });
    }
  });
  return { lead: convertedLead, contact, accountId };
}

/** Sales completion retains its Won-evidence guard; basic conversion uses convertLead. */
export function convertClosedLead(tx: Prisma.TransactionClient, tenantId: string, leadId: string, actorId: string, events: LeadConversionEvents = {}) {
  return convertLead(tx, tenantId, leadId, actorId, events, true);
}
