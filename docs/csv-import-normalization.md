# CRM import infrastructure normalization

Implemented and verified locally on 2026-10-04. Production retirement completed
on the same date at 15:35:37 Asia/Manila; all eight obsolete tables are removed.
See [the production retirement report](crm-import-production-retirement.md) for
executed checks and preserved counts, and [the deployment recovery report](render-import-deployment-recovery.md)
for the earlier deployment failure. This report supersedes the
persistence and rollout portions of [the earlier CSV feature audit](csv-import-audit.md).

## 1–2. Tables found and why they existed

| Original job / result tables | Actual responsibility and differences |
|---|---|
| `LeadImport` / `LeadImportResult` | Lead history introduced in `20260821000000_add_lead_import`; common job counters, creator, tenant, filename, status and timestamps. Results stored a `leadId` and person-field snapshots. |
| `ContactImport` / `ContactImportResult` | The same job structure and person snapshots, with `contactId`. Included in the business-verification schema history and the additive `20261001120000_add_crm_import_tables` prerequisite. |
| `AccountImport` / `AccountImportResult` | The same job structure, with `accountId` and company/address snapshots in results. Same prerequisite migration history as Contacts. |
| `DealImport` / `DealImportResult` | Added in `20261004000000_deal_imports_user_recovery`. Same job structure; results already used JSONB, `dealId` and unique `(importId,rowNumber)`. |

These were module-specific implementations of the same infrastructure, not four
different business entities. Scalar result snapshots can be preserved in JSONB;
they do not require different physical tables. Legacy entity IDs were historical
references guarded by tenant checks, not domain foreign keys.

The audit covered the schema, migration history, routes/controllers/repositories,
parsing/validation, duplicate checks, transactions, history UI, idempotency, chunk
staging, tenant middleware, indexes, foreign keys and cleanup. The proposed chunk
table existed only in the pending migration. Previously, cleanup was lazy on upload.

## 3–6. Final models, retained/removed tables and relationships

| Model | Stored information | Relationships/deletion |
|---|---|---|
| `CrmImportJob` | Tenant, enum module, original `fileName`/`createdById` names, counters, status, key/hash, optional upload ID, creation/completion timestamps | Tenant and User restrict deletion; optional upload uses `SET NULL`; owns result rows |
| `CrmImportRowResult` | Job ID, physical CSV row number, status, historical `recordId`, error `remarks`, JSONB snapshot, creation time | Required job FK with `CASCADE` |
| `CrmImportUpload` | Tenant, actor, enum module, expected chunk count, source digest, expiry | Tenant/User cascade; owns chunks; optional single job |
| `CrmImportChunk` | Upload ID, chunk index and raw content | Required upload FK with `CASCADE` |

Uploads exist before preview/execution creates a job. A separate upload parent
therefore removes repeated scope/actor/module/expiry metadata from every chunk.
Inline CSV requests do not create upload records.

All eight old Prisma models and their runtime delegates/services are removed.
The retirement migration removes all eight physical tables only after verification.
They were read-only between rollout phases and are now absent from production.
Historical SQL, migration tests and the read-only inventory script intentionally
retain old names. Domain tables remain independent and are not changed by these
normalization migrations. No global customer-plus-Product Deal constraint is added.

Common values stay relational. JSONB holds module-specific field snapshots and
resolved values. Unused `updatedAt`/`errorCode` columns were not invented; existing
status strings and `remarks` preserve historical classifications and API behavior.

## 7. Migration strategy and deployment order

Read-only `prisma migrate status` and `_prisma_migrations` inspection confirmed the
configured production database had applied migrations through
`20261026000000_module_action_permissions`. The proposed
`20261027000000_crm_import_integrity` was pending and could safely be reworked for
that database. No applied historical migration was edited. Deployment state in
other databases: **I cannot confirm this.** Check those before using the revised file.

1. During an import maintenance window, run the expansion phase from `backend`:

   ```powershell
   node scripts/deploy-crm-imports.cjs --expand
   ```

   It invokes Prisma `migrate deploy` using a temporary copy of the exact checked-in
   migration files through `20261027000000_crm_import_integrity`. Checksums and
   Prisma migration bookkeeping are retained. It does not use `db push`.

2. Expansion creates normalized tables/indexes/FKs, locks the old tables, copies
   jobs and results with unchanged IDs/timestamps/relationships, and verifies
   complete payloads plus historical result counts inside a transaction. Person
   and Account snapshots retain all original scalar fields, including nulls;
   Deal JSON is copied unchanged. Old tables remain available for reads. Write
   guards prevent an old application from creating divergent history.

