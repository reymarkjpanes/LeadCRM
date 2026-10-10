import prisma from '../../../config/database.config';
import type {
  DuplicateCheckParams,
  DuplicateCheckResult,
  DuplicateMatch,
  DuplicateEntityType,
  DuplicateConfidence,
} from './duplicate-detection.types';

const MAX_RESULTS = 10;

/**
 * Normalize a phone number for comparison by stripping non-digit chars
 * and handling common Philippine number formats (+63 / 0 prefix).
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Remove leading country code 63 or leading 0
  if (digits.startsWith('63') && digits.length >= 11) {
    return digits.substring(2);
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    return digits.substring(1);
  }
  return digits;
}

/**
 * Check for duplicate records across Leads, Contacts, and Accounts
 * within the same tenant. Returns matches ranked by confidence.
 */
export async function checkDuplicates(params: DuplicateCheckParams): Promise<DuplicateCheckResult> {
  const { tenantId, email, phone, firstName, lastName, companyName, excludeId, entityTypes } = params;
  const matches: DuplicateMatch[] = [];

  // ── Search Leads ──────────────────────────────────────────────────────────
  if (entityTypes.includes('lead')) {
    const leadMatches = await findLeadDuplicates(tenantId, { email, phone, firstName, lastName, companyName, excludeId });
    matches.push(...leadMatches);
  }

  // ── Search Contacts ───────────────────────────────────────────────────────
  if (entityTypes.includes('contact')) {
    const contactMatches = await findContactDuplicates(tenantId, { email, phone, firstName, lastName, companyName, excludeId });
    matches.push(...contactMatches);
  }

  // ── Search Accounts ───────────────────────────────────────────────────────
  if (entityTypes.includes('account') && companyName) {
    const accountMatches = await findAccountDuplicates(tenantId, { companyName, excludeId });
    matches.push(...accountMatches);
  }

  // Sort by confidence (HIGH first) then by name
  matches.sort((a, b) => {
    if (a.confidence === 'HIGH' && b.confidence === 'MEDIUM') return -1;
    if (a.confidence === 'MEDIUM' && b.confidence === 'HIGH') return 1;
    return a.name.localeCompare(b.name);
  });

  return { matches: matches.slice(0, MAX_RESULTS) };
}

// ── Lead duplicate search ─────────────────────────────────────────────────────

async function findLeadDuplicates(
  tenantId: string,
  criteria: { email?: string; phone?: string; firstName?: string; lastName?: string; companyName?: string; excludeId?: string },
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const seen = new Set<string>();

  // Email exact match — HIGH confidence
  if (criteria.email) {
    const emailMatches = await prisma.lead.findMany({
      where: {
        tenantId,
        email: { equals: criteria.email, mode: 'insensitive' },
        ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
        status: { not: 'Merged' },
      },
      take: 5,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, companyName: true, status: true },
    });

    for (const lead of emailMatches) {
      if (!seen.has(lead.id)) {
        seen.add(lead.id);
        matches.push(buildLeadMatch(lead, 'HIGH', ['email']));
      }
    }
  }

  // Phone normalized match — HIGH confidence
  if (criteria.phone) {
    const normalizedInput = normalizePhone(criteria.phone);
    if (normalizedInput.length >= 7) {
      // Search with LIKE pattern for the last 7+ digits
      const phoneMatches = await prisma.lead.findMany({
        where: {
          tenantId,
          phone: { not: null },
          ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
          status: { not: 'Merged' },
        },
        take: 50, // Fetch more to filter client-side for phone normalization
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, companyName: true, status: true },
      });

      for (const lead of phoneMatches) {
        if (lead.phone && !seen.has(lead.id)) {
          const normalizedDb = normalizePhone(lead.phone);
          if (normalizedDb === normalizedInput) {
            seen.add(lead.id);
            matches.push(buildLeadMatch(lead, 'HIGH', ['phone']));
          }
        }
      }
    }
  }

  // Name match — MEDIUM confidence (requires both first and last name)
  if (criteria.firstName && criteria.lastName) {
    const nameMatches = await prisma.lead.findMany({
      where: {
        tenantId,
        firstName: { equals: criteria.firstName, mode: 'insensitive' },
        lastName: { equals: criteria.lastName, mode: 'insensitive' },
        ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
        status: { not: 'Merged' },
      },
      take: 5,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, companyName: true, status: true },
    });

    for (const lead of nameMatches) {
      if (!seen.has(lead.id)) {
        seen.add(lead.id);
        matches.push(buildLeadMatch(lead, 'MEDIUM', ['firstName', 'lastName']));
      }
    }
  }

  return matches;
}

