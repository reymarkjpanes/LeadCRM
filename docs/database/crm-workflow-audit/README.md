# CRM schema and Workflow audit

The implementation retires four scalar columns through a guarded forward migration, aligns Workflow fields with supported CRM editors, and preserves historical records and execution history. The complete original inventory contains **136 fields: 132 retained and four retired**. This is locally verified code; deployment is still gated by existing live database drift and the unrelated permission regression below.

## Database evidence and decisions

[Column matrix](column-matrix.md) covers every original Lead, Contact, Account and Deal scalar field. [Structured evidence](evidence.json) contains source locations, catalog columns, constraints, indexes, dependencies, migration fingerprints, aggregate usage and Workflow-reference counts. Search evidence is an inventory aid; dynamic access cannot be ruled out by absent tokens. Retirement decisions also use the semantic review below, live NULL counts, runtime removal and migration guards.

The configured backend Supabase database was inspected in a repeatable-read, read-only transaction on **2026-10-08 at 10:26:21 UTC**. No customer values, message bodies or connection credentials are in the report. No live DDL or record writes were performed. Its association with the currently deployed production application was not independently established: **I cannot confirm this.**

| Table / relationship | Rows at capture |
| --- | ---: |
| Lead / Contact / Account / Deal | 6 / 1 / 2 / 7 |
| LeadProductInterest / ContactProductInterest / AccountProductInterest | 7 / 1 / 1 |
| LeadDeal / ContactDeal | 7 / 1 |
| CustomFieldValue | 3 |
| Workflow / WorkflowTriggerRecord / WorkflowExecutionRun / WorkflowExecutionStep | 0 / 0 / 0 / 0 |

All inspected CRM product records were normalized, no legacy Product name lacked a matching junction, and all seven Deals had canonical Products. This small snapshot alone is not a reason to retire compatibility structures.

| Retired column | Semantic review | Live non-NULL / archived nonempty |
| --- | --- | --- |
| Contact.lastContactedAt | No supported editor, DTO, repository business writer, automation field, import, campaign, inbox or report consumer. Engagement uses `lastCustomerReplyAt` mapped to `lastMeaningfulInboundAt`, which is retained. | 0 / 0 |
| Contact.qualifiedAt | No business reader/writer; removed the remaining optional frontend store type. Qualification and status transitions use the existing CRM status/stage services. | 0 / 0 |
| Contact.disqualifiedReason | No supported reader/writer; removed the optional frontend store type. Deal `lostReason` remains separate and intact. | 0 / 0 |
| Deal.billingFrequency | No current CRM control, pricing, reporting or execution consumer. Removed the vestigial create/update/batch DTO field, shared Deal property, and adapter input/output entries together. Older Workflow JSON remains repairable. | 0 / 0 |

Live totals were one Contact and seven Deals. All four columns were NULL, not merely empty strings. Unknown external consumers cannot be established from repository and database evidence: **I cannot confirm this.** Coordinate the application release with retirement because an old Prisma client may implicitly select these columns.

### Retained candidates

| Fields | Decision and actual dependency |
| --- | --- |
| Lead.website, Lead.description | KEEP. Website remains in `frontend/src/features/tenant/crm/leads/config/record-detail.config.tsx`; description is copied to Contact notes by `backend/src/modules/crm/leads/lead-conversion.service.ts`. These are excluded from new Workflow action choices, not removed from the database. |
| Contact.jobTitle, notes, linkedinUrl, recordType | KEEP. Job Title has an inline detail editor; notes participate in conversion/API persistence. Legacy identity/projections and unknown historical consumers make broader retirement unjustified. |
| Contact.lifecycleStage, customerSince, customerType, activeProducts | KEEP. Conversion maintains customer metadata and active Products; the Contact repository still filters lifecycle stage. |
| Lead/Contact/Account product arrays, Deal product arrays, productsNormalized | KEEP TRANSITIONAL. Product relation adapters, imports, conversion, legacy resolution and snapshot projections still use them. Canonical Workflow values use IDs. |
| Account.internalNotes, activeProducts, tags | KEEP. Account Edit still initializes and saves these properties; Internal Notes and Active Products remain supported Workflow fields. Tags remain persisted by existing CRM contracts. |
| assignedUserId, ownerId, accountId, convertedContactId and other relationship IDs | KEEP. Tenant-scoped assignment, association, conversion and ownership history. No relationship is removed by this migration. |
| Deal.value, currency, productInterestId, closingValues, closingSnapshot, won flags and timestamps | KEEP HISTORY. Catalog price changes must not reprice old Deals; closing evidence and Won history remain authoritative. Workflow conditions can inspect value/Product, but Update Fields cannot rewrite them. |
| archive metadata, created/updated attribution, activity and audit records | KEEP HISTORY/SYSTEM. Includes archived records and historical display fields. |
| reply/outbound/engagement timestamps, doNotContact | KEEP AUTOMATION/INTEGRATION. Existing Gmail and messaging suppression contracts remain authoritative. |

