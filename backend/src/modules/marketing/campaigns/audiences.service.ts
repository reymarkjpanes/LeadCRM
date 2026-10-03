import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AudiencePreviewSchema, CreateAudienceSchema, type AudienceInput, type AudienceBreakdown, type EmailVariables } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';

export function campaignScope(tenantId: string) {
  const context = tenantContext.getStore();
  if (!context || context.tenantId !== tenantId) throw new AppError('CRM tenant context is required.', 403);
  return { tenantId };
}
export async function getAudiences(tenantId: string) {
  return prisma.targetAudience.findMany({ where: { ...campaignScope(tenantId), isActive: true }, include: { conditions: { orderBy: { conditionOrder: 'asc' } } }, orderBy: { name: 'asc' } });
}
export async function createAudience(tenantId: string, input: unknown) {
  const dto = CreateAudienceSchema.parse(input);
  return prisma.targetAudience.create({ data: { ...campaignScope(tenantId), name: dto.name, source: dto.source,
    conditions: { create: dto.conditions.map((c, i) => ({ ...c, conditionOrder: i })) } }, include: { conditions: true } });
}
export async function audienceDefinition(tenantId: string, id?: string | null, source?: string | null, db: Prisma.TransactionClient = prisma): Promise<AudienceInput> {
  if (id) {
    const audience = await db.targetAudience.findFirst({ where: { ...campaignScope(tenantId), id, isActive: true }, include: { conditions: true } });
    if (!audience) throw new AppError('Target audience not found.', 404);
    return AudiencePreviewSchema.parse({ source: audience.source, conditions: audience.conditions.map(({ field, operator, value }) => ({ field, operator, value })) });
  }
  return AudiencePreviewSchema.parse({ source, conditions: [] });
}

