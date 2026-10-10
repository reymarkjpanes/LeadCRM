# Product normalization implementation and verification

Date: 2026-10-05. Source changes and the forward migration are implemented locally.
The migration was exercised on disposable databases, **not applied to the connected
application database**. The application was not deployed. No live prices or customer
records were edited by this task.

## Required findings

1. **Original model count:** 57. The proposed schema contains 60, adding three
   meaningful junction models rather than targeting a smaller table count.
2. **Tables actually removed:** none.
3. **Removal justification:** no destructive retirement met all deployment and
   historical-data verification requirements. No applied migration was rewritten.
4. **Candidates retained:** see the candidate table below. External worker/deployment
   usage and retention policy cannot be established from a local source search.
5. **Duplicated fields found:** Lead `productInterest`/`productInterestIds`;
   Contact and Account `productInterests`/`activeProducts`; Deal singular Product FK
   plus `productInterestIds`/`productInterests`; Deal and Task singular CRM links
   alongside their membership junctions. `productInterestOther` is contextual text.
6. **New normalized relations:** `LeadProductInterest`, `ContactProductInterest`,
   `AccountProductInterest`. Each has a composite record/Product primary key,
   tenant-scoped composite FKs, deterministic position, and an index on
   `(tenantId, productInterestId)`. Contact/Account links have `interested` and
   `activeProduct` flags to preserve the different meanings of the original lists.
   There are no copied Product names or prices in these junctions.
7. **ProductInterest schema:** existing catalog fields and `Decimal(14,2)` price
   remain. Added `(id, tenantId)` uniqueness to support composite scope FKs.
   The existing partial unique index on tenant and case-insensitive active name
   remains; retired names may legitimately be reused. Retained links preserve
   their original Product identity when an active replacement shares that name.
8. **Relationship migration counts:** live preflight identifies 19 unique resolvable
   Lead links, 5 Contact links, 4 Account links, and 15 singly resolvable Deals.
   These are projected backfill counts, not claims of a live backfill. Ten unmatched
   label occurrences remain: six on Leads (`CCTV` five times, `Door Access` once)
   and four Contact `CCTV` labels. There were no ambiguous live matches. The
   populated migration test actually created 4/3/2 product junction rows.
9. **Product values before/after:** both live reads contain 276 Products: 265 zero
   and 11 nonzero. All Product rows, values and update timestamps are identical
   between reads. The original catalog migration initializes prices to zero.
   There is no reliable intended-price source for the 265 zeros; none was invented
   or backfilled. Test prices of 25,000/15,000/30,000 exist only in test databases.
10. **Reported zero-price bug:** I cannot confirm this. The current numeric request
    path did not reproduce a successful save being replaced by zero. The adapter
    sends `dealValue`, the strict backend contract accepts numeric values, Prisma
    updates the Decimal, and the frontend awaits the mutation and refreshes.
    The confirmed input defect was rejecting formatted `₱25,000`/comma amounts.
    Existing nonzero database prices demonstrate that persistence is not uniformly
    failing. The originating deployed version/request that produced the reported
    zero was not available; no unsupported root cause is asserted.
11. **Persistence fix/hardening:** the editor parses plain or correctly grouped
    Peso amounts to a number, rejects blank/malformed/negative/excess-precision
    values, and never falls back to zero. The backend writes an explicit
    `Prisma.Decimal` at two decimal places and checks the returned persisted value
    before committing. Success toast still follows successful server completion;
    the existing catalog refresh is retained. API strings such as `"₱25,000"`
    remain invalid; the browser sends `25000`.
12. **New Deal snapshot rule:** one active tenant Product per new Deal. The server
    copies its current price and PHP currency. Lead automation creates one Deal
    per Product; imports, manual creation, returning Contact form inquiries, and
    duplication also use catalog prices. Later edits cannot change an existing
    Deal's Product, value or currency. Workflow conditions can read these fields,
    but setters are unavailable. Existing setter steps remain saved for review,
    fail safely if executed, and cannot be activated until removed/disabled.
    No live workflows with these setter fields were found.
13. **Historical Deal verification:** all 22 live Deal product/value snapshots have
    identical hashes across the two read-only inventories. The populated migration
    test compares every original Deal value and array exactly before/after,
    including multi-product, conflicting singular/plural, and unknown-product rows.
    The existing Deal.value storage type was not changed or rounded by this migration.
    API tests prove Deal A remains 25,000 after the Product becomes 30,000; Deal B
    and a new duplicate receive 30,000. Historical context edits retain value.
