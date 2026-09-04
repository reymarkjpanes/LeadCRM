import prisma from '../../../config/database.config';
import type { Prisma } from '@prisma/client';
import type { RelationshipCounts } from './merge.types';

/**
 * Count relationships for a Lead record.
 */
export async function countLeadRelationships(id: string, tenantId: string): Promise<RelationshipCounts> {
  const [activities, tasks, deals, campaigns, invoices] = await Promise.all([
    prisma.activity.count({ where: { leadId: id, tenantId } }),
    prisma.task.count({ where: { leadId: id, tenantId } }),
    prisma.leadDeal.count({ where: { leadId: id, tenantId } }),
    prisma.campaignContact.count({ where: { leadId: id, tenantId } }),
    prisma.invoice.count({ where: { leadId: id, tenantId } }),
  ]);
  return { activities, tasks, deals, campaigns, invoices };
}

/**
 * Count relationships for a Contact record.
 */
export async function countContactRelationships(id: string, tenantId: string): Promise<RelationshipCounts> {
  const [activities, tasks, deals, campaigns, invoices] = await Promise.all([
    prisma.activity.count({ where: { customerId: id, tenantId } }),
    prisma.task.count({ where: { customerId: id, tenantId } }),
    prisma.contactDeal.count({ where: { contactId: id, tenantId } }),
    prisma.campaignContact.count({ where: { customerId: id, tenantId } }),
    prisma.invoice.count({ where: { customerId: id, tenantId } }),
  ]);
  return { activities, tasks, deals, campaigns, invoices };
}

/**
 * Count relationships for an Account record.
 */
export async function countAccountRelationships(id: string, tenantId: string): Promise<RelationshipCounts> {
  const [activities, deals, leads, contacts] = await Promise.all([
    prisma.activity.count({ where: { accountId: id, tenantId } }),
    prisma.deal.count({ where: { accountId: id, tenantId, isArchived: false } }),
    prisma.lead.count({ where: { accountId: id, tenantId } }),
    // Contacts link to Account via Contact.accountId (ADR-001 canonical path).
    prisma.contact.count({ where: { accountId: id, tenantId, isArchived: false } }),
  ]);
  return { activities, tasks: 0, deals, leads, contacts };
}

/**
 * Reassign all lead relationships from secondary to primary within a transaction.
 */
export async function reassignLeadRelationships(
  tx: Prisma.TransactionClient,
  primaryId: string,
  secondaryId: string,
  tenantId: string,
): Promise<RelationshipCounts> {
  // Activities
  const activities = await tx.activity.updateMany({
    where: { leadId: secondaryId, tenantId },
    data: { leadId: primaryId },
  });

  // Tasks
  const tasks = await tx.task.updateMany({
    where: { leadId: secondaryId, tenantId },
    data: { leadId: primaryId },
  });

  // LeadDeal junctions — handle uniqueness conflicts
  const existingJunctions = await tx.leadDeal.findMany({
    where: { leadId: primaryId, tenantId },
    select: { dealId: true },
  });
  const existingDealIds = new Set(existingJunctions.map((j) => j.dealId));

  const secondaryJunctions = await tx.leadDeal.findMany({
    where: { leadId: secondaryId, tenantId },
    select: { id: true, dealId: true },
  });

  let dealsReassigned = 0;
  for (const junction of secondaryJunctions) {
    if (existingDealIds.has(junction.dealId)) {
      // Duplicate — delete the secondary junction
      await tx.leadDeal.delete({ where: { id: junction.id } });
    } else {
      // Safe to reassign
      await tx.leadDeal.update({
        where: { id: junction.id },
        data: { leadId: primaryId },
      });
      dealsReassigned++;
    }
  }

  // Direct Deal.leadId references
  await tx.deal.updateMany({
    where: { leadId: secondaryId, tenantId },
    data: { leadId: primaryId },
  });

  // CampaignContacts
  const campaigns = await tx.campaignContact.updateMany({
    where: { leadId: secondaryId, tenantId },
    data: { leadId: primaryId },
  });

  // EmailDeliveryLogs
  await tx.emailDeliveryLog.updateMany({
    where: { leadId: secondaryId, tenantId },
    data: { leadId: primaryId },
  });

  // Invoices
  const invoices = await tx.invoice.updateMany({
    where: { leadId: secondaryId, tenantId },
    data: { leadId: primaryId },
  });

  return {
    activities: activities.count,
    tasks: tasks.count,
    deals: dealsReassigned,
    campaigns: campaigns.count,
    invoices: invoices.count,
  };
}

