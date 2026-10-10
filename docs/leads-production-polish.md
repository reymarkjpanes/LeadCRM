# Leads production polish and ownership transfer

Verification date: 8 October 2026. Scope: the existing Leads UI, its server contract, dependent CRM paths, and safe Team Management deactivation.

The implementation is local and uncommitted. The existing Leads layout, typography, colors, field sections, and DataGrid design are preserved. Three obsolete Lead columns are removed from Prisma and have a forward retirement migration: `description`, `website`, and `productInterestOther`. Historical values are copied exactly into hidden, inactive `CustomFieldValue` records before the physical drop.

**The configured database was audited read-only; its columns have not been dropped in this session.** The last audit found 8 Leads, all normalized, no unresolved Product rows, no archived Leads, one converted Lead, and no non-null values in the three retired columns. Its latest applied migration was `20261109000000_campaign_final_statuses`. This is an audit snapshot, not a deployment result. Deployed release, live column retirement, and production acceptance: **I cannot confirm this.**

## Database changes and release sequence

| Migration | Purpose |
| --- | --- |
| `20261110000000_preserve_retired_lead_fields` | Preserve exact text, empty strings and Unicode in hidden archival custom values. A temporary trigger also preserves writes from the old application. Lead timestamps are unchanged. Reserved field-ID collisions abort the migration. |
| `20261111000000_crm_ownership_safety` | Assignment and deactivation triggers lock the same User row and prevent new active records from being assigned to an inactive user. Deactivation is blocked while active CRM ownership remains. |
| `20261112000000_retire_lead_nonform_columns` | Verify exact preservation, require the release-verification marker on populated databases, remove the temporary trigger, and physically drop the three columns. |

System fields remain because the application uses them: IDs, tenant ownership, timestamps, authors, assignment, archive/conversion metadata, engagement timestamps, retry receipts and Product normalization state. Product compatibility arrays remain an explicit fallback for unresolved historical rows; `LeadProductInterest` remains authoritative for normalized records. Removing these system fields merely because they are absent from a form would break history, authorization or automation.

Use the existing forward deployment entry point; do not use `db push`, reset the database, or bypass the migration gate.

1. Build and deploy the reviewed release using `npm --prefix backend run db:deploy`. Normal deployment applies preservation/ownership changes while deferring the destructive Lead migration and any independently deferred relationship retirement.
2. Confirm that the API is serving that release, and set `CRM_LEADS_VERIFY_API` to its HTTPS base ending in `/api/v1`, `CRM_LEADS_VERIFY_COMMIT` to its exact 40-character SHA, and `CRM_LEADS_VERIFY_TOKEN` to an authenticated Client Admin token. Supply credentials privately through the deployment environment.
3. Run `npm --prefix backend run db:leads:verify`. The gate checks the health SHA/capability, authenticated user and database identity, and list/detail serialization.
4. Run `npm --prefix backend run db:leads:retire`. It repeats verification, enables the single-use marker and runs the drop migration with the preservation check under a database lock.
5. Run `node scripts/audit-lead-polish.cjs` from `backend`, check migration status, and smoke-test the deployed API and UI. The audit prints schema/aggregate counts, never credentials or record values.

The drop and preservation guards were executed on disposable PostgreSQL-compatible databases. Steps against the configured production database have not been executed here.

## Verification evidence

Across the focused checks below, 234 backend/migration tests and 32 frontend tests passed; one deployed import-rollout test was skipped. These are focused checks, not a claim that the entire repository test suite passed. Generated screenshots and logs remain ignored under `data/outputs/lead-polish-browser/` and `data/outputs/product-normalization-tests/`.

