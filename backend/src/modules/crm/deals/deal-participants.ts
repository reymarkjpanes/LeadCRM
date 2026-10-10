import { Prisma } from '@prisma/client';

export const participantOrder = [{ position: 'asc' }, { addedAt: 'asc' }, { id: 'asc' }] satisfies Prisma.LeadDealOrderByWithRelationInput[];

/** Preserve the public singular fields as projections of the ordered junctions. */
export function withDealParticipants<T extends {
  leadDeals: Array<{ leadId: string; lead?: unknown }>;
  contactDeals: Array<{ contactId: string; contact?: unknown }>;
}>(deal: T) {
  return { ...deal, leadId: deal.leadDeals[0]?.leadId ?? null, contactId: deal.contactDeals[0]?.contactId ?? null,
    lead: deal.leadDeals[0]?.lead ?? null, contact: deal.contactDeals[0]?.contact ?? null };
}
