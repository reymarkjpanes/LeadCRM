# Whole-system normalization and schema retirement

Audit date: 2026-10-05, Asia/Manila. Scope: all LeadCRM models, migrations, physical PostgreSQL tables, runtime domains, integrations and background consumers.

The release has **57 Prisma models**, down from 60: four obsolete tables removed and one mailbox relationship table added. The expanded live catalog has **57 application tables / 58 physical public tables**, including `_prisma_migrations`. Migrations 83–85 are applied. Migration 86 is tested and gated on verification of the new serving backend. This report will record the final live retirement after that gate completes.

This is practical normalization with explicit ownership, not universal strict 3NF/BCNF certification. Ordered Deal/Task junctions own mutable participants; mailbox thread associations move from JSON to a constrained relation. Tenant scope projections, caches, history, document payloads and supported product compatibility fields intentionally remain.

## Complete evidence

- [Every original/current table and scalar column](normalization-inventory.md): decisions, runtime read/write sites, nested access, purpose, keys, indexes, constraints, row counts, timestamps, null distributions, arrays, JSON, enums, triggers and migration checksums.
- [Current ERD](normalization-erd.md), [catalog audit](../../backend/scripts/audit-database.mjs), [source inventory](../../backend/scripts/database-source-inventory.mjs), [reviewed decisions](../../backend/scripts/database-audit-decisions.mjs).
- Private evidence/backups are git-ignored under `data/outputs/database-audit/`. Credentials and row payloads are not published.

## Authorized cleanup and recovery

The user authorized deleting all dummy data except `seeder@camxian.com`. **4,233 of 4,284 application rows were removed**, leaving 51. The notification dispatcher recreated one operational delivery cursor, giving 52. The retained User, password hash, workspace, role, permissions and existing sessions were preserved exactly. No password was reset.

| Table | Before | After cleanup | Initial post-cleanup check |
|---|---:|---:|---:|
| User | 18 | 1 | 1 |
| Tenant | 23 | 1 | 1 |
| RoleDefinition | 49 | 1 | 1 |
| RolePermission | 725 | 16 | 16 |
| UserRole | 15 | 1 | 1 |
| Session | 31 | 31 | 31 |
| TenantPreference | 49 | 0 | 1 |
| Other application rows | 3,374 | 0 | 0 |
| **Total** | **4,284** | **51** | **52** |

Cleanup used a serializable transaction, explicit locks and FK-ordered DELETE. No reset, TRUNCATE, disabled FK, destructive schema push or applied-migration edit occurred. External storage objects and Google/provider accounts were not deleted. Dummy CRM configurations and database mailbox credentials were cleared; real use requires configuring the workspace and reconnecting mailboxes.

The original backup `recovery-2026-10-05T06-45-22-059Z.json` has SHA-256 `7cec4acb56e4ce46585e79db5f7d5a637a309babce1aa9b94d87617e61f214ac`. All 60 tables were restored into disposable PGlite; counts, all-row integrity-migration preservation, rollback and exact User preservation passed.

The pre-retirement backup `retirement-recovery-2026-10-05T08-28-26-869Z.json` has SHA-256 `a038c7f15250436a3c56d74670d717a9a2a38843448c11037a9247b70c565092`. Every row of all 60 tables was restored exactly before replaying migrations 84/85. A fresh snapshot precedes final live column retirement. Recover into a disposable database first; live restoration of dummy data requires separate authorization.

Subsequent live activity added mailbox messages, a mailbox connection, workspace configuration and audit/preferences rows. The 12:19 UTC catalog contained 775 application rows. These newer records are preserved; the historical cleanup totals above do not describe the later database. The inventory records the latest per-table counts, and a new recovery snapshot protects this current data before column retirement.

The refreshed recovery file is `retirement-recovery-2026-10-05T12-28-58-431Z.json`, SHA-256 `15775f41ce4de92442fbadf15bdef526126e92f56cb6bfa8b9c1dbe796a9a39a`: **796 application rows across 57 tables**, including 704 mailbox messages. Every backed-up row restored exactly, and migration 86 passed against the restored data with the User unchanged.

## Sources of truth

