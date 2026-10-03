import {taskAssociationWhere, reassignTaskLinks} from "../../operations/tasks/tasks.repository";
import prisma from '../../../config/database.config';
import type { Prisma } from '@prisma/client';
import type { RelationshipCounts } from './merge.types';

/**
 * Count relationships for a Lead record.
 */
export async function countLeadRelationships(id: string, tenantId: string): Promise<RelationshipCounts> {
  const [activities, tasks, deals, campaigns] = await Promise.all([
    prisma.activity.count({ where: { leadId: id, tenantId } }),
    prisma.task.count({ where: { tenantId, ...taskAssociationWhere("lead",id,tenantId) } }),
    prisma.leadDeal.count({ where: { leadId: id, tenantId } }),
    prisma.campaignContact.count({ where: { leadId: id, tenantId } }),
  ]);
  return { activities, tasks, deals, campaigns };
}

/**
 * Count relationships for a Contact record.
 */
export async function countContactRelationships(id: string, tenantId: string): Promise<RelationshipCounts> {
  const [activities, tasks, deals, campaigns] = await Promise.all([
    prisma.activity.count({ where: { contactId: id, tenantId } }),
    prisma.task.count({ where: { tenantId, ...taskAssociationWhere("contact",id,tenantId) } }),
    prisma.contactDeal.count({ where: { contactId: id, tenantId } }),
    prisma.campaignContact.count({ where: { contactId: id, tenantId } }),
  ]);
  return { activities, tasks, deals, campaigns };
}

/**
 * Count relationships for an Account record.
 */
export async function countAccountRelationships(id: string, tenantId: string): Promise<RelationshipCounts> {
  const [activities, deals, leads, contacts, tasks] = await Promise.all([
    prisma.activity.count({ where: { accountId: id, tenantId } }),
    prisma.deal.count({ where: { accountId: id, tenantId, isArchived: false } }),
    prisma.lead.count({ where: { accountId: id, tenantId } }),
    // Contacts link to Account via Contact.accountId (ADR-001 canonical path).
    prisma.contact.count({ where: { accountId: id, tenantId, isArchived: false } }),
    prisma.task.count({where:{tenantId,...taskAssociationWhere("account",id,tenantId)}}),
  ]);
  return { activities, tasks, deals, leads, contacts };
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
  const tasks = await reassignTaskLinks(tx,"lead",primaryId,secondaryId,tenantId);

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


  return {
    activities: activities.count,
    tasks: tasks.count,
    deals: dealsReassigned,
    campaigns: campaigns.count,
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
    where: { contactId: secondaryId, tenantId },
    data: { contactId: primaryId },
  });

  // Tasks
  const tasks = await reassignTaskLinks(tx,"contact",primaryId,secondaryId,tenantId);

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

  // Direct Deal.contactId references
  await tx.deal.updateMany({
    where: { contactId: secondaryId, tenantId },
    data: { contactId: primaryId },
  });

  // CampaignContacts
  const campaigns = await tx.campaignContact.updateMany({
    where: { contactId: secondaryId, tenantId },
    data: { contactId: primaryId },
  });

  // EmailDeliveryLogs
  await tx.emailDeliveryLog.updateMany({
    where: { contactId: secondaryId, tenantId },
    data: { contactId: primaryId },
  });


  return {
    activities: activities.count,
    tasks: tasks.count,
    deals: dealsReassigned,
    campaigns: campaigns.count,
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
  const tasks = await reassignTaskLinks(tx,"account",primaryId,secondaryId,tenantId);
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
    tasks: tasks.count,
    deals: deals.count,
    leads: leads.count,
    contacts: contacts.count,
  };
}