14. **Deal relationship findings:** LeadDeal/ContactDeal are multi-record membership
    and conversion-history links; singular `leadId`/`contactId` still identify
    primary relationships used by sales conversion, Gmail, engagement, and
    workflow recipient selection. Keep both during this transition. Live missing
    membership links: zero. Migration backfills a missing primary membership;
    it does not replace existing junctions. Fifteen live Deals resolve to one
    Product; seven have no Product association; none resolves to multiple Products.
    The latter seven stay compatible, with their original values. Future historical
    multi-product/conflicting rows also remain intact and cannot be silently split
    or duplicated as if a Product had been reconciled.
15. **Task findings:** Tasks support multiple links and ordering in TaskLead,
    TaskContact, TaskDeal and TaskAccount. Current services maintain singular
    primary links as compatibility mirrors, and timelines/workflows still consume
    them. All live singular links already have matching junctions. Migration fills
    missing ones after the existing maximum position without reordering; the test
    preserves position 4 and inserts position 5.
16. **Intentionally retained structures:** all legacy product arrays and singular
    Deal/Task CRM fields; Others contextual text; Deal.value; Activity, AuditLog,
    DealStageHistory; workflow definition/trigger/run/step history; campaign,
    recipient, metrics, delivery and event tables; shared CrmImportJob,
    CrmImportRowResult, CrmImportUpload, CrmImportChunk; security and Gmail tables.
    No unresolved legacy data is discarded. Obsolete Deal value setter code was
    removed; no code references a newly dropped database column or table.
17. **New migration:** `20261029000000_normalize_product_relationships`. It expands,
    backfills exact ID or case/whitespace-normalized name matches within the same
    tenant, verifies link coverage, marks fully resolved rows, and reinforces the
    Deal Product FK. It contains no table/column drops. Dropping/replacing the old
    single-column FK is constraint maintenance, not data deletion. Eighty-one
    existing migrations are applied; this new 82nd migration is pending live.
    Checksums match existing SQL after accounting for LF/CRLF; no unfinished
    unrolled-back migration was found.
18. **Row counts:** the complete live inventory appears below. Before was
    05:11:11 UTC, after was 05:54:16 UTC. The only count change was MailboxMessage
    1,828 → 1,829, observed between read-only transactions. This task made no live
    writes; the source of that new message was not investigated. Disposable
    migration tests assert all original table counts, except intentionally added
    Deal/Task memberships, are preserved.
19. **Orphans/FKs:** zero live orphan/cross-tenant LeadDeal, ContactDeal, TaskLead,
    TaskContact, TaskDeal, TaskAccount or singular Deal Product references. New
    junction FKs enforce parent and Product tenant equality. Tests verify duplicate
    rejection, cross-tenant insert/update rejection and deletion protection for
    referenced Products. Product retirement remains a soft operation. Live new
    junction verification awaits deployment; I cannot confirm this.
20. **API compatibility:** existing Product display array response shapes are
    derived centrally from relations for normalized rows, including nested reads.
    New writes do not independently maintain Product name/ID arrays. Rows with
    unresolved history explicitly retain their legacy representation. Names
    reflect catalog renames. Existing request forms remain: Lead/Deal IDs,
    Contact/Account names resolved to FKs. Deal create now requires exactly one
    Product; conflicting singular/plural IDs are rejected. Unchanged edit payload
    previews are ignored; new arbitrary snapshot overrides are rejected. Product
    PATCH still returns the refreshed catalog. See [API.md](API.md).
21. **Tests actually run:** see the command/result table below. External Gmail/SMS
    delivery is stubbed; no customer email or text was sent. Frontend acceptance
    uses DOM tests with mocked HTTP; backend acceptance uses authenticated real
    HTTP and a real disposable SQL database. A production-build local browser
    fixture was started, but the in-app browser failed to attach and no Chrome
    connector was available. Actual browser refresh/reopen and the deployed
    application were not exercised; I cannot confirm this.
22. **Prisma:** `prisma validate` passed from the backend directory. A first root
    invocation lacked DIRECT_URL and was rerun with the correct project context.
    `db:generate` and production build generation passed with Prisma 5.22.0.
23. **Typecheck/lint/build:** all three workspace typechecks passed; backend and
    frontend production builds passed. Sandbox cache/network restrictions required
    authorized reruns. Next.js reports the existing multiple-lockfile root warning;
    Vitest reports its existing future config-loader warning. These are not test
    failures. `git diff --check` passes.