| Check | Result / evidence |
| --- | --- |
| Lead/deactivation SQL and authenticated HTTP | 12 passed. `leads-results.json`; includes rollback, concurrent assignment, 505-record batching, safe serialization and Product merge identity. |
| Sales automation, normalized Products, CSV imports, notifications | 48 passed, 1 skipped. The skipped test requires deployed import-rollout API verification. `lead-regressions-results.json`. |
| Workflow integration and polish | 71 passed. `lead-workflow-results.json`. Includes retired settings retained in drafts and rejected on activation. |
| Public Forms | 19 passed. `forms-results.json`. |
| Module custom fields | 9 passed. `custom-fields-results.json`. |
| CRM completion, engagement and notifications | 14 passed. `completion-results.json`. |
| Archive, restore, authorization, local file upload/download | 31 passed. `archive-rerun.log`. Storage provider simulated locally; actual bytes were persisted and downloaded. |
| Conversion preservation/property checks | 6 passed. `conversion-final.log`; includes reused Product names and original Deal preservation. |
| Backend change-event and required-name unit checks | 19 passed. `backend-unit.log`. |
| Frontend Team Management, assignment, date filters, Workflow controls, background refresh | 32 passed across the focused run and corrected Workflow selector rerun. `frontend-tests.log` and `frontend-workflow-rerun.log`. |
| Migration and deployment guards | 5 passed. `migration-tests.log`. Verified columns physically absent after the disposable migration and exact historical values still present. |
| Built-app browser acceptance | 22 checks passed; no page or transport errors. Widths 1440, 1024, 768, 390, 375 and 320. Real local API/authentication/database; includes input rejection, Lead persistence, cancel without writes, final reassignment, and inactive agent exclusion. |
| Shared, backend, frontend typechecks | Passed (`lint` in these workspaces runs `tsc --noEmit`). |
| Backend production build | Passed. Prisma client generated from the updated schema. |
| Frontend production build | Passed with explicit build-only `API_URL=https://api.example.test/api/v1`; no production endpoint contacted. Existing multiple-lockfile warning remains. |
| Whitespace check | `git diff --check` passed. |

Windows sandbox access/socket/cache failures were rerun outside the sandbox. A conversion test run overlapped Prisma regeneration and failed during import; it was rerun after generation finished and passed. Older Workflow/archive fixtures required updates for the current onboarding requirement, Client Admin exclusion and retired Lead fields. Their final results above supersede those failed intermediate attempts; the failed attempts were not counted as passes.

## Leads report: requested items 1–72