3. Deploy the matching backend/frontend/shared code. Resume imports on that version.
   Complete a successful import in each module for every workspace with historical
   imports. Verify the visible History and result pages. These are real business
   writes; the rollout script deliberately does not create synthetic production CRM records.

4. Supply `CRM_IMPORT_VERIFY_API` as the API base ending in `/api/v1`, and
   `CRM_IMPORT_VERIFY_TOKENS` as a JSON array of authorized bearer tokens covering
   the affected workspaces. Supply secrets through the deployment environment;
   do not commit or paste them into reports. Run from `backend`:

   ```powershell
   node scripts/deploy-crm-imports.cjs --verify
   node scripts/deploy-crm-imports.cjs --retire
   ```

   The verifier is read-only. It compares all paginated module histories, summaries
   and result payloads with the database, requires a successful normalized import
   per module, and rechecks the original historical data. The retirement command
   reruns these checks, then supplies a single-use database comment allowing the
   versioned retirement migration. Tokens and row contents are never reported.

   For small histories, an operator can instead capture the signed-in production
   UI's History and every Import Details table without exporting HttpOnly cookies.
   Set `CRM_IMPORT_VERIFY_BROWSER_EVIDENCE` to the local JSON evidence file and
   `CRM_IMPORT_VERIFY_API` to the frontend HTTPS origin (no API path in this mode).
   `verify-crm-import-browser.cjs` checks the origin, capture age, exact displayed
   History rows and every displayed result cell against Prisma, plus the same
   complete historical SQL comparison. It refuses histories over 10 jobs or 25
   results per job; use paginated API verification for those. Capture evidence
   directly from the DOM; never manufacture responses from database records.
   Keep the evidence in ignored local storage because it contains CRM data.

   A historical workspace marked `SANDBOX` with **zero active users** cannot
   complete authenticated checks. Its full historical payloads must still pass
   SQL comparison before and inside retirement. This narrow exception is reported
   separately; active workspaces and sandboxes with active users require all four
   successful imports and authenticated History checks. No users are reactivated.

5. `20261028000000_retire_legacy_crm_imports` locks the source tables and verifies
   preservation again before dropping results, then jobs, without `CASCADE`.
   Missing/changed history, extra historical results, or unexpected dependent
   tables abort and roll back the destructive phase. The verifier, temporary
   comparison views and release marker are then removed.

The hosting entry point `npm --prefix backend run db:deploy` now invokes
`--deploy`, applies expansion and defers retirement until API verification. Once
retirement is applied, it resumes ordinary migration deployment. It refuses
unresolved failures and later migrations while retirement is still pending,
rather than silently omitting a later release's schema changes. Fresh disposable
databases can also replay both SQL migrations directly.

Bare `prisma migrate deploy` against the entire history bypasses this ordering and
fails the retirement gate on a populated database. Recover that specific failed
attempt with `npm --prefix backend run db:imports:recover`; it verifies original
SQL checksums, all eight retained source tables, their write guards and complete
history equality before Prisma `migrate resolve --rolled-back`. Never mark
unexecuted SQL as applied. Run `db:imports:verify` and `db:imports:retire` only after
the authenticated API checks and successful new imports described above.

Original IDs are retained, so URLs/history links remain stable. Cross-table ID
collisions or duplicate row numbers stop expansion instead of silently deleting,
renumbering or merging historical data. They require explicit data reconciliation.

## 8–10. Counts migrated and preservation evidence

| Module | Production jobs observed | Production results observed | Live jobs/results migrated by this task | Rehearsal jobs/results migrated and retained |
|---|---:|---:|---|---|
| LEAD | 2 | 8 | 0 / 0 | 2 / 8 |
| CONTACT | 0 | 0 | 0 / 0 | 1 / 2 |
| ACCOUNT | 0 | 0 | 0 / 0 | 1 / 2 |
| DEAL | 0 | 0 | 0 / 0 | 1 / 2 |

Production counts came from `backend/scripts/inspect-crm-imports.cjs`, not estimates.
No production history was mutated. The full rollout rehearsal preserved all five
fixture jobs and fourteen results through authenticated API verification and old
table retirement. Separate preservation fixtures migrated eight jobs and sixteen
results, checking exact payload equality, Unicode, nulls, IDs, timestamps, nested
JSON and references to already-deleted domain records. Corruption and collisions
were tested to ensure rollback retains old data.