24. **Remaining risks:** deployment requires a coordinated application switch and
    write pause, not an independent SQL rollout under old writers. Reconcile the
    ten unmatched labels and seven unassociated Deals with staff before retiring
    legacy columns. Zero prices require staff-supplied values. Historical arrays
    are retained for verification, not kept synchronized on normalized rows.
    Old demo/repair scripts that bypass domain services still contain legacy
    fixtures; do not use them as production import paths. Direct database writes
    can bypass application snapshot rules. A confirmed cause for the original
    deployed zero-price report, external-worker retirement safety, production
    performance and a deployed browser acceptance flow remain unverified.

## Retained cleanup candidates

| Table | Live rows / latest row | Source and dependency evidence | Decision |
|---|---|---|---|
| DealAction | 0 / none | No active Prisma delegate calls found in current source. FKs to Tenant, Deal, User; schema/scoping references remain. | Keep. I cannot confirm this table is safe to remove across deployments. |
| AutomationRule | 0 / none; 0 active rules | Current automation uses Workflow tables. No current source delegate calls found. FK to Tenant. External workers not established. | Keep. I cannot confirm this table is safe to remove. |
| SMSQueue | 0 / none; no queued statuses | Current source has no queue delegate calls, but pre-existing compiled SMS gateway code contains reads/writes. FKs to Tenant, Contact, Campaign. SMS workflows still exist through the current sending service. | Keep. I cannot confirm this table is safe to remove. |
| EmailVerificationToken | 7 / 2026-09-18 01:25:00 UTC; 0 valid unused tokens | `core/auth/verification.service.ts` still reads/writes tokens; FK to User. Historical security data remains. | Keep. I cannot confirm this table is safe to remove. |

## Test evidence

All database runners create disposable databases, replay the committed migration
history and close their servers. They never reset or push the application schema.

| Command / scope | Actual result |
|---|---|
| `node backend/scripts/verify-product-migration.mjs` | PASS: populated historical fixtures, 4 Lead / 3 Contact / 2 Account product links, exact original rows/prices/arrays, conflict/multi-product retention, ordered Task backfill, FK constraints |
| `node backend/scripts/test-product-normalization.mjs` | 48 passed, 1 skipped: Product normalization/price HTTP acceptance, sales automation, imports, notifications. Skip requires deployment-only rollout evidence. |
| `node backend/scripts/test-product-regressions.mjs` | 249 passed: smoke 11, workflows/Tasks 84, forms 18, campaigns 28, CRM completion/conversion 14, Gmail/engagement 79, profile/users/organization 15 |
| `node backend/scripts/test-product-regressions.mjs workflow` | 84 passed on the final dispatcher path |
| `node backend/scripts/test-product-regressions.mjs environment` | 10 passed: Client Admin protections, per-module permissions, tenant scope, sales-agent eligibility and Gmail permissions |
| Focused backend Vitest: Deals, auth/security, permissions, archive/files/restore, reports, workflow validation/actions | 281 passed, 16 skipped across 30 passing files and 2 environment-gated files. Profile and permissions integration are separately exercised by the account/environment runners. No test failures remain in that run. |
| Focused frontend Vitest: Products, Deal form, Product selector, workflow builder/polish | 38 passed across 5 files |
| Final duplication property test | 8 passed after the legacy-conflict guard |
| `npm run lint` | 3/3 workspaces passed |
| `npm run build` | 2/2 build workspaces passed; Prisma generation passed |

Early failures exposed stale test expectations for mutable Deal pricing, obsolete
permission fixture keys, and the tracked JavaScript workflow catalog diverging from
TypeScript. Tests now express the new snapshot rule and current permission names;
runtime RBAC was not loosened. Both workflow catalog source forms were updated.

Logs are local ignored `product-*.log` files. Private deployment inventories are
ignored `product-normalization-before.json` and `product-normalization-after.json`.
The read-only audit script can recreate them without printing credentials.
`preview-product-normalization.mjs` provides a disposable local production-build
fixture for subsequent browser verification. It was shut down after browser
attachment failed; its test Product remained zero because no UI save occurred.

## Deployment and retirement runbook

1. Verify a restorable deployment backup and identify every API/worker instance.
   Pause writes and drain in-flight requests/imports/forms/campaign/workflow workers.
   Keep the currently running old application from writing during the switch.