| # | Topic | Implementation / verification boundary |
| --- | --- | --- |
| 1 | Files changed | Exact repository file inventory appears below. |
| 2 | UI preservation | Existing layout and controls retained. Broken conversion options and retired Workflow inputs removed; validation and responsive modal behavior corrected. No visual redesign. |
| 3 | Final form fields | First Name, Last Name, Email, optional Phone, Company Name, Status, Product Interest, Account, Assigned Agent, Source, Full Address, plus configured Custom Fields. |
| 4 | Validation authority | `shared/src/contracts/lead.contract.ts`; backend DTO aliases and frontend validation consume shared constraints. |
| 5 | Stale DTOs | Old create/update DTOs alias canonical Lead types. Frontend request types also use the shared Lead contract. Unknown/retired request fields are rejected. |
| 6 | Legacy naming | Existing `crm/contacts` implementation stays in place to avoid breaking imports. Routes explicitly call it `leadController`; the Contact API remains separate in `contacts-v2`. |
| 7 | Status | Hot, Warm, Cold, Closed, Cancelled. Legacy casing is normalized for reads; writes use canonical values. |
| 8 | Source | Google Ads, Referral, Email Campaign, Website, Social Media Advertisement, Direct Mail, Content Marketing, Others. Historical unsupported sources are not silently overwritten by unrelated edits. |
| 9 | Phone | Optional; when present, exactly 10 Philippine mobile digits starting with 9, stored as `+63…`. Existing input rejects invalid characters and excess digits; server independently validates. |
| 10 | Agent eligibility | Active same-tenant user, non-Guest/non-Client Admin, with persisted Lead and Deal view/edit permissions. Server exposes the eligibility flag used by selectors. |
| 11 | Client Admin | Excluded from new sales assignments and replacement choices. Historical unchanged owners remain readable. |
| 12 | Auto assignment | Existing persisted round-robin cursor runs inside the serializable creation transaction. No eligible agents leaves the record unassigned. |
| 13 | Product authority | Tenant-owned Product catalog IDs; current catalog price is read on the server. |
| 14 | Normalized Lead links | `LeadProductInterest` is authoritative. Explicit Product edits atomically replace links. |
| 15 | API projection | Shared database projection produces canonical Product IDs/names. Safe Lead serializer hides retry keys, normalization flags and engagement internals. Also used for merge responses. |
| 16 | Edit selection | Form initializes Product selections from `productInterestIds`, including normalized rows whose physical legacy arrays are empty. |
| 17 | Automatic Deals | One Product Deal per selected Lead/Product using the existing Sales Pipeline starting stage and normalized junction. |
| 18 | Deal Product source | Projected canonical Lead Product IDs, not empty legacy name arrays. |
| 19 | Deal value | Snapshot from Product price at creation. Existing Deal price/stage/history is preserved on subsequent Lead edits. |
| 20 | Duplicate prevention | Tenant creation receipt, Lead/Product automation key, existing associations and serializable retry behavior. |
| 21 | Adding Product | Adds its link and missing Deal; retains existing Deals. |
| 22 | Removing Product | Removes selection only; historical Deal, value and associations survive. |
| 23 | Deal Created events | Queued during the transaction, dispatched after successful commit; failed transaction attempts discard their queued effects. |
| 24 | Lead Created events | Shared manual/import/public-Form creation path queues the event once for a newly created Lead. Retry receipts return the original row. |
| 25 | Lead Updated events | Diffs use actual transaction before/after state, including saved Custom Fields. No update event for timestamp-only saves. |
| 26 | Status Changed events | Uses persisted previous/new status, avoiding stale pre-transaction snapshots. Existing trigger layer deduplicates event receipts. |
| 27 | Engagement | Existing reply-timing rules retained and covered by CRM completion tests. Live Gmail ingestion: I cannot confirm this. |
| 28 | Closed guard | Requires an associated active Deal with a confirmed Won stage. Closed updates also require related module permissions. |
| 29 | Cancelled | Cancels qualifying open Deals through existing stage-history logic; previously terminal Deals remain unchanged. Newly added Deals on Cancelled Leads are handled too. |
| 30 | Conversion | Uses the existing transactional conversion path, preserves the Lead and records conversion metadata/history. Arbitrary Deal creation/skip-Contact options are rejected. |
| 31 | Contact resolution | Uses selected same-tenant identity or exact normalized email. Ambiguous/archived matches fail safely. Existing customer assignment is preserved. |
| 32 | Account resolution | Uses explicit/linked Account or normalized exact company match; ambiguous or conflicting links abort. |
| 33 | Product preservation | Canonical IDs retained in Contact/Account relationships, including retired Products and reused catalog names. Unresolved historical text retains its compatibility path. |
| 34 | Deal preservation | Original Deal IDs, stages, prices and agents retained; Contact associations added transactionally. |
| 35 | Conversion retries | Reuse the original Contact and conversion timestamp; do not rewrite converted identity or duplicate conversion history. |
| 36 | Converted edit guard | Lead edits/Custom Field edits reject converted records and direct staff to the Contact. |
| 37 | Custom Fields | Existing definitions and `CustomFieldValue` persistence retained. Hidden/disabled values survive; archived Lead direct access is blocked. No new standard form fields. |
| 38 | Duplicates | Existing tenant-scoped email/phone/name duplicate detection and warning UI retained; no automatic destructive merge introduced. Dedicated duplicate-warning browser acceptance: I cannot confirm this. |
| 39 | Merge | Serializable Lead merge checks active/non-converted identities, archives the loser, preserves custom/file/history records, deduplicates campaign membership, and preserves selected Product IDs. Repeated merges reject safely. |
| 40 | Search/filter/sort | Applied in the database before pagination, with allowlisted sorting and stable ID tie-breaker. |
| 41 | Current-page filter bug | Presence and Updated/Never Updated filters now run server-side. Counts come from database facets over the matching scope. |
| 42 | Created Date | Existing Asia/Manila UTC+08:00 inclusive calendar-day bounds retained independently of browser/server timezone. |
| 43 | Assigned Agent column | Existing column renderer retained; filter labels use Assigned Agent and expose the full eligible directory. |
| 44 | Email actions | Table and row actions navigate to the existing Inbox composer instead of `mailto:`. |
| 45 | Activity | Existing histories retained. Normal Lead activity endpoints require an active same-tenant Lead, including direct Activity IDs. |
| 46 | Quick Log | Existing shared scroll behavior preserved; no layout changes. Dedicated Quick Log browser acceptance in this run: I cannot confirm this. |
| 47 | Files | Existing private metadata/byte storage preserved. Active-record authorization is enforced; local upload/list/download tests passed. Live Supabase Storage: I cannot confirm this. |
| 48 | Archive | Marks archive metadata while preserving business status, relationships and history. |
| 49 | Restore | Preserves business status; legacy `Archived` status falls back to Warm. Restore to an inactive current agent fails with a useful 409. |
| 50 | Archived direct access | Normal detail/edit/relationship/file/custom-field/activity paths deny archived Leads; dedicated Archived Data permissions remain. |
| 51 | Imports | Canonical name/email/phone/source validation; removed obsolete field mappings. Existing persisted import history/retries and shared creation path retained. |
| 52 | Public Forms | Shared sales transaction/creation path; request receipts prevent repeats. Returning customer opportunities retain existing records and create new Deals with events after commit. |
| 53 | Campaigns | Product targeting remains canonical. Agent filters validate persisted sales eligibility. Normalized Product audience integration passed. Live delivery: I cannot confirm this. |
| 54 | Inbox assignment | Existing scope reads current assignment. Test confirmed old/new user Lead visibility changes after transfer. Live mailbox synchronization: I cannot confirm this. |
| 55 | Audit semantics | Lead creates/updates/archives/restores/merges/conversion identify Lead, not Contact. Create/update audit entries share the relevant transaction. |
| 56 | Safe errors | User-facing not-found/edit labels identify Leads. Existing middleware keeps Prisma internals out of API responses. |
| 57 | Tenant enforcement | Authentication-derived tenant and actor; same-tenant account/product/agent validation; My Leads cannot be spoofed via query actor ID. |
| 58 | Mass assignment | Strict shared schemas reject unknown/internal/retired fields and malformed IDs. |
| 59 | Cache/refresh | Existing background refresh retained. Deactivation invalidates CRM/user/dashboard page caches and refreshes the shared agent directory. |
| 60 | Races | Existing request cancellation/identity guards retained; transactional retry, ownership row locks, receipt uniqueness and server revalidation cover write races. |
| 61 | Schema/indexes | Three removed Lead columns; no new broad indexes. Existing tenant/assignment/Product keys reused. Ownership safety added as database triggers. |
| 62 | Migrations | Three forward migrations listed above; no reset or silent destructive deployment. |
| 63 | Executed checks | Evidence matrix above and reproducible scripts in the changed-file inventory. |
| 64 | Backend tests | Focused SQL/HTTP, migration and unit checks passed as listed; one deployed import-rollout test skipped. Full repository suite: I cannot confirm this. |
| 65 | Frontend tests | 32 focused tests passed; full frontend suite was not run. |
| 66 | Shared typecheck | Passed. |
| 67 | Backend typecheck | Passed. |
| 68 | Frontend typecheck | Passed. |
| 69 | Backend build | Passed; see evidence matrix. |
| 70 | Frontend build | Passed; see evidence matrix and build-only API URL. |
| 71 | Diff hygiene | `git diff --check` passed; generated evidence is ignored. |
| 72 | Limitations | No deployed-release/production drop proof, actual provider delivery, live OAuth/Gmail sync, live storage, full-suite result or crash-recovery event-delivery guarantee. I cannot confirm this. |