| Fact | Authority | Deliberately retained meaning |
|---|---|---|
| Identity / credentials | User | Session is separately revocable hashed security state |
| Effective grants | UserRole → RoleDefinition → RolePermission | User.role is primary routing/admin identity, not an unordered grant aggregate |
| Group membership | TenantGroupMember | Unique pair and tenant-consistent endpoints |
| Customer organization | Account | Lead.companyName / Contact.company may be unlinked intake text |
| Lead conversion | Retained Lead.contactId / convertedAt / convertedById | Contact represents the resulting lifecycle; original Lead retains provenance |
| Deal participants | Ordered LeadDeal / ContactDeal | Singular API fields derive from junctions |
| Task participants | TaskLead / TaskContact / TaskDeal / TaskAccount | Singular API fields derive from ordered links |
| Stage | Deal.stageId | pipelineId is a constrained query projection; DealStageHistory records past transitions |
| Products | ProductInterest plus three junctions / Deal.productInterestId | Deal value/currency are historical terms; product arrays retain explicit legacy compatibility |
| Campaign delivery | CampaignContact / EmailDeliveryLog | Campaign totals, CampaignMetrics snapshots and EmailEvent history differ intentionally |
| Daily quota | CampaignEmailQuota | Send reservations cannot be reconstructed from successful sends |
| Audience rules | TargetAudienceCondition | Independent ordered child predicates remain rows |
| Automation | Workflow | Trigger/run/step records preserve idempotency, attempts and outcomes |
| Forms | MarketingForm | Draft/published configurations differ; FormSubmission captures payload and published definition |
| Notifications | Notification | Recipient read state differs from Activity and AuditLog |
| Mailbox credentials / challenge | EmailAccount / MailboxOAuthState | Encrypted credentials and transient OAuth state have separate lifecycles |
| Thread association | MailboxThreadAssociation | Message-level CRM context is captured history |
| Imports | CrmImportJob / CrmImportRowResult | Upload/chunk staging expires independently of outcomes |
| Files | RecordFile | Exactly one CRM parent; content lives in external object storage |
| Security history | AuditLog | CRM Activity, stage history and provider events are separate records |

Every table has KEEP, NORMALIZE, REPLACE or DROP in the inventory. Nested-only TargetAudienceCondition and LeadProductInterest usage is traced through parents. Empty post-cleanup data alone was never considered proof of obsolescence.

## Forward migrations and live compatibility

| Sequence | Migration | Status / scope |
|---|---|---|
| 83 | [strengthen_relational_integrity](../../backend/prisma/migrations/20261030000000_strengthen_relational_integrity/migration.sql) | Applied: nineteen stronger FKs, ten reference superkeys, duplicate-index removal and live/default reconciliation |
| 84 | [retire_obsolete_infrastructure](../../backend/prisma/migrations/20261031000000_retire_obsolete_infrastructure/migration.sql) | Applied: four empty tables, DealActionType and unused all-null Task.organizationId dropped |
| 85 | [expand_canonical_relationships](../../backend/prisma/migrations/20261101000000_expand_canonical_relationships/migration.sql) | Applied: ordered participant backfill, MailboxThreadAssociation and temporary compatibility bridges |
| 86 | [retire_relationship_compatibility](../../backend/prisma/migrations/20261102000000_retire_relationship_compatibility/migration.sql) | Tested; gated: six scalar columns, mailbox compatibility rows and bridges retired; partial unique index aligned |

The original 82 successful migrations remain unchanged. Four older rolled-back entries stay in the ledger. The expanded live ledger has 85 successful migrations / 89 entries. Checksums match allowing LF/CRLF only.

| Dropped table | Confirmed absence / replacement |
|---|---|
| DealAction | No supported route/worker/integration/frontend consumer; Activity and DealStageHistory implement current actions; zero original rows |
| AutomationRule | No supported consumer; Workflow owns current automation; zero original rows |
| SMSQueue | Retired Android gateway storage; current provider adapter and campaigns do not access it; zero original rows |
| EmailVerificationToken | Signup verification route retired; unreachable service and obsolete unit test removed; seven original dummy rows were already authorized for deletion |

Each DROP checks zero rows and unexpected inbound FKs under locks; Task.organizationId must be all-null. Runtime absence was checked against the previously deployed `989e84fa9e837e4ced22fedbc766d01908b71695`, confirmed through the real frontend proxy. That backend remained healthy after 84/85. Active password recovery, sessions, Google login and mailbox OAuth remain.

Migration 85 backfills scalar-only participants without discarding multilinks and ranks the former primary first. Junction-to-scalar triggers keep old readers compatible. Current repositories, imports, conversion, merge, workflows, public forms and seeders use junctions. Deal scalar edits and relationship synchronization commit in one transaction. Stage-required singular IDs derive from junctions; restore/duplicate responses remain compatible.

Mailbox preference backfill validates account/thread identity, tenant, Deal, timestamp and exact JSON shape. Bidirectional write/delete bridges support coexistence. The replacement has primary key `(accountId, threadId)` and composite tenant FKs to EmailAccount and Deal. UTC meaning is preserved.

