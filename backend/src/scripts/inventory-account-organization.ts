/**
 * READ-ONLY inventory for the CRM Data Model Consolidation spec (Task 0 gate).
 *
 * Spec: .kiro/specs/crm-data-model-consolidation/  (design.md — Pre-migration inventory)
 * ADR:  docs/decisions/ADR-001-canonical-company-model.md
 *
 * This script ONLY READS. It performs no writes, no schema changes, and no migrations.
 * It gathers the 8 inventory items needed before Phase 1 of the Account <- Organization
 * consolidation can be considered.
 *
 * Run:  npx ts-node src/scripts/inventory-account-organization.ts   (from /backend)
 * Uses: DATABASE_URL from backend/.env (same client the app uses).
 *
 * Safety: all queries are SELECT/count/groupBy only. Legacy-table checks (Customer /
 * CustomerDeal) use raw SELECT wrapped in try/catch because those tables are not modeled
 * in the current Prisma schema and may already be dropped.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

function heading(title: string): void {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

async function main(): Promise<void> {
  console.log('CRM Data Model Consolidation — READ-ONLY inventory');
  console.log('No data will be modified. Generated at:', new Date().toISOString());

  // ── 1. Total Account records ────────────────────────────────────────────
  heading('1. Total Account records');
  const totalAccounts = await prisma.account.count();
  console.log('Accounts:', totalAccounts);

  // ── 2. Total Organization records ───────────────────────────────────────
  heading('2. Total Organization records');
  const totalOrganizations = await prisma.organization.count();
  console.log('Organizations:', totalOrganizations);

  // ── 3. Contacts referencing an Organization ─────────────────────────────
  heading('3. Contacts with organizationId set');
  const contactsWithOrg = await prisma.contact.count({ where: { organizationId: { not: null } } });
  const contactsTotal = await prisma.contact.count();
  console.log('Contacts total:', contactsTotal);
  console.log('Contacts linked to an Organization:', contactsWithOrg);

  // ── 4. Same/similar names within the same tenant (exact, normalized) ─────
  heading('4. Organization names that match an Account name within the SAME tenant');
  const nameMatches = await prisma.$queryRawUnsafe<
    Array<{ tenantId: string; name: string; acct_matches: bigint }>
  >(`
    SELECT o."tenantId", lower(trim(o.name)) AS name, COUNT(DISTINCT a.id) AS acct_matches
    FROM "Organization" o
    LEFT JOIN "Account" a
      ON a."tenantId" = o."tenantId" AND lower(trim(a.name)) = lower(trim(o.name))
    GROUP BY o."tenantId", lower(trim(o.name))
    ORDER BY acct_matches DESC, name ASC
  `);
  const matched = nameMatches.filter((r) => Number(r.acct_matches) > 0);
  const unmatched = nameMatches.filter((r) => Number(r.acct_matches) === 0);
  console.log(`Distinct org names: ${nameMatches.length}`);
  console.log(`  → with >=1 matching Account (reuse candidates): ${matched.length}`);
  console.log(`  → with NO matching Account (create candidates):  ${unmatched.length}`);
  console.log(`  → with MULTIPLE matching Accounts (AMBIGUOUS — must flag): ${matched.filter((r) => Number(r.acct_matches) > 1).length}`);
  if (matched.filter((r) => Number(r.acct_matches) > 1).length > 0) {
    console.log('  Ambiguous (multi-match) rows:');
    for (const row of matched.filter((r) => Number(r.acct_matches) > 1)) {
      console.log(`    tenant=${row.tenantId} name="${row.name}" accounts=${Number(row.acct_matches)}`);
    }
  }

  // ── 5. Duplicate companies (same tenant + normalized name, >1 id) ────────
  heading('5. Duplicate company names within a tenant (multiple ids)');
  const dupAccounts = await prisma.$queryRawUnsafe<Array<{ tenantId: string; name: string; n: bigint }>>(`
    SELECT "tenantId", lower(trim(name)) AS name, COUNT(*) AS n
    FROM "Account" GROUP BY 1,2 HAVING COUNT(*) > 1 ORDER BY n DESC
  `);
  const dupOrgs = await prisma.$queryRawUnsafe<Array<{ tenantId: string; name: string; n: bigint }>>(`
    SELECT "tenantId", lower(trim(name)) AS name, COUNT(*) AS n
    FROM "Organization" GROUP BY 1,2 HAVING COUNT(*) > 1 ORDER BY n DESC
  `);
  console.log(`Duplicate Account name groups:      ${dupAccounts.length}`);
  dupAccounts.forEach((r) => console.log(`    [Account] tenant=${r.tenantId} name="${r.name}" count=${Number(r.n)}`));
  console.log(`Duplicate Organization name groups: ${dupOrgs.length}`);
  dupOrgs.forEach((r) => console.log(`    [Org]     tenant=${r.tenantId} name="${r.name}" count=${Number(r.n)}`));

  // ── 6. Contacts whose Organization has NO matching Account (must create) ─
  heading('6. Contacts whose Organization has NO name-matching Account in tenant');
  const unmappable = await prisma.$queryRawUnsafe<
    Array<{ id: string; tenantId: string; name: string }>
  >(`
    SELECT c.id, c."tenantId", o.name
    FROM "Contact" c JOIN "Organization" o ON o.id = c."organizationId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "Account" a
      WHERE a."tenantId" = c."tenantId" AND lower(trim(a.name)) = lower(trim(o.name))
    )
  `);
  console.log(`Contacts needing a NEW Account created during backfill: ${unmappable.length}`);
  unmappable.slice(0, 25).forEach((r) => console.log(`    contact=${r.id} tenant=${r.tenantId} org="${r.name}"`));
  if (unmappable.length > 25) console.log(`    ...and ${unmappable.length - 25} more`);

  // ── 7. Field differences on name-matched pairs ──────────────────────────
  heading('7. Field differences between name-matched Account/Organization pairs');
  const fieldDiffs = await prisma.$queryRawUnsafe<
    Array<{
      org_id: string; acct_id: string; tenantId: string; name: string;
      o_ind: string | null; a_ind: string | null;
      o_web: string | null; a_web: string | null;
      o_size: string | null; a_size: string | null;
    }>
  >(`
    SELECT o.id AS org_id, a.id AS acct_id, o."tenantId", o.name,
           o.industry AS o_ind, a.industry AS a_ind,
           o.website  AS o_web, a.website  AS a_web,
           o.size     AS o_size, a.size    AS a_size
    FROM "Organization" o JOIN "Account" a
      ON a."tenantId" = o."tenantId" AND lower(trim(a.name)) = lower(trim(o.name))
  `);
  const conflicting = fieldDiffs.filter(
    (r) => r.o_ind !== r.a_ind || r.o_web !== r.a_web || r.o_size !== r.a_size,
  );
  console.log(`Name-matched pairs: ${fieldDiffs.length}`);
  console.log(`  → with field conflicts (keep Account value, report Org value): ${conflicting.length}`);
  conflicting.slice(0, 25).forEach((r) =>
    console.log(
      `    "${r.name}" (tenant=${r.tenantId})` +
        ` ind[o=${r.o_ind ?? '-'}|a=${r.a_ind ?? '-'}]` +
        ` web[o=${r.o_web ?? '-'}|a=${r.a_web ?? '-'}]` +
        ` size[o=${r.o_size ?? '-'}|a=${r.a_size ?? '-'}]`,
    ),
  );
  if (conflicting.length > 25) console.log(`    ...and ${conflicting.length - 25} more`);

  // ── 8. Legacy orphan tables (Customer / CustomerDeal) ────────────────────
  heading('8. Legacy orphan tables (Customer / CustomerDeal) row counts');
  for (const table of ['Customer', 'CustomerDeal'] as const) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
      );
      console.log(`${table}: ${Number(rows[0]?.count ?? 0)} rows`);
    } catch {
      console.log(`${table}: table does not exist (already dropped) — safe`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  heading('SUMMARY (feed these into the backfill/duplicate strategy review)');
  console.log(JSON.stringify(
    {
      totalAccounts,
      totalOrganizations,
      contactsTotal,
      contactsLinkedToOrganization: contactsWithOrg,
      orgNames_reuseCandidates: matched.length,
      orgNames_createCandidates: unmatched.length,
      orgNames_ambiguousMultiMatch: matched.filter((r) => Number(r.acct_matches) > 1).length,
      duplicateAccountNameGroups: dupAccounts.length,
      duplicateOrgNameGroups: dupOrgs.length,
      contactsNeedingNewAccount: unmappable.length,
      nameMatchedPairs: fieldDiffs.length,
      nameMatchedPairsWithConflicts: conflicting.length,
    },
    null,
    2,
  ));
  console.log('\nDone. No data was modified.');
}

main()
  .catch((err) => {
    console.error('Inventory failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