## Deactivation report: requested items 1–36

| # | Topic | Implementation / verification boundary |
| --- | --- | --- |
| 1 | Files | Exact inventory below; main service is `user-deactivation.service.ts`. |
| 2 | Reassignment modal | Reuses `ConfirmActionDialog`; supports children, disabled confirmation, viewport containment and scrolling. |
| 3 | Agent selector | Reuses `AssignedAgentSelect` and the canonical eligible directory. |
| 4 | Impact API | `GET /administration/users/:id/deactivation-impact`; authenticated, tenant-scoped Client Admin with User view/activate rights; read-only. |
| 5 | Lead count | Current assignment, active/nondeleted, unconverted Leads. |
| 6 | Contact count | Current assignment, active/nondeleted Contacts. |
| 7 | Account count | Current assignment, active/nondeleted Accounts. |
| 8 | Deal count | Current assignment, active/nondeleted Deals, including terminal records that remain active. |
| 9 | Replacement | Same-tenant active eligible sales agent, revalidated inside final transaction. |
| 10 | Client Admin | Cannot be a replacement. |
| 11 | Target exclusion | Target cannot replace themselves; actor cannot deactivate their own account. Last active Client Admin protection retained. |
| 12 | Zero records | Replacement optional; final confirmation still required. |
| 13 | Final confirmation | Separate confirmation before the write. Cancel writes nothing. Continue disabled until required replacement selected. |
| 14 | Atomic transaction | Serializable transaction covers recount, validation, all transfers, history, audit, status and session revocation; retries discard failed attempts. |
| 15 | Lead transfer | `assignedUserId` updated in bounded keyset batches. |
| 16 | Contact transfer | Same batching and tenant guard. |
| 17 | Account transfer | Same batching and tenant guard. |
| 18 | Deal transfer | Same batching and tenant guard. |
| 19 | Deal compatibility | Current `ownerId` alias synchronized with `assignedUserId`. Historical authors remain unchanged. |
| 20 | History | Per-record assignment Activity captures previous/new agent and deactivation reason; original actors/history retained. Archived and converted Leads keep historical assignments. |
| 21 | Audit | One `user.deactivated_with_reassignment` entry with replacement and four module counts. |
| 22 | Sessions | Revocation is the final write inside the same transaction, so it becomes visible only on successful commit. Rollback leaves sessions usable. |
| 23 | Direct API | Generic status update refuses deactivation with owned records; database guard provides additional race protection. |
| 24 | Archive bypass | User archive refuses while active CRM ownership remains. |
| 25 | Bulk operations | Bulk INACTIVE update rejected; each user must go through individual ownership review. |
| 26 | Workflow behavior | Administrative ownership transfer creates audit/activity but suppresses ordinary CRM update triggers. Tested against an active persisted Workflow. |
| 27 | Inbox | Scope follows current assignment; old/new visibility verified locally. Production mailbox access: I cannot confirm this. |
| 28 | Success feedback | Transfer/deactivation success toast and immediate inactive row/selector refresh. |
| 29 | Failure | Transaction rollback verified using an injected Account write failure. UI clears stale replacement and reloads current impact when possible. |
| 30 | Tests | SQL/HTTP ownership suite, 505-record batch, concurrent assignment, frontend controls and built browser acceptance. |
| 31 | Backend typecheck | Passed. |
| 32 | Frontend typecheck | Passed. |
| 33 | Backend build | Passed. |
| 34 | Frontend build | Passed. |
| 35 | Diff hygiene | Passed. |
| 36 | Limitations | Production deployment/race/load behavior at production scale and live mailbox providers: I cannot confirm this. No full-suite or external delivery claim. |