2. Capture a fresh private inventory using
   `node backend/scripts/audit-product-normalization.cjs product-normalization-before.json`.
   Inspect pending migrations, orphan counts, exact unresolved labels, zero prices,
   and any newly introduced historical workflow setters. Stop for unexpected drift.
3. From `backend`, run the normal Prisma **migrate deploy** command with the intended
   deployment's direct connection. This step has not been run in this task. Do not
   use reset, db push, or edit an applied migration. SQL backfill and validation
   execute in one transaction; a FK/coverage failure aborts that transaction.
4. Deploy this backend and frontend together, with the regenerated Prisma client.
   Old code must not resume writing arrays after the backfill. Keep the write pause
   until read checks pass. New code must not start before the new columns exist.
5. Capture an after inventory. Compare all original table counts, each Product
   price and the Deal `valueHash`; new Deal primary FK backfills are expected, price
   changes are not. Check new junction counts and zero orphans. Inspect every
   compatibility row. The snapshot hash including legacy Product IDs may change
   when a primary FK is backfilled, so use the separate monetary `valueHash` here.
6. Run the Product save/reload and new/old Deal price acceptance flow in an approved
   test organization, plus login/RBAC, conversions, Tasks, files/archive restore,
   workflows, campaign preview and Gmail reads. Resume writes only after checks.
7. Resolve unmatched historical names through explicit staff-approved Product
   mappings; never fuzzy-map labels, invent prices, split Deals or create Products
   from every Others explanation. Reverify before removing any compatibility data.
8. Retire arrays/singular compatibility fields only in a separate forward migration
   after all historical records and all deployed readers/writers are confirmed.
   If recovery is required after new writes, keep the expanded schema and roll
   forward, or explicitly rehydrate old representations from relations during a
   controlled rollback. Simply starting old code against cleared arrays is unsafe.

## Live row inventory

The following table compares two live **read-only audits**, not a deployment.

| Model | Before | After |
|---|---:|---:|
| Tenant | 23 | 23 |
| User | 18 | 18 |
| RoleDefinition | 49 | 49 |
| RolePermission | 725 | 725 |
| UserRole | 15 | 15 |
| Session | 31 | 31 |
| TenantGroup | 1 | 1 |
| TenantGroupMember | 1 | 1 |
| Account | 22 | 22 |
| Lead | 31 | 31 |
| Contact | 10 | 10 |
| Pipeline | 23 | 23 |
| Stage | 134 | 134 |
| Deal | 22 | 22 |
| LeadDeal | 18 | 18 |
| ContactDeal | 6 | 6 |
| DealStageHistory | 35 | 35 |
| DealAction | 0 | 0 |
| Task | 24 | 24 |
| Activity | 160 | 160 |
| Notification | 54 | 54 |
| ClosingFieldDefinition | 5 | 5 |
| TargetAudience | 4 | 4 |
| TargetAudienceCondition | 6 | 6 |
| Campaign | 9 | 9 |
| MarketingForm | 5 | 5 |
| FormSubmission | 7 | 7 |
| CampaignMetrics | 38 | 38 |
| CampaignContact | 22 | 22 |
| Template | 2 | 2 |
| Workflow | 4 | 4 |
| WorkflowTriggerRecord | 21 | 21 |
| WorkflowExecutionRun | 21 | 21 |
| WorkflowExecutionStep | 38 | 38 |
| AuditLog | 373 | 373 |
| EmailDeliveryLog | 22 | 22 |
| PasswordResetToken | 1 | 1 |
| EmailVerificationToken | 7 | 7 |
| EmailAccount | 2 | 2 |
| MailboxOAuthState | 0 | 0 |
| MailboxMessage | 1828 | 1829 |
| SMSQueue | 0 | 0 |
| EmailEvent | 29 | 29 |
| AutomationRule | 0 | 0 |
| UserPreference | 27 | 27 |
| TenantPreference | 49 | 49 |
| CrmImportJob | 6 | 6 |
| CrmImportRowResult | 12 | 12 |
| CrmImportUpload | 0 | 0 |
| CrmImportChunk | 0 | 0 |
| CampaignEmailQuota | 4 | 4 |
| TaskLead | 19 | 19 |
| TaskContact | 2 | 2 |
| TaskDeal | 6 | 6 |
| TaskAccount | 2 | 2 |
| RecordFile | 1 | 1 |
| ProductInterest | 276 | 276 |