Normal `db:deploy` stops at 85 until explicit retirement. [db:relations:retire](../../backend/scripts/deploy-canonical-relationships.cjs) requires HTTPS, exact build SHA, `canonical-crm-relations-v1` capability, an authenticated administrator matching the configured DB, and successful Deals/Tasks reads. SQL then locks source/target tables and rechecks all six projections and mailbox equivalence. Only afterward does it remove `Deal.leadId/contactId` and `Task.leadId/contactId/dealId/accountId`. Failure aborts the transaction.

Post-retirement rollback requires a forward compatibility migration; starting the old binary alone is unsafe. The expanded phase permits old/new coexistence. Ten-second lock timeouts bound acquisition; larger installations may need staged/concurrent index work.

## Keys, indexes and normal forms

Nineteen strengthened FK paths: RolePermission.role; UserRole.user/role; Session.user; TenantGroupMember.group/user; Stage.pipeline; Deal.pipeline/stage; LeadDeal.lead/deal; ContactDeal.contact/deal; Notification.user; FormSubmission.form; WorkflowTriggerRecord.workflow; WorkflowExecutionRun.trigger; WorkflowExecutionStep.execution; MailboxMessage.account. Ten reference superkeys enforce tenant equality; they are not claimed to be minimal business keys.

Exact duplicates `Session_tokenHash_idx` and `EmailDeliveryLog_gmailMessageId_idx` were removed while unique indexes remain. Missing Activity tenant/lead/time and EmailDeliveryLog tenant/lead indexes were restored. Contact archive/lifecycle indexes and defaults align between Prisma and replay. Mailbox association adds a composite PK and tenant/Deal lookup index. Removed columns lose their dependent FKs/indexes; canonical junction indexes remain.

Migration 86 replaces the historical partial CampaignContact `(campaignId, leadId)` unique index with Prisma's full unique index. PostgreSQL permits multiple NULLs in both representations, preserving non-null recipient identity while eliminating introspection drift.

All **14 scalar arrays** and **24 original JSON columns** were reviewed; table retirement leaves **21 JSON columns**. Provider scopes/labels, captured addresses, validation field names and tags are value collections. Product ID/name arrays project from catalog relations for normalized rows; unresolved historical selections retain explicit compatibility. Mailbox relational JSON is extracted. Flexible form/closing configuration, workflow DSL and captured audit/import/submission/execution documents remain JSON.

Core entities and junctions have clear keys and ownership; relationship attributes depend on the whole pair. Universal strict 1NF/2NF/3NF certification would be misleading because arrays/JSON, tenant enforcement projections, derived counters and history deliberately remain. The practical rule is one authority for mutable facts and explicit derivation or historical meaning for retained copies.

Before cleanup there were no declared-FK orphans, but six AuditLog actor tenant mismatches and five orphan founding-owner references. Authorized dummy deletion removed those records; that is not presented as a general history repair. Current declared and checked logical links have zero orphans/mismatches. Pipeline/trigger consistency, conversion links, primary role matches, user/group/import duplicates, RecordFile parent count and Workflow state are also checked.

## Validation actually executed

| Check | Result |
|---|---|
| Prisma validate / generate | Passed, Prisma Client 5.22 |
| Native PostgreSQL 17 replay / Prisma diff | All 86 migrations deployed; zero schema difference, exit 0 |
| Integrity migration fixtures | Populated preservation, invalid-data rollback, tenant guards and pipeline/workflow consistency passed |
| Obsolete retirement fixtures | Nonempty-table/inbound-FK/non-null-column guards, rollback and retained-row equivalence passed |
| Canonical migration fixtures | Scalar-only backfill, multilinks/order, old reads, mailbox bridges/UTC, deployment/equivalence guards and retirement passed |
| Actual backup restoration | Original cleanup and pre-retirement backups restored and verified |
| Complete backend suite | **693 passed, 0 failed, 266 skipped**; environment-guarded integrations run separately |
| PostgreSQL application groups | **259 passed**: smoke, workflows/tasks, forms, campaigns, completion, mailbox, account security, permissions |
| Product/import/sales/notification tests | **48 passed, 1 skipped**, four files |
| Native roles / groups | **9 passed** |
| Full frontend suite | **1,001 passed, 0 failed**; corrected permission/cache/label suites also passed **14/14** |
| Deployment gate tests | **6 passed**, separate Node test runner |
| Workspace lint / typechecks | All three passed |
| Separate seeder typecheck | Passed; seeders not executed on live data |
| Production builds | Backend and frontend passed; 180 frontend routes generated |
| Authenticated live preflight | Passed through actual frontend proxy with temporary audit session; session deleted and exact User unchanged |

Old conversion mocks were replaced by real migrated fixtures testing current confirmed-sale behavior, mapping, idempotent retries, preservation, rollback and tenant isolation. Historical fixtures now create rows against their matching schema before migration. Frontend expectations reflect separate Lead/Contact grants, personal Settings availability and related customer count invalidation. No permission was loosened to satisfy tests. Product projection middleware was corrected for explicit nested selections, with helper fields removed from returned shapes.

