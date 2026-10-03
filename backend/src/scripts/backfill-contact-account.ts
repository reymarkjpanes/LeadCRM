/**
 * Phase 2 (Backfill) of the CRM Data Model Consolidation (ADR-001).
 *
 * Spec: .kiro/specs/crm-data-model-consolidation/  (design.md — Migration strategy, Phase 2)
 *
 * Goal: for every Contact that still references an Organization, ensure the Contact points at
 * the canonical Account (Contact.accountId), reusing an existing Account when there is strong
 * same-company evidence within the SAME tenant, else creating one from the Organization's fields.
 *
 * SAFETY / RULES (from the spec):
 *   - Tenant-scoped ONLY. Never match across tenants. Every write asserts
 *     mappedAccount.tenantId === contact.tenantId.
 *   - Match key: lower(trim(name)). Exact normalized match within tenant => reuse.
 *   - Ambiguity (multiple candidate Accounts) => FLAG and SKIP (never guess/auto-merge).
 *   - Field conflicts between a matched Account and the Organization => keep the Account value,
 *     RECORD the Organization's differing value in the report (do not overwrite the Account).
 *   - DRY-RUN by default. Pass --apply to perform writes.
 *   - Idempotent: contacts that already have the correct accountId are skipped.
 *
 * Run (dry-run, default):  npx ts-node src/scripts/backfill-contact-account.ts
 * Run (apply writes):      npx ts-node src/scripts/backfill-contact-account.ts --apply
 *
 * On the current dev DB (0 Organizations, 0 Contacts) this is a no-op and reports nothing to do.
 * IMPORTANT: take a database snapshot before running with --apply on any populated database,
 * and re-run the inventory (inventory-account-organization.ts) against production first.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY (writes enabled)' : 'DRY-RUN (no writes)';

function norm(name: string): string {
  return name.trim().toLowerCase();
}

interface ConflictField {
  field: string;
  accountValue: unknown;
  organizationValue: unknown;
}

interface ReportRow {
  contactId: string;
  tenantId: string;
  organizationId: string;
  organizationName: string;
  action: 'skip-already-linked' | 'reuse-account' | 'create-account' | 'FLAG-ambiguous' | 'FLAG-tenant-mismatch';
  accountId?: string;
  conflicts?: ConflictField[];
}

/** Fields Account and Organization share — used to carry data when creating a new Account. */
function accountDataFromOrganization(org: {
  tenantId: string; assignedUserId: string | null; name: string; industry: string | null;
  size: string | null; website: string | null; tags: string[];
  address: string | null; city: string | null; province: string | null; country: string | null;
  activeProducts: string[];
  internalNotes: string | null; notes: string | null; productInterests: string[];
}) {
  return {
    tenantId:         org.tenantId,
    assignedUserId:   org.assignedUserId,
    name:             org.name,
    industry:         org.industry,
    size:             org.size,
    website:          org.website,
    tags:             org.tags,
    address:          org.address,
    city:             org.city,
    province:         org.province,
    country:          org.country,
    activeProducts:   org.activeProducts,
    internalNotes:    org.internalNotes,
    notes:            org.notes,
    productInterests: org.productInterests,
  };
}

function detectConflicts(
  account: { industry: string | null; website: string | null; size: string | null },
  org: { industry: string | null; website: string | null; size: string | null },
): ConflictField[] {
  const conflicts: ConflictField[] = [];
  const compare: Array<[string, unknown, unknown]> = [
    ['industry', account.industry, org.industry],
    ['website', account.website, org.website],
    ['size', account.size, org.size],
  ];
  for (const [field, a, o] of compare) {
    if (o != null && a !== o) conflicts.push({ field, accountValue: a, organizationValue: o });
  }
  return conflicts;
}