Full per-column classification and production counts are in the matrix. Original migrations were not rewritten.

### Migration and rollout

Created [20261110000000_retire_unused_crm_columns/migration.sql](../../../backend/prisma/migrations/20261110000000_retire_unused_crm_columns/migration.sql).

1. Begin a transaction with a 10-second lock timeout and 60-second statement timeout; lock Contact, Deal and Workflow before rechecking.
2. Abort if any of the four retired columns is non-NULL, across **all tenants and archived records**, including empty strings. Data found later must be preserved and reconciled explicitly; the migration does not silently erase it or invent a destination.
3. Abort if any nonarchived Workflow marked active by either lifecycle marker references a retired field in condition/action selectors. Nested selectors and qualified names are checked. Pause and repair such Workflows before retrying. Draft/paused JSON is kept unchanged.
4. Drop exactly the four columns without `CASCADE`. Unknown view dependencies cause rollback. No table, Workflow definition, trigger record, execution or step is deleted.
5. Commit only after every check succeeds. A failed transaction leaves columns and data intact. If Prisma records a failed migration, investigate the guard failure and use the established migration recovery process after preservation; do not mark it applied without execution.

Before deployment, verify the target database/application identity, take a restorable backup, reconcile the existing pending migrations below through their guarded rollout, and stop older application instances/workers that select retired columns. Apply the matching migration/application release together through the repository's `npm --prefix backend run db:deploy` path. Check the ledger, health, authenticated CRM/Workflow reads and post-deployment drift before resuming traffic. The existing relationship-retirement gate must not be bypassed.

Rollback requires restoring schema compatibility **before** running an older binary. Since the forward migration only succeeds on NULL columns, a reviewed compensating migration can re-add three nullable Contact columns (`TIMESTAMP(3)`, `TIMESTAMP(3)`, `TEXT`) and nullable Deal `billingFrequency TEXT`. Do not edit the applied migration or reset the database. Restore backup data if any reconciliation was performed outside this migration.

The captured ledger has no true content-checksum mismatch when LF/CRLF variants are compared; 68 files differ only by line endings. Preserve applied-file checksums. Existing pending migrations:

- `20261102000000_retire_relationship_compatibility`: live Deal/Task singular compatibility columns and their foreign keys remain; CampaignContact's canonical unique index also needs this reconciliation.
- `20261106000000_scoped_mailbox_delivery`: live EmailAccount/MailboxMessage delivery/sync fields and ScheduledMailboxEmail are missing.
- The newly created `20261110000000_retire_unused_crm_columns` is intentionally unapplied live.

Five CustomFieldValue foreign keys and its long index had existing physical names different from Prisma's defaults. Added explicit `map` names in Prisma to match the existing migration/catalog; no rename or data mutation was necessary. After replaying all **95 migrations**, the disposable database to Prisma diff is empty.

## Workflow contracts and behavior

### Trigger and action catalogs

| Module | Supported triggers | Emission source |
| --- | --- | --- |
| Leads | Created, Updated, Status Changed | `contacts/contacts.service.ts`, governed creation/import/conversion callers |
| Contacts | Created, Updated, Status Changed | `contacts-v2/contacts-v2.service.ts` and conversion orchestration |
| Accounts | Updated | `companies/companies.service.ts` |
| Deals | Created, Updated, Stage Changed, Closed Won, Closed Lost | `deals/deals.service.ts`, batch creation and stage-transition services |

**Account Created is deliberately absent.** There was no complete supported trigger/emitter contract to preserve; this cleanup does not add one speculatively.

Available actions: Create Task, Send Email, Send SMS, Assign Agent, Update Fields, Move Deal Stage. Email targets Leads/Contacts through a connected Gmail sender. SMS validates an explicit record/primary relationship recipient. Stage actions use the existing stage service, permissions, Closed Won requirements and lost-reason validation. Retired Send Campaign and Create Notification steps stay visible in saved configurations for disable/remove repair and cannot execute.

### Field/control map

The shared catalog is explicit; Prisma properties are never automatically exposed. CRM source/industry/size/status choices are shared with forms. Text length limits match backend contracts; API validation remains authoritative. Relationship and Product controls carry IDs and display labels.

