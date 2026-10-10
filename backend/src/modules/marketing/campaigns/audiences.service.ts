import { z } from 'zod';
import { Prisma, ContactStatus } from '@prisma/client';
import { AudienceSourceSchema, AudiencePreviewSchema, AudiencePreviewRequestSchema, CreateAudienceSchema, CRM_STATUSES, isAssignableAgent, LeadCreatedFilterSchema, leadCreatedBounds, type AudienceInput, type AudienceBreakdown, type AudiencePreviewResult, type EmailVariables } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';
import { resolveProducts, validateSalesOwner } from '../../crm/leads/lead-automation.service';
import { normalizeSmsPhone } from '../../../shared/services/sms.service';

export function campaignScope(tenantId: string) {
  const context = tenantContext.getStore();
  if (!context || context.tenantId !== tenantId) throw new AppError('CRM tenant context is required.', 403);
  return { tenantId };
}

/** CRM scalar fields used by audience matching; never a paginated UI cache. */
async function companyValues(tenantId: string, source: AudienceInput['source'], db: Prisma.TransactionClient = prisma) {
  const where = { ...campaignScope(tenantId), isArchived: false, deletedAt: null };
  const [leads, contacts] = await Promise.all([
    source === 'CONTACTS' ? [] : db.lead.findMany({ where, distinct: ['companyName'], select: { companyName: true } }),
    source === 'LEADS' ? [] : db.contact.findMany({ where, distinct: ['company', 'accountId'], select: { company: true, account: { select: { name: true } } } }),
  ]);
  return [...leads.map(row => row.companyName), ...contacts.map(row => row.account?.name || row.company)].filter((value): value is string => !!value?.trim());
}
export async function audienceCompanies(tenantId: string, input: unknown) {
  const source = AudienceSourceSchema.parse(input);
  const names = new Map<string, string>();
  for (const value of (await companyValues(tenantId, source)).sort()) {
    const name = value.trim();
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// Preserve the string column: scalars stay readable, structured values are JSON.
// Legacy product names resolve only through this tenant's catalog.
async function readDefinition(tenantId: string, source: string, rows: { field: string; operator: string; value: string }[], db: Prisma.TransactionClient): Promise<AudienceInput> {
  const conditions = await Promise.all(rows.map(async row => {
    let value: unknown = row.value;
    if (row.field === 'status') value = CRM_STATUSES.find(s => s.toLowerCase() === row.value.toLowerCase()) ?? row.value;
    if (row.field === 'createdAt' && row.operator === 'any') value = null;
    if ((row.field === 'productInterest' || row.field === 'createdAt') && /^[\[{]/.test(row.value)) {
      try { value = JSON.parse(row.value); } catch { throw new AppError('Saved audience contains an invalid condition.', 400); }
    }
    if (row.field === 'productInterest' && typeof value === 'string') {
      const product = await db.productInterest.findFirst({ where: { tenantId, active: true, name: value }, select: { id: true } });
      if (!product) throw new AppError('A saved audience Product Interest is no longer available.', 400);
      value = [product.id];
    }
    return { field: row.field, operator: row.operator, value };
  }));
  return AudiencePreviewSchema.parse({ source, conditions });
}
export async function validateAudienceReferences(tenantId: string, dto: AudienceInput, db: Prisma.TransactionClient = prisma) {
  for (const c of dto.conditions) {
    if (c.field === 'productInterest') await resolveProducts(db, tenantId, c.value);
    if (c.field === 'assignedUserId') {
      await validateSalesOwner(db, tenantId, c.value);
    }
  }
}
export async function getAudiences(tenantId: string) {
  const rows = await prisma.targetAudience.findMany({ where: { ...campaignScope(tenantId), isActive: true }, include: { conditions: { orderBy: { conditionOrder: 'asc' } } }, orderBy: { name: 'asc' } });
  return Promise.all(rows.map(async row => ({ id: row.id, name: row.name, ...await readDefinition(tenantId, row.source, row.conditions, prisma) })));
}
export async function createAudience(tenantId: string, input: unknown) {
  const dto = CreateAudienceSchema.parse(input), scope = campaignScope(tenantId);
  return prisma.$transaction(async tx => {
    await validateAudienceReferences(tenantId, dto, tx);
    if (dto.conditions.some(c => c.field === 'company')) {
      const available = new Set((await companyValues(tenantId, dto.source, tx)).map(value => value.trim().toLowerCase()));
      for (const c of dto.conditions) if (c.field === 'company' && !available.has(c.value.toLowerCase())) throw new AppError('Select an existing company for this source.', 400);
    }
    const row = await tx.targetAudience.create({ data: { ...scope, name: dto.name, source: dto.source,
      conditions: { create: dto.conditions.map((c, i) => ({ field: c.field, operator: c.operator, value: typeof c.value === 'string' ? c.value : JSON.stringify(c.value), conditionOrder: i })) } } });
    return { id: row.id, ...dto };
  });
}
export async function audienceDefinition(tenantId: string, id?: string | null, source?: string | null, db: Prisma.TransactionClient = prisma): Promise<AudienceInput> {
  if (id) {
    const audience = await db.targetAudience.findFirst({ where: { ...campaignScope(tenantId), id, isActive: true }, include: { conditions: { orderBy: { conditionOrder: 'asc' } } } });
    if (!audience) throw new AppError('Target audience not found.', 404);
    return readDefinition(tenantId, audience.source, audience.conditions, db);
  }
  return AudiencePreviewSchema.parse({ source, conditions: [] });
}

// Only validated fields are mapped; no request keys become raw query fragments.
export function conditionsFor(input: AudienceInput, lead: boolean, companies?: string[]): Prisma.LeadWhereInput[] | Prisma.ContactWhereInput[] {
  return input.conditions.map(c => {
    switch (c.field) {
      case 'createdAt': {
        if (c.operator === 'any') return {};
        const filter = LeadCreatedFilterSchema.parse(c.operator === 'between' ? { operator: c.operator, ...(typeof c.value === 'object' ? c.value : {}) } : { operator: c.operator, date: c.value });
        return { createdAt: leadCreatedBounds(filter) };
      }
      case 'status': {
        const value = lead ? c.value : c.value.toUpperCase() as ContactStatus;
        return { status: { ...(c.operator === 'not_equals' ? { not: value } : { equals: value }), ...(lead ? { mode: 'insensitive' } : {}) } };
      }
      case 'source': return { source: c.operator === 'not_equals' ? { not: c.value } : { equals: c.value } };
      case 'company': {
        const contactCompany = (scalar: Prisma.StringNullableFilter): Prisma.ContactWhereInput => ({ OR: [
          { account: { is: { name: scalar as Prisma.StringFilter } } },
          { account: { is: null }, company: scalar },
          { account: { is: { name: '' } }, company: scalar },
        ] });
        const matches = companies?.filter(value => value.trim().toLowerCase() === c.value.trim().toLowerCase());
        if (matches && c.operator !== 'contains') {
          const scalar = { [c.operator === 'not_equals' ? 'notIn' : 'in']: [...new Set([c.value, ...matches])], mode: 'insensitive' as const };
          return lead ? { companyName: scalar } : contactCompany(scalar);
        }
        const scalar = { ...(c.operator === 'not_equals' ? { not: c.value } : c.operator === 'contains' ? { contains: c.value } : { equals: c.value }), mode: 'insensitive' as const };
        return lead ? { companyName: scalar } : contactCompany(scalar);
      }
      case 'assignedUserId': return { assignedUserId: c.operator === 'not_equals' ? { not: c.value } : { equals: c.value } };
      case 'productInterest': {
        const relation = { productInterestId: { in: c.value }, ...(lead ? {} : { interested: true }) };
        return { productLinks: c.operator === 'not_equals' ? { none: relation } : { some: relation } };
      }
    }
  }) as Prisma.LeadWhereInput[] | Prisma.ContactWhereInput[];
}
export interface ResolvedRecipient { leadId?: string; contactId?: string; email: string | null; phone?: string | null; personalization: EmailVariables; reason: string | null }
const emptyBreakdown = (): AudienceBreakdown => ({ matched: 0, eligible: 0, missingEmail: 0, invalidEmail: 0, duplicateEmail: 0, staffEmail: 0, unsubscribed: 0, blocked: 0, inactive: 0, recipientNotAllowed: 0, missingPhone: 0, invalidPhone: 0, duplicatePhone: 0, doNotContact: 0 });
const reasonCounts = { MISSING_EMAIL: 'missingEmail', INVALID_EMAIL: 'invalidEmail', DUPLICATE_EMAIL: 'duplicateEmail', STAFF_EMAIL: 'staffEmail', UNSUBSCRIBED: 'unsubscribed', BLOCKED: 'blocked', INACTIVE: 'inactive', RECIPIENT_NOT_ALLOWED: 'recipientNotAllowed', MISSING_PHONE: 'missingPhone', INVALID_PHONE: 'invalidPhone', DUPLICATE_PHONE: 'duplicatePhone', DO_NOT_CONTACT: 'doNotContact' } as const;
function classify(row: ResolvedRecipient, channel: 'EMAIL' | 'SMS', staff: Set<string>, suppressed: Map<string, string>, allowlist: Set<string> | null, seen: Set<string>, breakdown: AudienceBreakdown) {
  breakdown.matched++;
  row.email = row.email?.trim().toLowerCase() || null;
  if (channel === 'SMS') {
    if (!row.phone?.trim()) row.reason ||= 'MISSING_PHONE';
    else { try { row.phone = normalizeSmsPhone(row.phone); } catch { row.reason ||= 'INVALID_PHONE'; } }
    row.reason ||= suppressed.get(row.phone || '') || (seen.has(row.phone || '') ? 'DUPLICATE_PHONE' : null);
  } else {
    row.reason ||= !row.email ? 'MISSING_EMAIL' : !z.string().email().safeParse(row.email).success ? 'INVALID_EMAIL' : staff.has(row.email) ? 'STAFF_EMAIL' : suppressed.get(row.email) || (seen.has(row.email) ? 'DUPLICATE_EMAIL' : allowlist && !allowlist.has(row.email) ? 'RECIPIENT_NOT_ALLOWED' : null);
  }
  if (row.reason) {
    const key = reasonCounts[row.reason as keyof typeof reasonCounts];
    if (key) breakdown[key] = (breakdown[key] ?? 0) + 1;
  } else { seen.add((channel === 'SMS' ? row.phone : row.email)!); breakdown.eligible++; }
}
export function classifyRecipients(records: ResolvedRecipient[], staff: Set<string>, suppressed: Map<string, string>, allowlist: Set<string> | null, channel: 'EMAIL' | 'SMS' = 'EMAIL') {
  const breakdown = emptyBreakdown(), seen = new Set<string>();
  for (const row of records) classify(row, channel, staff, suppressed, allowlist, seen, breakdown);
  return { records, breakdown };
}

async function visitBatches<T extends { id: string }>(read: (cursor?: string) => Promise<T[]>, visit: (row: T) => void) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await read(cursor);
    rows.forEach(visit);
    if (rows.length < 250) return;
    cursor = rows[rows.length - 1].id;
  }
}

export async function resolveAudience(tenantId: string, input: unknown, db: Prisma.TransactionClient = prisma, channel: 'EMAIL' | 'SMS' = 'EMAIL', page?: { page: number; limit: number }) {
  const dto = AudiencePreviewSchema.parse(input), scope = campaignScope(tenantId);
  await validateAudienceReferences(tenantId, dto, db);
  const companies = dto.conditions.some(c => c.field === 'company') ? await companyValues(tenantId, dto.source, db) : undefined;
  const staff = new Set<string>(), suppressed = new Map<string, string>();
  const batch = (cursor?: string) => ({ take: 250, orderBy: { id: 'asc' as const }, where: { ...scope, ...(cursor ? { id: { gt: cursor } } : {}) } });
  if (channel === 'EMAIL') {
    await visitBatches(cursor => db.user.findMany({ ...batch(cursor), select: { id: true, email: true } }), u => { staff.add(u.email.trim().toLowerCase()); });
    await visitBatches(cursor => db.emailDeliveryLog.findMany({ ...batch(cursor), where: { ...batch(cursor).where, OR: [{ status: { in: ['hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribed'] } }, { EmailEvent: { some: { eventType: { in: ['hard_bounce', 'blocked', 'spam', 'invalid_email', 'unsubscribe'] } } } }] }, select: { id: true, toEmail: true, status: true } }), log => { suppressed.set(log.toEmail.trim().toLowerCase(), log.status === 'unsubscribed' ? 'UNSUBSCRIBED' : 'BLOCKED'); });
  }
  await visitBatches(cursor => db.contact.findMany({ ...batch(cursor), where: { ...batch(cursor).where, doNotContact: true }, select: { id: true, email: true, phone: true } }), c => {
    if (channel === 'SMS' && c.phone) { try { suppressed.set(normalizeSmsPhone(c.phone), 'DO_NOT_CONTACT'); } catch { /* Invalid numbers cannot be sent. */ } }
    else if (c.email) suppressed.set(c.email.trim().toLowerCase(), 'UNSUBSCRIBED');
  });
  if (channel === 'EMAIL') await visitBatches(cursor => db.campaignContact.findMany({ ...batch(cursor), where: { ...batch(cursor).where, unsubscribed: true }, select: { id: true, email: true, lead: { select: { email: true } }, contact: { select: { email: true } } } }), c => {
    for (const email of [c.email, c.lead?.email, c.contact?.email]) if (email) suppressed.set(email.trim().toLowerCase(), 'UNSUBSCRIBED');
  });
  const rawAllowlist = process.env.BREVO_SANDBOX_EMAILS?.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const allowlist = process.env.NODE_ENV !== 'production' && rawAllowlist?.length ? new Set(rawAllowlist) : null;
  const breakdown = emptyBreakdown(), seen = new Set<string>(), records: ResolvedRecipient[] = [];
  const retain = (row: ResolvedRecipient) => {
    classify(row, channel, staff, suppressed, allowlist, seen, breakdown);
    if (!page || (!row.reason && breakdown.eligible > (page.page - 1) * page.limit && records.length < page.limit)) records.push(row);
  };
  // Contacts win. Preview reads bounded, stable batches and retains only its page.
  if (dto.source !== 'LEADS') {
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.contact.findMany({ where: { ...scope, AND: conditionsFor(dto, false, companies) as Prisma.ContactWhereInput[], ...(cursor ? { id: { gt: cursor } } : {}) }, take: 250, orderBy: { id: 'asc' }, select: { id: true, email: true, firstName: true, lastName: true, company: true, account: { select: { name: true } }, phone: true, status: true, doNotContact: true, isArchived: true, deletedAt: true } });
      for (const c of rows) retain({ contactId: c.id, email: c.email, phone: c.phone, reason: c.doNotContact ? (channel === 'SMS' ? 'DO_NOT_CONTACT' : 'UNSUBSCRIBED') : c.isArchived || c.deletedAt || c.status === 'CANCELLED' ? 'INACTIVE' : null, personalization: { first_name: c.firstName, last_name: c.lastName, company_name: c.account?.name || c.company || '', contact_number: c.phone || '', status: c.status } });
      if (rows.length < 250) break;
      cursor = rows[rows.length - 1].id;
    }
  }
  if (dto.source !== 'CONTACTS') {
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.lead.findMany({ where: { ...scope, AND: conditionsFor(dto, true, companies) as Prisma.LeadWhereInput[], ...(cursor ? { id: { gt: cursor } } : {}) }, take: 250, orderBy: { id: 'asc' }, select: { id: true, email: true, firstName: true, lastName: true, companyName: true, phone: true, status: true, isArchived: true, deletedAt: true, convertedAt: true } });
      for (const l of rows) retain({ leadId: l.id, email: l.email, phone: l.phone, reason: l.isArchived || l.deletedAt || l.convertedAt || ['archived', 'converted', 'cancelled'].includes(l.status.toLowerCase()) ? 'INACTIVE' : null, personalization: { first_name: l.firstName, last_name: l.lastName, company_name: l.companyName || '', contact_number: l.phone || '', status: l.status } });
      if (rows.length < 250) break;
      cursor = rows[rows.length - 1].id;
    }
  }
  return { records, breakdown };
}
export async function previewAudience(tenantId: string, input: unknown): Promise<AudiencePreviewResult> {
  const { channel, page, limit, ...definition } = AudiencePreviewRequestSchema.parse(input);
  const { records, breakdown } = await resolveAudience(tenantId, definition, prisma, channel, { page, limit });
  return { ...breakdown, recipients: records.map(r => ({ id: (r.contactId || r.leadId)!, recordType: r.contactId ? 'Contact' : 'Lead', name: `${r.personalization.first_name || ''} ${r.personalization.last_name || ''}`.trim(), company: r.personalization.company_name || '', email: r.email, phone: r.phone ?? null })), meta: { page, limit, total: breakdown.eligible, hasMore: page * limit < breakdown.eligible } };
}