async function main(): Promise<void> {
  console.log('CRM Data Model Consolidation — Phase 2 Backfill (Contact -> Account)');
  console.log('Mode:', MODE);
  console.log('Timestamp:', new Date().toISOString());

  // Only contacts still linked to an Organization and not yet linked to an Account need work.
  const contacts = await prisma.contact.findMany({
    where: { organizationId: { not: null } },
    select: { id: true, tenantId: true, organizationId: true, accountId: true },
  });

  console.log(`Contacts linked to an Organization: ${contacts.length}`);
  if (contacts.length === 0) {
    console.log('Nothing to backfill. Done. No data modified.');
    return;
  }

  const report: ReportRow[] = [];
  let reused = 0, created = 0, skipped = 0, flagged = 0;

  for (const contact of contacts) {
    if (contact.accountId) {
      report.push({
        contactId: contact.id, tenantId: contact.tenantId,
        organizationId: contact.organizationId!, organizationName: '(already linked)',
        action: 'skip-already-linked', accountId: contact.accountId,
      });
      skipped++;
      continue;
    }

    const org = await prisma.organization.findFirst({
      where: { id: contact.organizationId!, tenantId: contact.tenantId },
    });
    if (!org) {
      // Organization missing or belongs to another tenant — never map across tenants.
      report.push({
        contactId: contact.id, tenantId: contact.tenantId,
        organizationId: contact.organizationId!, organizationName: '(org not found in tenant)',
        action: 'FLAG-tenant-mismatch',
      });
      flagged++;
      continue;
    }

    // Tenant-scoped exact normalized name match against Account.
    const candidates = await prisma.account.findMany({
      where: { tenantId: contact.tenantId },
      select: { id: true, tenantId: true, name: true, industry: true, website: true, size: true },
    });
    const matches = candidates.filter((a) => norm(a.name) === norm(org.name));

    if (matches.length > 1) {
      report.push({
        contactId: contact.id, tenantId: contact.tenantId,
        organizationId: org.id, organizationName: org.name,
        action: 'FLAG-ambiguous',
      });
      flagged++;
      continue;
    }

    if (matches.length === 1) {
      const account = matches[0];
      // Tenant-isolation invariant.
      if (account.tenantId !== contact.tenantId) {
        report.push({
          contactId: contact.id, tenantId: contact.tenantId,
          organizationId: org.id, organizationName: org.name, action: 'FLAG-tenant-mismatch',
        });
        flagged++;
        continue;
      }
      const conflicts = detectConflicts(account, org);
      report.push({
        contactId: contact.id, tenantId: contact.tenantId,
        organizationId: org.id, organizationName: org.name,
        action: 'reuse-account', accountId: account.id,
        conflicts: conflicts.length ? conflicts : undefined,
      });
      reused++;
      if (APPLY) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { accountId: account.id },
        });
      }
      continue;
    }

    // No match — create a new Account from the Organization's fields (tenant-scoped by construction).
    report.push({
      contactId: contact.id, tenantId: contact.tenantId,
      organizationId: org.id, organizationName: org.name, action: 'create-account',
    });
    created++;
    if (APPLY) {
      const newAccount = await prisma.account.create({ data: accountDataFromOrganization(org) });
      if (newAccount.tenantId !== contact.tenantId) {
        throw new Error(`Tenant invariant violated creating account for contact ${contact.id}`);
      }
      await prisma.contact.update({
        where: { id: contact.id },
        data: { accountId: newAccount.id },
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log('\n=== Mapping report ===');
  for (const row of report) {
    let line = `  [${row.action}] contact=${row.contactId} tenant=${row.tenantId} org="${row.organizationName}"`;
    if (row.accountId) line += ` account=${row.accountId}`;
    if (row.conflicts) {
      line += ` CONFLICTS(kept Account value): ` +
        row.conflicts.map((c) => `${c.field}[acct=${String(c.accountValue)}|org=${String(c.organizationValue)}]`).join(' ');
    }
    console.log(line);
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify({
    mode: MODE,
    contactsLinkedToOrganization: contacts.length,
    reuseAccount: reused,
    createAccount: created,
    alreadyLinkedSkipped: skipped,
    flaggedForManualReview: flagged,
  }, null, 2));

  if (flagged > 0) {
    console.log(`\n⚠ ${flagged} contact(s) FLAGGED for manual review — not auto-mapped. Resolve before contract phase.`);
  }
  if (!APPLY) {
    console.log('\nDRY-RUN complete. No data modified. Re-run with --apply (after a DB snapshot) to write.');
  } else {
    console.log('\nAPPLY complete.');
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