// ── Contact duplicate search ──────────────────────────────────────────────────

async function findContactDuplicates(
  tenantId: string,
  criteria: { email?: string; phone?: string; firstName?: string; lastName?: string; companyName?: string; excludeId?: string },
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const seen = new Set<string>();

  // Email exact match — HIGH confidence
  if (criteria.email) {
    const emailMatches = await prisma.contact.findMany({
      where: {
        tenantId,
        email: { equals: criteria.email, mode: 'insensitive' },
        ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
        isArchived: false,
      },
      take: 5,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: true, status: true },
    });

    for (const contact of emailMatches) {
      if (!seen.has(contact.id)) {
        seen.add(contact.id);
        matches.push(buildContactMatch(contact, 'HIGH', ['email']));
      }
    }
  }

  // Phone normalized match — HIGH confidence
  if (criteria.phone) {
    const normalizedInput = normalizePhone(criteria.phone);
    if (normalizedInput.length >= 7) {
      const phoneMatches = await prisma.contact.findMany({
        where: {
          tenantId,
          phone: { not: null },
          ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
          isArchived: false,
        },
        take: 50,
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: true, status: true },
      });

      for (const contact of phoneMatches) {
        if (contact.phone && !seen.has(contact.id)) {
          const normalizedDb = normalizePhone(contact.phone);
          if (normalizedDb === normalizedInput) {
            seen.add(contact.id);
            matches.push(buildContactMatch(contact, 'HIGH', ['phone']));
          }
        }
      }
    }
  }

  // Name match — MEDIUM confidence
  if (criteria.firstName && criteria.lastName) {
    const nameMatches = await prisma.contact.findMany({
      where: {
        tenantId,
        firstName: { equals: criteria.firstName, mode: 'insensitive' },
        lastName: { equals: criteria.lastName, mode: 'insensitive' },
        ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
        isArchived: false,
      },
      take: 5,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: true, status: true },
    });

    for (const contact of nameMatches) {
      if (!seen.has(contact.id)) {
        seen.add(contact.id);
        matches.push(buildContactMatch(contact, 'MEDIUM', ['firstName', 'lastName']));
      }
    }
  }

  return matches;
}

// ── Account duplicate search ──────────────────────────────────────────────────

async function findAccountDuplicates(
  tenantId: string,
  criteria: { companyName: string; excludeId?: string },
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  const nameMatches = await prisma.account.findMany({
    where: {
      tenantId,
      name: { equals: criteria.companyName, mode: 'insensitive' },
      isArchived: false,
      ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
    },
    take: 5,
    select: { id: true, name: true, industry: true, website: true },
  });

  for (const account of nameMatches) {
    matches.push({
      id: account.id,
      entityType: 'account',
      name: account.name,
      companyName: account.name,
      confidence: 'MEDIUM',
      matchedFields: ['companyName'],
    });
  }

  return matches;
}

// ── Match builders ────────────────────────────────────────────────────────────

function buildLeadMatch(
  lead: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; companyName: string | null; status: string },
  confidence: DuplicateConfidence,
  matchedFields: string[],
): DuplicateMatch {
  return {
    id: lead.id,
    entityType: 'lead',
    name: `${lead.firstName} ${lead.lastName}`.trim(),
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    companyName: lead.companyName ?? undefined,
    status: lead.status,
    confidence,
    matchedFields,
  };
}

function buildContactMatch(
  contact: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; company: string | null; status: string },
  confidence: DuplicateConfidence,
  matchedFields: string[],
): DuplicateMatch {
  return {
    id: contact.id,
    entityType: 'contact',
    name: `${contact.firstName} ${contact.lastName}`.trim(),
    email: contact.email ?? undefined,
    phone: contact.phone ?? undefined,
    companyName: contact.company ?? undefined,
    status: contact.status,
    confidence,
    matchedFields,
  };
}