| Module | Editable standard fields |
| --- | --- |
| Lead | First Name, Last Name, Email, Phone, Company Name, Status, Product Interest, Account, Lead Source, Assigned Agent, Full Address |
| Contact | First Name, Last Name, Email, Phone, Company Name, Status, Product Interest, Account, Source, Assigned Agent, Full Address |
| Account | Account Name, Industry, Size, Website, Street Address, City, Province, Country, Assigned Agent, Product Interest, Notes, Internal Notes, Active Products |
| Deal | Title, Priority, Expected Close Date, Lead Source, Industry, Address, Assigned Agent, Account, Contacts, Leads |

Condition fields include these plus Deal Value, Product Interest, Stage, Pipeline, Has ever reached Won, Stage history verified, and the relevant event's previous/new Status or Stage. Products use contains/not-contains/empty operators; enum/relationship choices use supported operators; numeric/date/boolean values have typed controls. Optional editable values have an explicit Clear action; required fields cannot be cleared.

Custom fields come from the existing tenant definitions and `CustomFieldValue` store. Only active, visible fields for the trigger module appear. The action picker separates Standard Fields and Custom Fields; conditions group them. Text, Long Text, Number, Date and Dropdown follow existing custom-field validation. File Upload and governed Closed Won fields stay outside generic Workflow updates. Hidden/inactive field values and historical closing JSON remain intact. Definition reads do not initialize settings or create records.

Product conditions/actions use canonical Product IDs, including Account Active Products. Contact/Account update DTOs and transactional relation writers accept IDs while retaining legacy transport compatibility. Legacy saved Product names map only on an exact unique normalized-name match in the same tenant. Ambiguous, retired, missing or foreign selections remain visible for repair and fail activation; they are never fuzzy-matched or silently deleted. Deal Product/value/currency stay protected snapshots.

### Events, permissions and execution

Lead/Contact status events contain canonical `event.previousStatus` and `event.newStatus`. Case-only/no-op or stale events do not execute. Deal transition events carry previous/new stage IDs and use the persisted stage-history ID as event identity. The existing Closed Won/lost domain checks remain in charge.

Updated events compare committed values, including custom values before/after the save. Supported field aliases normalize Product keys, and the engine filters out metadata, derived-only and retired-field changes. Reordering a Product set or saving unchanged values does not create a false Updated event. Entity context comes from tenant-scoped database reads and approved fields; callers can supply only recognized event metadata.

Activation, dry-run HTTP requests and each action recheck the relevant source/action/reference permissions. The activating author must still be active and authorized at execution. Builder options are module-permission scoped; eligible assignees use the existing sales-agent rules. Connected Gmail senders are listed separately, including authorized active Client Admin senders. Foreign/inactive records and unavailable Products/templates/accounts/users are rejected.

The existing database uniqueness claim makes duplicate event IDs execute once. AsyncLocalStorage tracks visited Workflows with a maximum chain depth of ten to stop cycles. Workflow availability/version, record availability and stage-follow-up eligibility are checked again during execution. After an action fails, later actions are recorded as skipped. Invalid definitions or missing event actors produce a failed validation step and skipped action entries. Unexpected emitter failures log safe structured context; no silent catch remains. Historical execution rows are not rewritten.

### Lifecycle and safe testing

| Operation | Persisted behavior |
| --- | --- |
| Open new builder | No database row until Save draft |
| Save draft | DRAFT, inactive; no actions run |
| Activate draft | Validate references/permissions; ACTIVE, active; store activating author |
| Pause active | PAUSED, inactive, including when references have since become unavailable |
| Edit and save paused | Remains PAUSED and inactive |
| Resume paused | Revalidate and return to ACTIVE |
| Duplicate | New uniquely named DRAFT; copied configuration, no copied execution history |
| Archive | Archived/inactive; original configuration and execution history retained |

Only nonarchived ACTIVE Workflows with `isActive=true` are selected for execution. Draft rows show **Activate**, paused rows show **Resume**. Legacy action references are preserved in drafts/disabled steps for explicit repair; unsupported conditions must be corrected or removed before saving an executable definition. Inconsistent lifecycle markers do not authorize execution.

Dry-run reads the saved definition and a tenant-scoped sample, validates permissions/references and projects earlier updates in memory. It does not create Tasks, send messages, update CRM values, initialize custom definitions, or write execution/activity/audit rows. The UI labels the saved-version behavior and disables Test while edits are unsaved. Provider delivery is not attempted.

Builder dependencies load in parallel after authentication, metadata requests are deduplicated while in flight, and failed requests can be retried. Metadata times out at 25 seconds; builder/sample/dry-run loading is bounded at 30 seconds. The existing API transport still governs mutations. Timeout does not imply a server-side operation was rolled back; inspect saved state before resubmitting a mutation.

