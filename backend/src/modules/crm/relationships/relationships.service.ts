import prisma from '../../../config/database.config';
import { NotFoundError } from '../../../shared/errors/http-error';

const DEFAULT_LIMIT = 10;

/**
 * Get relationships for a Lead record.
 */
export async function getLeadRelationships(id: string, tenantId: string, limit = DEFAULT_LIMIT) {
  const lead = await prisma.lead.findFirst({
    where: { id, tenantId },
    select: { id: true, contactId: true, accountId: true },
  });
  if (!lead) throw new NotFoundError('Lead');

  const [contact, account, leadDeals, activities, tasks] = await Promise.all([
    // Converted contact
    lead.contactId
      ? prisma.contact.findFirst({
          where: { id: lead.contactId, tenantId },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
        })
      : null,
    // Linked account
    lead.accountId
      ? prisma.account.findFirst({
          where: { id: lead.accountId, tenantId },
          select: { id: true, name: true, industry: true, website: true },
        })
      : null,
    // Deals via junction
    prisma.leadDeal.findMany({
      where: { leadId: id, tenantId },
      take: limit,
      orderBy: { addedAt: 'desc' },
      include: {
        deal: {
          select: { id: true, title: true, value: true, priority: true, stage: { select: { id: true, name: true } } },
        },
      },
    }),
    // Recent activities
    prisma.activity.findMany({
      where: { leadId: id, tenantId },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, title: true, createdAt: true },
    }),
    // Tasks
    prisma.task.findMany({
      where: { leadId: id, tenantId, isArchived: false },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
    }),
  ]);

  return {
    contact,
    account,
    deals: leadDeals.map((ld) => ld.deal),
    activities,
    tasks,
  };
}

/**
 * Get relationships for a Contact record.
 */
export async function getContactRelationships(id: string, tenantId: string, limit = DEFAULT_LIMIT) {
  const contact = await prisma.contact.findFirst({
    where: { id, tenantId },
    select: { id: true, accountId: true },
  });
  if (!contact) throw new NotFoundError('Contact');

  // Canonical company link is Account (ADR-001).
  const companyAccountId = contact.accountId ?? null;

  const [sourceLead, account, contactDeals, activities, tasks] = await Promise.all([
    // Source lead (lead that was converted into this contact)
    prisma.lead.findFirst({
      where: { contactId: id, tenantId },
      select: { id: true, firstName: true, lastName: true, email: true, status: true, source: true },
    }),
    // Linked company (canonical Account)
    companyAccountId
      ? prisma.account.findFirst({
          where: { id: companyAccountId, tenantId },
          select: { id: true, name: true, industry: true, website: true },
        })
      : null,
    // Deals via junction
    prisma.contactDeal.findMany({
      where: { contactId: id, tenantId },
      take: limit,
      orderBy: { addedAt: 'desc' },
      include: {
        deal: {
          select: { id: true, title: true, value: true, priority: true, stage: { select: { id: true, name: true } } },
        },
      },
    }),
    // Recent activities
    prisma.activity.findMany({
      where: { customerId: id, tenantId },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, title: true, createdAt: true },
    }),
    // Tasks
    prisma.task.findMany({
      where: { customerId: id, tenantId, isArchived: false },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
    }),
  ]);

  return {
    sourceLead,
    account,
    deals: contactDeals.map((cd) => cd.deal),
    activities,
    tasks,
  };
}

/**
 * Get relationships for an Account record.
 */
export async function getAccountRelationships(id: string, tenantId: string, limit = DEFAULT_LIMIT) {
  const account = await prisma.account.findFirst({
    where: { id, tenantId, isArchived: false },
    select: { id: true },
  });
  if (!account) throw new NotFoundError('Account');

  const [leads, contacts, deals, activities] = await Promise.all([
    prisma.lead.findMany({
      where: { accountId: id, tenantId, status: { not: 'Merged' } },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, firstName: true, lastName: true, email: true, status: true, source: true },
    }),
    // Contacts now link to the canonical Account (ADR-001) via Contact.accountId.
    prisma.contact.findMany({
      where: { accountId: id, tenantId, isArchived: false },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, firstName: true, lastName: true, email: true, status: true },
    }),
    prisma.deal.findMany({
      where: { accountId: id, tenantId, isArchived: false },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, value: true, priority: true, stage: { select: { id: true, name: true } } },
    }),
    prisma.activity.findMany({
      where: { accountId: id, tenantId },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, title: true, createdAt: true },
    }),
  ]);

  return { leads, contacts, deals, activities };
}

/**
 * Get relationships for a Deal record.
 */
export async function getDealRelationships(id: string, tenantId: string, limit = DEFAULT_LIMIT) {
  const deal = await prisma.deal.findFirst({
    where: { id, tenantId },
    select: { id: true, accountId: true },
  });
  if (!deal) throw new NotFoundError('Deal');

  const [account, leadDeals, contactDeals, activities, tasks] = await Promise.all([
    // Linked account
    deal.accountId
      ? prisma.account.findFirst({
          where: { id: deal.accountId, tenantId },
          select: { id: true, name: true, industry: true, website: true },
        })
      : null,
    // Leads via junction
    prisma.leadDeal.findMany({
      where: { dealId: id, tenantId },
      take: limit,
      include: {
        lead: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
        },
      },
    }),
    // Contacts via junction
    prisma.contactDeal.findMany({
      where: { dealId: id, tenantId },
      take: limit,
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
        },
      },
    }),
    // Recent activities
    prisma.activity.findMany({
      where: { dealId: id, tenantId },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, title: true, createdAt: true },
    }),
    // Tasks
    prisma.task.findMany({
      where: { dealId: id, tenantId, isArchived: false },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
    }),
  ]);

  return {
    account,
    leads: leadDeals.map((ld) => ld.lead),
    contacts: contactDeals.map((cd) => cd.contact),
    activities,
    tasks,
  };
}