No historical fixture data was lost. Successful production migration and preservation
after deployment: **I cannot confirm this.** The target schema does not yet describe
the current production import tables; it describes the verified post-rollout state.

## 11–13. Module identity, idempotency and History

`CrmImportModule` is a PostgreSQL/Prisma enum: `LEAD`, `CONTACT`, `ACCOUNT`, `DEAL`.
One route-to-enum map connects the existing plural URLs to this controlled value.
Every repository query includes tenant and module; result queries also constrain
the parent job. Cross-module and cross-tenant IDs return 404.

One unique `(tenantId,module,idempotencyKey)` constraint governs every new import.
The request hash covers actor, filename, sorted mappings and the raw-source SHA-256.
Same-key/same-request retries return or resume the existing job; changed requests
return 409. The same key can be independently used in another module. Legacy jobs
retain null keys; no historical requests or duplicate classifications are guessed.

One unique `(importJobId,rowNumber)` constraint protects row execution. The existing
serializable transaction/retry mechanism commits the domain record, automatic
Deals, row result and progress together. Processing remains bounded to 25 rows per
request. Import idempotency does not constrain legitimate future opportunities.

All History routes query the shared job/result tables. Ordering is deterministic
by creation time and ID; status filtering and pagination stay on the server.
The same frontend history/detail components serve all modules.

## 14–15. Chunk staging and cleanup

Chunk staging is retained because files larger than the inline threshold need
durable, resumable uploads within request/proxy limits. Browser verification used
an 801,135-byte file, chunk retries and interrupted execution recovery. Four
module-specific staging systems are unnecessary.

Raw chunks are deleted immediately after job completion, including failed jobs
whose row processing completed. A source digest remains on the upload parent to
support network retries until its 24-hour expiry. The server deletes expired
upload parents at startup and hourly, cascading remaining chunks; upload requests
also perform scoped lazy cleanup. Job history survives with a null upload ID.
With a running server, expired content is removed by the next hourly run; downtime
is caught at startup. An unfinished job after expiry requires reselecting its
identical source; committed rows and request identity still prevent duplicate work.

Uploads are tenant/actor/module scoped, consistent chunk retries are accepted,
changed chunks are rejected, and aggregate size is checked. Source digests cannot
be changed once set. Raw uploaded content is not included in History or logs.

## 16–17. Backend refactor and API compatibility

`backend/src/modules/crm/imports/` contains the shared controller factory,
repository, orchestration service, upload service and cleanup scheduler. The
`importHandlers` registry dispatches identity checks, business duplicate rules,
relationship resolution and creation to module-specific functions. The sixteen
duplicated controller/service/repository/DTO files were removed. Unused frontend
API wrappers, the redundant Lead detail page and obsolete shared Deal aliases
were removed after reference searches.

Normalization adds no URL changes. Existing `fileName`, `createdById`, counters,
`remarks`, `importId` and module-specific result-ID aliases remain compatible;
`module`, `importJobId` and `recordId` expose the normalized contract. The earlier
CSV feature work changed `{fileName,rows}` to raw CSV/upload plus mappings and a
key; this normalization does not introduce another request-contract change.

Existing authentication, tenant boundaries, import/view permissions, CSV limits
and business validation remain. Prisma's automatic error logger is disabled
because failed insert arguments can contain raw CSV. Request middleware logs
sanitized import error codes without arguments, row contents or stack traces.

The actual Product catalog remains `ProductInterest`. Tests verify Lead, Contact
and Account interests; separate CCTV/Biometrics Deals at 25,000/15,000; execution-time
Product price resolution; preserved historical prices; later legitimate Deals;
and normal conversion/closing rules. No CRM domain models were merged.

## 18–19. Indexes and foreign keys

New indexes reflect actual queries:

- Job uniqueness: `(tenantId,module,idempotencyKey)` and optional `uploadId`.
- History: `(tenantId,module,createdAt,id)` and `(tenantId,module,status,createdAt,id)`.
- Results: unique `(importJobId,rowNumber)` plus `(importJobId,status,rowNumber)`.
- Upload cleanup: `expiresAt`; upload lookup uses its primary key.
- Chunks: unique `(uploadId,chunkIndex)` serves retrieval and ordered assembly.