No external message or Google consent was performed. Provider suites use configured doubles. The temporary live audit session verifies signing/session middleware and identity; it is not a password-login test. Its token is neither logged nor persisted, and the session is deleted in `finally`.

## Performance and limits

Twelve EXPLAIN ANALYZE plans on restored pre-cleanup data covered Leads, Contacts, Accounts, pipeline, Tasks, campaign reports, workflow history, notifications, archive, team, imports and mailbox. Disposable PGlite execution times were approximately 0.05–4.42 ms, not production latency guarantees. New reads use relation includes and indexed mailbox lookups rather than per-record fetch loops. Composite indexes incur deliberate write overhead for integrity.

Remaining limits: active PasswordResetToken storage is plaintext; system Gmail uses the supported `system/system` identity exception; some optional actor/provider/history links depend on runtime validation; hard-delete cascades retain module-specific behavior; product compatibility arrays remain; SMS scheduling includes an existing dry-run path and email scheduling is paused by existing policy. These are documented boundaries, not reasons to keep proven-obsolete tables.

## Required 37-point result

| # | Item | Result |
|---:|---|---|
| 1 | Original Prisma models | 60 |
| 2 | Original physical tables | 61 including Prisma ledger |
| 3 | Final Prisma models | 57 |
| 4 | Current physical tables | 58 verified live; column retirement does not change count |
| 5 | Tables kept | Every KEEP decision is named in inventory; active history/security/staging retained |
| 6 | Tables normalized | Every NORMALIZE decision covers relationship authority, tenant consistency or catalog alignment |
| 7 | Tables/storage replaced | Mailbox-thread preferences replaced by MailboxThreadAssociation |
| 8 | Tables dropped | DealAction, AutomationRule, SMSQueue, EmailVerificationToken — live |
| 9 | Columns dropped | Task.organizationId live; six participant scalars gated for 86 |
| 10 | Redundant relationships | Two Deal/four Task scalar mechanisms replaced by ordered junction authority |
| 11 | Duplicate mutable facts | Primary participant IDs derive from junctions; mailbox mapping becomes relational |
| 12 | Snapshots | Commercial, closing, audit, form, import, metrics and provider history retained |
| 13 | Arrays | All 14 individually classified |
| 14 | JSON | All 24 original / 21 remaining individually classified |
| 15 | Auth findings | Sessions/recovery/login/OAuth retained; unreachable signup verification retired |
| 16 | Role findings | Primary identity differs from grants; role/session/group tenant constraints strengthened |
| 17 | CRM findings | Entity boundaries, conversion provenance, ownership and archive flows preserved |
| 18 | Deal findings | Ordered participants, atomic edits, compatible responses and stage validation |
| 19 | Task findings | Four junctions drive filters, context, serialization, workflows and writes |
| 20 | Campaign findings | Recipient state, caches, snapshots, quota reservations and delivery logs differ |
| 21 | Workflow findings | Definition/trigger/run/step retained; composite consistency enforced |
| 22 | Gmail findings | Current thread mapping normalized; credentials/challenges/messages remain separate |
| 23 | Forms findings | Independent submissions capture payload/published schema; composite form FK |
| 24 | Notifications | Recipient/read/idempotency retained; cursor explains one preference row |
| 25 | Imports | Shared job/result/upload/chunk architecture retained and tested |
| 26 | Obsolete structures | Four guarded table drops plus unused organization column; no supported consumer removed |
| 27 | Index changes | Two duplicate indexes removed, missing indexes restored, mailbox index added; partial unique alignment in 86 |
| 28 | FK changes | Nineteen strengthened paths, two mailbox composite FKs, retired table/column FKs removed |
| 29 | Unique changes | Ten tenant reference superkeys, mailbox account/thread PK; business identities retained |
| 30 | Migration files | Four forward files 83–86; 83–85 applied, 86 gated |
| 31 | Row counts | Cleanup 4,284 → 51, then cursor 52; later activity grew to 775 at 12:19 UTC and is preserved; latest per-table inventory supplied |
| 32 | Orphans | Zero current declared-FK/checked logical-link orphans and tenant mismatches |
| 33 | Compatibility | Public singular IDs derived; temporary SQL bridges removed only after verification |
| 34 | Tests executed | Results/skips above; no unperformed provider test claimed |
| 35 | Prisma | Validate/generate/replay/zero fresh-schema drift passed |
| 36 | Lint/build | Three workspace checks, seeder check, backend/frontend production builds passed |
| 37 | Remaining risks | Final live cutover pending at this revision; intentional history/security/provider limits documented |