## Operational limits

Workflow effects are queued in memory and dispatched after commit using the existing deduplicated Workflow receipts. This prevents transaction-retry duplication and uncommitted events. It is not a durable transactional outbox: delivery across a process crash immediately after commit has not been established.

The normal deploy command intentionally cannot drop Lead columns while an older API may still be serving. Production readiness therefore includes the serving-release verification and retirement step above, followed by live acceptance. No commit, push, deployment or production mutation was performed in this session.

## Changed files

The inventory below includes source, migrations, verification scripts and this report; generated evidence is excluded.

- `.gitignore`
- `backend/package.json`
- `backend/prisma/migrations/20261110000000_preserve_retired_lead_fields/migration.sql`
- `backend/prisma/migrations/20261111000000_crm_ownership_safety/migration.sql`
- `backend/prisma/migrations/20261112000000_retire_lead_nonform_columns/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/scripts/audit-lead-polish.cjs`
- `backend/scripts/deploy-crm-imports.cjs`
- `backend/scripts/deploy-lead-fields.cjs`
- `backend/scripts/test-product-regressions.mjs`
- `backend/scripts/verify-lead-polish-browser.mjs`
- `backend/scripts/verify-lead-retirement.test.mjs`
- `backend/src/api/routes/administration.routes.ts`
- `backend/src/api/routes/crm.routes.ts`
- `backend/src/api/routes/index.ts`
- `backend/src/modules/administration/users/user-deactivation.service.ts`
- `backend/src/modules/administration/users/users.controller.ts`
- `backend/src/modules/administration/users/users.service.ts`
- `backend/src/modules/automation/actions/action-fields.ts`
- `backend/src/modules/automation/workflows/__tests__/workflow-polish.integration.test.ts`
- `backend/src/modules/automation/workflows/__tests__/workflow.integration.test.ts`
- `backend/src/modules/crm/__tests__/updated-events.test.ts`
- `backend/src/modules/crm/closing-requirements/custom-field-values.repository.ts`
- `backend/src/modules/crm/contacts/__tests__/conversion-fixture.ts`
- `backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts`
- `backend/src/modules/crm/contacts/__tests__/lead-conversion-preservation.property.test.ts`
- `backend/src/modules/crm/contacts/contacts.controller.ts`
- `backend/src/modules/crm/contacts/contacts.dto.ts`
- `backend/src/modules/crm/contacts/contacts.repository.ts`
- `backend/src/modules/crm/contacts/contacts.service.ts`
- `backend/src/modules/crm/imports/import-rows.service.ts`
- `backend/src/modules/crm/leads/lead-automation.service.ts`
- `backend/src/modules/crm/leads/lead-conversion.service.ts`
- `backend/src/modules/crm/leads/lead-polish.integration.test.ts`
- `backend/src/modules/crm/leads/lead-serializer.ts`
- `backend/src/modules/crm/leads/leads.dto.ts`
- `backend/src/modules/crm/leads/product-relations.ts`
- `backend/src/modules/crm/leads/sales-automation.integration.test.ts`
- `backend/src/modules/crm/merge/merge.repository.ts`
- `backend/src/modules/crm/merge/merge.service.ts`
- `backend/src/modules/crm/record-files/record-files.service.ts`
- `backend/src/modules/crm/record-updates.ts`
- `backend/src/modules/crm/relationships/relationships.service.ts`
- `backend/src/modules/marketing/campaigns/audiences.service.ts`
- `backend/src/modules/marketing/forms/public-forms.service.ts`
- `docs/leads-production-polish.md`
- `frontend/src/features/tenant/administration/users/adapters/user.adapter.ts`
- `frontend/src/features/tenant/administration/users/services/users.service.ts`
- `frontend/src/features/tenant/automation/workflows/ui/workflow-fields.tsx`
- `frontend/src/features/tenant/automation/workflows/ui/workflow-polish.test.tsx`
- `frontend/src/features/tenant/crm/leads/hooks/use-leads-data.ts`
- `frontend/src/features/tenant/crm/leads/ui/convert-lead-dialog.tsx`
- `frontend/src/features/tenant/crm/leads/ui/lead-filters.tsx`
- `frontend/src/features/tenant/crm/leads/ui/lead-form.tsx`
- `frontend/src/features/tenant/crm/leads/ui/leads-data-grid.tsx`
- `frontend/src/features/tenant/crm/leads/ui/leads-page.tsx`
- `frontend/src/features/tenant/crm/shared/import/configs/lead-import.config.ts`
- `frontend/src/features/tenant/settings/ui/__tests__/team-management-users.test.tsx`
- `frontend/src/features/tenant/settings/ui/team-management-users.tsx`
- `frontend/src/lib/api/adapters/contact.adapter.ts`
- `frontend/src/shared/components/crm/__tests__/assigned-agent-select.test.tsx`
- `frontend/src/shared/components/crm/assigned-agent-select.tsx`
- `frontend/src/shared/components/crm/confirm-action-dialog.tsx`
- `frontend/src/shared/hooks/use-module-data.ts`
- `frontend/src/shared/utils/assigned-agents.test.ts`
- `frontend/src/store/DataContext.tsx`
- `frontend/src/store/types/lead.types.ts`
- `frontend/src/store/types/user.types.ts`
- `shared/src/contracts/lead.contract.ts`
- `shared/src/contracts/record-experience.js`
- `shared/src/contracts/record-experience.ts`
- `shared/src/index.ts`
- `shared/src/validation/crm-import.schema.ts`