The builder preserves existing layout, native labeled inputs, keyboard-operable controls, and responsive configuration panels. Browser checks cover six widths, typed custom fields, saved lifecycle, error/retry recovery and nonmutating tests. Full screen-reader and assistive-device acceptance: **I cannot confirm this.**

## Verification and limitations

Commands below were run locally. Integration data was synthetic and isolated; Gmail/SMS providers were mocked in integration tests. Browser transport was routed from the production frontend build to a real cookie-authenticated local backend and disposable SQL. The production build used an HTTPS placeholder API URL for configuration validation; it did not contact that URL.

| Verification | Result |
| --- | --- |
| `node backend/scripts/test-crm-column-retirement.mjs` | PASS: 22 guard/preservation checks and a fresh full migration replay |
| `node backend/scripts/verify-database-drift.mjs` | PASS: empty diff after 95 migrations |
| `node backend/scripts/verify-workflow-browser.mjs <playwright-module>` | PASS: 39 checks, zero browser page/transport errors; 320px and 1440px screenshots visually inspected |
| Focused backend Workflow unit/conditions/validation/security/catalog tests | PASS: 46 tests, seven suites |
| `npm --prefix frontend test -- src/features/tenant/automation/workflows` | PASS: 104 tests, nine suites |
| `node backend/scripts/test-product-regressions.mjs workflow` | PASS: 93 tests (75 Workflow, 18 Task), four suites |
| `node backend/scripts/test-product-normalization.mjs` | PASS: 48 tests; one deployment-specific import approval check deliberately skipped |
| `node backend/scripts/test-custom-fields.mjs` | PASS: nine tests plus custom-definition/value migration and tenant/module constraint checks |
| Other disposable PostgreSQL groups: forms, campaigns, CRM completion, mailbox/engagement, account/auth/import/settings, smoke | PASS: 19 / 42 / 14 / 57 / 16 / 11 tests respectively |
| Permissions group | **9 pass, 1 fail**: existing `/administration/groups` GET returns 200 for a restricted role where the regression expects 403. Route and full member projection are unchanged by this work. Resolve intended listing access before claiming full RBAC acceptance. |
| `npm --prefix shared run build` and shared/backend/frontend `run lint` | PASS |
| Backend Prisma generation/TypeScript production build and frontend production build | PASS |
| `git diff --check` | PASS |

The integration fixtures were brought up to current User onboarding, active Workflow lifecycle, Product-create integer price and Product-ID audience contracts; no production permission or validation rule was weakened to make tests pass. The Deal duplication fix also excludes its loaded `productInterestRecord` relation from Prisma create input.

The final Workflow/Task, Product/import/notification and browser runs used the new retirement migration. The additional custom-field and other regression groups ran earlier in this audit, before the four-column retirement; they are recorded as supporting regression evidence rather than a second full-suite run on the final schema.

Browser results are in ignored `data/outputs/workflow-browser/results.json`; screenshots cover **1440, 1024, 768, 390, 375 and 320 pixels** for all four module configurations. Generated screenshots, disposable databases and logs are excluded from Git. The browser script is versioned for repeatability.

The required regression paths are covered by the Workflow main/polish suites: real Lead/Contact create and update events, previous/new status, Account update, Deal create/stage/Won/lost, Product/custom-field values, invalid references, revoked author permissions, duplicate event claims, mid-action failure/skipped successors, paused/archived suppression, lifecycle persistence and nonmutating dry-run. Provider acceptance/inbox delivery, deployment-specific migrated import history, a full live Workflow execution and post-deployment production browser behavior: **I cannot confirm this.**

No commit, push or deployment was performed. Apply the migration only after resolving the rollout gates above. The local schema is reconciled; the captured live database is not yet at that schema.

## Changed code areas

- Prisma schema and the new guarded migration; audit, migration-test and browser-verification scripts.
- Shared Workflow contracts/catalog, form option constants and Deal contracts; a build step synchronizes the existing CommonJS companion files used by runtime/test resolution.
- Backend Workflow repository, validation, actions, permissions, trigger/engine/service/controller; read-only custom definitions and CRM custom-value change tracking.
- Contact/Account transactional Product-ID updates, CRM event emitters, Deal DTO and duplication adapter.
- Workflow builder fields, loading, lifecycle labels, dry-run UI, templates and frontend API helpers; shared option reuse in CRM forms and stale Contact/Deal type cleanup.
- Focused regression tests and fixture alignment, `.gitignore`, this report, the original-column matrix and redacted evidence.
