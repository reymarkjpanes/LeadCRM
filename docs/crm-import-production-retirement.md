# Production import retirement — 2026-10-04

`20261028000000_retire_legacy_crm_imports` completed in the configured production
database at `2026-10-04T07:35:37.822Z` (15:35:37 Asia/Manila). All eight legacy
tables are absent. A subsequent normal `npm run db:deploy` found all 81 migration
files and reported no pending migrations. Applied SQL history was not rewritten.

## Tables and data preservation

| Retired source tables | Historical jobs preserved | Historical result rows preserved |
|---|---:|---:|
| LeadImport / LeadImportResult | 2 | 8 |
| ContactImport / ContactImportResult | 0 | 0 |
| AccountImport / AccountImportResult | 0 | 0 |
| DealImport / DealImportResult | 0 | 0 |

The shared tables are `CrmImportJob`, `CrmImportRowResult`, `CrmImportUpload` and
`CrmImportChunk`. Jobs use the existing tenant scope and controlled `LEAD`,
`CONTACT`, `ACCOUNT`, `DEAL` enum. Results belong to jobs with cascade deletion
and unique `(importJobId, rowNumber)`. Idempotency is shared and unique per
`tenantId + module + idempotencyKey`, with a request hash preventing changed retries.

Before retirement, the SQL verifier compared every original job/result payload,
not only counts. A local snapshot also captured all normalized jobs/results.
After retirement, every normalized job/result matched that snapshot exactly:
**6 jobs and 12 results**, comprising the 2 original jobs/8 results and 4 authorized
test imports/4 results. No historical import data was lost. The local snapshot and
browser evidence are ignored files because they contain CRM data.

The retirement transaction locked the eight sources, reran preservation checks,
and dropped only their result/job tables, temporary comparison views and verifier/
write-guard functions. Their indexes and foreign keys disappeared with them.
Shared indexes/foreign keys remain as documented in the [architecture report](csv-import-normalization.md).
`LeadDeal`, `ContactDeal` and CRM domain tables remain separate and present.

## Production verification

The user signed into LeadCRM and explicitly authorized clearly labeled test
records. Through the deployed import UI, one CSV was uploaded, mapped, validated
and successfully imported for each module. The records use `IMPORT QA 20261004`
names and reserved `example.invalid` emails. They remain available for review.

- Lead: one record with CCTV Product Interest and one automatic Deal.
- Contact: one record with CCTV Product Interest.
- Account: one record with CCTV Product Interest.
- Deal: one record linked to the test Contact and CCTV Product.

Both the automatic and directly imported Deals have value **5500**, matching the
workspace's existing CCTV Product configuration. No Product price was changed.
The four imported records' Product links/snapshots were verified by database reads.
The tests therefore add one Lead, one Contact, one Account and two Deals in total.

All four History tables and every visible result row in the active workspace
were captured from the signed-in UI and matched against Prisma before retirement,
including the original four-row Lead import. Each module's history was isolated.
Direct browser navigation to JSON API responses was blocked, so a small-history
DOM-evidence verifier was added rather than exporting authentication cookies. It
checks origin, freshness, complete displayed rows and all result cells, and refuses
pagination it cannot fully verify. The original paginated API-token path remains.

After retirement, all four History pages were loaded again from the deployed
service and their displayed tables matched the saved pre-retirement evidence
exactly. The Deal result page was also reloaded and matched, including its Product
value. Five post-retirement page comparisons passed.

The other historical import belongs to the Makati `SANDBOX`, which has **zero
active users**. Its full job/result payloads passed database comparison before
and inside retirement. It could not pass an authenticated UI check, and no user
was reactivated. The verifier permits this narrowly checked dormant-sandbox case;
active workspaces and sandboxes with active users still require authenticated
verification and successful new imports in all four modules.

## Executed checks

- `node scripts/test-import-normalization.mjs`: **13 integration tests passed**
  on an isolated database, including new imports, Product values, duplicates,
  retries/idempotency across all four modules, validation/errors, permissions,
  history isolation, chunk cleanup and two-phase retirement with exact preservation.
- `node --test backend/scripts/verify-crm-import-rollout.test.cjs`: **4 tests
  passed**, covering stale/wrong-origin/missing evidence, mismatched rows/counts,
  successful-import requirements and rejection of unsafe sandbox exemptions.
- `npm run db:imports:verify`: passed against production using captured UI evidence.
- `npm run db:imports:retire`: reran verification and applied the checked-in SQL.
- Read-only before/after comparison: exact normalized payload match; old tables
  absent; the completed migration is recorded in `_prisma_migrations`.
- `npm run db:deploy`: no pending migrations after retirement.
- `node ../node_modules/prisma/build/index.js validate` from `backend`: passed.
- `npm run db:generate` from `backend`: passed, Prisma Client 5.22.0.
- Updated script syntax checks and `git diff --check`: passed.

The backend build/TypeScript compilation passed during the immediately preceding
deployment repair. This follow-up changes only operator scripts/tests/docs; it
does not change runtime API contracts or frontend code. A new full workspace
build/lint was not executed in this follow-up. Production retry/error/concurrency
cases were not deliberately injected: **I cannot confirm this** from live tests;
those behaviors passed the isolated integration suite.

Chunk staging remains shared because uploads can precede jobs and large CSVs
need chunked transfer. Expired upload parents are purged on startup and hourly,
cascading raw chunks; completed import source is released immediately. No staged
uploads/chunks were present during this production rollout. Long-running cleanup
under every future hosting condition: **I cannot confirm this**.