The old tables' duplicate indexes/FKs disappear with their tables. No unused
actor-only, status-only or JSON indexes were added. Job-to-User/Tenant deletion
behavior remains restrictive; result-to-job and chunk-to-upload deletion cascades
prevent orphan infrastructure. Upload deletion never deletes history.

Tenant/actor/upload scope and parent identity remain database-guarded. New
`recordId` links are checked against the appropriate domain table's tenant.
They are historical references rather than polymorphic foreign keys, preserving
history when a domain record is deleted. The migration deliberately copies old
references before installing the guard.

## 20. Tests actually executed

| Command/check | Result |
|---|---|
| `npm exec -- vitest run src/tests/migrations/normalize-crm-imports.test.ts src/modules/crm/imports/import-logging.test.ts` from `backend` | 6 passed: preservation, rollout gate, corruption, collisions, dependent FKs, cascade/scope/uniqueness and log privacy |
| `node scripts/test-import-normalization.mjs` | 13 passed; authenticated four-module execution and historical API verification, followed by successful retirement preserving 5 jobs / 14 results |
| `node scripts/test-sales-db.mjs src/modules/crm/leads/sales-automation.integration.test.ts src/modules/crm/imports/imports.integration.test.ts src/integrations/gmail/mailbox.integration.test.ts` | 40 passed; 25 skipped (24 mailbox tests require their dedicated database name, plus the rollout-only test) |
| `node backend/scripts/test-mailbox-db.mjs` | 79 passed, including the previously skipped mailbox integration tests |
| `node backend/scripts/test-single-workspace.mjs account` | 14 passed, including the updated authenticated Deal import test and account administration regressions |
| `npm exec -- vitest run src/features/tenant/crm/shared/import/utils/import-validation.test.ts` from `frontend` | 12 passed |
| `node scripts/verify-csv-imports.cjs` with local preview API/frontend and bundled Playwright | Four real browser flows, 120 viewport checks, large-file chunking and interrupted-batch History recovery passed |

Database tests replay the checked-in SQL migrations in disposable PostgreSQL-compatible
PGlite databases, never the deployment database. The browser checked widths 1440,
768, 390, 375 and 320, retaining the existing UI. Tests cover duplicate rules,
Products/prices, row errors, completed and partial retries, progress, all module
histories, scope/RBAC, cleanup and cascade preservation. Counts across commands
overlap; they should not be presented as a count of distinct tests.

## 21–22. Prisma, build, typecheck and lint actually executed

- `npx prisma migrate status` from `backend`: read-only production check confirmed
  the pending expansion migration before reworking it; exit 1 indicated pending work.
- `npx prisma validate` from `backend`: passed.
- `npm --prefix backend run db:generate`: passed; Prisma Client generated.
- `node scripts/verify-import-schema.mjs`: replayed all migrations and ran real
  Prisma `migrate diff` against `schema.prisma`. No import-model drift. The sole
  unrelated difference is the pre-existing `ClosingFieldDefinition.updatedAt`
  database default; it was left unchanged.
- `npm run lint`: all three workspaces passed their TypeScript checks. The scripts
  run `tsc --noEmit`; no separate ESLint suite is claimed.
- `npm run build`: frontend and backend production builds passed. The first
  sandbox attempt failed with Windows `EPERM readlink`; the approved unrestricted
  retry succeeded.
- `git diff --check`: passed. Repository searches found no old Prisma import
  models/delegates in runtime code; old names remain where needed for migration
  SQL, migration fixtures, read-only inventory and audit documentation.

Local logs use the ignored `data-import-normalized-*.log` prefix. Browser evidence
is under ignored `data/outputs/csv-import-qa/`. The aggregate production inventory
is ignored; customer row data was not exported into the repository.

## 23. Remaining risks and limits

Production expansion, application deployment, API verification and retirement are
still required in that order. Live import behavior after this rollout and exact
production-schema agreement: **I cannot confirm this.** No obsolete production
table has been dropped by this task.

Full multi-connection native PostgreSQL concurrency, a 5,000-row live execution,
provider timeout behavior and cleanup timing during production downtime:
**I cannot confirm this.** The tests use PGlite with one database connection and
real Prisma/HTTP; they are not a production load test. Prisma migration SQL was
replayed locally, but the production `migrate deploy` command itself was not run.

Existing build warnings concern Next.js workspace-root detection and localhost
API defaults in the local build. The deployed API URL must remain configured.
Vite reports an existing native config-loader compatibility warning. No known
failing import test remains.