/**
 * Reassign all contact relationships from secondary to primary within a transaction.
 */
export async function reassignContactRelationships(
  tx: Prisma.TransactionClient,
  primaryId: string,
  secondaryId: string,
  tenantId: string,
): Promise<RelationshipCounts> {
  // Activities
  const activities = await tx.activity.updateMany({
    where: { customerId: secondaryId, tenantId },
    data: { customerId: primaryId },
  });

  // Tasks
  const tasks = await tx.task.updateMany({
    where: { customerId: secondaryId, tenantId },
    data: { customerId: primaryId },
  });

  // ContactDeal junctions — handle uniqueness conflicts
  const existingJunctions = await tx.contactDeal.findMany({
    where: { contactId: primaryId, tenantId },
    select: { dealId: true },
  });
  const existingDealIds = new Set(existingJunctions.map((j) => j.dealId));

  const secondaryJunctions = await tx.contactDeal.findMany({
    where: { contactId: secondaryId, tenantId },
    select: { id: true, dealId: true },
  });

  let dealsReassigned = 0;
  for (const junction of secondaryJunctions) {
    if (existingDealIds.has(junction.dealId)) {
      await tx.contactDeal.delete({ where: { id: junction.id } });
    } else {
      await tx.contactDeal.update({
        where: { id: junction.id },
        data: { contactId: primaryId },
      });
      dealsReassigned++;
    }
  }

  // Direct Deal.customerId references
  await tx.deal.updateMany({
    where: { customerId: secondaryId, tenantId },
    data: { customerId: primaryId },
  });

  // CampaignContacts
  const campaigns = await tx.campaignContact.updateMany({
    where: { customerId: secondaryId, tenantId },
    data: { customerId: primaryId },
  });

  // EmailDeliveryLogs
  await tx.emailDeliveryLog.updateMany({
    where: { customerId: secondaryId, tenantId },
    data: { customerId: primaryId },
  });

  // Invoices
  const invoices = await tx.invoice.updateMany({
    where: { customerId: secondaryId, tenantId },
    data: { customerId: primaryId },
  });

  return {
    activities: activities.count,
    tasks: tasks.count,
    deals: dealsReassigned,
    campaigns: campaigns.count,
    invoices: invoices.count,
  };
}

/**
 * Reassign all account relationships from secondary to primary within a transaction.
 */
export async function reassignAccountRelationships(
  tx: Prisma.TransactionClient,
  primaryId: string,
  secondaryId: string,
  tenantId: string,
): Promise<RelationshipCounts> {
  // Leads
  const leads = await tx.lead.updateMany({
    where: { accountId: secondaryId, tenantId },
    data: { accountId: primaryId },
  });

  // Contacts — reassign Contact.accountId from secondary to primary (ADR-001 canonical path).
  // relationships.service.ts getAccountRelationships() queries Contact.accountId, so
  // this reassignment ensures the surviving account's contact list is complete.
  const contacts = await tx.contact.updateMany({
    where: { accountId: secondaryId, tenantId },
    data: { accountId: primaryId },
  });

  // Deals
  const deals = await tx.deal.updateMany({
    where: { accountId: secondaryId, tenantId },
    data: { accountId: primaryId },
  });

  // Activities
  const activities = await tx.activity.updateMany({
    where: { accountId: secondaryId, tenantId },
    data: { accountId: primaryId },
  });

  return {
    activities: activities.count,
    tasks: 0,
    deals: deals.count,
    leads: leads.count,
    contacts: contacts.count,
  };
}
