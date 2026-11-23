import type { Deal, Prisma } from '@prisma/client';
import { companyNameMatchKey } from '@leadcrm/shared';
import { assertExternalCustomerEmail } from '../record-validation';
import { crmScope } from '../leads/lead-automation.service';
import { convertClosedLead } from '../leads/lead-conversion.service';
import { ConflictError } from '../../../shared/errors/http-error';
import { resolveAccountForCompany } from '../companies/account-resolution';

/** Called inside the same serializable transaction as the actual Won transition. */
export async function resolveWonRelationships(tx: Prisma.TransactionClient, deal: Deal, actorId: string) {
  const scope = crmScope(deal.tenantId);
  const links = await tx.leadDeal.findMany({ where: { ...scope, dealId: deal.id } });
  const leadIds = links.map(link => link.leadId);
  const leads = await tx.lead.findMany({ where: { ...scope, id: { in: leadIds } } });
  const contactLinks = await tx.contactDeal.findMany({ where: { ...scope, dealId: deal.id }, include: { contact: true } });
  const contacts = contactLinks.map(({ contact }) => contact);
  const participants = [...leads, ...contacts];
  const established = [...new Set([deal.accountId, ...participants.map(person => person.accountId)].filter((id): id is string => !!id))];
  const conflict = () => new ConflictError('Resolve the Account in Lead conversion or Contact Details before retrying Closed Won. The related records must agree on an active Account.');
  if (established.length > 1 || contacts.some(contact => contact.isArchived || contact.deletedAt)) throw conflict();
  let accountId: string | null = established[0] ?? null;
  const names = new Set(participants.map(person => companyNameMatchKey(person.companyName ?? '')).filter(Boolean));
  if (!accountId && names.size > 1) throw conflict();
  for (const lead of leads) {
    const converted = await convertClosedLead(tx, deal.tenantId, lead.id, actorId, { dealEventHandledByCaller: deal.id, closingAccountId: accountId ?? undefined });
    if (converted.accountId && accountId && converted.accountId !== accountId) throw conflict();
    accountId ??= converted.accountId;
  }
  for (const contact of contacts) {
    await assertExternalCustomerEmail(tx, deal.tenantId, contact.email, ['contactIds']);
  }
  const companyName = contacts.find(contact => contact.companyName?.trim())?.companyName;
  if (!accountId && companyName) {
    accountId = (await resolveAccountForCompany(tx, { tenantId: deal.tenantId, actorId, companyName, operation: 'close-won', recordId: deal.id })).id;
  }
  if (accountId) {
    const account = await tx.account.findFirst({ where: { ...scope, id: accountId, isArchived: false, deletedAt: null }, select: { name: true } });
    if (!account) throw conflict();
    for (const contact of contacts) {
      if (!contact.accountId) await tx.contact.updateMany({
        where: { ...scope, id: contact.id, accountId: null },
        data: { accountId, companyName: account.name, companyFromAccount: true },
      });
    }
    await tx.deal.update({ where: { ...scope, id: deal.id }, data: { accountId } });
  }
}
