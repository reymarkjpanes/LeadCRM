import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR, STAFF_PHONE_CONFLICT, CUSTOMER_PHONE_CONFLICT, isDirectMailSource } from '@leadcrm/shared';
import { normalizePhone } from './duplicate-detection/duplicate-detection.service';
import { readCrmStatusEvidence } from './access/crm-record-access.service';

// Store literal plain text; renderers escape it at the output boundary.
export const recordText = (max = 2000) => z.string().max(max)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'Control characters are not allowed.')
  .transform(value => value.trim());
export const recordName = (max = 100) => recordText(max).pipe(z.string().min(1, 'Name is required'));

export function assertSelectableCrmSource(source: unknown) {
  if (isDirectMailSource(source)) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ['source'], message: 'Direct Mail is a historical source. Choose an available source.' }]);
  }
}

/** User identity is internal regardless of role, activation or assignment eligibility. */
export async function assertExternalCustomerEmail(tx: Prisma.TransactionClient, tenantId: string,
  email: string | null | undefined, path: (string | number)[] = ['email']): Promise<void> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return;
  // Compare exactly after trimming legacy stored addresses, as CRM matching does.
  // Tenant-authoritative validation must include employees hidden by Team/Archived
  // Data View permissions. No identity details are returned to the caller.
  const candidates = await readCrmStatusEvidence(() => tx.user.findMany({ where: { tenantId, email: { contains: normalized, mode: 'insensitive' } }, select: { email: true } }));
  if (candidates.some(user => user.email.trim().toLowerCase() === normalized)) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path, message: INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR }]);
  }
}

/** Same tenant-authoritative identity boundary as staff email, including inactive users. */
export async function assertExternalCustomerPhone(tx: Prisma.TransactionClient, tenantId: string,
  phone: string | null | undefined, path: (string | number)[] = ['phone']): Promise<void> {
  if (!phone?.trim()) return;
  const normalized = normalizePhone(phone);
  const staff = await readCrmStatusEvidence(async () => await tx.user.findMany({
    where: { tenantId, phone: { not: null } }, select: { phone: true },
  }));
  if (staff.some(user => user.phone && normalizePhone(user.phone) === normalized)) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path, message: STAFF_PHONE_CONFLICT }]);
  }
}

type PhoneRecord = { module: 'leads' | 'contacts'; id: string; phone: string | null };

/** Manual writes use this inside salesTransaction; public capture, conversion and merge retain staff-only validation. */
export async function assertInternalCustomerPhone(tx: Prisma.TransactionClient, tenantId: string,
  phone: string | null | undefined, current?: PhoneRecord): Promise<void> {
  await assertExternalCustomerPhone(tx, tenantId, phone);
  if (!phone?.trim()) return;
  const normalized = normalizePhone(phone);
  // Preserve historical duplicates on unrelated edits, including equivalent formatting.
  if (current?.phone && normalizePhone(current.phone) === normalized) return;
  await readCrmStatusEvidence(async () => {
    // Do not reuse the duplicate-warning search: its sample limits and visibility
    // filters are appropriate for suggestions, but cannot establish uniqueness.
    const leads = await tx.lead.findMany({ where: { tenantId }, select: { id: true, phone: true, contactId: true } });
    const contacts = await tx.contact.findMany({ where: { tenantId, phone: { not: null } }, select: { id: true, phone: true } });
    const related = new Set<string>();
    if (current) {
      related.add(`${current.module}:${current.id}`);
      const edges = leads.filter(lead => lead.contactId).map(lead => [`leads:${lead.id}`, `contacts:${lead.contactId}`]);
      const merges = await tx.auditLog.findMany({ where: { tenantId, action: { in: ['lead.merged', 'contact.merged'] } },
        select: { action: true, entityId: true, metadata: true } });
      for (const merge of merges) {
        const secondaryId = (merge.metadata as { secondaryId?: unknown } | null)?.secondaryId;
        if (typeof secondaryId !== 'string') continue;
        const module = merge.action === 'lead.merged' ? 'leads' : 'contacts';
        edges.push([`${module}:${merge.entityId}`, `${module}:${secondaryId}`]);
      }
      // Only persisted conversion/merge provenance establishes the same customer.
      for (let size = -1; size !== related.size;) {
        size = related.size;
        for (const [left, right] of edges) if (related.has(left) || related.has(right)) { related.add(left); related.add(right); }
      }
    }
    const conflict = leads.some(lead => lead.phone && normalizePhone(lead.phone) === normalized && !related.has(`leads:${lead.id}`))
      || contacts.some(contact => contact.phone && normalizePhone(contact.phone) === normalized && !related.has(`contacts:${contact.id}`));
    if (conflict) throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ['phone'], message: CUSTOMER_PHONE_CONFLICT }]);
  });
}

/** Validate customer identities before writing or copying ordered Deal junctions. */
export async function assertExternalCustomerParticipants(tx: Prisma.TransactionClient, tenantId: string,
  participants: { leadIds?: string[]; contactIds?: string[] }): Promise<void> {
  for (const field of ['leadIds', 'contactIds'] as const) {
    const ids = participants[field];
    if (!ids?.length) continue;
    const where = { tenantId, id: { in: [...new Set(ids)] } };
    const people = await readCrmStatusEvidence(() => field === 'leadIds' ? tx.lead.findMany({ where, select: { email: true } })
      : tx.contact.findMany({ where, select: { email: true } }));
    for (const person of people) await assertExternalCustomerEmail(tx, tenantId, person.email, [field]);
  }
}