// Only validated fields are mapped; no request keys become raw query fragments.
function conditionsFor(input: AudienceInput, lead: boolean): Prisma.LeadWhereInput[] | Prisma.ContactWhereInput[] {
  return input.conditions.map(c => {
    const scalar = c.operator === 'not_equals' ? { not: c.value } : c.operator === 'contains' ? { contains: c.value, mode: 'insensitive' as const } : { equals: c.value };
    switch (c.field) {
      case 'createdAt': return { createdAt: c.operator === 'gte' ? { gte: new Date(c.value) } : { lt: new Date(new Date(c.value).getTime() + 86400000) } };
      case 'status':
        if (!lead && !['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED'].includes(c.value)) return c.operator === 'not_equals' ? {} : { id: { in: [] } };
        return { status: scalar };
      case 'source': return { source: scalar };
      case 'company': return lead ? { companyName: scalar } : { company: scalar };
      case 'assignedUserId': return { assignedUserId: scalar };
      case 'productInterest': {
        const filter = lead ? { productInterest: { has: c.value } } : { productInterests: { has: c.value } };
        return c.operator === 'not_equals' ? { NOT: filter } : filter;
      }
    }
  }) as Prisma.LeadWhereInput[] | Prisma.ContactWhereInput[];
}
export interface ResolvedRecipient { leadId?: string; contactId?: string; email: string | null; personalization: EmailVariables; reason: string | null }
export function classifyRecipients(records: ResolvedRecipient[], staff: Set<string>, suppressed: Map<string, string>, allowlist: Set<string> | null) {
  const breakdown: AudienceBreakdown = { matched: records.length, eligible: 0, missingEmail: 0, invalidEmail: 0, duplicateEmail: 0, staffEmail: 0, unsubscribed: 0, blocked: 0, inactive: 0, recipientNotAllowed: 0 };
  const seen = new Set<string>();
  const reasonCounts: Record<string, keyof AudienceBreakdown> = { MISSING_EMAIL: 'missingEmail', INVALID_EMAIL: 'invalidEmail', DUPLICATE_EMAIL: 'duplicateEmail', STAFF_EMAIL: 'staffEmail', UNSUBSCRIBED: 'unsubscribed', BLOCKED: 'blocked', INACTIVE: 'inactive', RECIPIENT_NOT_ALLOWED: 'recipientNotAllowed' };
  for (const row of records) {
    row.email = row.email?.trim().toLowerCase() || null;
    row.reason = row.reason || (!row.email ? 'MISSING_EMAIL' : !z.string().email().safeParse(row.email).success ? 'INVALID_EMAIL' : staff.has(row.email) ? 'STAFF_EMAIL' : suppressed.get(row.email) || (seen.has(row.email) ? 'DUPLICATE_EMAIL' : allowlist && !allowlist.has(row.email) ? 'RECIPIENT_NOT_ALLOWED' : null));
    if (row.reason) breakdown[reasonCounts[row.reason]!]++;
    else { seen.add(row.email!); breakdown.eligible++; }
  }
  return { records, breakdown };
}
export async function resolveAudience(tenantId: string, input: unknown, db: Prisma.TransactionClient = prisma) {
  const dto = AudiencePreviewSchema.parse(input);
  const scope = campaignScope(tenantId);
  const [leads, contacts, users, suppressedLogs, optedOut, priorOptOuts] = await Promise.all([
    dto.source === 'CONTACTS' ? [] : db.lead.findMany({ where: { ...scope, AND: conditionsFor(dto, true) as Prisma.LeadWhereInput[] }, select: { id: true, email: true, firstName: true, lastName: true, companyName: true, phone: true, status: true } }),
    dto.source === 'LEADS' ? [] : db.contact.findMany({ where: { ...scope, AND: conditionsFor(dto, false) as Prisma.ContactWhereInput[] }, select: { id: true, email: true, firstName: true, lastName: true, company: true, phone: true, status: true, doNotContact: true, isArchived: true, deletedAt: true } }),
    db.user.findMany({ where: { tenantId }, select: { email: true } }),
    db.emailDeliveryLog.findMany({ where: { ...scope, OR: [{ status: { in: ['hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribed'] } }, { EmailEvent: { some: { eventType: { in: ['hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribe'] } } } }] }, select: { toEmail: true, status: true } }),
    db.contact.findMany({ where: { ...scope, doNotContact: true }, select: { email: true } }),
    db.campaignContact.findMany({ where: { ...scope, unsubscribed: true }, select: { email: true, leadId: true, contactId: true, lead: { select: { email: true } }, contact: { select: { email: true } } } }),
  ]);
  const staff = new Set(users.map(u => u.email.trim().toLowerCase()));
  const suppressed = new Map(suppressedLogs.map(log => [log.toEmail.trim().toLowerCase(), log.status === 'unsubscribed' ? 'UNSUBSCRIBED' : 'BLOCKED']));
  for (const c of optedOut) if (c.email) suppressed.set(c.email.trim().toLowerCase(), 'UNSUBSCRIBED');
  for (const c of priorOptOuts) for (const email of [c.email, c.lead?.email, c.contact?.email]) if (email) suppressed.set(email.trim().toLowerCase(), 'UNSUBSCRIBED');
  const records: ResolvedRecipient[] = [
    ...contacts.map(c => ({ contactId: c.id, email: c.email, reason: c.doNotContact ? 'UNSUBSCRIBED' : c.isArchived || c.deletedAt || c.status === 'CANCELLED' ? 'INACTIVE' : null, personalization: { first_name: c.firstName, last_name: c.lastName, company_name: c.company || '', contact_number: c.phone || '', status: c.status } })),
    ...leads.map(l => ({ leadId: l.id, email: l.email, reason: ['Archived', 'Converted', 'CANCELLED'].includes(l.status) ? 'INACTIVE' : null, personalization: { first_name: l.firstName, last_name: l.lastName, company_name: l.companyName || '', contact_number: l.phone || '', status: l.status } })),
  ];
  const rawAllowlist = process.env.BREVO_SANDBOX_EMAILS?.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const allowlist = process.env.NODE_ENV !== 'production' && rawAllowlist?.length ? new Set(rawAllowlist || []) : null;
  return classifyRecipients(records, staff, suppressed, allowlist);
}
