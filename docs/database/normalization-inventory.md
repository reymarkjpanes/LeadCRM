# LeadCRM database inventory and normalization decisions

Audit date: 2026-10-05 (Asia/Manila). Initial catalog: 60 application tables, 61 physical public tables. Current catalog captured 2026-10-05T12:19:56.743Z: 57 application tables, 58 physical tables including Prisma bookkeeping, 57 Prisma models. 1547 repository files searched; 86 forward migration SQL files replayed.

Direct delegate matches establish code locations, not reachability by themselves. Nested access is reviewed with its parent. The four retired tables had no supported runtime consumers in the deployed build; empty post-cleanup tables alone were not used as proof. Final actions below describe the reviewed release; the live ledger states which migration phases have executed. See [report and rollout](normalization-report.md).

Categories: A core domain; B junction/relationship; C history/event; D security/auth; E integration; F configuration; G staging; H cache/counter/snapshot; I legacy candidate; J uncertain.

## Complete decision table

| Table | Category | Current purpose | Runtime usage | Normalization issue | Final action | Migration | Risk |
|---|---|---|---|---|---|---|---|
| Account | A | Customer organization | 39 direct reads; 12 direct writes; nested use below | Names are not unique identities; historical text/products have compatibility meaning | **KEEP** — Keep distinct from people; retain account-owned attributes | 83 | HIGH |
| AccountProductInterest | B | Account product interest and ownership flags | 1 direct reads; 0 direct writes; nested use below | Flags describe same pair, not duplicate products | **KEEP** — Keep existing normalized junction | None | HIGH |
| Activity | C | CRM-visible timeline | 12 direct reads; 27 direct writes; nested use below | Multiple contextual FKs are supported despite stale exactly-one comment; hard-delete cascades | **KEEP** — Keep distinct from audit; correct comment; retain event metadata and archive history | 83 | HIGH |
| AuditLog | C | Security and administration change history | 4 direct reads; 11 direct writes; nested use below | Six historical actor tenant mismatches before cleanup; entity references are polymorphic history | **KEEP** — Keep immutable changesets; do not rewrite historical tenant/actor identity or cascade away logs | None | HIGH |
| AutomationRule | I | Old automation definition mechanism | No supported consumer; historical references only | No current route/worker/frontend consumer; Workflow owns supported automation | **DROP** — Drop empty table in guarded migration 84; preserve Workflow and all execution history | 84 | MEDIUM |
| Campaign | A | Outbound campaign definition and cached totals | 16 direct reads; 17 direct writes; nested use below | Mutable totals derive from recipient state; concurrent updates serialized in send/webhook flow | **KEEP** — Keep cache; preserve Report API and send reservations; scheduler starts at boot and pauses email sends; SMS dry-run path needs separate review | None | HIGH |
| CampaignContact | C | Recipient identity, send state and captured personalization | 14 direct reads; 6 direct writes; nested use below | Email/personalization preserve send-time facts; nullable lead/contact supports deletion | **NORMALIZE** — Keep separate from provider log; recipient/provider identity retained | 83, 86 | HIGH |
| CampaignEmailQuota | H | Account-wide provider daily send reservation | 0 direct reads; 2 direct writes; nested use below | Reservation is authoritative concurrency control, not report count | **KEEP** — Keep daily key and atomic increments; do not derive from successful sends | None | HIGH |
| CampaignMetrics | H | Append-only campaign reporting snapshots | 0 direct reads; 2 direct writes; nested use below | Shares counter names with Campaign but snapshotAt gives different meaning | **KEEP** — Keep snapshots; never merge into current totals | None | HIGH |
| ClosingFieldDefinition | F | Tenant-defined closing field configuration | 2 direct reads; 3 direct writes; nested use below | JSON definition is flexible schema; updatedAt SQL default missing in Prisma | **NORMALIZE** — Keep composite tenant/id identity and JSON; align Prisma with existing updatedAt default | None | MEDIUM |
| Contact | A | Known customer person and lifecycle | 51 direct reads; 16 direct writes; nested use below | owner and assignee have distinct provenance; company is free-text fallback; lifecycle differs from human status | **KEEP** — Keep lifecycle and status; retain conversion trace and account relationship | 83 | HIGH |
| ContactDeal | B | Many-to-many opportunity contact participation | 10 direct reads; 9 direct writes; nested use below | Missing tenant equality between both endpoints | **NORMALIZE** — Composite endpoint FKs; keep addedBy, role and addedAt provenance | 83, 85, 86 | HIGH |
| ContactProductInterest | B | Contact product interest and ownership flags | 1 direct reads; 0 direct writes; nested use below | Flags describe same pair, not duplicate products | **KEEP** — Keep existing normalized junction | None | HIGH |
| CrmImportChunk | G | Ordered upload content slice | 0 direct reads; 1 direct writes; nested use below | Parent owns module/scope/expiry; correct normalized dependency | **KEEP** — Keep unique upload/chunkIndex and cascade source cleanup | None | MEDIUM |
| CrmImportJob | C | Shared module import job and accounting | 4 direct reads; 3 direct writes; nested use below | Counters are transactionally finalized from row outcomes; upload reference may expire | **KEEP** — Keep shared import architecture and idempotency identity | None | HIGH |
| CrmImportRowResult | C | Historical per-input-row outcome | 4 direct reads; 0 direct writes; nested use below | recordId intentionally survives source record deletion; JSON holds input snapshot | **KEEP** — Keep unique job/rowNumber and immutable input/result | None | HIGH |
| CrmImportUpload | G | Expiring raw import upload envelope | 4 direct reads; 5 direct writes; nested use below | Owns source hash, expiry and chunk count before job creation | **KEEP** — Keep shared staging; retain cleanup index | None | HIGH |
| Deal | A | Opportunity with immutable commercial snapshot | 49 direct reads; 18 direct writes; nested use below | Duplicate scalar people relationships retired after canonical release verification | **NORMALIZE** — Use ordered LeadDeal/ContactDeal as sole participant storage; derive singular API fields; atomic edits; keep value snapshot | 83, 85, 86 | HIGH |
| DealAction | I | Legacy structured manual-deal action log | No supported consumer; historical references only | No runtime, route, worker, integration or frontend table consumer; current actions use Activity and DealStageHistory | **DROP** — Drop empty table and enum through guarded migration 84; existing deployed build has no consumer | 84 | MEDIUM |
| DealStageHistory | C | Immutable stage transition history | 5 direct reads; 3 direct writes; nested use below | Hard-delete cascade removes history; archive does not | **KEEP** — Keep; retain hard-delete behavior pending a separate retention policy; never fold into Deal | None | HIGH |
| EmailAccount | E | Encrypted Gmail credentials and synchronization lease | 16 direct reads; 12 direct writes; nested use below | System sender intentionally uses system/system without User/Tenant rows | **NORMALIZE** — Keep system sender exception; do not blindly add tenant/user FKs; separate system credentials in future expand phase | 83 | HIGH |
| EmailDeliveryLog | E | Outbound provider submission and current delivery state | 3 direct reads; 8 direct writes; nested use below | Duplicate gmailMessageId index; provider state also projected to recipients | **NORMALIZE** — Keep separate from inbox; remove exact redundant index | 83 | HIGH |
| EmailEvent | C | Idempotent outbound provider event history | 0 direct reads; 1 direct writes; nested use below | Shares event facts with delivery projection intentionally | **KEEP** — Keep event identity key and history; separate from mailbox messages | None | HIGH |
| EmailVerificationToken | D | Retired signup verification capabilities | No supported consumer; historical references only | Public route retired; unused service unreachable; seven original dummy rows deleted with authorized cleanup | **DROP** — Drop empty table in migration 84 and remove unreachable service/test; password reset and OAuth remain separate active flows | 84 | HIGH |
| FormSubmission | C | Individual idempotent published form submission | 3 direct reads; 3 direct writes; nested use below | tenantId not tied to form by composite FK | **NORMALIZE** — Composite form FK; keep payload, publishedConfig, email/phone capture snapshots | 83 | HIGH |
| Lead | A | Prospective person and retained conversion source | 53 direct reads; 15 direct writes; nested use below | companyName may be unlinked intake text; contactId is conversion trace; products compatibility | **KEEP** — Keep original row, conversion actor/time and account link; no email uniqueness without business rule | 83 | HIGH |
| LeadDeal | B | Many-to-many opportunity lead participation | 9 direct reads; 8 direct writes; nested use below | Missing tenant equality between both endpoints | **NORMALIZE** — Composite endpoint FKs; keep addedBy, role and addedAt provenance | 83, 85, 86 | HIGH |
| LeadProductInterest | B | Ordered lead product selections | 0 direct reads; 0 direct writes; nested use below | Nested writes through productRelationData are active | **KEEP** — Keep existing normalized junction | None | HIGH |
| MailboxMessage | E | Gmail ingestion and CRM engagement state | 9 direct reads; 3 direct writes; nested use below | Account scope needs enforcement; nullable CRM context retained through conversion/history | **NORMALIZE** — Composite account FK; keep captured per-message context; normalize current thread association into its own table | 83 | HIGH |
| MailboxOAuthState | D | Short-lived session-bound OAuth challenge | 1 direct reads; 3 direct writes; nested use below | Hash/session/user references validated by OAuth flow, no DB FK | **KEEP** — Keep isolated secrets and expiry index; do not combine with sessions or inbox | None | HIGH |
| MailboxThreadAssociation | B | Current Deal association of a provider thread within one mailbox | 2 direct reads; 1 direct writes; nested use below | Preference JSON previously stored a mutable relational Deal ID without FK | **REPLACE** — Replace mailbox-thread preference rows with account/thread primary key and tenant-safe account/Deal FKs | 85, 86 | HIGH |
| MarketingForm | F | Draft and published form definition | 13 direct reads; 7 direct writes; nested use below | Draft/published JSON are intentionally different versions | **KEEP** — Keep definition and immutable published config snapshots | 83 | HIGH |
| Notification | C | Recipient-specific inbox event and read state | 6 direct reads; 5 direct writes; nested use below | Nullable eventKey allows non-idempotent ad hoc notices; recipient tenant should be enforced | **NORMALIZE** — Keep unique tenant/user/eventKey; composite recipient FK; do not replace with audit | 83 | HIGH |
| PasswordResetToken | D | Active password recovery capability | 1 direct reads; 5 direct writes; nested use below | Optional userId lacks FK; email is captured identity guard; token is currently plaintext | **KEEP** — Keep active flow; token hashing and nullable-user compatibility need dedicated expand/switch rollout | None | HIGH |
| Pipeline | F | Tenant sales pipeline | 14 direct reads; 6 direct writes; nested use below | Stage tenant depends on pipeline; currency is configurable pipeline default | **NORMALIZE** — Keep; enforce parent scope for stages | 83 | HIGH |
| ProductInterest | A | Product catalog current defaults | 14 direct reads; 4 direct writes; nested use below | Previously normalized; deal value is intentionally historical | **KEEP** — Keep existing product behavior; outside this normalization change | None | HIGH |
| RecordFile | A | Stored object metadata attached to CRM record | 5 direct reads; 1 direct writes; nested use below | Composite record scope exists; uploadedBy scope and storage cleanup require separate lifecycle checks | **KEEP** — Keep storage ownership and exactly-one-record SQL constraint; never merge with audit | None | HIGH |
| RoleDefinition | D | Named tenant roles | 15 direct reads; 4 direct writes; nested use below | Single-column child FKs do not enforce tenant equality | **NORMALIZE** — Keep; add tenant reference key for assignments and permissions | 83 | HIGH |
| RolePermission | D | One module permission vector per role | 0 direct reads; 3 direct writes; nested use below | tenantId can disagree with role; redundant roleId index | **NORMALIZE** — Use composite role FK; retain action flags and module identity | 83 | HIGH |
| Session | D | Hashed revocable authentication sessions | 2 direct reads; 7 direct writes; nested use below | Duplicate tokenHash index; user/tenant equality not constrained | **NORMALIZE** — Keep security state; composite user FK; remove exact redundant index | 83 | HIGH |
| SMSQueue | I | Legacy Android gateway delivery queue | No supported consumer; historical references only | No runtime/worker/webhook access; SMS uses external provider service | **DROP** — Drop empty table in guarded migration 84; provider adapter and campaign flow retained | 84 | MEDIUM |
| Stage | F | Ordered pipeline stage and entry rules | 19 direct reads; 6 direct writes; nested use below | Tenant/pipeline relationship and Deal pipeline-stage pair need database enforcement | **NORMALIZE** — Composite pipeline FK and Deal stage reference key; keep requiredFields configuration | 83 | HIGH |
| TargetAudience | F | Reusable dynamic audience query | 2 direct reads; 1 direct writes; nested use below | Conditions correctly stored as independent ordered child rules | **KEEP** — Keep normalized parent/child design | None | MEDIUM |
| TargetAudienceCondition | B | Ordered audience predicate | 0 direct reads; 0 direct writes; nested use below | Nested parent reads/creates are active even with no direct delegate calls | **KEEP** — Keep relational rows; values interpreted by validated operators | None | MEDIUM |
| Task | A | Assigned scheduled work | 19 direct reads; 3 direct writes; nested use below | Four scalar relationships duplicated ordered junctions; live-only organizationId unused | **NORMALIZE** — Use TaskLead/TaskContact/TaskDeal/TaskAccount exclusively; derive singular API fields; retire five obsolete columns | 84, 85, 86 | HIGH |
| TaskAccount | B | Ordered task-account association | 0 direct reads; 2 direct writes; nested use below | Already composite tenant-safe FKs and pair PK | **KEEP** — Keep canonical multi-record associations | None | HIGH |
| TaskContact | B | Ordered task-contact association | 0 direct reads; 2 direct writes; nested use below | Already composite tenant-safe FKs and pair PK | **KEEP** — Keep canonical multi-record associations | None | HIGH |
| TaskDeal | B | Ordered task-deal association | 0 direct reads; 2 direct writes; nested use below | Already composite tenant-safe FKs and pair PK | **KEEP** — Keep canonical multi-record associations | None | HIGH |
| TaskLead | B | Ordered task-lead association | 0 direct reads; 2 direct writes; nested use below | Already composite tenant-safe FKs and pair PK | **KEEP** — Keep canonical multi-record associations | None | HIGH |
| Template | F | Reusable email/SMS authoring template | 10 direct reads; 4 direct writes; nested use below | Campaign inline content can deliberately override template | **KEEP** — Keep; no campaign-body deduplication | None | MEDIUM |
| Tenant | A | Workspace identity and defaults | 6 direct reads; 3 direct writes; nested use below | ownerUserId captures founding identity; five historical orphaned dummy references were removed by authorized cleanup | **KEEP** — Keep tenant scoping and retained workspace identity; founding provenance is separate from current permissions | None | HIGH |
| TenantGroup | F | Named staff groups | 3 direct reads; 3 direct writes; nested use below | Tenant-aware member relation missing | **NORMALIZE** — Keep; add tenant reference key | 83 | MEDIUM |
| TenantGroupMember | B | Group membership | 0 direct reads; 2 direct writes; nested use below | Existing group/user uniqueness is correct; missing tenant FK enforcement | **NORMALIZE** — Keep pair uniqueness; composite member FKs | 83 | HIGH |
| TenantPreference | F | Workspace preferences and operational state | 8 direct reads; 7 direct writes; nested use below | mailbox-thread JSON duplicated a queryable relationship; other values are configuration/cursors | **NORMALIZE** — Move mailbox mapping into MailboxThreadAssociation; remove compatibility rows after equivalence check; keep other preferences | 85, 86 | MEDIUM |
| User | D | Staff identity, credentials and primary routing role | 42 direct reads; 13 direct writes; nested use below | role is a primary identity; UserRole grants permissions; not an interchangeable duplicate | **NORMALIZE** — Keep compatibility role; strengthen tenant keys; never infer primary role from arbitrary junction ordering | 83 | HIGH |
| UserPreference | F | Per-user module display preferences | 1 direct reads; 2 direct writes; nested use below | Flexible JSON is appropriate; tenant/user FK gap remains | **KEEP** — Keep config; document keys with relational content separately | None | MEDIUM |
| UserRole | B | Permission-bearing user role assignments | 3 direct reads; 3 direct writes; nested use below | Tenant equality is enforced only in services | **NORMALIZE** — Use tenant-consistent composite FKs; retain API compound unique selector | 83 | HIGH |
| Workflow | F | Trigger/action configuration and current lifecycle | 8 direct reads; 3 direct writes; nested use below | status and isActive are synchronized compatibility state | **NORMALIZE** — Keep JSON DSL and lifecycle guard; no enum tightening without accepted historical values | 83 | HIGH |
| WorkflowExecutionRun | C | Execution attempt and summary | 5 direct reads; 2 direct writes; nested use below | workflowId can disagree with trigger.workflowId | **NORMALIZE** — Composite trigger FK including workflowId and tenantId; keep indexed workflow projection | 83 | HIGH |
| WorkflowExecutionStep | C | Individual action execution result | 0 direct reads; 2 direct writes; nested use below | Scope can disagree with run; repeated stepIndex semantics must be retained | **NORMALIZE** — Composite execution FK; retain independent output and errors | 83 | HIGH |
| WorkflowTriggerRecord | C | Idempotent observed workflow event | 0 direct reads; 1 direct writes; nested use below | Workflow/tenant scope not enforced by FK | **NORMALIZE** — Composite workflow FK; keep event payload snapshot | 83 | HIGH |
| _prisma_migrations | F | Migration ledger | Prisma deploy/diff tooling | Infrastructure bookkeeping | KEEP | Prisma managed | HIGH |

## Per-table evidence

### Account

Customer organization. Category A. Keep distinct from people; retain account-owned attributes

- Initial audit rows: **22**; immediately before cleanup: **22**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): deletedAt=NULL; createdAt=2026-10-04T07:20:54.155Z; updatedAt=2026-10-04T07:20:54.155Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Account_id_tenantId_key" ON public."Account" USING btree (id, "tenantId")`; `CREATE UNIQUE INDEX "Account_pkey" ON public."Account" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); assignedUser: User? (@relation(fields: [assignedUserId], references: [id])).
- Children: Lead.account; Contact.account; Deal.organization; Activity.organization; TaskAccount.account; RecordFile.account; AccountProductInterest.account.
- Direct runtime-source read sites: [backend/src/modules/crm/relationships/relationships.service.ts:29](../../backend/src/modules/crm/relationships/relationships.service.ts#L29); [backend/src/modules/crm/relationships/relationships.service.ts:91](../../backend/src/modules/crm/relationships/relationships.service.ts#L91); [backend/src/modules/crm/relationships/relationships.service.ts:140](../../backend/src/modules/crm/relationships/relationships.service.ts#L140); [backend/src/modules/crm/relationships/relationships.service.ts:190](../../backend/src/modules/crm/relationships/relationships.service.ts#L190); [backend/src/modules/operations/tasks/tasks.repository.ts:84](../../backend/src/modules/operations/tasks/tasks.repository.ts#L84); [backend/src/modules/operations/tasks/tasks.repository.ts:217](../../backend/src/modules/operations/tasks/tasks.repository.ts#L217); [backend/src/modules/operations/tasks/tasks.repository.ts:329](../../backend/src/modules/operations/tasks/tasks.repository.ts#L329); [backend/src/modules/operations/tasks/tasks.repository.ts:339](../../backend/src/modules/operations/tasks/tasks.repository.ts#L339); [backend/src/modules/operations/tasks/tasks.repository.ts:434](../../backend/src/modules/operations/tasks/tasks.repository.ts#L434); [backend/src/modules/crm/record-files/record-files.service.ts:21](../../backend/src/modules/crm/record-files/record-files.service.ts#L21); [backend/src/modules/crm/merge/merge.service.ts:244](../../backend/src/modules/crm/merge/merge.service.ts#L244); [backend/src/modules/crm/merge/merge.service.ts:245](../../backend/src/modules/crm/merge/merge.service.ts#L245); [backend/src/modules/crm/merge/merge.service.ts:271](../../backend/src/modules/crm/merge/merge.service.ts#L271); [backend/src/modules/crm/merge/merge.service.ts:272](../../backend/src/modules/crm/merge/merge.service.ts#L272); [backend/src/modules/crm/leads/lead-conversion.service.ts:33](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L33); [backend/src/modules/crm/leads/lead-conversion.service.ts:39](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L39); [backend/src/modules/crm/leads/lead-conversion.service.ts:41](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L41); [backend/src/modules/crm/leads/lead-automation.service.ts:98](../../backend/src/modules/crm/leads/lead-automation.service.ts#L98); [backend/src/modules/crm/imports/import-rows.service.ts:46](../../backend/src/modules/crm/imports/import-rows.service.ts#L46); [backend/src/modules/crm/imports/import-rows.service.ts:162](../../backend/src/modules/crm/imports/import-rows.service.ts#L162); [backend/src/modules/crm/imports/import-rows.service.ts:192](../../backend/src/modules/crm/imports/import-rows.service.ts#L192); [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:237](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L237); [backend/src/modules/crm/deals/won-conversion.service.ts:27](../../backend/src/modules/crm/deals/won-conversion.service.ts#L27); [backend/src/modules/crm/deals/won-conversion.service.ts:35](../../backend/src/modules/crm/deals/won-conversion.service.ts#L35); [backend/src/modules/crm/contacts-v2/contacts-v2.service.ts:64](../../backend/src/modules/crm/contacts-v2/contacts-v2.service.ts#L64); [backend/src/modules/crm/contacts/contacts.service.ts:146](../../backend/src/modules/crm/contacts/contacts.service.ts#L146); [backend/src/modules/crm/contacts/contacts.repository.ts:130](../../backend/src/modules/crm/contacts/contacts.repository.ts#L130); [backend/src/modules/crm/companies/companies.repository.ts:45](../../backend/src/modules/crm/companies/companies.repository.ts#L45); [backend/src/modules/crm/companies/companies.repository.ts:47](../../backend/src/modules/crm/companies/companies.repository.ts#L47); [backend/src/modules/crm/companies/companies.repository.ts:53](../../backend/src/modules/crm/companies/companies.repository.ts#L53); [backend/src/modules/crm/companies/companies.repository.ts:60](../../backend/src/modules/crm/companies/companies.repository.ts#L60); [backend/src/modules/crm/companies/companies.repository.ts:75](../../backend/src/modules/crm/companies/companies.repository.ts#L75); [backend/src/modules/crm/companies/companies.repository.ts:79](../../backend/src/modules/crm/companies/companies.repository.ts#L79); [backend/src/modules/automation/workflows/workflows.repository.ts:16](../../backend/src/modules/automation/workflows/workflows.repository.ts#L16); [backend/src/modules/automation/workflows/workflows.repository.ts:122](../../backend/src/modules/automation/workflows/workflows.repository.ts#L122); [backend/src/modules/automation/actions/actions.repository.ts:3](../../backend/src/modules/automation/actions/actions.repository.ts#L3); [backend/src/modules/automation/actions/action-fields.ts:51](../../backend/src/modules/automation/actions/action-fields.ts#L51); [backend/src/modules/administration/archived-data/archived-data.service.ts:54](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L54)
- Direct runtime-source write sites: [backend/src/modules/crm/merge/merge.service.ts:284](../../backend/src/modules/crm/merge/merge.service.ts#L284); [backend/src/modules/crm/merge/merge.service.ts:289](../../backend/src/modules/crm/merge/merge.service.ts#L289); [backend/src/modules/crm/leads/lead-conversion.service.ts:36](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L36); [backend/src/modules/crm/leads/lead-conversion.service.ts:42](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L42); [backend/src/modules/crm/imports/import-rows.service.ts:141](../../backend/src/modules/crm/imports/import-rows.service.ts#L141); [backend/src/modules/crm/imports/import-rows.service.ts:163](../../backend/src/modules/crm/imports/import-rows.service.ts#L163); [backend/src/modules/crm/deals/won-conversion.service.ts:29](../../backend/src/modules/crm/deals/won-conversion.service.ts#L29); [backend/src/modules/crm/deals/won-conversion.service.ts:37](../../backend/src/modules/crm/deals/won-conversion.service.ts#L37); [backend/src/modules/crm/companies/companies.repository.ts:71](../../backend/src/modules/crm/companies/companies.repository.ts#L71); [backend/src/modules/crm/companies/companies.repository.ts:82](../../backend/src/modules/crm/companies/companies.repository.ts#L82); [backend/src/modules/crm/companies/companies.repository.ts:87](../../backend/src/modules/crm/companies/companies.repository.ts#L87); [backend/src/modules/crm/companies/companies.repository.ts:94](../../backend/src/modules/crm/companies/companies.repository.ts#L94)
- Possible nested relation access (review with parent): [backend/src/integrations/gmail/mailbox-ingestion.service.ts:27](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L27) `account`; [backend/src/modules/notifications/notification-events.service.ts:75](../../backend/src/modules/notifications/notification-events.service.ts#L75) `account`; [backend/src/modules/operations/tasks/tasks.service.ts:128](../../backend/src/modules/operations/tasks/tasks.service.ts#L128) `account`; [backend/src/modules/operations/tasks/tasks.repository.ts:51](../../backend/src/modules/operations/tasks/tasks.repository.ts#L51) `account`; [backend/src/modules/operations/tasks/tasks.repository.ts:80](../../backend/src/modules/operations/tasks/tasks.repository.ts#L80) `organization`; [backend/src/modules/crm/deals/deals.service.ts:267](../../backend/src/modules/crm/deals/deals.service.ts#L267) `organization`; [backend/src/modules/crm/deals/deals.repository.ts:53](../../backend/src/modules/crm/deals/deals.repository.ts#L53) `organization`; [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:25](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L25) `account`; [backend/src/modules/crm/contacts/contacts.repository.ts:62](../../backend/src/modules/crm/contacts/contacts.repository.ts#L62) `account`; [backend/src/modules/administration/product-interests/product-interests.repository.ts:14](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L14) `organization`
- Search matches across repository: 2310 in 378 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/automation/workflows/workflows.repository.ts:16](../../backend/src/modules/automation/workflows/workflows.repository.ts#L16); [backend/src/modules/automation/workflows/workflows.repository.ts:122](../../backend/src/modules/automation/workflows/workflows.repository.ts#L122)
- Normalization assessment: Names are not unique identities; historical text/products have compatibility meaning. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| productsNormalized | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterestOther | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| assignedUserId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| industry | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| size | String? | // "1-10" \| "11-50" \| "51-200" \| "200+" | 0 | KEEP — attribute owned by this row; not a separate entity |
| website | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| notes | String? | @db.Text | 0 | KEEP — attribute owned by this row; not a separate entity |
| internalNotes | String? | @db.Text | 0 | KEEP — attribute owned by this row; not a separate entity |
| tags | String[] | @default([]) | 0 | KEEP: Simple tag values; no independently managed tag entity or FK identity. |
| productInterests | String[] | @default([]) | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| activeProducts | String[] | @default([]) | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| address | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| city | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| province | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| country | String? | @default("Philippines") | 0 | KEEP — attribute owned by this row; not a separate entity |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| deletedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| deletedBy | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @default(now()) @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Account_assignedUserId_fkey; validated=true
FOREIGN KEY ("assignedUserId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Account_pkey; validated=true
PRIMARY KEY (id)
-- Account_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Account_id_tenantId_key" ON public."Account" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Account_pkey" ON public."Account" USING btree (id);
CREATE INDEX "Account_tenantId_assignedUserId_idx" ON public."Account" USING btree ("tenantId", "assignedUserId");
CREATE INDEX "Account_tenantId_createdAt_idx" ON public."Account" USING btree ("tenantId", "createdAt");
CREATE INDEX "Account_tenantId_idx" ON public."Account" USING btree ("tenantId");
CREATE INDEX "Account_tenantId_isArchived_idx" ON public."Account" USING btree ("tenantId", "isArchived");
CREATE INDEX "Account_tenantId_name_idx" ON public."Account" USING btree ("tenantId", name);
```

</details>

### AccountProductInterest

Account product interest and ownership flags. Category B. Keep existing normalized junction

- Initial audit rows: **4**; immediately before cleanup: **4**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("accountId", "productInterestId").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "AccountProductInterest_pkey" ON public."AccountProductInterest" USING btree ("accountId", "productInterestId")`.
- Parent relations: account: Account (@relation(fields: [accountId, tenantId], references: [id, tenantId], onDelete: Cascade)); product: ProductInterest (@relation(fields: [productInterestId, tenantId], references: [id, tenantId], onDelete: Restrict)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/leads/product-relations.ts:18](../../backend/src/modules/crm/leads/product-relations.ts#L18)
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:48](../../backend/src/modules/operations/tasks/tasks.repository.ts#L48) `accountLinks`; [backend/src/modules/marketing/campaigns/audiences.service.ts:45](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L45) `productLinks`
- Search matches across repository: 12 in 7 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Flags describe same pair, not duplicate products. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| accountId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| productInterestId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| interested | Boolean | @default(true) | 0 | KEEP — attribute owned by this row; not a separate entity |
| activeProduct | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- AccountProductInterest_accountId_tenantId_fkey; validated=true
FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- AccountProductInterest_pkey; validated=true
PRIMARY KEY ("accountId", "productInterestId")
-- AccountProductInterest_productInterestId_tenantId_fkey; validated=true
FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "AccountProductInterest_pkey" ON public."AccountProductInterest" USING btree ("accountId", "productInterestId");
CREATE INDEX "AccountProductInterest_tenantId_productInterestId_idx" ON public."AccountProductInterest" USING btree ("tenantId", "productInterestId");
```

</details>

### Activity

CRM-visible timeline. Category C. Keep distinct from audit; correct comment; retain event metadata and archive history

- Initial audit rows: **160**; immediately before cleanup: **160**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-05T01:27:31.880Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Activity_pkey" ON public."Activity" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); createdBy: User (@relation(fields: [createdById], references: [id])); lead: Lead? (@relation(fields: [leadId], references: [id], onDelete: Cascade)); contact: Contact? (@relation(fields: [contactId], references: [id], onDelete: Cascade)); deal: Deal? (@relation(fields: [dealId], references: [id], onDelete: Cascade)); organization: Account? (@relation(fields: [accountId], references: [id], onDelete: Cascade)); task: Task? (@relation(fields: [taskId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/notifications/notification-events.service.ts:48](../../backend/src/modules/notifications/notification-events.service.ts#L48); [backend/src/modules/notifications/notification-events.service.ts:55](../../backend/src/modules/notifications/notification-events.service.ts#L55); [backend/src/modules/crm/relationships/relationships.service.ts:46](../../backend/src/modules/crm/relationships/relationships.service.ts#L46); [backend/src/modules/crm/relationships/relationships.service.ts:108](../../backend/src/modules/crm/relationships/relationships.service.ts#L108); [backend/src/modules/crm/relationships/relationships.service.ts:166](../../backend/src/modules/crm/relationships/relationships.service.ts#L166); [backend/src/modules/crm/relationships/relationships.service.ts:216](../../backend/src/modules/crm/relationships/relationships.service.ts#L216); [backend/src/modules/crm/merge/merge.repository.ts:11](../../backend/src/modules/crm/merge/merge.repository.ts#L11); [backend/src/modules/crm/merge/merge.repository.ts:24](../../backend/src/modules/crm/merge/merge.repository.ts#L24); [backend/src/modules/crm/merge/merge.repository.ts:37](../../backend/src/modules/crm/merge/merge.repository.ts#L37); [backend/src/modules/crm/activities/activities.repository.ts:71](../../backend/src/modules/crm/activities/activities.repository.ts#L71); [backend/src/modules/crm/activities/activities.repository.ts:78](../../backend/src/modules/crm/activities/activities.repository.ts#L78); [backend/src/modules/crm/activities/activities.repository.ts:97](../../backend/src/modules/crm/activities/activities.repository.ts#L97)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-sync.service.ts:77](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L77); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:78](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L78); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:111](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L111); [backend/src/modules/crm/record-files/record-files.service.ts:59](../../backend/src/modules/crm/record-files/record-files.service.ts#L59); [backend/src/modules/marketing/forms/public-forms.service.ts:137](../../backend/src/modules/marketing/forms/public-forms.service.ts#L137); [backend/src/modules/crm/merge/merge.service.ts:132](../../backend/src/modules/crm/merge/merge.service.ts#L132); [backend/src/modules/crm/merge/merge.service.ts:213](../../backend/src/modules/crm/merge/merge.service.ts#L213); [backend/src/modules/crm/merge/merge.service.ts:294](../../backend/src/modules/crm/merge/merge.service.ts#L294); [backend/src/modules/crm/merge/merge.repository.ts:57](../../backend/src/modules/crm/merge/merge.repository.ts#L57); [backend/src/modules/crm/merge/merge.repository.ts:123](../../backend/src/modules/crm/merge/merge.repository.ts#L123); [backend/src/modules/crm/merge/merge.repository.ts:208](../../backend/src/modules/crm/merge/merge.repository.ts#L208); [backend/src/modules/crm/leads/lead-conversion.service.ts:68](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L68); [backend/src/modules/crm/leads/lead-conversion.service.ts:70](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L70); [backend/src/modules/crm/leads/lead-automation.service.ts:86](../../backend/src/modules/crm/leads/lead-automation.service.ts#L86); [backend/src/modules/crm/leads/lead-automation.service.ts:117](../../backend/src/modules/crm/leads/lead-automation.service.ts#L117); [backend/src/modules/crm/engagement.service.ts:24](../../backend/src/modules/crm/engagement.service.ts#L24); [backend/src/modules/crm/engagement.service.ts:39](../../backend/src/modules/crm/engagement.service.ts#L39); [backend/src/modules/crm/deals/deals.repository.ts:256](../../backend/src/modules/crm/deals/deals.repository.ts#L256); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:115](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L115); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:118](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L118); [backend/src/modules/crm/contacts/contacts.repository.ts:142](../../backend/src/modules/crm/contacts/contacts.repository.ts#L142); [backend/src/modules/crm/contacts/contacts.repository.ts:145](../../backend/src/modules/crm/contacts/contacts.repository.ts#L145); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:68](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L68); [backend/src/modules/crm/activities/activities.repository.ts:110](../../backend/src/modules/crm/activities/activities.repository.ts#L110); [backend/src/modules/crm/activities/activities.repository.ts:122](../../backend/src/modules/crm/activities/activities.repository.ts#L122); [backend/src/modules/crm/activities/activities.repository.ts:134](../../backend/src/modules/crm/activities/activities.repository.ts#L134); [backend/src/modules/automation/workflows/workflows.repository.ts:142](../../backend/src/modules/automation/workflows/workflows.repository.ts#L142)
- Possible nested relation access (review with parent): [backend/src/modules/crm/relationships/relationships.service.ts:127](../../backend/src/modules/crm/relationships/relationships.service.ts#L127) `activities`; [backend/src/modules/crm/merge/merge.repository.ts:106](../../backend/src/modules/crm/merge/merge.repository.ts#L106) `activities`; [backend/src/modules/crm/activities/activities.repository.ts:85](../../backend/src/modules/crm/activities/activities.repository.ts#L85) `activities`
- Search matches across repository: 655 in 153 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notification-events.service.ts:48](../../backend/src/modules/notifications/notification-events.service.ts#L48); [backend/src/modules/notifications/notification-events.service.ts:55](../../backend/src/modules/notifications/notification-events.service.ts#L55); [backend/src/integrations/gmail/mailbox-sync.service.ts:77](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L77); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:78](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L78); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:111](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L111); [backend/src/modules/automation/workflows/workflows.repository.ts:142](../../backend/src/modules/automation/workflows/workflows.repository.ts#L142)
- Normalization assessment: Multiple contextual FKs are supported despite stale exactly-one comment; hard-delete cascades. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| createdById | String | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |
| type | String | // call\|meeting\|email\|sms\|note\|task\|workflow\|stage_change\|deal_action\|file_upload | 0 | KEEP — captured event/outcome fact |
| title | String | No explicit default; required | 0 | KEEP — captured event/outcome fact |
| description | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| metadata | Json? | No explicit default; nullable | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| leadId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| contactId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| dealId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| accountId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| taskId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Activity_accountId_fkey; validated=true
FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_createdById_fkey; validated=true
FOREIGN KEY ("createdById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Activity_dealId_fkey; validated=true
FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_pkey; validated=true
PRIMARY KEY (id)
-- Activity_taskId_fkey; validated=true
FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Activity_pkey" ON public."Activity" USING btree (id);
CREATE INDEX "Activity_tenantId_contactId_createdAt_idx" ON public."Activity" USING btree ("tenantId", "contactId", "createdAt");
CREATE INDEX "Activity_tenantId_createdAt_idx" ON public."Activity" USING btree ("tenantId", "createdAt");
CREATE INDEX "Activity_tenantId_dealId_createdAt_idx" ON public."Activity" USING btree ("tenantId", "dealId", "createdAt");
CREATE INDEX "Activity_tenantId_idx" ON public."Activity" USING btree ("tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- Activity_accountId_fkey; validated=true
FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_createdById_fkey; validated=true
FOREIGN KEY ("createdById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Activity_dealId_fkey; validated=true
FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_pkey; validated=true
PRIMARY KEY (id)
-- Activity_taskId_fkey; validated=true
FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- Activity_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Activity_pkey" ON public."Activity" USING btree (id);
CREATE INDEX "Activity_tenantId_contactId_createdAt_idx" ON public."Activity" USING btree ("tenantId", "contactId", "createdAt");
CREATE INDEX "Activity_tenantId_createdAt_idx" ON public."Activity" USING btree ("tenantId", "createdAt");
CREATE INDEX "Activity_tenantId_dealId_createdAt_idx" ON public."Activity" USING btree ("tenantId", "dealId", "createdAt");
CREATE INDEX "Activity_tenantId_idx" ON public."Activity" USING btree ("tenantId");
CREATE INDEX "Activity_tenantId_leadId_createdAt_idx" ON public."Activity" USING btree ("tenantId", "leadId", "createdAt");
```

</details>

### AuditLog

Security and administration change history. Category C. Keep immutable changesets; do not rewrite historical tenant/actor identity or cascade away logs

- Initial audit rows: **377**; immediately before cleanup: **377**; after cleanup: **0**; final live rows: **12**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-05T06:22:02.759Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "AuditLog_pkey" ON public."AuditLog" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); user: User (@relation(fields: [userId], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/notifications/notification-events.service.ts:83](../../backend/src/modules/notifications/notification-events.service.ts#L83); [backend/src/modules/administration/audit/audit.service.ts:24](../../backend/src/modules/administration/audit/audit.service.ts#L24); [backend/src/modules/administration/audit/audit.service.ts:29](../../backend/src/modules/administration/audit/audit.service.ts#L29); [backend/src/modules/administration/archived-data/archived-data.service.ts:82](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L82)
- Direct runtime-source write sites: [backend/src/core/auth/profile.service.ts:18](../../backend/src/core/auth/profile.service.ts#L18); [backend/src/core/auth/onboarding.service.ts:21](../../backend/src/core/auth/onboarding.service.ts#L21); [backend/src/core/auth/change-password.service.ts:25](../../backend/src/core/auth/change-password.service.ts#L25); [backend/src/core/audit/audit.service.ts:30](../../backend/src/core/audit/audit.service.ts#L30); [backend/src/modules/marketing/forms/public-forms.service.ts:160](../../backend/src/modules/marketing/forms/public-forms.service.ts#L160); [backend/src/modules/crm/leads/lead-conversion.service.ts:72](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L72); [backend/src/modules/crm/imports/imports.service.ts:83](../../backend/src/modules/crm/imports/imports.service.ts#L83); [backend/src/modules/crm/deal-stage-automation.service.ts:17](../../backend/src/modules/crm/deal-stage-automation.service.ts#L17); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:33](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L33); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:75](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L75); [backend/src/modules/administration/organization-settings/organization-settings.service.ts:25](../../backend/src/modules/administration/organization-settings/organization-settings.service.ts#L25)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 175 in 76 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notification-events.service.ts:83](../../backend/src/modules/notifications/notification-events.service.ts#L83)
- Normalization assessment: Six historical actor tenant mismatches before cleanup; entity references are polymorphic history. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| action | String | // e.g. "contact.created" \| "deal.stage_changed" \| "user.login" | 0 | KEEP — captured event/outcome fact |
| entityType | String | // e.g. "Contact" \| "Deal" \| "User" | 0 | KEEP — captured event/outcome fact |
| entityId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| category | String | @default("crm") // auth\|crm\|workflow\|admin\|system | 0 | KEEP — captured event/outcome fact |
| changeset | Json? | // { before: { status: "WARM" }, after: { status: "HOT" } } | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| metadata | Json? | No explicit default; nullable | 12 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| ipAddress | String? | No explicit default; nullable | 12 | KEEP — captured event/outcome fact |
| userAgent | String? | No explicit default; nullable | 12 | KEEP — captured event/outcome fact |
| sessionId | String? | No explicit default; nullable | 12 | KEEP — relationship or historical/provider identity; see declared parents |
| severity | String | @default("INFO") // INFO\|WARNING\|CRITICAL | 0 | KEEP — captured event/outcome fact |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- AuditLog_pkey; validated=true
PRIMARY KEY (id)
-- AuditLog_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- AuditLog_userId_fkey; validated=true
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "AuditLog_pkey" ON public."AuditLog" USING btree (id);
CREATE INDEX "AuditLog_tenantId_category_idx" ON public."AuditLog" USING btree ("tenantId", category);
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON public."AuditLog" USING btree ("tenantId", "createdAt");
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON public."AuditLog" USING btree ("tenantId", "entityType", "entityId");
CREATE INDEX "AuditLog_tenantId_severity_idx" ON public."AuditLog" USING btree ("tenantId", severity);
CREATE INDEX "AuditLog_tenantId_userId_idx" ON public."AuditLog" USING btree ("tenantId", "userId");
```

</details>

### AutomationRule

Old automation definition mechanism. Category I. Drop empty table in guarded migration 84; preserve Workflow and all execution history

- Initial audit rows: **0**; immediately before cleanup: **0**; after cleanup: **0**; final live rows: **unavailable**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=NULL; updatedAt=NULL
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "AutomationRule_pkey" ON public."AutomationRule" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 30 in 13 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: None in supported routes. Historical DTO words are not storage dependencies.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: No current route/worker/frontend consumer; Workflow owns supported automation. Final action: **DROP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | table dropped | DROP — retired table |
| tenantId | String | No explicit default; required | table dropped | DROP — retired table |
| name | String | No explicit default; required | table dropped | DROP — retired table |
| description | String? | No explicit default; nullable | table dropped | DROP — retired table |
| triggerType | String | // e.g. "contact.created", "deal.won", "no.reply.3days" | table dropped | DROP — retired table |
| conditions | Json? | No explicit default; nullable | table dropped | DROP — retired table |
| actions | Json | // what to do (e.g., schedule campaign) | table dropped | DROP — retired table |
| isActive | Boolean | @default(true) | table dropped | DROP — retired table |
| createdAt | DateTime | @default(now()) | table dropped | DROP — retired table |
| updatedAt | DateTime | @updatedAt | table dropped | DROP — retired table |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- AutomationRule_pkey; validated=true
PRIMARY KEY (id)
-- AutomationRule_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "AutomationRule_pkey" ON public."AutomationRule" USING btree (id);
CREATE INDEX "AutomationRule_tenantId_idx" ON public."AutomationRule" USING btree ("tenantId");
CREATE INDEX "AutomationRule_tenantId_isActive_idx" ON public."AutomationRule" USING btree ("tenantId", "isActive");
CREATE INDEX "AutomationRule_tenantId_triggerType_idx" ON public."AutomationRule" USING btree ("tenantId", "triggerType");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql


```

</details>

### Campaign

Outbound campaign definition and cached totals. Category A. Keep cache; preserve Report API and send reservations; scheduler starts at boot and pauses email sends; SMS dry-run path needs separate review

- Initial audit rows: **9**; immediately before cleanup: **9**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): scheduledFor=NULL; sentAt=2026-10-02T02:10:36.963Z; createdAt=2026-10-02T02:10:35.528Z; updatedAt=2026-10-02T02:10:57.256Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Campaign_pkey" ON public."Campaign" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); targetAudience: TargetAudience? (@relation(fields: [targetAudienceId], references: [id], onDelete: SetNull)); emailTemplate: Template? (@relation("CampaignEmailTemplate", fields: [emailTemplateId], references: [id], onDelete: SetNull)); smsTemplate: Template? (@relation("CampaignSmsTemplate", fields: [smsTemplateId], references: [id], onDelete: SetNull)).
- Children: CampaignMetrics.campaign; CampaignContact.campaign; EmailDeliveryLog.campaign.
- Direct runtime-source read sites: [backend/src/core/scheduler/campaign-scheduler.service.ts:86](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L86); [backend/src/modules/notifications/notification-events.service.ts:96](../../backend/src/modules/notifications/notification-events.service.ts#L96); [backend/src/modules/notifications/notification-events.service.ts:107](../../backend/src/modules/notifications/notification-events.service.ts#L107); [backend/src/modules/reporting/reports/reports.service.ts:85](../../backend/src/modules/reporting/reports/reports.service.ts#L85); [backend/src/modules/marketing/campaigns/campaigns.service.ts:68](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L68); [backend/src/modules/marketing/campaigns/campaigns.service.ts:70](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L70); [backend/src/modules/marketing/campaigns/campaigns.service.ts:71](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L71); [backend/src/modules/marketing/campaigns/campaigns.service.ts:76](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L76); [backend/src/modules/marketing/campaigns/campaigns.service.ts:114](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L114); [backend/src/modules/marketing/campaigns/campaigns.service.ts:115](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L115); [backend/src/modules/marketing/campaigns/campaigns.service.ts:127](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L127); [backend/src/modules/marketing/campaigns/campaigns.service.ts:130](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L130); [backend/src/modules/marketing/campaigns/campaigns.repository.ts:4](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L4); [backend/src/modules/automation/actions/actions.repository.ts:12](../../backend/src/modules/automation/actions/actions.repository.ts#L12); [backend/src/modules/administration/archived-data/archived-data.service.ts:60](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L60)
- Direct runtime-source write sites: [backend/src/core/scheduler/campaign-scheduler.service.ts:118](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L118); [backend/src/core/scheduler/campaign-scheduler.service.ts:148](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L148); [backend/src/core/scheduler/campaign-scheduler.service.ts:155](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L155); [backend/src/core/scheduler/campaign-scheduler.service.ts:171](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L171); [backend/src/core/scheduler/campaign-scheduler.service.ts:217](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L217); [backend/src/modules/marketing/campaigns/campaigns.service.ts:98](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L98); [backend/src/modules/marketing/campaigns/campaigns.service.ts:106](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L106); [backend/src/modules/marketing/campaigns/campaigns.service.ts:125](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L125); [backend/src/modules/marketing/campaigns/campaigns.service.ts:150](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L150); [backend/src/modules/marketing/campaigns/campaigns.service.ts:180](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L180); [backend/src/modules/marketing/campaigns/campaigns.service.ts:189](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L189); [backend/src/modules/marketing/campaigns/campaigns.service.ts:198](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L198); [backend/src/modules/marketing/campaigns/campaigns.service.ts:223](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L223); [backend/src/modules/marketing/campaigns/campaigns.service.ts:232](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L232); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:35](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L35); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:69](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L69); [backend/src/modules/administration/archived-data/archived-data.service.ts:119](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L119)
- Possible nested relation access (review with parent): [backend/src/core/scheduler/campaign-scheduler.service.ts:144](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L144) `campaign`; [backend/src/core/scheduler/campaign-scheduler.service.ts:59](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L59) `campaigns`; [backend/src/modules/crm/merge/merge.repository.ts:109](../../backend/src/modules/crm/merge/merge.repository.ts#L109) `campaigns`; [backend/src/modules/marketing/campaigns/campaigns.service.ts:85](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L85) `campaign`; [backend/src/modules/automation/workflows/workflows.repository.ts:21](../../backend/src/modules/automation/workflows/workflows.repository.ts#L21) `campaigns`
- Search matches across repository: 1170 in 175 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/core/scheduler/campaign-scheduler.service.ts:86](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L86); [backend/src/modules/notifications/notification-events.service.ts:96](../../backend/src/modules/notifications/notification-events.service.ts#L96); [backend/src/modules/notifications/notification-events.service.ts:107](../../backend/src/modules/notifications/notification-events.service.ts#L107); [backend/src/modules/marketing/campaigns/campaigns.service.ts:68](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L68); [backend/src/modules/marketing/campaigns/campaigns.service.ts:70](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L70); [backend/src/modules/marketing/campaigns/campaigns.service.ts:71](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L71); [backend/src/modules/marketing/campaigns/campaigns.service.ts:76](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L76); [backend/src/modules/marketing/campaigns/campaigns.service.ts:114](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L114); [backend/src/modules/marketing/campaigns/campaigns.service.ts:115](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L115); [backend/src/modules/marketing/campaigns/campaigns.service.ts:127](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L127); [backend/src/modules/marketing/campaigns/campaigns.service.ts:130](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L130); [backend/src/modules/marketing/campaigns/campaigns.repository.ts:4](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L4); [backend/src/core/scheduler/campaign-scheduler.service.ts:118](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L118); [backend/src/core/scheduler/campaign-scheduler.service.ts:148](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L148); [backend/src/core/scheduler/campaign-scheduler.service.ts:155](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L155); [backend/src/core/scheduler/campaign-scheduler.service.ts:171](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L171); [backend/src/core/scheduler/campaign-scheduler.service.ts:217](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L217); [backend/src/modules/marketing/campaigns/campaigns.service.ts:98](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L98); [backend/src/modules/marketing/campaigns/campaigns.service.ts:106](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L106); [backend/src/modules/marketing/campaigns/campaigns.service.ts:125](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L125); [backend/src/modules/marketing/campaigns/campaigns.service.ts:150](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L150); [backend/src/modules/marketing/campaigns/campaigns.service.ts:180](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L180); [backend/src/modules/marketing/campaigns/campaigns.service.ts:189](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L189); [backend/src/modules/marketing/campaigns/campaigns.service.ts:198](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L198); [backend/src/modules/marketing/campaigns/campaigns.service.ts:223](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L223); [backend/src/modules/marketing/campaigns/campaigns.service.ts:232](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L232); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:35](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L35); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:69](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L69)
- Normalization assessment: Mutable totals derive from recipient state; concurrent updates serialized in send/webhook flow. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| audienceSource | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdById | String? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| recipientCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| failedCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| targetAudienceId | String? | // FK to TargetAudience G�� replaces old targetAudience String? | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| emailTemplateId | String? | // optional FK to Template (type=Email) | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| smsTemplateId | String? | // optional FK to Template (type=SMS) | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| type | CampaignType | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| status | CampaignStatus | @default(DRAFT) | 0 | KEEP — attribute owned by this row; not a separate entity |
| subject | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| body | String? | // inline body override when no template selected | 0 | KEEP — attribute owned by this row; not a separate entity |
| sentCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| openedCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| clickedCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| engagement | Float | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| scheduledFor | DateTime? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| sentAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Campaign_emailTemplateId_fkey; validated=true
FOREIGN KEY ("emailTemplateId") REFERENCES "Template"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Campaign_pkey; validated=true
PRIMARY KEY (id)
-- Campaign_smsTemplateId_fkey; validated=true
FOREIGN KEY ("smsTemplateId") REFERENCES "Template"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Campaign_targetAudienceId_fkey; validated=true
FOREIGN KEY ("targetAudienceId") REFERENCES "TargetAudience"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Campaign_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Campaign_pkey" ON public."Campaign" USING btree (id);
CREATE INDEX "Campaign_tenantId_idx" ON public."Campaign" USING btree ("tenantId");
CREATE INDEX "Campaign_tenantId_isArchived_idx" ON public."Campaign" USING btree ("tenantId", "isArchived");
CREATE INDEX "Campaign_tenantId_status_idx" ON public."Campaign" USING btree ("tenantId", status);
```

</details>

### CampaignContact

Recipient identity, send state and captured personalization. Category C. Keep separate from provider log; recipient/provider identity retained

- Initial audit rows: **22**; immediately before cleanup: **22**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): sentAt=2026-10-02T02:10:36.910Z; deliveredAt=2026-10-02T02:10:38.000Z; openedAt=2026-10-02T02:10:51.000Z; clickedAt=2026-09-25T03:34:19.000Z; bouncedAt=2026-10-02T02:06:32.000Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "CampaignContact_campaignId_contactId_key" ON public."CampaignContact" USING btree ("campaignId", "contactId")`; `CREATE UNIQUE INDEX "CampaignContact_campaignId_leadId_key" ON public."CampaignContact" USING btree ("campaignId", "leadId") WHERE ("leadId" IS NOT NULL)`; `CREATE UNIQUE INDEX "CampaignContact_messageId_key" ON public."CampaignContact" USING btree ("messageId")`; `CREATE UNIQUE INDEX "CampaignContact_pkey" ON public."CampaignContact" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); campaign: Campaign (@relation(fields: [campaignId], references: [id], onDelete: Cascade)); lead: Lead? (@relation(fields: [leadId], references: [id], onDelete: SetNull)); contact: Contact? (@relation(fields: [contactId], references: [id], onDelete: SetNull)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/merge/merge.repository.ts:14](../../backend/src/modules/crm/merge/merge.repository.ts#L14); [backend/src/modules/crm/merge/merge.repository.ts:27](../../backend/src/modules/crm/merge/merge.repository.ts#L27); [backend/src/modules/marketing/campaigns/campaigns.service.ts:80](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L80); [backend/src/modules/marketing/campaigns/campaigns.service.ts:81](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L81); [backend/src/modules/marketing/campaigns/campaigns.service.ts:192](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L192); [backend/src/modules/marketing/campaigns/campaigns.service.ts:193](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L193); [backend/src/modules/marketing/campaigns/campaigns.service.ts:194](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L194); [backend/src/modules/marketing/campaigns/campaigns.service.ts:195](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L195); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:63](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L63); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:64](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L64); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:65](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L65); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:66](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L66); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:67](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L67); [backend/src/modules/marketing/campaigns/audiences.service.ts:75](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L75)
- Direct runtime-source write sites: [backend/src/modules/crm/merge/merge.repository.ts:93](../../backend/src/modules/crm/merge/merge.repository.ts#L93); [backend/src/modules/crm/merge/merge.repository.ts:157](../../backend/src/modules/crm/merge/merge.repository.ts#L157); [backend/src/modules/marketing/campaigns/campaigns.service.ts:145](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L145); [backend/src/modules/marketing/campaigns/campaigns.service.ts:171](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L171); [backend/src/modules/marketing/campaigns/campaigns.service.ts:181](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L181); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:50](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L50)
- Possible nested relation access (review with parent): [backend/src/modules/marketing/campaigns/campaigns.repository.ts:8](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L8) `campaignContacts`
- Search matches across repository: 135 in 37 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/marketing/campaigns/campaigns.service.ts:80](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L80); [backend/src/modules/marketing/campaigns/campaigns.service.ts:81](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L81); [backend/src/modules/marketing/campaigns/campaigns.service.ts:192](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L192); [backend/src/modules/marketing/campaigns/campaigns.service.ts:193](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L193); [backend/src/modules/marketing/campaigns/campaigns.service.ts:194](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L194); [backend/src/modules/marketing/campaigns/campaigns.service.ts:195](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L195); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:63](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L63); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:64](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L64); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:65](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L65); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:66](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L66); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:67](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L67); [backend/src/modules/marketing/campaigns/audiences.service.ts:75](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L75); [backend/src/modules/marketing/campaigns/campaigns.service.ts:145](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L145); [backend/src/modules/marketing/campaigns/campaigns.service.ts:171](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L171); [backend/src/modules/marketing/campaigns/campaigns.service.ts:181](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L181); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:50](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L50)
- Normalization assessment: Email/personalization preserve send-time facts; nullable lead/contact supports deletion. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| email | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| personalization | Json? | No explicit default; nullable | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| messageId | String? | @unique | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| failureReason | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| campaignId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| leadId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| contactId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| status | String | @default("pending") // pending\|sent\|delivered\|opened\|clicked\|bounced\|unsubscribed | 0 | KEEP — captured event/outcome fact |
| sentAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| deliveredAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| openedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| clickedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| bouncedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| unsubscribed | Boolean | @default(false) | 0 | KEEP — captured event/outcome fact |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- CampaignContact_campaignId_fkey; validated=true
FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- CampaignContact_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- CampaignContact_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- CampaignContact_pkey; validated=true
PRIMARY KEY (id)
-- CampaignContact_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "CampaignContact_campaignId_contactId_key" ON public."CampaignContact" USING btree ("campaignId", "contactId");
CREATE UNIQUE INDEX "CampaignContact_campaignId_leadId_key" ON public."CampaignContact" USING btree ("campaignId", "leadId") WHERE ("leadId" IS NOT NULL);
CREATE INDEX "CampaignContact_campaignId_tenantId_status_idx" ON public."CampaignContact" USING btree ("campaignId", "tenantId", status);
CREATE UNIQUE INDEX "CampaignContact_messageId_key" ON public."CampaignContact" USING btree ("messageId");
CREATE UNIQUE INDEX "CampaignContact_pkey" ON public."CampaignContact" USING btree (id);
CREATE INDEX "CampaignContact_tenantId_idx" ON public."CampaignContact" USING btree ("tenantId");
```

</details>

### CampaignEmailQuota

Account-wide provider daily send reservation. Category H. Keep daily key and atomic increments; do not derive from successful sends

- Initial audit rows: **4**; immediately before cleanup: **4**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY (day).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "CampaignEmailQuota_pkey" ON public."CampaignEmailQuota" USING btree (day)`.
- Parent relations: No declared Prisma parent relation.
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/marketing/campaigns/campaigns.service.ts:140](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L140); [backend/src/modules/marketing/campaigns/campaigns.service.ts:141](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L141)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 9 in 8 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/marketing/campaigns/campaigns.service.ts:140](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L140); [backend/src/modules/marketing/campaigns/campaigns.service.ts:141](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L141)
- Normalization assessment: Reservation is authoritative concurrency control, not report count. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| day | String | @id | 0 | KEEP — row identity |
| reserved | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- CampaignEmailQuota_pkey; validated=true
PRIMARY KEY (day)
CREATE UNIQUE INDEX "CampaignEmailQuota_pkey" ON public."CampaignEmailQuota" USING btree (day);
```

</details>

### CampaignMetrics

Append-only campaign reporting snapshots. Category H. Keep snapshots; never merge into current totals

- Initial audit rows: **38**; immediately before cleanup: **38**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): snapshotAt=2026-10-02T02:10:57.261Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "CampaignMetrics_pkey" ON public."CampaignMetrics" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); campaign: Campaign (@relation(fields: [campaignId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/marketing/campaigns/campaigns.service.ts:199](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L199); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:70](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L70)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 36 in 17 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/marketing/campaigns/campaigns.service.ts:199](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L199); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:70](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L70)
- Normalization assessment: Shares counter names with Campaign but snapshotAt gives different meaning. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| campaignId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| sentCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| deliveredCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| openedCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| clickedCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| respondedCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| bouncedCount | Int | @default(0) | 0 | KEEP — operational counter or historical metric; see table purpose |
| openRate | Float | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| clickRate | Float | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| deliveryRate | Float | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| responseRate | Float | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| bounceRate | Float | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| snapshotAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- CampaignMetrics_campaignId_fkey; validated=true
FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- CampaignMetrics_pkey; validated=true
PRIMARY KEY (id)
-- CampaignMetrics_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "CampaignMetrics_campaignId_tenantId_idx" ON public."CampaignMetrics" USING btree ("campaignId", "tenantId");
CREATE UNIQUE INDEX "CampaignMetrics_pkey" ON public."CampaignMetrics" USING btree (id);
CREATE INDEX "CampaignMetrics_tenantId_idx" ON public."CampaignMetrics" USING btree ("tenantId");
CREATE INDEX "CampaignMetrics_tenantId_snapshotAt_idx" ON public."CampaignMetrics" USING btree ("tenantId", "snapshotAt");
```

</details>

### ClosingFieldDefinition

Tenant-defined closing field configuration. Category F. Keep composite tenant/id identity and JSON; align Prisma with existing updatedAt default

- Initial audit rows: **5**; immediately before cleanup: **5**; after cleanup: **0**; final live rows: **5**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-02T08:17:10.422Z; updatedAt=2026-10-02T08:17:10.517Z
- Primary key: PRIMARY KEY ("tenantId", id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "ClosingFieldDefinition_pkey" ON public."ClosingFieldDefinition" USING btree ("tenantId", id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts:8](../../backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts#L8); [backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts:12](../../backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts#L12)
- Direct runtime-source write sites: [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:31](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L31); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:32](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L32); [backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts:11](../../backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts#L11)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 21 in 13 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: JSON definition is flexible schema; updatedAt SQL default missing in Prisma. Final action: **NORMALIZE**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| id | String | No explicit default; required | 0 | KEEP — row identity |
| definition | Json | No explicit default; required | 0 | KEEP: Flexible preference or field definition; no independent record identity demonstrated. |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @default(now()) @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- ClosingFieldDefinition_pkey; validated=true
PRIMARY KEY ("tenantId", id)
-- ClosingFieldDefinition_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "ClosingFieldDefinition_pkey" ON public."ClosingFieldDefinition" USING btree ("tenantId", id);
```

</details>

### Contact

Known customer person and lifecycle. Category A. Keep lifecycle and status; retain conversion trace and account relationship

- Initial audit rows: **10**; immediately before cleanup: **10**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): lastContactedAt=NULL; convertedAt=2026-10-02T02:56:31.437Z; deletedAt=NULL; createdAt=2026-10-04T07:19:31.657Z; updatedAt=2026-10-04T07:22:05.275Z; customerSince=2026-10-02T02:56:31.437Z; qualifiedAt=NULL; lastStatusChangedAt=2026-10-02T02:56:31.390Z; lastMeaningfulInboundAt=NULL; firstUnansweredOutboundAt=NULL; engagementEvaluatedAt=NULL
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Contact_id_tenantId_key" ON public."Contact" USING btree (id, "tenantId")`; `CREATE UNIQUE INDEX "Contact_pkey" ON public."Contact" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); account: Account? (@relation(fields: [accountId], references: [id])); assignedUser: User? (@relation("AssignedContacts", fields: [assignedUserId], references: [id])); owner: User? (@relation("OwnedContacts", fields: [ownerId], references: [id])).
- Children: Lead.convertedContact; ContactDeal.contact; Activity.contact; FormSubmission.contact; CampaignContact.contact; EmailDeliveryLog.contact; TaskContact.contact; RecordFile.contact; ContactProductInterest.contact.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:18](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L18); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:19](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L19); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:81](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L81); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:123](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L123); [backend/src/core/scheduler/campaign-scheduler.service.ts:232](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L232); [backend/src/core/scheduler/campaign-scheduler.service.ts:249](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L249); [backend/src/modules/notifications/notification-events.service.ts:44](../../backend/src/modules/notifications/notification-events.service.ts#L44); [backend/src/modules/notifications/notification-events.service.ts:58](../../backend/src/modules/notifications/notification-events.service.ts#L58); [backend/src/modules/notifications/notification-events.service.ts:77](../../backend/src/modules/notifications/notification-events.service.ts#L77); [backend/src/modules/crm/relationships/relationships.service.ts:22](../../backend/src/modules/crm/relationships/relationships.service.ts#L22); [backend/src/modules/crm/relationships/relationships.service.ts:74](../../backend/src/modules/crm/relationships/relationships.service.ts#L74); [backend/src/modules/crm/relationships/relationships.service.ts:154](../../backend/src/modules/crm/relationships/relationships.service.ts#L154); [backend/src/modules/operations/tasks/tasks.repository.ts:72](../../backend/src/modules/operations/tasks/tasks.repository.ts#L72); [backend/src/modules/operations/tasks/tasks.repository.ts:213](../../backend/src/modules/operations/tasks/tasks.repository.ts#L213); [backend/src/modules/operations/tasks/tasks.repository.ts:309](../../backend/src/modules/operations/tasks/tasks.repository.ts#L309); [backend/src/modules/operations/tasks/tasks.repository.ts:424](../../backend/src/modules/operations/tasks/tasks.repository.ts#L424); [backend/src/modules/crm/record-files/record-files.service.ts:21](../../backend/src/modules/crm/record-files/record-files.service.ts#L21); [backend/src/modules/marketing/forms/public-forms.service.ts:63](../../backend/src/modules/marketing/forms/public-forms.service.ts#L63); [backend/src/modules/marketing/forms/public-forms.service.ts:73](../../backend/src/modules/marketing/forms/public-forms.service.ts#L73); [backend/src/modules/marketing/forms/public-forms.service.ts:124](../../backend/src/modules/marketing/forms/public-forms.service.ts#L124); [backend/src/modules/crm/merge/merge.service.ts:163](../../backend/src/modules/crm/merge/merge.service.ts#L163); [backend/src/modules/crm/merge/merge.service.ts:164](../../backend/src/modules/crm/merge/merge.service.ts#L164); [backend/src/modules/crm/merge/merge.service.ts:190](../../backend/src/modules/crm/merge/merge.service.ts#L190); [backend/src/modules/crm/merge/merge.service.ts:191](../../backend/src/modules/crm/merge/merge.service.ts#L191); [backend/src/modules/crm/merge/merge.repository.ts:41](../../backend/src/modules/crm/merge/merge.repository.ts#L41); [backend/src/modules/crm/leads/lead-conversion.service.ts:14](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L14); [backend/src/modules/crm/leads/lead-conversion.service.ts:18](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L18); [backend/src/modules/marketing/campaigns/audiences.service.ts:71](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L71); [backend/src/modules/marketing/campaigns/audiences.service.ts:74](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L74); [backend/src/modules/crm/imports/import-rows.service.ts:51](../../backend/src/modules/crm/imports/import-rows.service.ts#L51); [backend/src/modules/crm/imports/import-rows.service.ts:158](../../backend/src/modules/crm/imports/import-rows.service.ts#L158); [backend/src/modules/crm/imports/import-rows.service.ts:171](../../backend/src/modules/crm/imports/import-rows.service.ts#L171); [backend/src/modules/crm/engagement.service.ts:16](../../backend/src/modules/crm/engagement.service.ts#L16); [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:158](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L158); [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:181](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L181); [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:206](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L206); [backend/src/modules/crm/deals/deals.repository.ts:374](../../backend/src/modules/crm/deals/deals.repository.ts#L374); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:68](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L68); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:70](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L70); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:77](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L77); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:84](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L84); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:101](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L101); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:105](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L105); [backend/src/modules/crm/contacts/contacts.service.ts:134](../../backend/src/modules/crm/contacts/contacts.service.ts#L134); [backend/src/modules/automation/workflows/workflows.repository.ts:17](../../backend/src/modules/automation/workflows/workflows.repository.ts#L17); [backend/src/modules/automation/workflows/workflows.repository.ts:121](../../backend/src/modules/automation/workflows/workflows.repository.ts#L121); [backend/src/modules/automation/actions/action-sms.ts:17](../../backend/src/modules/automation/actions/action-sms.ts#L17); [backend/src/modules/automation/actions/action-sms.ts:21](../../backend/src/modules/automation/actions/action-sms.ts#L21); [backend/src/modules/automation/actions/action-fields.ts:54](../../backend/src/modules/automation/actions/action-fields.ts#L54); [backend/src/modules/administration/archived-data/archived-data.service.ts:53](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L53)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:85](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L85); [backend/src/modules/marketing/forms/public-forms.service.ts:125](../../backend/src/modules/marketing/forms/public-forms.service.ts#L125); [backend/src/modules/crm/merge/merge.service.ts:203](../../backend/src/modules/crm/merge/merge.service.ts#L203); [backend/src/modules/crm/merge/merge.service.ts:208](../../backend/src/modules/crm/merge/merge.service.ts#L208); [backend/src/modules/crm/merge/merge.repository.ts:196](../../backend/src/modules/crm/merge/merge.repository.ts#L196); [backend/src/modules/crm/leads/lead-conversion.service.ts:47](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L47); [backend/src/modules/crm/leads/lead-conversion.service.ts:52](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L52); [backend/src/modules/crm/leads/lead-conversion.service.ts:58](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L58); [backend/src/modules/crm/imports/import-rows.service.ts:135](../../backend/src/modules/crm/imports/import-rows.service.ts#L135); [backend/src/modules/crm/imports/import-rows.service.ts:159](../../backend/src/modules/crm/imports/import-rows.service.ts#L159); [backend/src/modules/crm/engagement.service.ts:23](../../backend/src/modules/crm/engagement.service.ts#L23); [backend/src/modules/crm/deals/won-conversion.service.ts:31](../../backend/src/modules/crm/deals/won-conversion.service.ts#L31); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:94](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L94); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:109](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L109); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:127](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L127); [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:134](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L134)
- Possible nested relation access (review with parent): [backend/src/core/scheduler/campaign-scheduler.service.ts:267](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L267) `contacts`; [backend/src/modules/notifications/notification-events.service.ts:45](../../backend/src/modules/notifications/notification-events.service.ts#L45) `contact`; [backend/src/modules/crm/relationships/relationships.service.ts:210](../../backend/src/modules/crm/relationships/relationships.service.ts#L210) `contact`; [backend/src/modules/crm/relationships/relationships.service.ts:234](../../backend/src/modules/crm/relationships/relationships.service.ts#L234) `contacts`; [backend/src/modules/operations/tasks/tasks.service.ts:134](../../backend/src/modules/operations/tasks/tasks.service.ts#L134) `contact`; [backend/src/modules/operations/tasks/tasks.service.ts:115](../../backend/src/modules/operations/tasks/tasks.service.ts#L115) `contacts`; [backend/src/modules/operations/tasks/tasks.repository.ts:69](../../backend/src/modules/operations/tasks/tasks.repository.ts#L69) `convertedContact`; [backend/src/modules/operations/tasks/tasks.repository.ts:38](../../backend/src/modules/operations/tasks/tasks.repository.ts#L38) `contact`; [backend/src/modules/crm/record-files/record-files.service.ts:9](../../backend/src/modules/crm/record-files/record-files.service.ts#L9) `contacts`; [backend/src/modules/crm/merge/merge.repository.ts:218](../../backend/src/modules/crm/merge/merge.repository.ts#L218) `contacts`; [backend/src/modules/marketing/campaigns/campaigns.repository.ts:10](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L10) `contact`; [backend/src/modules/marketing/campaigns/audiences.service.ts:75](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L75) `contact`; [backend/src/modules/crm/imports/imports.service.ts:103](../../backend/src/modules/crm/imports/imports.service.ts#L103) `contacts`; [backend/src/modules/crm/imports/import-rows.service.ts:188](../../backend/src/modules/crm/imports/import-rows.service.ts#L188) `contacts`; [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:283](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L283) `contact`; [backend/src/modules/crm/deals/won-conversion.service.ts:21](../../backend/src/modules/crm/deals/won-conversion.service.ts#L21) `contact`; [backend/src/modules/crm/deals/deals.service.ts:269](../../backend/src/modules/crm/deals/deals.service.ts#L269) `contact`; [backend/src/modules/crm/deals/deals.repository.ts:60](../../backend/src/modules/crm/deals/deals.repository.ts#L60) `contact`; [backend/src/modules/crm/contacts/contacts.service.ts:149](../../backend/src/modules/crm/contacts/contacts.service.ts#L149) `contact`; [backend/src/modules/automation/workflows/workflows.service.ts:38](../../backend/src/modules/automation/workflows/workflows.service.ts#L38) `contacts`; [backend/src/modules/automation/workflows/workflows.repository.ts:10](../../backend/src/modules/automation/workflows/workflows.repository.ts#L10) `contacts`; [backend/src/modules/automation/triggers/triggers.service.ts:3](../../backend/src/modules/automation/triggers/triggers.service.ts#L3) `contact`; [backend/src/modules/administration/product-interests/product-interests.repository.ts:13](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L13) `contact`
- Search matches across repository: 2782 in 411 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:18](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L18); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:19](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L19); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:81](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L81); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:123](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L123); [backend/src/core/scheduler/campaign-scheduler.service.ts:232](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L232); [backend/src/core/scheduler/campaign-scheduler.service.ts:249](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L249); [backend/src/modules/notifications/notification-events.service.ts:44](../../backend/src/modules/notifications/notification-events.service.ts#L44); [backend/src/modules/notifications/notification-events.service.ts:58](../../backend/src/modules/notifications/notification-events.service.ts#L58); [backend/src/modules/notifications/notification-events.service.ts:77](../../backend/src/modules/notifications/notification-events.service.ts#L77); [backend/src/modules/marketing/campaigns/audiences.service.ts:71](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L71); [backend/src/modules/marketing/campaigns/audiences.service.ts:74](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L74); [backend/src/modules/automation/workflows/workflows.repository.ts:17](../../backend/src/modules/automation/workflows/workflows.repository.ts#L17); [backend/src/modules/automation/workflows/workflows.repository.ts:121](../../backend/src/modules/automation/workflows/workflows.repository.ts#L121); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:85](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L85)
- Normalization assessment: owner and assignee have distinct provenance; company is free-text fallback; lifecycle differs from human status. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| productsNormalized | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterestOther | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| accountId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| assignedUserId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| ownerId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| firstName | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| lastName | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| email | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| phone | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| company | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| jobTitle | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| linkedinUrl | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| status | ContactStatus | @default(WARM) | 0 | KEEP — attribute owned by this row; not a separate entity |
| score | Int | @default(75) | 0 | KEEP — attribute owned by this row; not a separate entity |
| source | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| notes | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| lastContactedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| lastStatusChangedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| lastMeaningfulInboundAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| firstUnansweredOutboundAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| engagementEvaluatedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| convertedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| doNotContact | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| archiveReason | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| deletedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| deletedBy | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |
| activeProducts | String[] | No explicit default; required | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| address | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| customerSince | DateTime? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| customerType | String | @default("Prospect") | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterests | String[] | No explicit default; required | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| lifecycleStage | ContactLifecycleStage | @default(LEAD) | 0 | KEEP — attribute owned by this row; not a separate entity |
| recordType | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| qualifiedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| disqualifiedReason | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Contact_accountId_fkey; validated=true
FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Contact_assignedUserId_fkey; validated=true
FOREIGN KEY ("assignedUserId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Contact_ownerId_fkey; validated=true
FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Contact_pkey; validated=true
PRIMARY KEY (id)
-- Contact_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Contact_id_tenantId_key" ON public."Contact" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Contact_pkey" ON public."Contact" USING btree (id);
CREATE INDEX "Contact_tenantId_accountId_idx" ON public."Contact" USING btree ("tenantId", "accountId");
CREATE INDEX "Contact_tenantId_assignedUserId_idx" ON public."Contact" USING btree ("tenantId", "assignedUserId");
CREATE INDEX "Contact_tenantId_createdAt_idx" ON public."Contact" USING btree ("tenantId", "createdAt");
CREATE INDEX "Contact_tenantId_email_idx" ON public."Contact" USING btree ("tenantId", email);
CREATE INDEX "Contact_tenantId_idx" ON public."Contact" USING btree ("tenantId");
CREATE INDEX "Contact_tenantId_isArchived_idx" ON public."Contact" USING btree ("tenantId", "isArchived");
CREATE INDEX "Contact_tenantId_lifecycleStage_idx" ON public."Contact" USING btree ("tenantId", "lifecycleStage");
CREATE INDEX "Contact_tenantId_status_idx" ON public."Contact" USING btree ("tenantId", status);
```

</details>

### ContactDeal

Many-to-many opportunity contact participation. Category B. Composite endpoint FKs; keep addedBy, role and addedAt provenance

- Initial audit rows: **6**; immediately before cleanup: **6**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): addedAt=2026-10-04T07:22:05.201Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "ContactDeal_contactId_dealId_key" ON public."ContactDeal" USING btree ("contactId", "dealId")`; `CREATE UNIQUE INDEX "ContactDeal_pkey" ON public."ContactDeal" USING btree (id)`.
- Parent relations: contact: Contact (@relation(fields: [contactId, tenantId], references: [id, tenantId], onDelete: Cascade)); deal: Deal (@relation(fields: [dealId, tenantId], references: [id, tenantId], onDelete: Cascade)); tenant: Tenant (@relation(fields: [tenantId], references: [id])); addedBy: User? (@relation(fields: [addedById], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/relationships/relationships.service.ts:97](../../backend/src/modules/crm/relationships/relationships.service.ts#L97); [backend/src/modules/crm/relationships/relationships.service.ts:206](../../backend/src/modules/crm/relationships/relationships.service.ts#L206); [backend/src/modules/marketing/forms/public-forms.service.ts:93](../../backend/src/modules/marketing/forms/public-forms.service.ts#L93); [backend/src/modules/crm/merge/merge.repository.ts:26](../../backend/src/modules/crm/merge/merge.repository.ts#L26); [backend/src/modules/crm/merge/merge.repository.ts:132](../../backend/src/modules/crm/merge/merge.repository.ts#L132); [backend/src/modules/crm/merge/merge.repository.ts:138](../../backend/src/modules/crm/merge/merge.repository.ts#L138); [backend/src/modules/crm/deals/won-conversion.service.ts:21](../../backend/src/modules/crm/deals/won-conversion.service.ts#L21); [backend/src/modules/crm/deals/deals.service.ts:311](../../backend/src/modules/crm/deals/deals.service.ts#L311); [backend/src/modules/crm/deals/deals.repository.ts:250](../../backend/src/modules/crm/deals/deals.repository.ts#L250); [backend/src/modules/crm/deals/deals.repository.ts:355](../../backend/src/modules/crm/deals/deals.repository.ts#L355)
- Direct runtime-source write sites: [backend/src/modules/marketing/forms/public-forms.service.ts:136](../../backend/src/modules/marketing/forms/public-forms.service.ts#L136); [backend/src/modules/crm/merge/merge.repository.ts:146](../../backend/src/modules/crm/merge/merge.repository.ts#L146); [backend/src/modules/crm/merge/merge.repository.ts:148](../../backend/src/modules/crm/merge/merge.repository.ts#L148); [backend/src/modules/crm/leads/lead-conversion.service.ts:60](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L60); [backend/src/modules/crm/deals/deals.service.ts:313](../../backend/src/modules/crm/deals/deals.service.ts#L313); [backend/src/modules/crm/deals/deals.repository.ts:124](../../backend/src/modules/crm/deals/deals.repository.ts#L124); [backend/src/modules/crm/deals/deals.repository.ts:365](../../backend/src/modules/crm/deals/deals.repository.ts#L365); [backend/src/modules/crm/deals/deals.repository.ts:385](../../backend/src/modules/crm/deals/deals.repository.ts#L385); [backend/src/modules/crm/deals/deals.repository.ts:391](../../backend/src/modules/crm/deals/deals.repository.ts#L391)
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:76](../../backend/src/modules/operations/tasks/tasks.repository.ts#L76) `contactDeals`; [backend/src/modules/crm/engagement.service.ts:12](../../backend/src/modules/crm/engagement.service.ts#L12) `contactDeals`; [backend/src/modules/crm/deals/deals.service.ts:268](../../backend/src/modules/crm/deals/deals.service.ts#L268) `contactDeals`; [backend/src/modules/crm/deals/deals.repository.ts:30](../../backend/src/modules/crm/deals/deals.repository.ts#L30) `contactDeals`; [backend/src/modules/automation/workflows/workflows.repository.ts:125](../../backend/src/modules/automation/workflows/workflows.repository.ts#L125) `contactDeals`; [backend/src/modules/administration/product-interests/product-interests.repository.ts:13](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L13) `contactDeals`
- Search matches across repository: 181 in 61 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Missing tenant equality between both endpoints. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| contactId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| dealId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| role | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| addedById | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| addedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- ContactDeal_addedById_fkey; validated=true
FOREIGN KEY ("addedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- ContactDeal_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- ContactDeal_dealId_fkey; validated=true
FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- ContactDeal_pkey; validated=true
PRIMARY KEY (id)
-- ContactDeal_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "ContactDeal_contactId_dealId_key" ON public."ContactDeal" USING btree ("contactId", "dealId");
CREATE INDEX "ContactDeal_contactId_tenantId_idx" ON public."ContactDeal" USING btree ("contactId", "tenantId");
CREATE INDEX "ContactDeal_dealId_tenantId_idx" ON public."ContactDeal" USING btree ("dealId", "tenantId");
CREATE UNIQUE INDEX "ContactDeal_pkey" ON public."ContactDeal" USING btree (id);
CREATE INDEX "ContactDeal_tenantId_idx" ON public."ContactDeal" USING btree ("tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- ContactDeal_addedById_fkey; validated=true
FOREIGN KEY ("addedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- ContactDeal_contactId_tenantId_fkey; validated=true
FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- ContactDeal_dealId_tenantId_fkey; validated=true
FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- ContactDeal_pkey; validated=true
PRIMARY KEY (id)
-- ContactDeal_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "ContactDeal_contactId_dealId_key" ON public."ContactDeal" USING btree ("contactId", "dealId");
CREATE INDEX "ContactDeal_contactId_tenantId_idx" ON public."ContactDeal" USING btree ("contactId", "tenantId");
CREATE INDEX "ContactDeal_dealId_tenantId_idx" ON public."ContactDeal" USING btree ("dealId", "tenantId");
CREATE UNIQUE INDEX "ContactDeal_pkey" ON public."ContactDeal" USING btree (id);
CREATE INDEX "ContactDeal_tenantId_idx" ON public."ContactDeal" USING btree ("tenantId");
```

</details>

### ContactProductInterest

Contact product interest and ownership flags. Category B. Keep existing normalized junction

- Initial audit rows: **5**; immediately before cleanup: **5**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("contactId", "productInterestId").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "ContactProductInterest_pkey" ON public."ContactProductInterest" USING btree ("contactId", "productInterestId")`.
- Parent relations: contact: Contact (@relation(fields: [contactId, tenantId], references: [id, tenantId], onDelete: Cascade)); product: ProductInterest (@relation(fields: [productInterestId, tenantId], references: [id, tenantId], onDelete: Restrict)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/leads/product-relations.ts:17](../../backend/src/modules/crm/leads/product-relations.ts#L17)
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:36](../../backend/src/modules/operations/tasks/tasks.repository.ts#L36) `contactLinks`; [backend/src/modules/marketing/campaigns/audiences.service.ts:45](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L45) `productLinks`
- Search matches across repository: 18 in 9 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Flags describe same pair, not duplicate products. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| contactId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| productInterestId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| interested | Boolean | @default(true) | 0 | KEEP — attribute owned by this row; not a separate entity |
| activeProduct | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- ContactProductInterest_contactId_tenantId_fkey; validated=true
FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- ContactProductInterest_pkey; validated=true
PRIMARY KEY ("contactId", "productInterestId")
-- ContactProductInterest_productInterestId_tenantId_fkey; validated=true
FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "ContactProductInterest_pkey" ON public."ContactProductInterest" USING btree ("contactId", "productInterestId");
CREATE INDEX "ContactProductInterest_tenantId_productInterestId_idx" ON public."ContactProductInterest" USING btree ("tenantId", "productInterestId");
```

</details>

### CrmImportChunk

Ordered upload content slice. Category G. Keep unique upload/chunkIndex and cascade source cleanup

- Initial audit rows: **0**; immediately before cleanup: **0**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "CrmImportChunk_pkey" ON public."CrmImportChunk" USING btree (id)`; `CREATE UNIQUE INDEX "CrmImportChunk_uploadId_chunkIndex_key" ON public."CrmImportChunk" USING btree ("uploadId", "chunkIndex")`.
- Parent relations: upload: CrmImportUpload (@relation(fields: [uploadId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/crm/imports/import-upload.service.ts:56](../../backend/src/modules/crm/imports/import-upload.service.ts#L56)
- Possible nested relation access (review with parent): [backend/src/modules/crm/imports/import-upload.service.ts:15](../../backend/src/modules/crm/imports/import-upload.service.ts#L15) `chunks`
- Search matches across repository: 19 in 12 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Parent owns module/scope/expiry; correct normalized dependency. Final action: **KEEP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| uploadId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| chunkIndex | Int | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| content | String | @db.Text | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- CrmImportChunk_chunkIndex_check; validated=true
CHECK ((("chunkIndex" >= 0) AND ("chunkIndex" <= 159)))
-- CrmImportChunk_pkey; validated=true
PRIMARY KEY (id)
-- CrmImportChunk_uploadId_fkey; validated=true
FOREIGN KEY ("uploadId") REFERENCES "CrmImportUpload"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "CrmImportChunk_pkey" ON public."CrmImportChunk" USING btree (id);
CREATE UNIQUE INDEX "CrmImportChunk_uploadId_chunkIndex_key" ON public."CrmImportChunk" USING btree ("uploadId", "chunkIndex");
```

</details>

### CrmImportJob

Shared module import job and accounting. Category C. Keep shared import architecture and idempotency identity

- Initial audit rows: **6**; immediately before cleanup: **6**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-04T07:22:05.096Z; completedAt=2026-10-04T07:22:05.314Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "CrmImportJob_pkey" ON public."CrmImportJob" USING btree (id)`; `CREATE UNIQUE INDEX "CrmImportJob_tenantId_module_idempotencyKey_key" ON public."CrmImportJob" USING btree ("tenantId", module, "idempotencyKey")`; `CREATE UNIQUE INDEX "CrmImportJob_uploadId_key" ON public."CrmImportJob" USING btree ("uploadId")`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id], onDelete: Restrict)); createdBy: User (@relation(fields: [createdById], references: [id], onDelete: Restrict)); upload: CrmImportUpload? (@relation(fields: [uploadId], references: [id], onDelete: SetNull)).
- Children: CrmImportRowResult.job.
- Direct runtime-source read sites: [backend/src/modules/crm/imports/imports.repository.ts:16](../../backend/src/modules/crm/imports/imports.repository.ts#L16); [backend/src/modules/crm/imports/imports.repository.ts:17](../../backend/src/modules/crm/imports/imports.repository.ts#L17); [backend/src/modules/crm/imports/imports.repository.ts:20](../../backend/src/modules/crm/imports/imports.repository.ts#L20); [backend/src/modules/crm/imports/imports.repository.ts:21](../../backend/src/modules/crm/imports/imports.repository.ts#L21)
- Direct runtime-source write sites: [backend/src/modules/crm/imports/imports.repository.ts:18](../../backend/src/modules/crm/imports/imports.repository.ts#L18); [backend/src/modules/crm/imports/imports.repository.ts:19](../../backend/src/modules/crm/imports/imports.repository.ts#L19); [backend/src/modules/crm/imports/imports.repository.ts:26](../../backend/src/modules/crm/imports/imports.repository.ts#L26)
- Possible nested relation access (review with parent): [backend/src/modules/crm/imports/imports.repository.ts:14](../../backend/src/modules/crm/imports/imports.repository.ts#L14) `job`; [backend/src/modules/crm/imports/import-upload.service.ts:15](../../backend/src/modules/crm/imports/import-upload.service.ts#L15) `job`
- Search matches across repository: 65 in 21 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Counters are transactionally finalized from row outcomes; upload reference may expire. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| module | CrmImportModule | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| fileName | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| totalRecords | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| successfulRecords | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| failedRecords | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| duplicateRecords | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| status | String | @default("pending") | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdById | String | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |
| idempotencyKey | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| requestHash | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| uploadId | String? | @unique | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| completedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- CrmImportJob_createdById_fkey; validated=true
FOREIGN KEY ("createdById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- CrmImportJob_pkey; validated=true
PRIMARY KEY (id)
-- CrmImportJob_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- CrmImportJob_uploadId_fkey; validated=true
FOREIGN KEY ("uploadId") REFERENCES "CrmImportUpload"(id) ON UPDATE CASCADE ON DELETE SET NULL
CREATE UNIQUE INDEX "CrmImportJob_pkey" ON public."CrmImportJob" USING btree (id);
CREATE INDEX "CrmImportJob_tenantId_module_createdAt_id_idx" ON public."CrmImportJob" USING btree ("tenantId", module, "createdAt", id);
CREATE UNIQUE INDEX "CrmImportJob_tenantId_module_idempotencyKey_key" ON public."CrmImportJob" USING btree ("tenantId", module, "idempotencyKey");
CREATE INDEX "CrmImportJob_tenantId_module_status_createdAt_id_idx" ON public."CrmImportJob" USING btree ("tenantId", module, status, "createdAt", id);
CREATE UNIQUE INDEX "CrmImportJob_uploadId_key" ON public."CrmImportJob" USING btree ("uploadId");
```

</details>

### CrmImportRowResult

Historical per-input-row outcome. Category C. Keep unique job/rowNumber and immutable input/result

- Initial audit rows: **12**; immediately before cleanup: **12**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-04T07:22:05.292Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "CrmImportRowResult_importJobId_rowNumber_key" ON public."CrmImportRowResult" USING btree ("importJobId", "rowNumber")`; `CREATE UNIQUE INDEX "CrmImportRowResult_pkey" ON public."CrmImportRowResult" USING btree (id)`.
- Parent relations: job: CrmImportJob (@relation(fields: [importJobId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/imports/imports.repository.ts:22](../../backend/src/modules/crm/imports/imports.repository.ts#L22); [backend/src/modules/crm/imports/imports.repository.ts:23](../../backend/src/modules/crm/imports/imports.repository.ts#L23); [backend/src/modules/crm/imports/imports.repository.ts:24](../../backend/src/modules/crm/imports/imports.repository.ts#L24); [backend/src/modules/crm/imports/imports.repository.ts:25](../../backend/src/modules/crm/imports/imports.repository.ts#L25)
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): [backend/src/modules/crm/imports/imports.repository.ts:24](../../backend/src/modules/crm/imports/imports.repository.ts#L24) `results`; [backend/src/modules/crm/deals/deals.repository.ts:305](../../backend/src/modules/crm/deals/deals.repository.ts#L305) `results`
- Search matches across repository: 48 in 19 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: recordId intentionally survives source record deletion; JSON holds input snapshot. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| importJobId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| rowNumber | Int | No explicit default; required | 0 | KEEP — captured event/outcome fact |
| status | String | No explicit default; required | 0 | KEEP — captured event/outcome fact |
| recordId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| remarks | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| data | Json | @default("{}") | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- CrmImportRowResult_importJobId_fkey; validated=true
FOREIGN KEY ("importJobId") REFERENCES "CrmImportJob"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- CrmImportRowResult_pkey; validated=true
PRIMARY KEY (id)
CREATE UNIQUE INDEX "CrmImportRowResult_importJobId_rowNumber_key" ON public."CrmImportRowResult" USING btree ("importJobId", "rowNumber");
CREATE INDEX "CrmImportRowResult_importJobId_status_rowNumber_idx" ON public."CrmImportRowResult" USING btree ("importJobId", status, "rowNumber");
CREATE UNIQUE INDEX "CrmImportRowResult_pkey" ON public."CrmImportRowResult" USING btree (id);
```

</details>

### CrmImportUpload

Expiring raw import upload envelope. Category G. Keep shared staging; retain cleanup index

- Initial audit rows: **0**; immediately before cleanup: **0**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): expiresAt=NULL
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "CrmImportUpload_pkey" ON public."CrmImportUpload" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id], onDelete: Cascade)); actor: User (@relation(fields: [actorId], references: [id], onDelete: Cascade)).
- Children: CrmImportJob.upload; CrmImportChunk.upload.
- Direct runtime-source read sites: [backend/src/modules/crm/imports/import-upload.service.ts:15](../../backend/src/modules/crm/imports/import-upload.service.ts#L15); [backend/src/modules/crm/imports/import-upload.service.ts:19](../../backend/src/modules/crm/imports/import-upload.service.ts#L19); [backend/src/modules/crm/imports/import-upload.service.ts:37](../../backend/src/modules/crm/imports/import-upload.service.ts#L37); [backend/src/modules/crm/imports/import-upload.service.ts:49](../../backend/src/modules/crm/imports/import-upload.service.ts#L49)
- Direct runtime-source write sites: [backend/src/modules/crm/imports/import-upload.service.ts:13](../../backend/src/modules/crm/imports/import-upload.service.ts#L13); [backend/src/modules/crm/imports/import-upload.service.ts:18](../../backend/src/modules/crm/imports/import-upload.service.ts#L18); [backend/src/modules/crm/imports/import-upload.service.ts:29](../../backend/src/modules/crm/imports/import-upload.service.ts#L29); [backend/src/modules/crm/imports/import-upload.service.ts:43](../../backend/src/modules/crm/imports/import-upload.service.ts#L43); [backend/src/modules/crm/imports/import-cleanup.service.ts:7](../../backend/src/modules/crm/imports/import-cleanup.service.ts#L7)
- Possible nested relation access (review with parent): [backend/src/modules/crm/imports/import-upload.service.ts:56](../../backend/src/modules/crm/imports/import-upload.service.ts#L56) `upload`
- Search matches across repository: 39 in 12 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Owns source hash, expiry and chunk count before job creation. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| actorId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| module | CrmImportModule | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| totalChunks | Int | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| sourceHash | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| expiresAt | DateTime | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- CrmImportUpload_actorId_fkey; validated=true
FOREIGN KEY ("actorId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- CrmImportUpload_pkey; validated=true
PRIMARY KEY (id)
-- CrmImportUpload_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- CrmImportUpload_totalChunks_check; validated=true
CHECK ((("totalChunks" >= 1) AND ("totalChunks" <= 160)))
CREATE INDEX "CrmImportUpload_expiresAt_idx" ON public."CrmImportUpload" USING btree ("expiresAt");
CREATE UNIQUE INDEX "CrmImportUpload_pkey" ON public."CrmImportUpload" USING btree (id);
```

</details>

### Deal

Opportunity with immutable commercial snapshot. Category A. Use ordered LeadDeal/ContactDeal as sole participant storage; derive singular API fields; atomic edits; keep value snapshot

- Initial audit rows: **22**; immediately before cleanup: **22**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): expectedCloseDate=2026-10-01T00:00:00.000Z; closedAt=2026-10-02T02:56:31.390Z; deletedAt=NULL; createdAt=2026-10-05T01:27:31.167Z; updatedAt=2026-10-05T01:27:31.167Z; wonConfirmedAt=2026-10-02T02:56:31.390Z; stageChangedAt=2026-10-02T03:13:05.000Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Deal_id_tenantId_key" ON public."Deal" USING btree (id, "tenantId")`; `CREATE UNIQUE INDEX "Deal_pkey" ON public."Deal" USING btree (id)`; `CREATE UNIQUE INDEX "Deal_tenantId_automationKey_key" ON public."Deal" USING btree ("tenantId", "automationKey")`.
- Parent relations: productInterestRecord: ProductInterest? (@relation(fields: [productInterestId, tenantId], references: [id, tenantId], onDelete: Restrict)); tenant: Tenant (@relation(fields: [tenantId], references: [id])); pipeline: Pipeline (@relation(fields: [pipelineId, tenantId], references: [id, tenantId])); stage: Stage (@relation(fields: [stageId, pipelineId, tenantId], references: [id, pipelineId, tenantId])); organization: Account? (@relation(fields: [accountId], references: [id])); assignedUser: User? (@relation("AssignedDeals", fields: [assignedUserId], references: [id])); owner: User? (@relation("OwnedDeals", fields: [ownerId], references: [id])).
- Children: LeadDeal.deal; ContactDeal.deal; DealStageHistory.deal; Activity.deal; TaskDeal.deal; RecordFile.deal; MailboxThreadAssociation.deal.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-sync.service.ts:37](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L37); [backend/src/integrations/gmail/mailbox-sync.service.ts:55](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L55); [backend/src/integrations/gmail/mailbox-sync.service.ts:70](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L70); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:58](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L58); [backend/src/modules/reporting/reports/reports.service.ts:34](../../backend/src/modules/reporting/reports/reports.service.ts#L34); [backend/src/modules/crm/relationships/relationships.service.ts:160](../../backend/src/modules/crm/relationships/relationships.service.ts#L160); [backend/src/modules/crm/relationships/relationships.service.ts:181](../../backend/src/modules/crm/relationships/relationships.service.ts#L181); [backend/src/modules/operations/tasks/tasks.repository.ts:78](../../backend/src/modules/operations/tasks/tasks.repository.ts#L78); [backend/src/modules/operations/tasks/tasks.repository.ts:215](../../backend/src/modules/operations/tasks/tasks.repository.ts#L215); [backend/src/modules/operations/tasks/tasks.repository.ts:321](../../backend/src/modules/operations/tasks/tasks.repository.ts#L321); [backend/src/modules/operations/tasks/tasks.repository.ts:429](../../backend/src/modules/operations/tasks/tasks.repository.ts#L429); [backend/src/modules/crm/record-files/record-files.service.ts:21](../../backend/src/modules/crm/record-files/record-files.service.ts#L21); [backend/src/modules/crm/pipeline/pipeline.repository.ts:48](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L48); [backend/src/modules/crm/pipeline/pipeline.repository.ts:70](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L70); [backend/src/modules/crm/pipeline/pipeline.repository.ts:84](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L84); [backend/src/modules/marketing/forms/public-forms.service.ts:85](../../backend/src/modules/marketing/forms/public-forms.service.ts#L85); [backend/src/modules/crm/merge/merge.repository.ts:38](../../backend/src/modules/crm/merge/merge.repository.ts#L38); [backend/src/modules/crm/leads/lead-conversion.service.ts:12](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L12); [backend/src/modules/crm/leads/lead-automation.service.ts:77](../../backend/src/modules/crm/leads/lead-automation.service.ts#L77); [backend/src/modules/crm/engagement.service.ts:32](../../backend/src/modules/crm/engagement.service.ts#L32); [backend/src/modules/crm/engagement.service.ts:44](../../backend/src/modules/crm/engagement.service.ts#L44); [backend/src/modules/crm/deals/forecast.service.ts:18](../../backend/src/modules/crm/deals/forecast.service.ts#L18); [backend/src/modules/crm/deals/deals.service.ts:152](../../backend/src/modules/crm/deals/deals.service.ts#L152); [backend/src/modules/crm/deals/deals.repository.ts:47](../../backend/src/modules/crm/deals/deals.repository.ts#L47); [backend/src/modules/crm/deals/deals.repository.ts:64](../../backend/src/modules/crm/deals/deals.repository.ts#L64); [backend/src/modules/crm/deals/deals.repository.ts:71](../../backend/src/modules/crm/deals/deals.repository.ts#L71); [backend/src/modules/crm/deals/deals.repository.ts:131](../../backend/src/modules/crm/deals/deals.repository.ts#L131); [backend/src/modules/crm/deals/deals.repository.ts:156](../../backend/src/modules/crm/deals/deals.repository.ts#L156); [backend/src/modules/crm/deals/deals.repository.ts:188](../../backend/src/modules/crm/deals/deals.repository.ts#L188); [backend/src/modules/crm/deals/deals.repository.ts:221](../../backend/src/modules/crm/deals/deals.repository.ts#L221); [backend/src/modules/crm/deals/deals.repository.ts:259](../../backend/src/modules/crm/deals/deals.repository.ts#L259); [backend/src/modules/crm/deals/deals.repository.ts:312](../../backend/src/modules/crm/deals/deals.repository.ts#L312); [backend/src/modules/crm/deals/deals.repository.ts:328](../../backend/src/modules/crm/deals/deals.repository.ts#L328); [backend/src/modules/crm/deals/deals.repository.ts:353](../../backend/src/modules/crm/deals/deals.repository.ts#L353); [backend/src/modules/crm/deals/deals.repository.ts:406](../../backend/src/modules/crm/deals/deals.repository.ts#L406); [backend/src/modules/crm/deals/bulk-deals.service.ts:29](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L29); [backend/src/modules/crm/deals/bulk-deals.service.ts:84](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L84); [backend/src/modules/crm/deals/bulk-deals.service.ts:155](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L155); [backend/src/modules/crm/contacts/contacts.service.ts:130](../../backend/src/modules/crm/contacts/contacts.service.ts#L130); [backend/src/modules/crm/contacts/contacts.service.ts:138](../../backend/src/modules/crm/contacts/contacts.service.ts#L138); [backend/src/modules/crm/contacts/contacts.service.ts:147](../../backend/src/modules/crm/contacts/contacts.service.ts#L147); [backend/src/modules/crm/contacts/contacts.service.ts:148](../../backend/src/modules/crm/contacts/contacts.service.ts#L148); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:39](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L39); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:54](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L54); [backend/src/modules/automation/workflows/workflows.repository.ts:123](../../backend/src/modules/automation/workflows/workflows.repository.ts#L123); [backend/src/modules/administration/product-interests/product-interests.repository.ts:10](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L10); [backend/src/modules/administration/product-interests/product-interests.repository.ts:17](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L17); [backend/src/modules/administration/archived-data/archived-data.service.ts:55](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L55)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:109](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L109); [backend/src/modules/crm/pipeline/pipeline.repository.ts:117](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L117); [backend/src/modules/marketing/forms/public-forms.service.ts:131](../../backend/src/modules/marketing/forms/public-forms.service.ts#L131); [backend/src/modules/crm/merge/merge.repository.ts:202](../../backend/src/modules/crm/merge/merge.repository.ts#L202); [backend/src/modules/crm/leads/lead-conversion.service.ts:62](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L62); [backend/src/modules/crm/leads/lead-automation.service.ts:79](../../backend/src/modules/crm/leads/lead-automation.service.ts#L79); [backend/src/modules/crm/leads/lead-automation.service.ts:82](../../backend/src/modules/crm/leads/lead-automation.service.ts#L82); [backend/src/modules/crm/engagement.service.ts:37](../../backend/src/modules/crm/engagement.service.ts#L37); [backend/src/modules/crm/deals/won-conversion.service.ts:39](../../backend/src/modules/crm/deals/won-conversion.service.ts#L39); [backend/src/modules/crm/deals/deals.service.ts:240](../../backend/src/modules/crm/deals/deals.service.ts#L240); [backend/src/modules/crm/deals/deals.service.ts:280](../../backend/src/modules/crm/deals/deals.service.ts#L280); [backend/src/modules/crm/deals/deals.repository.ts:112](../../backend/src/modules/crm/deals/deals.repository.ts#L112); [backend/src/modules/crm/deals/deals.repository.ts:174](../../backend/src/modules/crm/deals/deals.repository.ts#L174); [backend/src/modules/crm/deals/deals.repository.ts:241](../../backend/src/modules/crm/deals/deals.repository.ts#L241); [backend/src/modules/crm/deals/deals.repository.ts:274](../../backend/src/modules/crm/deals/deals.repository.ts#L274); [backend/src/modules/crm/deals/bulk-deals.service.ts:37](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L37); [backend/src/modules/crm/deals/bulk-deals.service.ts:97](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L97); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:67](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L67)
- Possible nested relation access (review with parent): [backend/src/modules/notifications/notification-events.service.ts:64](../../backend/src/modules/notifications/notification-events.service.ts#L64) `deal`; [backend/src/modules/reporting/reports/reports.service.ts:11](../../backend/src/modules/reporting/reports/reports.service.ts#L11) `deals`; [backend/src/modules/crm/relationships/relationships.service.ts:40](../../backend/src/modules/crm/relationships/relationships.service.ts#L40) `deal`; [backend/src/modules/crm/relationships/relationships.service.ts:64](../../backend/src/modules/crm/relationships/relationships.service.ts#L64) `deals`; [backend/src/modules/operations/tasks/tasks.service.ts:135](../../backend/src/modules/operations/tasks/tasks.service.ts#L135) `deal`; [backend/src/modules/operations/tasks/tasks.service.ts:117](../../backend/src/modules/operations/tasks/tasks.service.ts#L117) `deals`; [backend/src/modules/operations/tasks/tasks.repository.ts:43](../../backend/src/modules/operations/tasks/tasks.repository.ts#L43) `deal`; [backend/src/modules/crm/record-files/record-files.service.ts:9](../../backend/src/modules/crm/record-files/record-files.service.ts#L9) `deals`; [backend/src/modules/crm/pipeline/pipeline.repository.ts:14](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L14) `deals`; [backend/src/modules/crm/merge/merge.repository.ts:108](../../backend/src/modules/crm/merge/merge.repository.ts#L108) `deals`; [backend/src/modules/crm/imports/imports.service.ts:103](../../backend/src/modules/crm/imports/imports.service.ts#L103) `deals`; [backend/src/modules/crm/imports/import-rows.service.ts:196](../../backend/src/modules/crm/imports/import-rows.service.ts#L196) `deals`; [backend/src/modules/crm/deals/won-conversion.service.ts:8](../../backend/src/modules/crm/deals/won-conversion.service.ts#L8) `deal`; [backend/src/modules/crm/deals/deals.service.ts:190](../../backend/src/modules/crm/deals/deals.service.ts#L190) `deal`; [backend/src/modules/crm/deals/deals.repository.ts:267](../../backend/src/modules/crm/deals/deals.repository.ts#L267) `deal`; [backend/src/modules/crm/deals/deals.repository.ts:285](../../backend/src/modules/crm/deals/deals.repository.ts#L285) `deals`; [backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts:29](../../backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts#L29) `deal`; [backend/src/modules/automation/triggers/triggers.service.ts:5](../../backend/src/modules/automation/triggers/triggers.service.ts#L5) `deal`
- Search matches across repository: 4328 in 435 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-sync.service.ts:37](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L37); [backend/src/integrations/gmail/mailbox-sync.service.ts:55](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L55); [backend/src/integrations/gmail/mailbox-sync.service.ts:70](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L70); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:58](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L58); [backend/src/modules/automation/workflows/workflows.repository.ts:123](../../backend/src/modules/automation/workflows/workflows.repository.ts#L123); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:109](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L109)
- Normalization assessment: Duplicate scalar people relationships retired after canonical release verification. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| productsNormalized | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterestOther | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| hasEverBeenWon | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| wonHistoryVerified | Boolean | @default(true) | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterestIds | String[] | @default([]) | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| productInterestId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| automationKey | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| pipelineId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| stageId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| accountId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| assignedUserId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| ownerId | String? | // original deal owner (immutable) | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| title | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| value | Float? | No explicit default; nullable | 0 | KEEP — commercial snapshot, not current catalog default |
| currency | String? | @default("PHP") | 0 | KEEP — commercial snapshot, not current catalog default |
| billingFrequency | String? | // "monthly" \| "one_time" \| "annual" \| "quarterly" | 0 | KEEP — attribute owned by this row; not a separate entity |
| priority | Priority | @default(MEDIUM) | 0 | KEEP — attribute owned by this row; not a separate entity |
| expectedCloseDate | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| closedAt | DateTime? | // stamped when stage.isWon or stage.isLost = true | 0 | KEEP — lifecycle time or actor provenance |
| wonConfirmationType | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| wonConfirmationNote | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| wonConfirmedById | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| wonConfirmedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| closingValues | Json | @default("{}") | 0 | KEEP: Values for tenant-defined closing fields; definitions are relational, values are dynamic. |
| closingSnapshot | Json? | No explicit default; nullable | 0 | KEEP: Immutable closing evidence snapshot. |
| stageChangedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| lostReason | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| leadSource | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| industry | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterests | String[] | No explicit default; required | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| address | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| tags | String[] | // normalized to array G�� consistent with Contact.tags and Organization.tags | 0 | KEEP: Simple tag values; no independently managed tag entity or FK identity. |
| order | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| archiveReason | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| deletedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |
| contactId (original compatibility column) | text | nullable=YES; default=none | 0 | DROP through guarded migration; still present in expanded live phase |
| leadId (original compatibility column) | text | nullable=YES; default=none | 0 | DROP through guarded migration; still present in expanded live phase |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Deal_accountId_fkey; validated=true
FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_assignedUserId_fkey; validated=true
FOREIGN KEY ("assignedUserId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_ownerId_fkey; validated=true
FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_pipelineId_fkey; validated=true
FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Deal_pkey; validated=true
PRIMARY KEY (id)
-- Deal_productInterestId_tenantId_fkey; validated=true
FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- Deal_stageId_fkey; validated=true
FOREIGN KEY ("stageId") REFERENCES "Stage"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Deal_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Deal_id_tenantId_key" ON public."Deal" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Deal_pkey" ON public."Deal" USING btree (id);
CREATE INDEX "Deal_tenantId_assignedUserId_idx" ON public."Deal" USING btree ("tenantId", "assignedUserId");
CREATE UNIQUE INDEX "Deal_tenantId_automationKey_key" ON public."Deal" USING btree ("tenantId", "automationKey");
CREATE INDEX "Deal_tenantId_createdAt_idx" ON public."Deal" USING btree ("tenantId", "createdAt");
CREATE INDEX "Deal_tenantId_idx" ON public."Deal" USING btree ("tenantId");
CREATE INDEX "Deal_tenantId_isArchived_idx" ON public."Deal" USING btree ("tenantId", "isArchived");
CREATE INDEX "Deal_tenantId_pipelineId_idx" ON public."Deal" USING btree ("tenantId", "pipelineId");
CREATE INDEX "Deal_tenantId_stageId_idx" ON public."Deal" USING btree ("tenantId", "stageId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- Deal_accountId_fkey; validated=true
FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_assignedUserId_fkey; validated=true
FOREIGN KEY ("assignedUserId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_ownerId_fkey; validated=true
FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Deal_pipelineId_tenantId_fkey; validated=true
FOREIGN KEY ("pipelineId", "tenantId") REFERENCES "Pipeline"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- Deal_pkey; validated=true
PRIMARY KEY (id)
-- Deal_productInterestId_tenantId_fkey; validated=true
FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- Deal_stageId_pipelineId_tenantId_fkey; validated=true
FOREIGN KEY ("stageId", "pipelineId", "tenantId") REFERENCES "Stage"(id, "pipelineId", "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- Deal_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Deal_id_tenantId_key" ON public."Deal" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Deal_pkey" ON public."Deal" USING btree (id);
CREATE INDEX "Deal_tenantId_assignedUserId_idx" ON public."Deal" USING btree ("tenantId", "assignedUserId");
CREATE UNIQUE INDEX "Deal_tenantId_automationKey_key" ON public."Deal" USING btree ("tenantId", "automationKey");
CREATE INDEX "Deal_tenantId_createdAt_idx" ON public."Deal" USING btree ("tenantId", "createdAt");
CREATE INDEX "Deal_tenantId_idx" ON public."Deal" USING btree ("tenantId");
CREATE INDEX "Deal_tenantId_isArchived_idx" ON public."Deal" USING btree ("tenantId", "isArchived");
CREATE INDEX "Deal_tenantId_pipelineId_idx" ON public."Deal" USING btree ("tenantId", "pipelineId");
CREATE INDEX "Deal_tenantId_stageId_idx" ON public."Deal" USING btree ("tenantId", "stageId");
```

</details>

### DealAction

Legacy structured manual-deal action log. Category I. Drop empty table and enum through guarded migration 84; existing deployed build has no consumer

- Initial audit rows: **0**; immediately before cleanup: **0**; after cleanup: **0**; final live rows: **unavailable**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): performedAt=NULL
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "DealAction_pkey" ON public."DealAction" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); deal: Deal (@relation(fields: [dealId], references: [id], onDelete: Cascade)); performedBy: User (@relation(fields: [performedById], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): [backend/src/modules/automation/workflows/workflows.service.ts:21](../../backend/src/modules/automation/workflows/workflows.service.ts#L21) `actions`; [backend/src/modules/automation/workflows/workflows.repository.ts:52](../../backend/src/modules/automation/workflows/workflows.repository.ts#L52) `actions`
- Search matches across repository: 85 in 23 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: None in supported routes. Historical DTO words are not storage dependencies.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: No runtime, route, worker, integration or frontend table consumer; current actions use Activity and DealStageHistory. Final action: **DROP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | table dropped | DROP — retired table |
| tenantId | String | No explicit default; required | table dropped | DROP — retired table |
| dealId | String | No explicit default; required | table dropped | DROP — retired table |
| performedById | String | No explicit default; required | table dropped | DROP — retired table |
| actionType | DealActionType | No explicit default; required | table dropped | DROP — retired table |
| payload | Json? | // e.g. { field: "status", from: "WARM", to: "HOT" } or { to: "user@email.com" } | table dropped | DROP — retired table |
| note | String? | No explicit default; nullable | table dropped | DROP — retired table |
| performedAt | DateTime | @default(now()) | table dropped | DROP — retired table |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- DealAction_dealId_fkey; validated=true
FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- DealAction_performedById_fkey; validated=true
FOREIGN KEY ("performedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- DealAction_pkey; validated=true
PRIMARY KEY (id)
-- DealAction_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "DealAction_dealId_tenantId_idx" ON public."DealAction" USING btree ("dealId", "tenantId");
CREATE UNIQUE INDEX "DealAction_pkey" ON public."DealAction" USING btree (id);
CREATE INDEX "DealAction_tenantId_actionType_idx" ON public."DealAction" USING btree ("tenantId", "actionType");
CREATE INDEX "DealAction_tenantId_idx" ON public."DealAction" USING btree ("tenantId");
CREATE INDEX "DealAction_tenantId_performedAt_idx" ON public."DealAction" USING btree ("tenantId", "performedAt");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql


```

</details>

### DealStageHistory

Immutable stage transition history. Category C. Keep; retain hard-delete behavior pending a separate retention policy; never fold into Deal

- Initial audit rows: **35**; immediately before cleanup: **35**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): movedAt=2026-10-02T03:14:11.815Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "DealStageHistory_pkey" ON public."DealStageHistory" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); deal: Deal (@relation(fields: [dealId], references: [id], onDelete: Cascade)); movedBy: User (@relation(fields: [movedById], references: [id])); newStage: Stage (@relation("NewStage", fields: [newStageId], references: [id])); previousStage: Stage? (@relation("PreviousStage", fields: [previousStageId], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/notifications/notification-events.service.ts:64](../../backend/src/modules/notifications/notification-events.service.ts#L64); [backend/src/modules/crm/pipeline/pipeline.repository.ts:70](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L70); [backend/src/modules/crm/pipeline/pipeline.repository.ts:85](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L85); [backend/src/modules/crm/deals/deals.repository.ts:240](../../backend/src/modules/crm/deals/deals.repository.ts#L240); [backend/src/modules/crm/deals/deal-lifecycle.ts:13](../../backend/src/modules/crm/deals/deal-lifecycle.ts#L13)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:110](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L110); [backend/src/modules/crm/engagement.service.ts:38](../../backend/src/modules/crm/engagement.service.ts#L38); [backend/src/modules/crm/deals/deals.repository.ts:254](../../backend/src/modules/crm/deals/deals.repository.ts#L254)
- Possible nested relation access (review with parent): [backend/src/modules/marketing/forms/public-forms.service.ts:87](../../backend/src/modules/marketing/forms/public-forms.service.ts#L87) `stageHistories`; [backend/src/modules/crm/deals/deals.service.ts:268](../../backend/src/modules/crm/deals/deals.service.ts#L268) `stageHistories`; [backend/src/modules/crm/deals/deals.repository.ts:84](../../backend/src/modules/crm/deals/deals.repository.ts#L84) `stageHistories`
- Search matches across repository: 133 in 47 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notification-events.service.ts:64](../../backend/src/modules/notifications/notification-events.service.ts#L64); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:110](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L110)
- Normalization assessment: Hard-delete cascade removes history; archive does not. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| dealId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| previousStageId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| newStageId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| movedById | String | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |
| movedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| timeInPrevStage | Int? | // minutes spent in previous stage (computed on insert) | 0 | KEEP — captured event/outcome fact |
| note | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- DealStageHistory_dealId_fkey; validated=true
FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- DealStageHistory_movedById_fkey; validated=true
FOREIGN KEY ("movedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- DealStageHistory_newStageId_fkey; validated=true
FOREIGN KEY ("newStageId") REFERENCES "Stage"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- DealStageHistory_pkey; validated=true
PRIMARY KEY (id)
-- DealStageHistory_previousStageId_fkey; validated=true
FOREIGN KEY ("previousStageId") REFERENCES "Stage"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- DealStageHistory_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "DealStageHistory_dealId_tenantId_idx" ON public."DealStageHistory" USING btree ("dealId", "tenantId");
CREATE UNIQUE INDEX "DealStageHistory_pkey" ON public."DealStageHistory" USING btree (id);
CREATE INDEX "DealStageHistory_tenantId_idx" ON public."DealStageHistory" USING btree ("tenantId");
CREATE INDEX "DealStageHistory_tenantId_movedAt_idx" ON public."DealStageHistory" USING btree ("tenantId", "movedAt");
```

</details>

### EmailAccount

Encrypted Gmail credentials and synchronization lease. Category E. Keep system sender exception; do not blindly add tenant/user FKs; separate system credentials in future expand phase

- Initial audit rows: **2**; immediately before cleanup: **2**; after cleanup: **0**; final live rows: **1**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): tokenExpiresAt=2026-10-05T07:02:07.746Z; lastSyncAt=2026-10-05T06:34:17.303Z; connectedAt=2026-10-01T09:40:59.559Z; updatedAt=2026-10-05T06:34:17.518Z; syncLeaseUntil=NULL
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "EmailAccount_pkey" ON public."EmailAccount" USING btree (id)`; `CREATE UNIQUE INDEX "EmailAccount_tenantId_userId_provider_key" ON public."EmailAccount" USING btree ("tenantId", "userId", provider)`.
- Parent relations: No declared Prisma parent relation.
- Children: MailboxMessage.account; MailboxThreadAssociation.account.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-sync.service.ts:28](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L28); [backend/src/integrations/gmail/mailbox-sync.service.ts:34](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L34); [backend/src/integrations/gmail/mailbox-sync.service.ts:50](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L50); [backend/src/integrations/gmail/mailbox-sync.service.ts:62](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L62); [backend/src/integrations/gmail/mailbox-sync.service.ts:85](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L85); [backend/src/integrations/gmail/mailbox-sync.service.ts:93](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L93); [backend/src/integrations/gmail/mailbox-sync.service.ts:161](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L161); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:35](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L35); [backend/src/integrations/gmail/mailbox-auth.service.ts:42](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L42); [backend/src/integrations/gmail/gmail.service.ts:20](../../backend/src/integrations/gmail/gmail.service.ts#L20); [backend/src/integrations/gmail/gmail.service.ts:91](../../backend/src/integrations/gmail/gmail.service.ts#L91); [backend/src/integrations/gmail/gmail.service.ts:255](../../backend/src/integrations/gmail/gmail.service.ts#L255); [backend/src/integrations/gmail/gmail.service.ts:287](../../backend/src/integrations/gmail/gmail.service.ts#L287); [backend/src/integrations/gmail/gmail.service.ts:330](../../backend/src/integrations/gmail/gmail.service.ts#L330); [backend/src/modules/notifications/notification-events.service.ts:128](../../backend/src/modules/notifications/notification-events.service.ts#L128); [backend/src/modules/automation/actions/actions.repository.ts:21](../../backend/src/modules/automation/actions/actions.repository.ts#L21)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-sync.service.ts:88](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L88); [backend/src/integrations/gmail/mailbox-sync.service.ts:106](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L106); [backend/src/integrations/gmail/mailbox-sync.service.ts:112](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L112); [backend/src/integrations/gmail/mailbox-sync.service.ts:130](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L130); [backend/src/integrations/gmail/mailbox-sync.service.ts:139](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L139); [backend/src/integrations/gmail/mailbox-sync.service.ts:142](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L142); [backend/src/integrations/gmail/mailbox-sync.service.ts:148](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L148); [backend/src/integrations/gmail/mailbox-sync.service.ts:151](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L151); [backend/src/integrations/gmail/mailbox-auth.service.ts:48](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L48); [backend/src/integrations/gmail/gmail.service.ts:64](../../backend/src/integrations/gmail/gmail.service.ts#L64); [backend/src/integrations/gmail/gmail.service.ts:135](../../backend/src/integrations/gmail/gmail.service.ts#L135); [backend/src/integrations/gmail/gmail.service.ts:312](../../backend/src/integrations/gmail/gmail.service.ts#L312)
- Possible nested relation access (review with parent): [backend/src/integrations/gmail/mailbox-ingestion.service.ts:27](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L27) `account`; [backend/src/modules/notifications/notification-events.service.ts:75](../../backend/src/modules/notifications/notification-events.service.ts#L75) `account`; [backend/src/modules/operations/tasks/tasks.service.ts:128](../../backend/src/modules/operations/tasks/tasks.service.ts#L128) `account`; [backend/src/modules/operations/tasks/tasks.repository.ts:51](../../backend/src/modules/operations/tasks/tasks.repository.ts#L51) `account`; [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:25](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L25) `account`; [backend/src/modules/crm/contacts/contacts.repository.ts:62](../../backend/src/modules/crm/contacts/contacts.repository.ts#L62) `account`
- Search matches across repository: 144 in 49 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-sync.service.ts:28](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L28); [backend/src/integrations/gmail/mailbox-sync.service.ts:34](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L34); [backend/src/integrations/gmail/mailbox-sync.service.ts:50](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L50); [backend/src/integrations/gmail/mailbox-sync.service.ts:62](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L62); [backend/src/integrations/gmail/mailbox-sync.service.ts:85](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L85); [backend/src/integrations/gmail/mailbox-sync.service.ts:93](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L93); [backend/src/integrations/gmail/mailbox-sync.service.ts:161](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L161); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:35](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L35); [backend/src/integrations/gmail/mailbox-auth.service.ts:42](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L42); [backend/src/integrations/gmail/gmail.service.ts:20](../../backend/src/integrations/gmail/gmail.service.ts#L20); [backend/src/integrations/gmail/gmail.service.ts:91](../../backend/src/integrations/gmail/gmail.service.ts#L91); [backend/src/integrations/gmail/gmail.service.ts:255](../../backend/src/integrations/gmail/gmail.service.ts#L255); [backend/src/integrations/gmail/gmail.service.ts:287](../../backend/src/integrations/gmail/gmail.service.ts#L287); [backend/src/integrations/gmail/gmail.service.ts:330](../../backend/src/integrations/gmail/gmail.service.ts#L330); [backend/src/modules/notifications/notification-events.service.ts:128](../../backend/src/modules/notifications/notification-events.service.ts#L128); [backend/src/integrations/gmail/mailbox-sync.service.ts:88](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L88); [backend/src/integrations/gmail/mailbox-sync.service.ts:106](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L106); [backend/src/integrations/gmail/mailbox-sync.service.ts:112](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L112); [backend/src/integrations/gmail/mailbox-sync.service.ts:130](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L130); [backend/src/integrations/gmail/mailbox-sync.service.ts:139](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L139); [backend/src/integrations/gmail/mailbox-sync.service.ts:142](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L142); [backend/src/integrations/gmail/mailbox-sync.service.ts:148](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L148); [backend/src/integrations/gmail/mailbox-sync.service.ts:151](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L151); [backend/src/integrations/gmail/mailbox-auth.service.ts:48](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L48); [backend/src/integrations/gmail/gmail.service.ts:64](../../backend/src/integrations/gmail/gmail.service.ts#L64); [backend/src/integrations/gmail/gmail.service.ts:135](../../backend/src/integrations/gmail/gmail.service.ts#L135); [backend/src/integrations/gmail/gmail.service.ts:312](../../backend/src/integrations/gmail/gmail.service.ts#L312)
- Normalization assessment: System sender intentionally uses system/system without User/Tenant rows. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| provider | String | @default("gmail") // "gmail" \| future: "outlook" | 0 | KEEP — attribute owned by this row; not a separate entity |
| email | String | // the connected Gmail address | 0 | KEEP — attribute owned by this row; not a separate entity |
| accessToken | String | // encrypted G�� never log or expose | 0 | KEEP — security credential/state |
| refreshToken | String? | // encrypted G�� needed for offline access | 0 | KEEP — security credential/state |
| tokenExpiresAt | DateTime? | No explicit default; nullable | 0 | KEEP — security credential/state |
| scopes | String[] | // granted OAuth scopes | 0 | KEEP: Provider-defined OAuth permission tokens. |
| isActive | Boolean | @default(true) | 0 | KEEP — attribute owned by this row; not a separate entity |
| lastSyncAt | DateTime? | No explicit default; nullable | 1 | KEEP — lifecycle time or actor provenance |
| syncCursor | String? | // Gmail history ID for incremental sync | 1 | KEEP — attribute owned by this row; not a separate entity |
| connectedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |
| syncLeaseUntil | DateTime? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| syncLeaseId | String? | No explicit default; nullable | 1 | KEEP — relationship or historical/provider identity; see declared parents |
| syncPageToken | String? | No explicit default; nullable | 0 | KEEP — security credential/state |
| syncBaselineHistoryId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| syncError | String? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- EmailAccount_pkey; validated=true
PRIMARY KEY (id)
CREATE UNIQUE INDEX "EmailAccount_pkey" ON public."EmailAccount" USING btree (id);
CREATE INDEX "EmailAccount_tenantId_isActive_idx" ON public."EmailAccount" USING btree ("tenantId", "isActive");
CREATE INDEX "EmailAccount_tenantId_userId_idx" ON public."EmailAccount" USING btree ("tenantId", "userId");
CREATE UNIQUE INDEX "EmailAccount_tenantId_userId_provider_key" ON public."EmailAccount" USING btree ("tenantId", "userId", provider);
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- EmailAccount_pkey; validated=true
PRIMARY KEY (id)
CREATE UNIQUE INDEX "EmailAccount_id_tenantId_key" ON public."EmailAccount" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "EmailAccount_pkey" ON public."EmailAccount" USING btree (id);
CREATE INDEX "EmailAccount_tenantId_isActive_idx" ON public."EmailAccount" USING btree ("tenantId", "isActive");
CREATE INDEX "EmailAccount_tenantId_userId_idx" ON public."EmailAccount" USING btree ("tenantId", "userId");
CREATE UNIQUE INDEX "EmailAccount_tenantId_userId_provider_key" ON public."EmailAccount" USING btree ("tenantId", "userId", provider);
```

</details>

### EmailDeliveryLog

Outbound provider submission and current delivery state. Category E. Keep separate from inbox; remove exact redundant index

- Initial audit rows: **22**; immediately before cleanup: **22**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): sentAt=2026-10-02T02:10:36.910Z; openedAt=2026-10-02T02:10:51.000Z; clickedAt=2026-09-25T03:34:19.000Z; bouncedAt=2026-10-02T02:06:32.000Z; createdAt=2026-10-02T02:10:36.261Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "EmailDeliveryLog_brevoMessageId_key" ON public."EmailDeliveryLog" USING btree ("brevoMessageId")`; `CREATE UNIQUE INDEX "EmailDeliveryLog_gmailMessageId_key" ON public."EmailDeliveryLog" USING btree ("gmailMessageId")`; `CREATE UNIQUE INDEX "EmailDeliveryLog_pkey" ON public."EmailDeliveryLog" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); campaign: Campaign? (@relation(fields: [campaignId], references: [id], onDelete: SetNull)); lead: Lead? (@relation(fields: [leadId], references: [id], onDelete: SetNull)); contact: Contact? (@relation(fields: [contactId], references: [id], onDelete: SetNull)).
- Children: EmailEvent.deliveryLog.
- Direct runtime-source read sites: [backend/src/modules/marketing/campaigns/brevo-webhook.ts:27](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L27); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:46](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L46); [backend/src/modules/marketing/campaigns/audiences.service.ts:73](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L73)
- Direct runtime-source write sites: [backend/src/modules/crm/merge/merge.repository.ts:99](../../backend/src/modules/crm/merge/merge.repository.ts#L99); [backend/src/modules/crm/merge/merge.repository.ts:163](../../backend/src/modules/crm/merge/merge.repository.ts#L163); [backend/src/modules/marketing/campaigns/campaigns.service.ts:149](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L149); [backend/src/modules/marketing/campaigns/campaigns.service.ts:172](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L172); [backend/src/modules/marketing/campaigns/campaigns.service.ts:182](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L182); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:57](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L57); [backend/src/modules/automation/actions/actions.repository.ts:24](../../backend/src/modules/automation/actions/actions.repository.ts#L24); [backend/src/modules/automation/actions/actions.repository.ts:27](../../backend/src/modules/automation/actions/actions.repository.ts#L27)
- Possible nested relation access (review with parent): [backend/src/modules/marketing/campaigns/campaigns.repository.ts:12](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L12) `emailDeliveryLogs`
- Search matches across repository: 132 in 41 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/marketing/campaigns/brevo-webhook.ts:27](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L27); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:46](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L46); [backend/src/modules/marketing/campaigns/audiences.service.ts:73](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L73); [backend/src/modules/marketing/campaigns/campaigns.service.ts:149](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L149); [backend/src/modules/marketing/campaigns/campaigns.service.ts:172](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L172); [backend/src/modules/marketing/campaigns/campaigns.service.ts:182](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L182); [backend/src/modules/marketing/campaigns/brevo-webhook.ts:57](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L57)
- Normalization assessment: Duplicate gmailMessageId index; provider state also projected to recipients. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| brevoMessageId | String? | @unique | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| campaignId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| leadId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| contactId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| fromEmail | String | No explicit default; required | 0 | KEEP — captured event/outcome fact |
| toEmail | String | No explicit default; required | 0 | KEEP — captured event/outcome fact |
| subject | String | No explicit default; required | 0 | KEEP — captured event/outcome fact |
| gmailMessageId | String? | @unique | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| gmailThreadId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| status | String | // sent\|delivered\|opened\|clicked\|bounced\|failed | 0 | KEEP — captured event/outcome fact |
| sentAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| openedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| clickedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| bouncedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| errorMessage | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- EmailDeliveryLog_campaignId_fkey; validated=true
FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- EmailDeliveryLog_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- EmailDeliveryLog_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- EmailDeliveryLog_pkey; validated=true
PRIMARY KEY (id)
-- EmailDeliveryLog_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "EmailDeliveryLog_brevoMessageId_key" ON public."EmailDeliveryLog" USING btree ("brevoMessageId");
CREATE INDEX "EmailDeliveryLog_gmailMessageId_idx" ON public."EmailDeliveryLog" USING btree ("gmailMessageId");
CREATE UNIQUE INDEX "EmailDeliveryLog_gmailMessageId_key" ON public."EmailDeliveryLog" USING btree ("gmailMessageId");
CREATE UNIQUE INDEX "EmailDeliveryLog_pkey" ON public."EmailDeliveryLog" USING btree (id);
CREATE INDEX "EmailDeliveryLog_tenantId_campaignId_idx" ON public."EmailDeliveryLog" USING btree ("tenantId", "campaignId");
CREATE INDEX "EmailDeliveryLog_tenantId_contactId_idx" ON public."EmailDeliveryLog" USING btree ("tenantId", "contactId");
CREATE INDEX "EmailDeliveryLog_tenantId_idx" ON public."EmailDeliveryLog" USING btree ("tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- EmailDeliveryLog_campaignId_fkey; validated=true
FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- EmailDeliveryLog_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- EmailDeliveryLog_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- EmailDeliveryLog_pkey; validated=true
PRIMARY KEY (id)
-- EmailDeliveryLog_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "EmailDeliveryLog_brevoMessageId_key" ON public."EmailDeliveryLog" USING btree ("brevoMessageId");
CREATE UNIQUE INDEX "EmailDeliveryLog_gmailMessageId_key" ON public."EmailDeliveryLog" USING btree ("gmailMessageId");
CREATE UNIQUE INDEX "EmailDeliveryLog_pkey" ON public."EmailDeliveryLog" USING btree (id);
CREATE INDEX "EmailDeliveryLog_tenantId_campaignId_idx" ON public."EmailDeliveryLog" USING btree ("tenantId", "campaignId");
CREATE INDEX "EmailDeliveryLog_tenantId_contactId_idx" ON public."EmailDeliveryLog" USING btree ("tenantId", "contactId");
CREATE INDEX "EmailDeliveryLog_tenantId_idx" ON public."EmailDeliveryLog" USING btree ("tenantId");
CREATE INDEX "EmailDeliveryLog_tenantId_leadId_idx" ON public."EmailDeliveryLog" USING btree ("tenantId", "leadId");
```

</details>

### EmailEvent

Idempotent outbound provider event history. Category C. Keep event identity key and history; separate from mailbox messages

- Initial audit rows: **29**; immediately before cleanup: **29**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-02T02:10:57.211Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "EmailEvent_pkey" ON public."EmailEvent" USING btree (id)`; `CREATE UNIQUE INDEX "EmailEvent_providerEventKey_key" ON public."EmailEvent" USING btree ("providerEventKey")`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); deliveryLog: EmailDeliveryLog (@relation(fields: [deliveryLogId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/marketing/campaigns/brevo-webhook.ts:41](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L41)
- Possible nested relation access (review with parent): [backend/src/modules/marketing/campaigns/campaigns.repository.ts:13](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L13) `EmailEvent`; [backend/src/modules/marketing/campaigns/audiences.service.ts:73](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L73) `EmailEvent`
- Search matches across repository: 34 in 17 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/marketing/campaigns/brevo-webhook.ts:41](../../backend/src/modules/marketing/campaigns/brevo-webhook.ts#L41)
- Normalization assessment: Shares event facts with delivery projection intentionally. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| providerEventKey | String? | @unique | 0 | KEEP — captured event/outcome fact |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| deliveryLogId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| eventType | String | // open\|click\|bounce\|unsubscribe | 0 | KEEP — captured event/outcome fact |
| url | String? | // for clicks | 0 | KEEP — captured event/outcome fact |
| userAgent | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| ipAddress | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- EmailEvent_deliveryLogId_fkey; validated=true
FOREIGN KEY ("deliveryLogId") REFERENCES "EmailDeliveryLog"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- EmailEvent_pkey; validated=true
PRIMARY KEY (id)
-- EmailEvent_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "EmailEvent_deliveryLogId_idx" ON public."EmailEvent" USING btree ("deliveryLogId");
CREATE UNIQUE INDEX "EmailEvent_pkey" ON public."EmailEvent" USING btree (id);
CREATE UNIQUE INDEX "EmailEvent_providerEventKey_key" ON public."EmailEvent" USING btree ("providerEventKey");
CREATE INDEX "EmailEvent_tenantId_eventType_idx" ON public."EmailEvent" USING btree ("tenantId", "eventType");
CREATE INDEX "EmailEvent_tenantId_idx" ON public."EmailEvent" USING btree ("tenantId");
```

</details>

### EmailVerificationToken

Retired signup verification capabilities. Category D. Drop empty table in migration 84 and remove unreachable service/test; password reset and OAuth remain separate active flows

- Initial audit rows: **7**; immediately before cleanup: **7**; after cleanup: **0**; final live rows: **unavailable**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): expiresAt=2026-09-19T01:25:00.480Z; usedAt=2026-09-13T14:48:01.727Z; createdAt=2026-09-18T01:25:00.498Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "EmailVerificationToken_pkey" ON public."EmailVerificationToken" USING btree (id)`; `CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON public."EmailVerificationToken" USING btree ("tokenHash")`.
- Parent relations: user: User? (@relation(fields: [userId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/core/auth/verification.service.ts:35](../../backend/src/core/auth/verification.service.ts#L35)
- Direct runtime-source write sites: [backend/src/core/auth/verification.service.ts:25](../../backend/src/core/auth/verification.service.ts#L25)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 34 in 15 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: None in supported routes. Historical DTO words are not storage dependencies.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Public route retired; unused service unreachable; seven original dummy rows deleted with authorized cleanup. Final action: **DROP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | table dropped | DROP — retired table |
| userId | String? | // nullable — may be generated before user exists (e.g. pre-registration) | table dropped | DROP — retired table |
| email | String | No explicit default; required | table dropped | DROP — retired table |
| tokenHash | String | @unique // SHA-256 hex digest of plaintext token | table dropped | DROP — retired table |
| type | String | @default("EMAIL_VERIFICATION") | table dropped | DROP — retired table |
| expiresAt | DateTime | No explicit default; required | table dropped | DROP — retired table |
| usedAt | DateTime? | No explicit default; nullable | table dropped | DROP — retired table |
| createdAt | DateTime | @default(now()) | table dropped | DROP — retired table |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- EmailVerificationToken_pkey; validated=true
PRIMARY KEY (id)
-- EmailVerificationToken_userId_fkey; validated=true
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE INDEX "EmailVerificationToken_email_idx" ON public."EmailVerificationToken" USING btree (email);
CREATE UNIQUE INDEX "EmailVerificationToken_pkey" ON public."EmailVerificationToken" USING btree (id);
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON public."EmailVerificationToken" USING btree ("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON public."EmailVerificationToken" USING btree ("userId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql


```

</details>

### FormSubmission

Individual idempotent published form submission. Category C. Composite form FK; keep payload, publishedConfig, email/phone capture snapshots

- Initial audit rows: **7**; immediately before cleanup: **7**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): submittedAt=2026-10-02T01:40:47.519Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "FormSubmission_formId_requestKey_key" ON public."FormSubmission" USING btree ("formId", "requestKey")`; `CREATE UNIQUE INDEX "FormSubmission_pkey" ON public."FormSubmission" USING btree (id)`.
- Parent relations: form: MarketingForm (@relation(fields: [formId, tenantId], references: [id, tenantId], onDelete: Restrict)); lead: Lead? (@relation(fields: [leadId], references: [id], onDelete: Restrict)); contact: Contact? (@relation(fields: [contactId], references: [id], onDelete: Restrict)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/marketing/forms/public-forms.service.ts:43](../../backend/src/modules/marketing/forms/public-forms.service.ts#L43); [backend/src/modules/marketing/forms/forms.repository.ts:70](../../backend/src/modules/marketing/forms/forms.repository.ts#L70)
- Direct runtime-source write sites: [backend/src/modules/marketing/forms/public-forms.service.ts:120](../../backend/src/modules/marketing/forms/public-forms.service.ts#L120); [backend/src/modules/marketing/forms/public-forms.service.ts:148](../../backend/src/modules/marketing/forms/public-forms.service.ts#L148); [backend/src/modules/marketing/forms/forms.repository.ts:50](../../backend/src/modules/marketing/forms/forms.repository.ts#L50)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 53 in 18 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: tenantId not tied to form by composite FK. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| requestKey | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| formId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| publishedVersion | Int | No explicit default; required | 0 | KEEP — captured event/outcome fact |
| publishedConfig | Json | No explicit default; required | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| leadId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| contactId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| submittedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| email | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| phone | String? | No explicit default; nullable | 0 | KEEP — captured event/outcome fact |
| values | Json | No explicit default; required | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| tracking | Json | @default("{}") | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| notificationStatus | String | @default("not_requested") | 0 | KEEP — captured event/outcome fact |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- FormSubmission_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- FormSubmission_formId_fkey; validated=true
FOREIGN KEY ("formId") REFERENCES "MarketingForm"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- FormSubmission_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- FormSubmission_one_person_check; validated=true
CHECK ((((("leadId" IS NOT NULL))::integer + (("contactId" IS NOT NULL))::integer) = 1))
-- FormSubmission_pkey; validated=true
PRIMARY KEY (id)
CREATE INDEX "FormSubmission_contactId_idx" ON public."FormSubmission" USING btree ("contactId");
CREATE UNIQUE INDEX "FormSubmission_formId_requestKey_key" ON public."FormSubmission" USING btree ("formId", "requestKey");
CREATE INDEX "FormSubmission_leadId_idx" ON public."FormSubmission" USING btree ("leadId");
CREATE UNIQUE INDEX "FormSubmission_pkey" ON public."FormSubmission" USING btree (id);
CREATE INDEX "FormSubmission_tenantId_formId_submittedAt_idx" ON public."FormSubmission" USING btree ("tenantId", "formId", "submittedAt");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- FormSubmission_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- FormSubmission_formId_tenantId_fkey; validated=true
FOREIGN KEY ("formId", "tenantId") REFERENCES "MarketingForm"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- FormSubmission_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- FormSubmission_one_person_check; validated=true
CHECK ((((("leadId" IS NOT NULL))::integer + (("contactId" IS NOT NULL))::integer) = 1))
-- FormSubmission_pkey; validated=true
PRIMARY KEY (id)
CREATE INDEX "FormSubmission_contactId_idx" ON public."FormSubmission" USING btree ("contactId");
CREATE UNIQUE INDEX "FormSubmission_formId_requestKey_key" ON public."FormSubmission" USING btree ("formId", "requestKey");
CREATE INDEX "FormSubmission_leadId_idx" ON public."FormSubmission" USING btree ("leadId");
CREATE UNIQUE INDEX "FormSubmission_pkey" ON public."FormSubmission" USING btree (id);
CREATE INDEX "FormSubmission_tenantId_formId_submittedAt_idx" ON public."FormSubmission" USING btree ("tenantId", "formId", "submittedAt");
```

</details>

### Lead

Prospective person and retained conversion source. Category A. Keep original row, conversion actor/time and account link; no email uniqueness without business rule

- Initial audit rows: **31**; immediately before cleanup: **31**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-05T01:27:30.891Z; updatedAt=2026-10-05T01:55:55.993Z; lastStatusChangedAt=2026-10-02T02:56:31.390Z; convertedAt=2026-10-02T02:56:31.437Z; deletedAt=2026-10-05T01:55:55.992Z; lastMeaningfulInboundAt=2026-10-02T03:13:05.000Z; firstUnansweredOutboundAt=2026-10-02T02:53:20.000Z; engagementEvaluatedAt=2026-10-02T03:13:05.000Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Lead_id_tenantId_key" ON public."Lead" USING btree (id, "tenantId")`; `CREATE UNIQUE INDEX "Lead_pkey" ON public."Lead" USING btree (id)`; `CREATE UNIQUE INDEX "Lead_tenantId_creationKey_key" ON public."Lead" USING btree ("tenantId", "creationKey")`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); account: Account? (@relation(fields: [accountId], references: [id])); assignedUser: User? (@relation("AssignedLeads", fields: [assignedUserId], references: [id])); createdBy: User? (@relation("CreatedLeads", fields: [createdById], references: [id])); updatedBy: User? (@relation("UpdatedLeads", fields: [updatedById], references: [id])); convertedContact: Contact? (@relation("ConvertedFromLead", fields: [contactId], references: [id])); convertedBy: User? (@relation("ConvertedLeads", fields: [convertedById], references: [id])).
- Children: LeadDeal.lead; Activity.lead; FormSubmission.lead; CampaignContact.lead; EmailDeliveryLog.lead; TaskLead.lead; RecordFile.lead; LeadProductInterest.lead.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:17](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L17); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:50](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L50); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:81](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L81); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:123](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L123); [backend/src/modules/notifications/notification-events.service.ts:39](../../backend/src/modules/notifications/notification-events.service.ts#L39); [backend/src/modules/notifications/notification-events.service.ts:58](../../backend/src/modules/notifications/notification-events.service.ts#L58); [backend/src/modules/notifications/notification-events.service.ts:77](../../backend/src/modules/notifications/notification-events.service.ts#L77); [backend/src/modules/reporting/reports/reports.service.ts:62](../../backend/src/modules/reporting/reports/reports.service.ts#L62); [backend/src/modules/crm/relationships/relationships.service.ts:13](../../backend/src/modules/crm/relationships/relationships.service.ts#L13); [backend/src/modules/crm/relationships/relationships.service.ts:85](../../backend/src/modules/crm/relationships/relationships.service.ts#L85); [backend/src/modules/crm/relationships/relationships.service.ts:147](../../backend/src/modules/crm/relationships/relationships.service.ts#L147); [backend/src/modules/operations/tasks/tasks.repository.ts:67](../../backend/src/modules/operations/tasks/tasks.repository.ts#L67); [backend/src/modules/operations/tasks/tasks.repository.ts:211](../../backend/src/modules/operations/tasks/tasks.repository.ts#L211); [backend/src/modules/operations/tasks/tasks.repository.ts:308](../../backend/src/modules/operations/tasks/tasks.repository.ts#L308); [backend/src/modules/operations/tasks/tasks.repository.ts:422](../../backend/src/modules/operations/tasks/tasks.repository.ts#L422); [backend/src/modules/operations/tasks/tasks.repository.ts:450](../../backend/src/modules/operations/tasks/tasks.repository.ts#L450); [backend/src/modules/crm/record-files/record-files.service.ts:21](../../backend/src/modules/crm/record-files/record-files.service.ts#L21); [backend/src/modules/marketing/forms/public-forms.service.ts:62](../../backend/src/modules/marketing/forms/public-forms.service.ts#L62); [backend/src/modules/crm/merge/merge.service.ts:74](../../backend/src/modules/crm/merge/merge.service.ts#L74); [backend/src/modules/crm/merge/merge.service.ts:75](../../backend/src/modules/crm/merge/merge.service.ts#L75); [backend/src/modules/crm/merge/merge.service.ts:103](../../backend/src/modules/crm/merge/merge.service.ts#L103); [backend/src/modules/crm/merge/merge.service.ts:104](../../backend/src/modules/crm/merge/merge.service.ts#L104); [backend/src/modules/crm/merge/merge.repository.ts:39](../../backend/src/modules/crm/merge/merge.repository.ts#L39); [backend/src/modules/crm/leads/lead-conversion.service.ts:9](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L9); [backend/src/modules/crm/leads/lead-automation.service.ts:70](../../backend/src/modules/crm/leads/lead-automation.service.ts#L70); [backend/src/modules/crm/leads/lead-automation.service.ts:94](../../backend/src/modules/crm/leads/lead-automation.service.ts#L94); [backend/src/modules/crm/leads/lead-automation.service.ts:121](../../backend/src/modules/crm/leads/lead-automation.service.ts#L121); [backend/src/modules/marketing/campaigns/audiences.service.ts:70](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L70); [backend/src/modules/crm/imports/import-rows.service.ts:51](../../backend/src/modules/crm/imports/import-rows.service.ts#L51); [backend/src/modules/crm/imports/import-rows.service.ts:152](../../backend/src/modules/crm/imports/import-rows.service.ts#L152); [backend/src/modules/crm/imports/import-rows.service.ts:170](../../backend/src/modules/crm/imports/import-rows.service.ts#L170); [backend/src/modules/crm/engagement.service.ts:16](../../backend/src/modules/crm/engagement.service.ts#L16); [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:75](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L75); [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:99](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L99); [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:124](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L124); [backend/src/modules/crm/deals/won-conversion.service.ts:12](../../backend/src/modules/crm/deals/won-conversion.service.ts#L12); [backend/src/modules/crm/deals/won-conversion.service.ts:17](../../backend/src/modules/crm/deals/won-conversion.service.ts#L17); [backend/src/modules/crm/deals/deals.repository.ts:427](../../backend/src/modules/crm/deals/deals.repository.ts#L427); [backend/src/modules/crm/contacts/contacts.service.ts:126](../../backend/src/modules/crm/contacts/contacts.service.ts#L126); [backend/src/modules/crm/contacts/contacts.repository.ts:55](../../backend/src/modules/crm/contacts/contacts.repository.ts#L55); [backend/src/modules/crm/contacts/contacts.repository.ts:57](../../backend/src/modules/crm/contacts/contacts.repository.ts#L57); [backend/src/modules/crm/contacts/contacts.repository.ts:67](../../backend/src/modules/crm/contacts/contacts.repository.ts#L67); [backend/src/modules/crm/contacts/contacts.repository.ts:74](../../backend/src/modules/crm/contacts/contacts.repository.ts#L74); [backend/src/modules/crm/contacts/contacts.repository.ts:111](../../backend/src/modules/crm/contacts/contacts.repository.ts#L111); [backend/src/modules/crm/contacts/contacts.repository.ts:119](../../backend/src/modules/crm/contacts/contacts.repository.ts#L119); [backend/src/modules/crm/contacts/contacts.repository.ts:153](../../backend/src/modules/crm/contacts/contacts.repository.ts#L153); [backend/src/modules/crm/contacts/contacts.repository.ts:173](../../backend/src/modules/crm/contacts/contacts.repository.ts#L173); [backend/src/modules/automation/workflows/workflows.repository.ts:18](../../backend/src/modules/automation/workflows/workflows.repository.ts#L18); [backend/src/modules/automation/workflows/workflows.repository.ts:120](../../backend/src/modules/automation/workflows/workflows.repository.ts#L120); [backend/src/modules/automation/actions/action-sms.ts:17](../../backend/src/modules/automation/actions/action-sms.ts#L17); [backend/src/modules/automation/actions/action-fields.ts:54](../../backend/src/modules/automation/actions/action-fields.ts#L54); [backend/src/modules/administration/archived-data/archived-data.service.ts:52](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L52)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:84](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L84); [backend/src/modules/marketing/forms/public-forms.service.ts:98](../../backend/src/modules/marketing/forms/public-forms.service.ts#L98); [backend/src/modules/marketing/forms/public-forms.service.ts:108](../../backend/src/modules/marketing/forms/public-forms.service.ts#L108); [backend/src/modules/crm/merge/merge.service.ts:120](../../backend/src/modules/crm/merge/merge.service.ts#L120); [backend/src/modules/crm/merge/merge.service.ts:126](../../backend/src/modules/crm/merge/merge.service.ts#L126); [backend/src/modules/crm/merge/merge.repository.ts:188](../../backend/src/modules/crm/merge/merge.repository.ts#L188); [backend/src/modules/crm/leads/lead-conversion.service.ts:64](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L64); [backend/src/modules/crm/leads/lead-automation.service.ts:105](../../backend/src/modules/crm/leads/lead-automation.service.ts#L105); [backend/src/modules/crm/leads/lead-automation.service.ts:116](../../backend/src/modules/crm/leads/lead-automation.service.ts#L116); [backend/src/modules/crm/imports/import-rows.service.ts:153](../../backend/src/modules/crm/imports/import-rows.service.ts#L153); [backend/src/modules/crm/engagement.service.ts:22](../../backend/src/modules/crm/engagement.service.ts#L22); [backend/src/modules/crm/contacts/contacts.service.ts:140](../../backend/src/modules/crm/contacts/contacts.service.ts#L140); [backend/src/modules/crm/contacts/contacts.repository.ts:132](../../backend/src/modules/crm/contacts/contacts.repository.ts#L132); [backend/src/modules/crm/contacts/contacts.repository.ts:166](../../backend/src/modules/crm/contacts/contacts.repository.ts#L166); [backend/src/modules/crm/contacts/contacts.repository.ts:175](../../backend/src/modules/crm/contacts/contacts.repository.ts#L175)
- Possible nested relation access (review with parent): [backend/src/modules/notifications/notification-events.service.ts:40](../../backend/src/modules/notifications/notification-events.service.ts#L40) `lead`; [backend/src/modules/crm/relationships/relationships.service.ts:109](../../backend/src/modules/crm/relationships/relationships.service.ts#L109) `lead`; [backend/src/modules/crm/relationships/relationships.service.ts:233](../../backend/src/modules/crm/relationships/relationships.service.ts#L233) `leads`; [backend/src/modules/operations/tasks/tasks.service.ts:133](../../backend/src/modules/operations/tasks/tasks.service.ts#L133) `lead`; [backend/src/modules/operations/tasks/tasks.service.ts:113](../../backend/src/modules/operations/tasks/tasks.service.ts#L113) `leads`; [backend/src/modules/operations/tasks/tasks.repository.ts:34](../../backend/src/modules/operations/tasks/tasks.repository.ts#L34) `lead`; [backend/src/modules/operations/tasks/tasks.repository.ts:75](../../backend/src/modules/operations/tasks/tasks.repository.ts#L75) `convertedFromLeads`; [backend/src/modules/crm/record-files/record-files.service.ts:9](../../backend/src/modules/crm/record-files/record-files.service.ts#L9) `leads`; [backend/src/modules/crm/merge/merge.repository.ts:217](../../backend/src/modules/crm/merge/merge.repository.ts#L217) `leads`; [backend/src/modules/crm/leads/lead-conversion.service.ts:74](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L74) `lead`; [backend/src/modules/marketing/campaigns/campaigns.repository.ts:9](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L9) `lead`; [backend/src/modules/marketing/campaigns/audiences.service.ts:31](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L31) `lead`; [backend/src/modules/crm/imports/imports.service.ts:103](../../backend/src/modules/crm/imports/imports.service.ts#L103) `leads`; [backend/src/modules/crm/imports/import-rows.service.ts:187](../../backend/src/modules/crm/imports/import-rows.service.ts#L187) `leads`; [backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts:265](../../backend/src/modules/crm/duplicate-detection/duplicate-detection.service.ts#L265) `lead`; [backend/src/modules/crm/deals/deals.service.ts:269](../../backend/src/modules/crm/deals/deals.service.ts#L269) `lead`; [backend/src/modules/crm/deals/deals.repository.ts:56](../../backend/src/modules/crm/deals/deals.repository.ts#L56) `lead`; [backend/src/modules/crm/contacts/contacts.service.ts:41](../../backend/src/modules/crm/contacts/contacts.service.ts#L41) `lead`; [backend/src/modules/crm/activities/activities.repository.ts:46](../../backend/src/modules/crm/activities/activities.repository.ts#L46) `lead`; [backend/src/modules/automation/workflows/workflows.repository.ts:21](../../backend/src/modules/automation/workflows/workflows.repository.ts#L21) `leads`; [backend/src/modules/automation/triggers/triggers.service.ts:4](../../backend/src/modules/automation/triggers/triggers.service.ts#L4) `lead`; [backend/src/modules/administration/product-interests/product-interests.repository.ts:12](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L12) `lead`
- Search matches across repository: 3531 in 421 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:17](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L17); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:50](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L50); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:81](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L81); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:123](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L123); [backend/src/modules/notifications/notification-events.service.ts:39](../../backend/src/modules/notifications/notification-events.service.ts#L39); [backend/src/modules/notifications/notification-events.service.ts:58](../../backend/src/modules/notifications/notification-events.service.ts#L58); [backend/src/modules/notifications/notification-events.service.ts:77](../../backend/src/modules/notifications/notification-events.service.ts#L77); [backend/src/modules/marketing/campaigns/audiences.service.ts:70](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L70); [backend/src/modules/automation/workflows/workflows.repository.ts:18](../../backend/src/modules/automation/workflows/workflows.repository.ts#L18); [backend/src/modules/automation/workflows/workflows.repository.ts:120](../../backend/src/modules/automation/workflows/workflows.repository.ts#L120); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:84](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L84)
- Normalization assessment: companyName may be unlinked intake text; contactId is conversion trace; products compatibility. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| productsNormalized | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterestOther | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| creationKey | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @default(now()) @updatedAt | 0 | KEEP — lifecycle time or actor provenance |
| companyName | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| address | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| firstName | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| lastName | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| phone | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| email | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| description | String? | @db.Text | 0 | KEEP — attribute owned by this row; not a separate entity |
| website | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| productInterest | String[] | @default([]) | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| productInterestIds | String[] | @default([]) | 0 | HIDDEN RELATIONSHIP — NORMALIZED: Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| source | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| assignedUserId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| status | String | @default("Warm") | 0 | KEEP — attribute owned by this row; not a separate entity |
| accountId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| createdById | String? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| updatedById | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| lastStatusChangedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| lastMeaningfulInboundAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| firstUnansweredOutboundAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| engagementEvaluatedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| deletedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| deletedBy | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| contactId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| convertedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| convertedById | String? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Lead_accountId_fkey; validated=true
FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Lead_assignedUserId_fkey; validated=true
FOREIGN KEY ("assignedUserId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Lead_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Lead_convertedById_fkey; validated=true
FOREIGN KEY ("convertedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Lead_createdById_fkey; validated=true
FOREIGN KEY ("createdById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Lead_pkey; validated=true
PRIMARY KEY (id)
-- Lead_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Lead_updatedById_fkey; validated=true
FOREIGN KEY ("updatedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
CREATE UNIQUE INDEX "Lead_id_tenantId_key" ON public."Lead" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Lead_pkey" ON public."Lead" USING btree (id);
CREATE INDEX "Lead_tenantId_accountId_idx" ON public."Lead" USING btree ("tenantId", "accountId");
CREATE INDEX "Lead_tenantId_assignedUserId_idx" ON public."Lead" USING btree ("tenantId", "assignedUserId");
CREATE INDEX "Lead_tenantId_contactId_idx" ON public."Lead" USING btree ("tenantId", "contactId");
CREATE INDEX "Lead_tenantId_convertedAt_isArchived_idx" ON public."Lead" USING btree ("tenantId", "convertedAt", "isArchived");
CREATE INDEX "Lead_tenantId_createdAt_idx" ON public."Lead" USING btree ("tenantId", "createdAt");
CREATE INDEX "Lead_tenantId_createdById_idx" ON public."Lead" USING btree ("tenantId", "createdById");
CREATE UNIQUE INDEX "Lead_tenantId_creationKey_key" ON public."Lead" USING btree ("tenantId", "creationKey");
CREATE INDEX "Lead_tenantId_email_idx" ON public."Lead" USING btree ("tenantId", email);
CREATE INDEX "Lead_tenantId_idx" ON public."Lead" USING btree ("tenantId");
CREATE INDEX "Lead_tenantId_status_idx" ON public."Lead" USING btree ("tenantId", status);
```

</details>

### LeadDeal

Many-to-many opportunity lead participation. Category B. Composite endpoint FKs; keep addedBy, role and addedAt provenance

- Initial audit rows: **18**; immediately before cleanup: **18**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): addedAt=2026-10-05T01:27:31.173Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "LeadDeal_leadId_dealId_key" ON public."LeadDeal" USING btree ("leadId", "dealId")`; `CREATE UNIQUE INDEX "LeadDeal_pkey" ON public."LeadDeal" USING btree (id)`.
- Parent relations: lead: Lead (@relation(fields: [leadId, tenantId], references: [id, tenantId], onDelete: Cascade)); deal: Deal (@relation(fields: [dealId, tenantId], references: [id, tenantId], onDelete: Cascade)); tenant: Tenant (@relation(fields: [tenantId], references: [id])); addedBy: User? (@relation(fields: [addedById], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/relationships/relationships.service.ts:35](../../backend/src/modules/crm/relationships/relationships.service.ts#L35); [backend/src/modules/crm/relationships/relationships.service.ts:196](../../backend/src/modules/crm/relationships/relationships.service.ts#L196); [backend/src/modules/crm/merge/merge.repository.ts:13](../../backend/src/modules/crm/merge/merge.repository.ts#L13); [backend/src/modules/crm/merge/merge.repository.ts:66](../../backend/src/modules/crm/merge/merge.repository.ts#L66); [backend/src/modules/crm/merge/merge.repository.ts:72](../../backend/src/modules/crm/merge/merge.repository.ts#L72); [backend/src/modules/crm/deals/won-conversion.service.ts:10](../../backend/src/modules/crm/deals/won-conversion.service.ts#L10); [backend/src/modules/crm/deals/deals.service.ts:302](../../backend/src/modules/crm/deals/deals.service.ts#L302); [backend/src/modules/crm/deals/deals.repository.ts:249](../../backend/src/modules/crm/deals/deals.repository.ts#L249); [backend/src/modules/crm/deals/deals.repository.ts:408](../../backend/src/modules/crm/deals/deals.repository.ts#L408)
- Direct runtime-source write sites: [backend/src/modules/crm/merge/merge.repository.ts:81](../../backend/src/modules/crm/merge/merge.repository.ts#L81); [backend/src/modules/crm/merge/merge.repository.ts:84](../../backend/src/modules/crm/merge/merge.repository.ts#L84); [backend/src/modules/crm/leads/lead-automation.service.ts:85](../../backend/src/modules/crm/leads/lead-automation.service.ts#L85); [backend/src/modules/crm/deals/deals.service.ts:304](../../backend/src/modules/crm/deals/deals.service.ts#L304); [backend/src/modules/crm/deals/deals.repository.ts:117](../../backend/src/modules/crm/deals/deals.repository.ts#L117); [backend/src/modules/crm/deals/deals.repository.ts:418](../../backend/src/modules/crm/deals/deals.repository.ts#L418); [backend/src/modules/crm/deals/deals.repository.ts:438](../../backend/src/modules/crm/deals/deals.repository.ts#L438); [backend/src/modules/crm/deals/deals.repository.ts:444](../../backend/src/modules/crm/deals/deals.repository.ts#L444)
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:70](../../backend/src/modules/operations/tasks/tasks.repository.ts#L70) `leadDeals`; [backend/src/modules/marketing/forms/public-forms.service.ts:86](../../backend/src/modules/marketing/forms/public-forms.service.ts#L86) `leadDeals`; [backend/src/modules/crm/leads/lead-conversion.service.ts:12](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L12) `leadDeals`; [backend/src/modules/crm/leads/lead-automation.service.ts:77](../../backend/src/modules/crm/leads/lead-automation.service.ts#L77) `leadDeals`; [backend/src/modules/crm/engagement.service.ts:12](../../backend/src/modules/crm/engagement.service.ts#L12) `leadDeals`; [backend/src/modules/crm/deals/deals.service.ts:268](../../backend/src/modules/crm/deals/deals.service.ts#L268) `leadDeals`; [backend/src/modules/crm/deals/deals.repository.ts:31](../../backend/src/modules/crm/deals/deals.repository.ts#L31) `leadDeals`; [backend/src/modules/crm/contacts/contacts.service.ts:131](../../backend/src/modules/crm/contacts/contacts.service.ts#L131) `leadDeals`; [backend/src/modules/automation/workflows/workflows.repository.ts:124](../../backend/src/modules/automation/workflows/workflows.repository.ts#L124) `leadDeals`; [backend/src/modules/administration/product-interests/product-interests.repository.ts:12](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L12) `leadDeals`
- Search matches across repository: 162 in 53 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Missing tenant equality between both endpoints. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| leadId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| dealId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| role | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| addedById | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| addedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- LeadDeal_addedById_fkey; validated=true
FOREIGN KEY ("addedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- LeadDeal_dealId_fkey; validated=true
FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- LeadDeal_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- LeadDeal_pkey; validated=true
PRIMARY KEY (id)
-- LeadDeal_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "LeadDeal_dealId_tenantId_idx" ON public."LeadDeal" USING btree ("dealId", "tenantId");
CREATE UNIQUE INDEX "LeadDeal_leadId_dealId_key" ON public."LeadDeal" USING btree ("leadId", "dealId");
CREATE INDEX "LeadDeal_leadId_tenantId_idx" ON public."LeadDeal" USING btree ("leadId", "tenantId");
CREATE UNIQUE INDEX "LeadDeal_pkey" ON public."LeadDeal" USING btree (id);
CREATE INDEX "LeadDeal_tenantId_idx" ON public."LeadDeal" USING btree ("tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- LeadDeal_addedById_fkey; validated=true
FOREIGN KEY ("addedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- LeadDeal_dealId_tenantId_fkey; validated=true
FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- LeadDeal_leadId_tenantId_fkey; validated=true
FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- LeadDeal_pkey; validated=true
PRIMARY KEY (id)
-- LeadDeal_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "LeadDeal_dealId_tenantId_idx" ON public."LeadDeal" USING btree ("dealId", "tenantId");
CREATE UNIQUE INDEX "LeadDeal_leadId_dealId_key" ON public."LeadDeal" USING btree ("leadId", "dealId");
CREATE INDEX "LeadDeal_leadId_tenantId_idx" ON public."LeadDeal" USING btree ("leadId", "tenantId");
CREATE UNIQUE INDEX "LeadDeal_pkey" ON public."LeadDeal" USING btree (id);
CREATE INDEX "LeadDeal_tenantId_idx" ON public."LeadDeal" USING btree ("tenantId");
```

</details>

### LeadProductInterest

Ordered lead product selections. Category B. Keep existing normalized junction

- Initial audit rows: **19**; immediately before cleanup: **19**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("leadId", "productInterestId").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "LeadProductInterest_pkey" ON public."LeadProductInterest" USING btree ("leadId", "productInterestId")`.
- Parent relations: lead: Lead (@relation(fields: [leadId, tenantId], references: [id, tenantId], onDelete: Cascade)); product: ProductInterest (@relation(fields: [productInterestId, tenantId], references: [id, tenantId], onDelete: Restrict)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:32](../../backend/src/modules/operations/tasks/tasks.repository.ts#L32) `leadLinks`; [backend/src/modules/marketing/campaigns/audiences.service.ts:45](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L45) `productLinks`
- Search matches across repository: 13 in 6 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Nested writes through productRelationData are active. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| leadId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| productInterestId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- LeadProductInterest_leadId_tenantId_fkey; validated=true
FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- LeadProductInterest_pkey; validated=true
PRIMARY KEY ("leadId", "productInterestId")
-- LeadProductInterest_productInterestId_tenantId_fkey; validated=true
FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "LeadProductInterest_pkey" ON public."LeadProductInterest" USING btree ("leadId", "productInterestId");
CREATE INDEX "LeadProductInterest_tenantId_productInterestId_idx" ON public."LeadProductInterest" USING btree ("tenantId", "productInterestId");
```

</details>

### MailboxMessage

Gmail ingestion and CRM engagement state. Category E. Composite account FK; keep captured per-message context; normalize current thread association into its own table

- Initial audit rows: **1830**; immediately before cleanup: **1830**; after cleanup: **0**; final live rows: **683**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): sentAt=2026-10-05T06:30:47.000Z; createdAt=2026-10-05T06:34:17.202Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "MailboxMessage_accountId_providerMessageId_key" ON public."MailboxMessage" USING btree ("accountId", "providerMessageId")`; `CREATE UNIQUE INDEX "MailboxMessage_pkey" ON public."MailboxMessage" USING btree (id)`.
- Parent relations: account: EmailAccount (@relation(fields: [accountId, tenantId], references: [id, tenantId], onDelete: Restrict)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-sync.service.ts:36](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L36); [backend/src/integrations/gmail/mailbox-sync.service.ts:65](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L65); [backend/src/integrations/gmail/mailbox-sync.service.ts:121](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L121); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:38](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L38); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:53](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L53); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:118](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L118); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:126](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L126); [backend/src/modules/notifications/notification-events.service.ts:75](../../backend/src/modules/notifications/notification-events.service.ts#L75); [backend/src/modules/crm/activities/activities.repository.ts:88](../../backend/src/modules/crm/activities/activities.repository.ts#L88)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:40](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L40); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:74](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L74)
- Possible nested relation access (review with parent): [backend/src/integrations/gmail/mailbox-sync.service.ts:123](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L123) `messages`; [backend/src/integrations/gmail/mailbox-ingestion.service.ts:27](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L27) `messages`
- Search matches across repository: 51 in 24 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-sync.service.ts:36](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L36); [backend/src/integrations/gmail/mailbox-sync.service.ts:65](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L65); [backend/src/integrations/gmail/mailbox-sync.service.ts:121](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L121); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:38](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L38); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:53](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L53); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:118](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L118); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:126](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L126); [backend/src/modules/notifications/notification-events.service.ts:75](../../backend/src/modules/notifications/notification-events.service.ts#L75); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:40](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L40); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:74](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L74)
- Normalization assessment: Account scope needs enforcement; nullable CRM context retained through conversion/history. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| accountId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| providerMessageId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| threadId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| direction | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| from | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| recipients | String[] | No explicit default; required | 0 | KEEP: Captured email addresses for one provider message, not CRM person IDs. |
| subject | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| body | String | @db.Text | 0 | KEEP — attribute owned by this row; not a separate entity |
| snippet | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| labels | String[] | No explicit default; required | 0 | KEEP: Provider-defined message labels. |
| sentAt | DateTime | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |
| rfcMessageId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| leadId | String? | No explicit default; nullable | 683 | KEEP — relationship or historical/provider identity; see declared parents |
| contactId | String? | No explicit default; nullable | 683 | KEEP — relationship or historical/provider identity; see declared parents |
| dealId | String? | No explicit default; nullable | 683 | KEEP — relationship or historical/provider identity; see declared parents |
| meaningful | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| readyToClose | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| engagementRuleVersion | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| needsDealAssociation | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- MailboxMessage_accountId_fkey; validated=true
FOREIGN KEY ("accountId") REFERENCES "EmailAccount"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- MailboxMessage_direction_check; validated=true
CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text, 'unknown'::text])))
-- MailboxMessage_pkey; validated=true
PRIMARY KEY (id)
CREATE UNIQUE INDEX "MailboxMessage_accountId_providerMessageId_key" ON public."MailboxMessage" USING btree ("accountId", "providerMessageId");
CREATE UNIQUE INDEX "MailboxMessage_pkey" ON public."MailboxMessage" USING btree (id);
CREATE INDEX "MailboxMessage_tenantId_accountId_threadId_sentAt_idx" ON public."MailboxMessage" USING btree ("tenantId", "accountId", "threadId", "sentAt");
CREATE INDEX "MailboxMessage_tenantId_contactId_sentAt_idx" ON public."MailboxMessage" USING btree ("tenantId", "contactId", "sentAt");
CREATE INDEX "MailboxMessage_tenantId_leadId_sentAt_idx" ON public."MailboxMessage" USING btree ("tenantId", "leadId", "sentAt");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- MailboxMessage_accountId_tenantId_fkey; validated=true
FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- MailboxMessage_direction_check; validated=true
CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text, 'unknown'::text])))
-- MailboxMessage_pkey; validated=true
PRIMARY KEY (id)
CREATE UNIQUE INDEX "MailboxMessage_accountId_providerMessageId_key" ON public."MailboxMessage" USING btree ("accountId", "providerMessageId");
CREATE UNIQUE INDEX "MailboxMessage_pkey" ON public."MailboxMessage" USING btree (id);
CREATE INDEX "MailboxMessage_tenantId_accountId_threadId_sentAt_idx" ON public."MailboxMessage" USING btree ("tenantId", "accountId", "threadId", "sentAt");
CREATE INDEX "MailboxMessage_tenantId_contactId_sentAt_idx" ON public."MailboxMessage" USING btree ("tenantId", "contactId", "sentAt");
CREATE INDEX "MailboxMessage_tenantId_leadId_sentAt_idx" ON public."MailboxMessage" USING btree ("tenantId", "leadId", "sentAt");
```

</details>

### MailboxOAuthState

Short-lived session-bound OAuth challenge. Category D. Keep isolated secrets and expiry index; do not combine with sessions or inbox

- Initial audit rows: **0**; immediately before cleanup: **0**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): expiresAt=NULL
- Primary key: PRIMARY KEY ("stateHash").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "MailboxOAuthState_pkey" ON public."MailboxOAuthState" USING btree ("stateHash")`.
- Parent relations: No declared Prisma parent relation.
- Children: None declared.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-auth.service.ts:26](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L26)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-auth.service.ts:18](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L18); [backend/src/integrations/gmail/mailbox-auth.service.ts:19](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L19); [backend/src/integrations/gmail/mailbox-auth.service.ts:29](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L29)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 22 in 14 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-auth.service.ts:26](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L26); [backend/src/integrations/gmail/mailbox-auth.service.ts:18](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L18); [backend/src/integrations/gmail/mailbox-auth.service.ts:19](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L19); [backend/src/integrations/gmail/mailbox-auth.service.ts:29](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L29)
- Normalization assessment: Hash/session/user references validated by OAuth flow, no DB FK. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| stateHash | String | @id | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| sessionHash | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| verifier | String | No explicit default; required | 0 | KEEP — security credential/state |
| expiresAt | DateTime | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- MailboxOAuthState_pkey; validated=true
PRIMARY KEY ("stateHash")
CREATE INDEX "MailboxOAuthState_expiresAt_idx" ON public."MailboxOAuthState" USING btree ("expiresAt");
CREATE UNIQUE INDEX "MailboxOAuthState_pkey" ON public."MailboxOAuthState" USING btree ("stateHash");
```

</details>

### MailboxThreadAssociation

Current Deal association of a provider thread within one mailbox. Category B. Replace mailbox-thread preference rows with account/thread primary key and tenant-safe account/Deal FKs

- Initial audit rows: **unavailable**; immediately before cleanup: **unavailable**; after cleanup: **not executed**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("accountId", "threadId").
- Unique constraints/indexes: None beyond primary key.
- Parent relations: account: EmailAccount (@relation(fields: [accountId, tenantId], references: [id, tenantId], onDelete: Restrict)); deal: Deal (@relation(fields: [dealId, tenantId], references: [id, tenantId], onDelete: Restrict)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-sync.service.ts:73](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L73); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:60](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L60)
- Direct runtime-source write sites: [backend/src/integrations/gmail/mailbox-sync.service.ts:76](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L76)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 40 in 15 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-sync.service.ts:73](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L73); [backend/src/integrations/gmail/mailbox-ingestion.service.ts:60](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L60); [backend/src/integrations/gmail/mailbox-sync.service.ts:76](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L76)
- Normalization assessment: Preference JSON previously stored a mutable relational Deal ID without FK. Final action: **REPLACE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| accountId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| threadId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| dealId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| linkedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql


```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- MailboxThreadAssociation_accountId_tenantId_fkey; validated=true
FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- MailboxThreadAssociation_dealId_tenantId_fkey; validated=true
FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- MailboxThreadAssociation_pkey; validated=true
PRIMARY KEY ("accountId", "threadId")
CREATE UNIQUE INDEX "MailboxThreadAssociation_pkey" ON public."MailboxThreadAssociation" USING btree ("accountId", "threadId");
CREATE INDEX "MailboxThreadAssociation_tenantId_dealId_idx" ON public."MailboxThreadAssociation" USING btree ("tenantId", "dealId");
```

</details>

### MarketingForm

Draft and published form definition. Category F. Keep definition and immutable published config snapshots

- Initial audit rows: **5**; immediately before cleanup: **5**; after cleanup: **0**; final live rows: **1**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): publishedAt=2026-09-27T11:20:19.121Z; createdAt=2026-10-04T15:33:11.285Z; updatedAt=2026-10-04T15:33:11.285Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "MarketingForm_pkey" ON public."MarketingForm" USING btree (id)`; `CREATE UNIQUE INDEX "MarketingForm_publicId_key" ON public."MarketingForm" USING btree ("publicId")`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); createdBy: User (@relation(fields: [createdById], references: [id])).
- Children: FormSubmission.form.
- Direct runtime-source read sites: [backend/src/modules/marketing/forms/public-forms.service.ts:20](../../backend/src/modules/marketing/forms/public-forms.service.ts#L20); [backend/src/modules/marketing/forms/public-forms.service.ts:30](../../backend/src/modules/marketing/forms/public-forms.service.ts#L30); [backend/src/modules/marketing/forms/public-forms.service.ts:39](../../backend/src/modules/marketing/forms/public-forms.service.ts#L39); [backend/src/modules/marketing/forms/forms.repository.ts:9](../../backend/src/modules/marketing/forms/forms.repository.ts#L9); [backend/src/modules/marketing/forms/forms.repository.ts:12](../../backend/src/modules/marketing/forms/forms.repository.ts#L12); [backend/src/modules/marketing/forms/forms.repository.ts:18](../../backend/src/modules/marketing/forms/forms.repository.ts#L18); [backend/src/modules/marketing/forms/forms.repository.ts:23](../../backend/src/modules/marketing/forms/forms.repository.ts#L23); [backend/src/modules/marketing/forms/forms.repository.ts:28](../../backend/src/modules/marketing/forms/forms.repository.ts#L28); [backend/src/modules/marketing/forms/forms.repository.ts:34](../../backend/src/modules/marketing/forms/forms.repository.ts#L34); [backend/src/modules/marketing/forms/forms.repository.ts:40](../../backend/src/modules/marketing/forms/forms.repository.ts#L40); [backend/src/modules/marketing/forms/forms.repository.ts:59](../../backend/src/modules/marketing/forms/forms.repository.ts#L59); [backend/src/modules/marketing/forms/forms.repository.ts:68](../../backend/src/modules/marketing/forms/forms.repository.ts#L68)
- Direct runtime-source write sites: [backend/src/modules/marketing/forms/forms.repository.ts:14](../../backend/src/modules/marketing/forms/forms.repository.ts#L14); [backend/src/modules/marketing/forms/forms.repository.ts:21](../../backend/src/modules/marketing/forms/forms.repository.ts#L21); [backend/src/modules/marketing/forms/forms.repository.ts:32](../../backend/src/modules/marketing/forms/forms.repository.ts#L32); [backend/src/modules/marketing/forms/forms.repository.ts:44](../../backend/src/modules/marketing/forms/forms.repository.ts#L44); [backend/src/modules/marketing/forms/forms.repository.ts:51](../../backend/src/modules/marketing/forms/forms.repository.ts#L51); [backend/src/modules/marketing/forms/forms.repository.ts:57](../../backend/src/modules/marketing/forms/forms.repository.ts#L57); [backend/src/modules/marketing/forms/forms.repository.ts:65](../../backend/src/modules/marketing/forms/forms.repository.ts#L65)
- Possible nested relation access (review with parent): [backend/src/modules/marketing/forms/public-forms.service.ts:135](../../backend/src/modules/marketing/forms/public-forms.service.ts#L135) `form`
- Search matches across repository: 63 in 21 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Draft/published JSON are intentionally different versions. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| publicId | String | @unique @default(uuid()) | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| revision | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| publishedRevision | Int? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| publishedVersion | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| publishedConfig | Json? | No explicit default; nullable | 1 | KEEP: Published definition snapshot differs intentionally from editable draft. |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| createdById | String | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| status | String | @default("draft")   // "draft" \| "published" | 0 | KEEP — attribute owned by this row; not a separate entity |
| fields | Json | @default("[]")       // FormField[] | 0 | KEEP: Typed flexible builder configuration; individual submissions use FormSubmission. |
| design | Json | @default("{}")       // FormDesign | 0 | KEEP: Typed flexible builder configuration; individual submissions use FormSubmission. |
| settings | Json | @default("{}")       // FormSettings | 0 | KEEP: Typed flexible builder configuration; individual submissions use FormSubmission. |
| publishedAt | DateTime? | No explicit default; nullable | 1 | KEEP — lifecycle time or actor provenance |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- MarketingForm_createdById_fkey; validated=true
FOREIGN KEY ("createdById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- MarketingForm_pkey; validated=true
PRIMARY KEY (id)
-- MarketingForm_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "MarketingForm_pkey" ON public."MarketingForm" USING btree (id);
CREATE UNIQUE INDEX "MarketingForm_publicId_key" ON public."MarketingForm" USING btree ("publicId");
CREATE INDEX "MarketingForm_tenantId_idx" ON public."MarketingForm" USING btree ("tenantId");
CREATE INDEX "MarketingForm_tenantId_isArchived_createdAt_idx" ON public."MarketingForm" USING btree ("tenantId", "isArchived", "createdAt");
CREATE INDEX "MarketingForm_tenantId_status_idx" ON public."MarketingForm" USING btree ("tenantId", status);
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- MarketingForm_createdById_fkey; validated=true
FOREIGN KEY ("createdById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- MarketingForm_pkey; validated=true
PRIMARY KEY (id)
-- MarketingForm_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "MarketingForm_id_tenantId_key" ON public."MarketingForm" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "MarketingForm_pkey" ON public."MarketingForm" USING btree (id);
CREATE UNIQUE INDEX "MarketingForm_publicId_key" ON public."MarketingForm" USING btree ("publicId");
CREATE INDEX "MarketingForm_tenantId_idx" ON public."MarketingForm" USING btree ("tenantId");
CREATE INDEX "MarketingForm_tenantId_isArchived_createdAt_idx" ON public."MarketingForm" USING btree ("tenantId", "isArchived", "createdAt");
CREATE INDEX "MarketingForm_tenantId_status_idx" ON public."MarketingForm" USING btree ("tenantId", status);
```

</details>

### Notification

Recipient-specific inbox event and read state. Category C. Keep unique tenant/user/eventKey; composite recipient FK; do not replace with audit

- Initial audit rows: **54**; immediately before cleanup: **54**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): readAt=2026-10-05T01:31:54.984Z; createdAt=2026-10-05T01:56:03.945Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Notification_pkey" ON public."Notification" USING btree (id)`; `CREATE UNIQUE INDEX "Notification_tenantId_userId_eventKey_key" ON public."Notification" USING btree ("tenantId", "userId", "eventKey")`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); user: User (@relation(fields: [userId, tenantId], references: [id, tenantId], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/notifications/notifications.repository.ts:19](../../backend/src/modules/notifications/notifications.repository.ts#L19); [backend/src/modules/notifications/notifications.repository.ts:25](../../backend/src/modules/notifications/notifications.repository.ts#L25); [backend/src/modules/notifications/notifications.repository.ts:26](../../backend/src/modules/notifications/notifications.repository.ts#L26); [backend/src/modules/notifications/notifications.repository.ts:27](../../backend/src/modules/notifications/notifications.repository.ts#L27); [backend/src/modules/notifications/notifications.repository.ts:35](../../backend/src/modules/notifications/notifications.repository.ts#L35); [backend/src/modules/notifications/notifications.repository.ts:36](../../backend/src/modules/notifications/notifications.repository.ts#L36)
- Direct runtime-source write sites: [backend/src/modules/notifications/notifications.service.ts:38](../../backend/src/modules/notifications/notifications.service.ts#L38); [backend/src/modules/notifications/notifications.service.ts:42](../../backend/src/modules/notifications/notifications.service.ts#L42); [backend/src/modules/notifications/notifications.repository.ts:43](../../backend/src/modules/notifications/notifications.repository.ts#L43); [backend/src/modules/notifications/notifications.repository.ts:53](../../backend/src/modules/notifications/notifications.repository.ts#L53); [backend/src/modules/notifications/notifications.repository.ts:63](../../backend/src/modules/notifications/notifications.repository.ts#L63)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 254 in 82 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notifications.repository.ts:19](../../backend/src/modules/notifications/notifications.repository.ts#L19); [backend/src/modules/notifications/notifications.repository.ts:25](../../backend/src/modules/notifications/notifications.repository.ts#L25); [backend/src/modules/notifications/notifications.repository.ts:26](../../backend/src/modules/notifications/notifications.repository.ts#L26); [backend/src/modules/notifications/notifications.repository.ts:27](../../backend/src/modules/notifications/notifications.repository.ts#L27); [backend/src/modules/notifications/notifications.repository.ts:35](../../backend/src/modules/notifications/notifications.repository.ts#L35); [backend/src/modules/notifications/notifications.repository.ts:36](../../backend/src/modules/notifications/notifications.repository.ts#L36); [backend/src/modules/notifications/notifications.service.ts:38](../../backend/src/modules/notifications/notifications.service.ts#L38); [backend/src/modules/notifications/notifications.service.ts:42](../../backend/src/modules/notifications/notifications.service.ts#L42); [backend/src/modules/notifications/notifications.repository.ts:43](../../backend/src/modules/notifications/notifications.repository.ts#L43); [backend/src/modules/notifications/notifications.repository.ts:53](../../backend/src/modules/notifications/notifications.repository.ts#L53); [backend/src/modules/notifications/notifications.repository.ts:63](../../backend/src/modules/notifications/notifications.repository.ts#L63)
- Normalization assessment: Nullable eventKey allows non-idempotent ad hoc notices; recipient tenant should be enforced. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| type | String | // deal_assigned\|task_due\|campaign_sent\|workflow_failed\|deal_action\|... | 0 | KEEP — attribute owned by this row; not a separate entity |
| title | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| body | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| entityType | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| entityId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| eventKey | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| isRead | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| readAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Notification_pkey; validated=true
PRIMARY KEY (id)
-- Notification_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Notification_userId_fkey; validated=true
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "Notification_pkey" ON public."Notification" USING btree (id);
CREATE INDEX "Notification_tenantId_createdAt_idx" ON public."Notification" USING btree ("tenantId", "createdAt");
CREATE INDEX "Notification_tenantId_idx" ON public."Notification" USING btree ("tenantId");
CREATE UNIQUE INDEX "Notification_tenantId_userId_eventKey_key" ON public."Notification" USING btree ("tenantId", "userId", "eventKey");
CREATE INDEX "Notification_userId_tenantId_isRead_idx" ON public."Notification" USING btree ("userId", "tenantId", "isRead");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- Notification_pkey; validated=true
PRIMARY KEY (id)
-- Notification_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Notification_userId_tenantId_fkey; validated=true
FOREIGN KEY ("userId", "tenantId") REFERENCES "User"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "Notification_pkey" ON public."Notification" USING btree (id);
CREATE INDEX "Notification_tenantId_createdAt_idx" ON public."Notification" USING btree ("tenantId", "createdAt");
CREATE INDEX "Notification_tenantId_idx" ON public."Notification" USING btree ("tenantId");
CREATE UNIQUE INDEX "Notification_tenantId_userId_eventKey_key" ON public."Notification" USING btree ("tenantId", "userId", "eventKey");
CREATE INDEX "Notification_userId_tenantId_isRead_idx" ON public."Notification" USING btree ("userId", "tenantId", "isRead");
```

</details>

### PasswordResetToken

Active password recovery capability. Category D. Keep active flow; token hashing and nullable-user compatibility need dedicated expand/switch rollout

- Initial audit rows: **1**; immediately before cleanup: **1**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): expires=2026-09-26T11:39:20.674Z; createdAt=2026-09-26T10:39:20.675Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "PasswordResetToken_email_token_key" ON public."PasswordResetToken" USING btree (email, token)`; `CREATE UNIQUE INDEX "PasswordResetToken_pkey" ON public."PasswordResetToken" USING btree (id)`; `CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON public."PasswordResetToken" USING btree (token)`.
- Parent relations: No declared Prisma parent relation.
- Children: None declared.
- Direct runtime-source read sites: [backend/src/core/auth/password-reset.service.ts:52](../../backend/src/core/auth/password-reset.service.ts#L52)
- Direct runtime-source write sites: [backend/src/core/auth/password-reset.service.ts:27](../../backend/src/core/auth/password-reset.service.ts#L27); [backend/src/core/auth/password-reset.service.ts:32](../../backend/src/core/auth/password-reset.service.ts#L32); [backend/src/core/auth/password-reset.service.ts:61](../../backend/src/core/auth/password-reset.service.ts#L61); [backend/src/core/auth/password-reset.service.ts:82](../../backend/src/core/auth/password-reset.service.ts#L82); [backend/src/core/auth/change-password.service.ts:24](../../backend/src/core/auth/change-password.service.ts#L24)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 36 in 22 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Optional userId lacks FK; email is captured identity guard; token is currently plaintext. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| userId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| email | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| token | String | @unique | 0 | KEEP — security credential/state |
| expires | DateTime | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- PasswordResetToken_pkey; validated=true
PRIMARY KEY (id)
CREATE UNIQUE INDEX "PasswordResetToken_email_token_key" ON public."PasswordResetToken" USING btree (email, token);
CREATE UNIQUE INDEX "PasswordResetToken_pkey" ON public."PasswordResetToken" USING btree (id);
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON public."PasswordResetToken" USING btree (token);
```

</details>

### Pipeline

Tenant sales pipeline. Category F. Keep; enforce parent scope for stages

- Initial audit rows: **23**; immediately before cleanup: **23**; after cleanup: **0**; final live rows: **1**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-09-25T12:24:23.119Z; updatedAt=2026-09-28T01:41:05.901Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Pipeline_pkey" ON public."Pipeline" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: Stage.pipeline; Deal.pipeline.
- Direct runtime-source read sites: [backend/src/modules/reporting/reports/reports.service.ts:5](../../backend/src/modules/reporting/reports/reports.service.ts#L5); [backend/src/modules/crm/pipeline/pipeline.repository.ts:8](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L8); [backend/src/modules/crm/pipeline/pipeline.repository.ts:21](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L21); [backend/src/modules/crm/pipeline/pipeline.repository.ts:45](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L45); [backend/src/modules/crm/pipeline/pipeline.repository.ts:56](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L56); [backend/src/modules/crm/pipeline/pipeline.repository.ts:100](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L100); [backend/src/modules/crm/pipeline/pipeline.repository.ts:111](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L111); [backend/src/modules/crm/leads/lead-automation.service.ts:53](../../backend/src/modules/crm/leads/lead-automation.service.ts#L53); [backend/src/modules/crm/imports/import-rows.service.ts:56](../../backend/src/modules/crm/imports/import-rows.service.ts#L56); [backend/src/modules/crm/deals/forecast.service.ts:33](../../backend/src/modules/crm/deals/forecast.service.ts#L33); [backend/src/modules/automation/workflows/workflows.repository.ts:13](../../backend/src/modules/automation/workflows/workflows.repository.ts#L13); [backend/src/modules/automation/actions/actions.repository.ts:9](../../backend/src/modules/automation/actions/actions.repository.ts#L9); [backend/src/modules/administration/archived-data/archived-data.service.ts:56](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L56)
- Direct runtime-source write sites: [backend/src/modules/crm/pipeline/pipeline.repository.ts:33](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L33); [backend/src/modules/crm/pipeline/pipeline.repository.ts:38](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L38); [backend/src/modules/crm/pipeline/pipeline.repository.ts:51](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L51); [backend/src/modules/crm/leads/lead-automation.service.ts:54](../../backend/src/modules/crm/leads/lead-automation.service.ts#L54); [backend/src/modules/crm/leads/lead-automation.service.ts:55](../../backend/src/modules/crm/leads/lead-automation.service.ts#L55); [backend/src/modules/administration/archived-data/archived-data.service.ts:111](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L111)
- Possible nested relation access (review with parent): [backend/src/modules/crm/deals/forecast.service.ts:24](../../backend/src/modules/crm/deals/forecast.service.ts#L24) `pipeline`; [backend/src/modules/crm/deals/deals.service.ts:267](../../backend/src/modules/crm/deals/deals.service.ts#L267) `pipeline`; [backend/src/modules/crm/deals/deals.repository.ts:51](../../backend/src/modules/crm/deals/deals.repository.ts#L51) `pipeline`; [backend/src/modules/automation/actions/actions.repository.ts:18](../../backend/src/modules/automation/actions/actions.repository.ts#L18) `pipeline`
- Search matches across repository: 1461 in 272 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/automation/workflows/workflows.repository.ts:13](../../backend/src/modules/automation/workflows/workflows.repository.ts#L13)
- Normalization assessment: Stage tenant depends on pipeline; currency is configurable pipeline default. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| type | String? | // e.g. "Sales" \| "Service" \| "Onboarding" | 0 | KEEP — attribute owned by this row; not a separate entity |
| templateKey | String? | // identifies seeded templates for upgrades (e.g. "sales-inquiries") | 1 | KEEP — attribute owned by this row; not a separate entity |
| isDefault | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| currency | String? | @default("PHP") | 0 | KEEP — attribute owned by this row; not a separate entity |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Pipeline_pkey; validated=true
PRIMARY KEY (id)
-- Pipeline_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Pipeline_pkey" ON public."Pipeline" USING btree (id);
CREATE INDEX "Pipeline_tenantId_idx" ON public."Pipeline" USING btree ("tenantId");
CREATE INDEX "Pipeline_tenantId_isArchived_idx" ON public."Pipeline" USING btree ("tenantId", "isArchived");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- Pipeline_pkey; validated=true
PRIMARY KEY (id)
-- Pipeline_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Pipeline_id_tenantId_key" ON public."Pipeline" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Pipeline_pkey" ON public."Pipeline" USING btree (id);
CREATE INDEX "Pipeline_tenantId_idx" ON public."Pipeline" USING btree ("tenantId");
CREATE INDEX "Pipeline_tenantId_isArchived_idx" ON public."Pipeline" USING btree ("tenantId", "isArchived");
```

</details>

### ProductInterest

Product catalog current defaults. Category A. Keep existing product behavior; outside this normalization change

- Initial audit rows: **276**; immediately before cleanup: **276**; after cleanup: **0**; final live rows: **10**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-09-29T16:16:11.077Z; updatedAt=2026-10-05T06:22:02.735Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "ProductInterest_active_name_key" ON public."ProductInterest" USING btree ("tenantId", lower((name)::text)) WHERE active`; `CREATE UNIQUE INDEX "ProductInterest_id_tenantId_key" ON public."ProductInterest" USING btree (id, "tenantId")`; `CREATE UNIQUE INDEX "ProductInterest_pkey" ON public."ProductInterest" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id], onDelete: Cascade)).
- Children: Deal.productInterestRecord; LeadProductInterest.product; ContactProductInterest.product; AccountProductInterest.product.
- Direct runtime-source read sites: [backend/src/modules/crm/leads/product-snapshots.ts:12](../../backend/src/modules/crm/leads/product-snapshots.ts#L12); [backend/src/modules/crm/leads/product-relations.ts:14](../../backend/src/modules/crm/leads/product-relations.ts#L14); [backend/src/modules/crm/leads/lead-automation.service.ts:22](../../backend/src/modules/crm/leads/lead-automation.service.ts#L22); [backend/src/modules/crm/leads/lead-automation.service.ts:28](../../backend/src/modules/crm/leads/lead-automation.service.ts#L28); [backend/src/modules/crm/leads/lead-automation.service.ts:71](../../backend/src/modules/crm/leads/lead-automation.service.ts#L71); [backend/src/modules/crm/leads/lead-automation.service.ts:102](../../backend/src/modules/crm/leads/lead-automation.service.ts#L102); [backend/src/modules/crm/imports/import-rows.service.ts:23](../../backend/src/modules/crm/imports/import-rows.service.ts#L23); [backend/src/modules/crm/contacts/contacts.repository.ts:123](../../backend/src/modules/crm/contacts/contacts.repository.ts#L123); [backend/src/modules/automation/workflows/workflows.repository.ts:15](../../backend/src/modules/automation/workflows/workflows.repository.ts#L15); [backend/src/modules/automation/actions/action-fields.ts:40](../../backend/src/modules/automation/actions/action-fields.ts#L40); [backend/src/modules/administration/product-interests/product-interests.repository.ts:3](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L3); [backend/src/modules/administration/product-interests/product-interests.controller.ts:36](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L36); [backend/src/modules/administration/product-interests/product-interests.controller.ts:37](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L37); [backend/src/modules/administration/product-interests/product-interests.controller.ts:40](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L40)
- Direct runtime-source write sites: [backend/src/modules/administration/product-interests/product-interests.controller.ts:41](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L41); [backend/src/modules/administration/product-interests/product-interests.controller.ts:44](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L44); [backend/src/modules/administration/product-interests/product-interests.controller.ts:49](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L49); [backend/src/modules/administration/product-interests/product-interests.controller.ts:51](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L51)
- Possible nested relation access (review with parent): [backend/src/core/tenant/product-projections.ts:45](../../backend/src/core/tenant/product-projections.ts#L45) `product`; [backend/src/modules/marketing/campaigns/audiences.service.ts:45](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L45) `product`; [backend/src/modules/crm/imports/import-rows.service.ts:55](../../backend/src/modules/crm/imports/import-rows.service.ts#L55) `product`
- Search matches across repository: 408 in 112 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/automation/workflows/workflows.repository.ts:15](../../backend/src/modules/automation/workflows/workflows.repository.ts#L15)
- Normalization assessment: Previously normalized; deal value is intentionally historical. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | @db.VarChar(200) | 0 | KEEP — attribute owned by this row; not a separate entity |
| dealValue | Decimal | @db.Decimal(14, 2) | 0 | KEEP — attribute owned by this row; not a separate entity |
| active | Boolean | @default(true) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- ProductInterest_dealValue_check; validated=true
CHECK (("dealValue" >= (0)::numeric))
-- ProductInterest_pkey; validated=true
PRIMARY KEY (id)
-- ProductInterest_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "ProductInterest_active_name_key" ON public."ProductInterest" USING btree ("tenantId", lower((name)::text)) WHERE active;
CREATE UNIQUE INDEX "ProductInterest_id_tenantId_key" ON public."ProductInterest" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "ProductInterest_pkey" ON public."ProductInterest" USING btree (id);
CREATE INDEX "ProductInterest_tenantId_active_idx" ON public."ProductInterest" USING btree ("tenantId", active);
```

</details>

### RecordFile

Stored object metadata attached to CRM record. Category A. Keep storage ownership and exactly-one-record SQL constraint; never merge with audit

- Initial audit rows: **1**; immediately before cleanup: **1**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): uploadedAt=2026-09-29T04:39:58.896Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "RecordFile_objectKey_key" ON public."RecordFile" USING btree ("objectKey")`; `CREATE UNIQUE INDEX "RecordFile_pkey" ON public."RecordFile" USING btree (id)`.
- Parent relations: deal: Deal? (@relation(fields: [dealId, tenantId], references: [id, tenantId], onDelete: Cascade)); tenant: Tenant (@relation(fields: [tenantId], references: [id], onDelete: Restrict)); lead: Lead? (@relation(fields: [leadId, tenantId], references: [id, tenantId], onDelete: Cascade)); contact: Contact? (@relation(fields: [contactId, tenantId], references: [id, tenantId], onDelete: Cascade)); account: Account? (@relation(fields: [accountId, tenantId], references: [id, tenantId], onDelete: Cascade)); uploadedBy: User (@relation(fields: [uploadedById], references: [id], onDelete: Restrict)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/crm/record-files/record-files.service.ts:30](../../backend/src/modules/crm/record-files/record-files.service.ts#L30); [backend/src/modules/crm/record-files/record-files.service.ts:70](../../backend/src/modules/crm/record-files/record-files.service.ts#L70); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:45](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L45); [backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts:23](../../backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts#L23); [backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts:35](../../backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts#L35)
- Direct runtime-source write sites: [backend/src/modules/crm/record-files/record-files.service.ts:58](../../backend/src/modules/crm/record-files/record-files.service.ts#L58)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 64 in 23 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Composite record scope exists; uploadedBy scope and storage cleanup require separate lifecycle checks. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| dealId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| leadId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| contactId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| accountId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| uploadedById | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| size | Int | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| type | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| objectKey | String | @unique | 0 | KEEP — attribute owned by this row; not a separate entity |
| uploadedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- RecordFile_accountId_tenantId_fkey; validated=true
FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- RecordFile_contactId_tenantId_fkey; validated=true
FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- RecordFile_dealId_tenantId_fkey; validated=true
FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- RecordFile_leadId_tenantId_fkey; validated=true
FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- RecordFile_one_record; validated=true
CHECK ((num_nonnulls("leadId", "contactId", "accountId", "dealId") = 1))
-- RecordFile_pkey; validated=true
PRIMARY KEY (id)
-- RecordFile_size; validated=true
CHECK (((size > 0) AND (size <= 10485760)))
-- RecordFile_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- RecordFile_uploadedById_fkey; validated=true
FOREIGN KEY ("uploadedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "RecordFile_objectKey_key" ON public."RecordFile" USING btree ("objectKey");
CREATE UNIQUE INDEX "RecordFile_pkey" ON public."RecordFile" USING btree (id);
CREATE INDEX "RecordFile_tenantId_accountId_idx" ON public."RecordFile" USING btree ("tenantId", "accountId");
CREATE INDEX "RecordFile_tenantId_contactId_idx" ON public."RecordFile" USING btree ("tenantId", "contactId");
CREATE INDEX "RecordFile_tenantId_dealId_idx" ON public."RecordFile" USING btree ("tenantId", "dealId");
CREATE INDEX "RecordFile_tenantId_leadId_idx" ON public."RecordFile" USING btree ("tenantId", "leadId");
```

</details>

### RoleDefinition

Named tenant roles. Category D. Keep; add tenant reference key for assignments and permissions

- Initial audit rows: **49**; immediately before cleanup: **49**; after cleanup: **1**; final live rows: **1**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-03T05:54:45.120Z; updatedAt=2026-10-03T05:54:45.120Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "RoleDefinition_pkey" ON public."RoleDefinition" USING btree (id)`; `CREATE UNIQUE INDEX "RoleDefinition_tenantId_name_key" ON public."RoleDefinition" USING btree ("tenantId", name)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: RolePermission.role; UserRole.role.
- Direct runtime-source read sites: [backend/src/modules/administration/users/users.service.ts:62](../../backend/src/modules/administration/users/users.service.ts#L62); [backend/src/modules/administration/roles/roles.repository.ts:10](../../backend/src/modules/administration/roles/roles.repository.ts#L10); [backend/src/modules/administration/roles/roles.repository.ts:24](../../backend/src/modules/administration/roles/roles.repository.ts#L24); [backend/src/modules/administration/roles/roles.repository.ts:45](../../backend/src/modules/administration/roles/roles.repository.ts#L45); [backend/src/modules/administration/roles/roles.repository.ts:59](../../backend/src/modules/administration/roles/roles.repository.ts#L59); [backend/src/modules/administration/roles/roles.repository.ts:74](../../backend/src/modules/administration/roles/roles.repository.ts#L74); [backend/src/modules/administration/roles/roles.repository.ts:86](../../backend/src/modules/administration/roles/roles.repository.ts#L86); [backend/src/modules/administration/roles/roles.repository.ts:90](../../backend/src/modules/administration/roles/roles.repository.ts#L90); [backend/src/modules/administration/roles/roles.repository.ts:130](../../backend/src/modules/administration/roles/roles.repository.ts#L130); [backend/src/modules/administration/roles/roles.repository.ts:140](../../backend/src/modules/administration/roles/roles.repository.ts#L140); [backend/src/modules/administration/roles/roles.repository.ts:150](../../backend/src/modules/administration/roles/roles.repository.ts#L150); [backend/src/modules/administration/roles/roles.repository.ts:200](../../backend/src/modules/administration/roles/roles.repository.ts#L200); [backend/src/modules/administration/archived-data/archived-data.service.ts:58](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L58); [backend/src/modules/administration/archived-data/archived-data.service.ts:125](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L125)
- Direct runtime-source write sites: [backend/src/modules/administration/roles/roles.repository.ts:62](../../backend/src/modules/administration/roles/roles.repository.ts#L62); [backend/src/modules/administration/roles/roles.repository.ts:93](../../backend/src/modules/administration/roles/roles.repository.ts#L93); [backend/src/modules/administration/roles/roles.repository.ts:133](../../backend/src/modules/administration/roles/roles.repository.ts#L133); [backend/src/modules/administration/archived-data/archived-data.service.ts:128](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L128)
- Possible nested relation access (review with parent): [backend/src/integrations/gmail/mailbox-sync.service.ts:22](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L22) `role`; [backend/src/integrations/gmail/mailbox-auth.service.ts:36](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L36) `role`; [backend/src/core/permissions/permission.service.ts:7](../../backend/src/core/permissions/permission.service.ts#L7) `role`; [backend/src/core/auth/jwt.service.ts:8](../../backend/src/core/auth/jwt.service.ts#L8) `role`; [backend/src/modules/notifications/notification-events.service.ts:12](../../backend/src/modules/notifications/notification-events.service.ts#L12) `role`; [backend/src/modules/operations/tasks/tasks.repository.ts:197](../../backend/src/modules/operations/tasks/tasks.repository.ts#L197) `role`; [backend/src/modules/crm/leads/lead-automation.service.ts:34](../../backend/src/modules/crm/leads/lead-automation.service.ts#L34) `role`; [backend/src/modules/automation/actions/actions.repository.ts:6](../../backend/src/modules/automation/actions/actions.repository.ts#L6) `role`; [backend/src/modules/administration/users/users.service.ts:17](../../backend/src/modules/administration/users/users.service.ts#L17) `role`; [backend/src/modules/administration/users/users.repository.ts:9](../../backend/src/modules/administration/users/users.repository.ts#L9) `role`; [backend/src/modules/administration/roles/roles.service.ts:160](../../backend/src/modules/administration/roles/roles.service.ts#L160) `role`; [backend/src/modules/administration/roles/roles.repository.ts:35](../../backend/src/modules/administration/roles/roles.repository.ts#L35) `role`; [backend/src/modules/administration/groups/groups.repository.ts:22](../../backend/src/modules/administration/groups/groups.repository.ts#L22) `role`; [backend/src/modules/administration/archived-data/archived-data.service.ts:10](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L10) `role`
- Search matches across repository: 262 in 74 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Single-column child FKs do not enforce tenant equality. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| description | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| isSystemRole | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- RoleDefinition_no_active_guest; validated=true
CHECK (((lower(TRIM(BOTH FROM name)) <> 'guest'::text) OR ("isArchived" = true)))
-- RoleDefinition_pkey; validated=true
PRIMARY KEY (id)
-- RoleDefinition_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "RoleDefinition_pkey" ON public."RoleDefinition" USING btree (id);
CREATE INDEX "RoleDefinition_tenantId_isArchived_idx" ON public."RoleDefinition" USING btree ("tenantId", "isArchived");
CREATE UNIQUE INDEX "RoleDefinition_tenantId_name_key" ON public."RoleDefinition" USING btree ("tenantId", name);
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- RoleDefinition_no_active_guest; validated=true
CHECK (((lower(TRIM(BOTH FROM name)) <> 'guest'::text) OR ("isArchived" = true)))
-- RoleDefinition_pkey; validated=true
PRIMARY KEY (id)
-- RoleDefinition_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "RoleDefinition_id_tenantId_key" ON public."RoleDefinition" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "RoleDefinition_pkey" ON public."RoleDefinition" USING btree (id);
CREATE INDEX "RoleDefinition_tenantId_isArchived_idx" ON public."RoleDefinition" USING btree ("tenantId", "isArchived");
CREATE UNIQUE INDEX "RoleDefinition_tenantId_name_key" ON public."RoleDefinition" USING btree ("tenantId", name);
```

</details>

### RolePermission

One module permission vector per role. Category D. Use composite role FK; retain action flags and module identity

- Initial audit rows: **725**; immediately before cleanup: **725**; after cleanup: **16**; final live rows: **16**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "RolePermission_pkey" ON public."RolePermission" USING btree (id)`; `CREATE UNIQUE INDEX "RolePermission_roleId_module_key" ON public."RolePermission" USING btree ("roleId", module)`.
- Parent relations: role: RoleDefinition (@relation(fields: [roleId, tenantId], references: [id, tenantId], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/administration/roles/roles.repository.ts:66](../../backend/src/modules/administration/roles/roles.repository.ts#L66); [backend/src/modules/administration/roles/roles.repository.ts:114](../../backend/src/modules/administration/roles/roles.repository.ts#L114); [backend/src/modules/administration/roles/roles.repository.ts:120](../../backend/src/modules/administration/roles/roles.repository.ts#L120)
- Possible nested relation access (review with parent): [backend/src/integrations/gmail/mailbox-sync.service.ts:33](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L33) `permissions`; [backend/src/integrations/gmail/mailbox-ingestion.service.ts:14](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L14) `permissions`; [backend/src/modules/crm/leads/lead-automation.service.ts:35](../../backend/src/modules/crm/leads/lead-automation.service.ts#L35) `permissions`; [backend/src/modules/administration/roles/roles.repository.ts:15](../../backend/src/modules/administration/roles/roles.repository.ts#L15) `permissions`; [backend/src/modules/administration/archived-data/archived-data.service.ts:11](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L11) `permissions`
- Search matches across repository: 230 in 50 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: tenantId can disagree with role; redundant roleId index. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| roleId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| module | String | // e.g. "contacts", "deals", "campaigns" | 0 | KEEP — attribute owned by this row; not a separate entity |
| canView | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canCreate | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canEdit | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canDelete | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canArchive | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canImport | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canManageStages | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canComplete | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canAssign | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canSend | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canDuplicate | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canViewReports | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canActivate | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canViewRuns | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canPublish | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canViewSubmissions | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canViewClosedWon | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canDisable | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| canRestore | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- RolePermission_pkey; validated=true
PRIMARY KEY (id)
-- RolePermission_roleId_fkey; validated=true
FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "RolePermission_pkey" ON public."RolePermission" USING btree (id);
CREATE INDEX "RolePermission_roleId_idx" ON public."RolePermission" USING btree ("roleId");
CREATE UNIQUE INDEX "RolePermission_roleId_module_key" ON public."RolePermission" USING btree ("roleId", module);
CREATE INDEX "RolePermission_tenantId_module_idx" ON public."RolePermission" USING btree ("tenantId", module);
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- RolePermission_pkey; validated=true
PRIMARY KEY (id)
-- RolePermission_roleId_tenantId_fkey; validated=true
FOREIGN KEY ("roleId", "tenantId") REFERENCES "RoleDefinition"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "RolePermission_pkey" ON public."RolePermission" USING btree (id);
CREATE INDEX "RolePermission_roleId_idx" ON public."RolePermission" USING btree ("roleId");
CREATE UNIQUE INDEX "RolePermission_roleId_module_key" ON public."RolePermission" USING btree ("roleId", module);
CREATE INDEX "RolePermission_tenantId_module_idx" ON public."RolePermission" USING btree ("tenantId", module);
```

</details>

### Session

Hashed revocable authentication sessions. Category D. Keep security state; composite user FK; remove exact redundant index

- Initial audit rows: **31**; immediately before cleanup: **31**; after cleanup: **31**; final live rows: **32**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): expiresAt=2026-10-11T07:08:36.704Z; revokedAt=2026-10-02T14:00:26.247Z; lastActiveAt=2026-10-05T06:35:14.951Z; createdAt=2026-10-04T07:08:36.705Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Session_pkey" ON public."Session" USING btree (id)`; `CREATE UNIQUE INDEX "Session_tokenHash_key" ON public."Session" USING btree ("tokenHash")`.
- Parent relations: user: User (@relation(fields: [userId, tenantId], references: [id, tenantId], onDelete: Cascade)); tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-auth.service.ts:31](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L31); [backend/src/core/auth/session.service.ts:48](../../backend/src/core/auth/session.service.ts#L48)
- Direct runtime-source write sites: [backend/src/core/auth/session.service.ts:29](../../backend/src/core/auth/session.service.ts#L29); [backend/src/core/auth/session.service.ts:65](../../backend/src/core/auth/session.service.ts#L65); [backend/src/core/auth/session.service.ts:78](../../backend/src/core/auth/session.service.ts#L78); [backend/src/core/auth/session.service.ts:88](../../backend/src/core/auth/session.service.ts#L88); [backend/src/core/auth/session.service.ts:98](../../backend/src/core/auth/session.service.ts#L98); [backend/src/core/auth/password-reset.service.ts:80](../../backend/src/core/auth/password-reset.service.ts#L80); [backend/src/core/auth/change-password.service.ts:23](../../backend/src/core/auth/change-password.service.ts#L23)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 425 in 133 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-auth.service.ts:31](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L31)
- Normalization assessment: Duplicate tokenHash index; user/tenant equality not constrained. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| tokenHash | String | @unique // SHA-256 of JWT, never plaintext | 0 | KEEP — security credential/state |
| userAgent | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| ipAddress | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| expiresAt | DateTime | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |
| revokedAt | DateTime? | No explicit default; nullable | 24 | KEEP — lifecycle time or actor provenance |
| lastActiveAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Session_pkey; validated=true
PRIMARY KEY (id)
-- Session_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Session_userId_fkey; validated=true
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "Session_pkey" ON public."Session" USING btree (id);
CREATE INDEX "Session_tokenHash_idx" ON public."Session" USING btree ("tokenHash");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON public."Session" USING btree ("tokenHash");
CREATE INDEX "Session_userId_tenantId_idx" ON public."Session" USING btree ("userId", "tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- Session_pkey; validated=true
PRIMARY KEY (id)
-- Session_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Session_userId_tenantId_fkey; validated=true
FOREIGN KEY ("userId", "tenantId") REFERENCES "User"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "Session_pkey" ON public."Session" USING btree (id);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON public."Session" USING btree ("tokenHash");
CREATE INDEX "Session_userId_tenantId_idx" ON public."Session" USING btree ("userId", "tenantId");
```

</details>

### SMSQueue

Legacy Android gateway delivery queue. Category I. Drop empty table in guarded migration 84; provider adapter and campaign flow retained

- Initial audit rows: **0**; immediately before cleanup: **0**; after cleanup: **0**; final live rows: **unavailable**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): scheduledFor=NULL; sentAt=NULL; createdAt=NULL; updatedAt=NULL
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "SMSQueue_pkey" ON public."SMSQueue" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); campaign: Campaign? (@relation(fields: [campaignId], references: [id], onDelete: SetNull)); lead: Lead? (@relation(fields: [leadId], references: [id], onDelete: SetNull)); contact: Contact? (@relation(fields: [contactId], references: [id], onDelete: SetNull)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 56 in 19 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: None in supported routes. Historical DTO words are not storage dependencies.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: No runtime/worker/webhook access; SMS uses external provider service. Final action: **DROP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | table dropped | DROP — retired table |
| tenantId | String | No explicit default; required | table dropped | DROP — retired table |
| campaignId | String? | No explicit default; nullable | table dropped | DROP — retired table |
| leadId | String? | No explicit default; nullable | table dropped | DROP — retired table |
| contactId | String? | No explicit default; nullable | table dropped | DROP — retired table |
| toNumber | String | No explicit default; required | table dropped | DROP — retired table |
| message | String | No explicit default; required | table dropped | DROP — retired table |
| status | String | @default("pending") // pending\|processing\|sent\|delivered\|failed | table dropped | DROP — retired table |
| retryCount | Int | @default(0) | table dropped | DROP — retired table |
| scheduledFor | DateTime? | No explicit default; nullable | table dropped | DROP — retired table |
| sentAt | DateTime? | No explicit default; nullable | table dropped | DROP — retired table |
| errorMessage | String? | No explicit default; nullable | table dropped | DROP — retired table |
| createdAt | DateTime | @default(now()) | table dropped | DROP — retired table |
| updatedAt | DateTime | @updatedAt | table dropped | DROP — retired table |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- SMSQueue_campaignId_fkey; validated=true
FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- SMSQueue_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- SMSQueue_pkey; validated=true
PRIMARY KEY (id)
-- SMSQueue_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "SMSQueue_pkey" ON public."SMSQueue" USING btree (id);
CREATE INDEX "SMSQueue_tenantId_idx" ON public."SMSQueue" USING btree ("tenantId");
CREATE INDEX "SMSQueue_tenantId_scheduledFor_idx" ON public."SMSQueue" USING btree ("tenantId", "scheduledFor");
CREATE INDEX "SMSQueue_tenantId_status_idx" ON public."SMSQueue" USING btree ("tenantId", status);
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql


```

</details>

### Stage

Ordered pipeline stage and entry rules. Category F. Composite pipeline FK and Deal stage reference key; keep requiredFields configuration

- Initial audit rows: **134**; immediately before cleanup: **134**; after cleanup: **0**; final live rows: **5**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-09-25T12:24:25.859Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Stage_pkey" ON public."Stage" USING btree (id)`.
- Parent relations: pipeline: Pipeline (@relation(fields: [pipelineId, tenantId], references: [id, tenantId])); tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: Deal.stage; DealStageHistory.newStage; DealStageHistory.previousStage.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:107](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L107); [backend/src/modules/crm/pipeline/pipeline.repository.ts:64](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L64); [backend/src/modules/crm/pipeline/pipeline.repository.ts:81](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L81); [backend/src/modules/crm/pipeline/pipeline.repository.ts:87](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L87); [backend/src/modules/crm/pipeline/pipeline.repository.ts:102](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L102); [backend/src/modules/crm/leads/lead-automation.service.ts:56](../../backend/src/modules/crm/leads/lead-automation.service.ts#L56); [backend/src/modules/crm/leads/lead-automation.service.ts:61](../../backend/src/modules/crm/leads/lead-automation.service.ts#L61); [backend/src/modules/crm/imports/import-rows.service.ts:58](../../backend/src/modules/crm/imports/import-rows.service.ts#L58); [backend/src/modules/crm/engagement.service.ts:35](../../backend/src/modules/crm/engagement.service.ts#L35); [backend/src/modules/crm/deals/deals.service.ts:59](../../backend/src/modules/crm/deals/deals.service.ts#L59); [backend/src/modules/crm/deals/deals.service.ts:61](../../backend/src/modules/crm/deals/deals.service.ts#L61); [backend/src/modules/crm/deals/deals.service.ts:147](../../backend/src/modules/crm/deals/deals.service.ts#L147); [backend/src/modules/crm/deals/deals.service.ts:259](../../backend/src/modules/crm/deals/deals.service.ts#L259); [backend/src/modules/crm/deals/deals.repository.ts:99](../../backend/src/modules/crm/deals/deals.repository.ts#L99); [backend/src/modules/crm/deals/deals.repository.ts:225](../../backend/src/modules/crm/deals/deals.repository.ts#L225); [backend/src/modules/crm/deals/deals.repository.ts:299](../../backend/src/modules/crm/deals/deals.repository.ts#L299); [backend/src/modules/crm/deals/bulk-deals.service.ts:138](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L138); [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:72](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L72); [backend/src/modules/automation/actions/actions.repository.ts:18](../../backend/src/modules/automation/actions/actions.repository.ts#L18)
- Direct runtime-source write sites: [backend/src/modules/crm/pipeline/pipeline.repository.ts:59](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L59); [backend/src/modules/crm/pipeline/pipeline.repository.ts:73](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L73); [backend/src/modules/crm/pipeline/pipeline.repository.ts:88](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L88); [backend/src/modules/crm/pipeline/pipeline.repository.ts:104](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L104); [backend/src/modules/crm/leads/lead-automation.service.ts:58](../../backend/src/modules/crm/leads/lead-automation.service.ts#L58); [backend/src/modules/crm/leads/lead-automation.service.ts:64](../../backend/src/modules/crm/leads/lead-automation.service.ts#L64)
- Possible nested relation access (review with parent): [backend/src/integrations/gmail/mailbox-sync.service.ts:37](../../backend/src/integrations/gmail/mailbox-sync.service.ts#L37) `stage`; [backend/src/integrations/gmail/mailbox-ingestion.service.ts:58](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L58) `stage`; [backend/src/modules/notifications/notification-events.service.ts:67](../../backend/src/modules/notifications/notification-events.service.ts#L67) `stage`; [backend/src/modules/notifications/notification-events.service.ts:64](../../backend/src/modules/notifications/notification-events.service.ts#L64) `newStage`; [backend/src/modules/reporting/reports/reports.service.ts:36](../../backend/src/modules/reporting/reports/reports.service.ts#L36) `stage`; [backend/src/modules/reporting/reports/reports.service.ts:8](../../backend/src/modules/reporting/reports/reports.service.ts#L8) `stages`; [backend/src/modules/crm/relationships/relationships.service.ts:41](../../backend/src/modules/crm/relationships/relationships.service.ts#L41) `stage`; [backend/src/modules/crm/pipeline/pipeline.repository.ts:12](../../backend/src/modules/crm/pipeline/pipeline.repository.ts#L12) `stages`; [backend/src/modules/marketing/forms/public-forms.service.ts:87](../../backend/src/modules/marketing/forms/public-forms.service.ts#L87) `stage`; [backend/src/modules/marketing/forms/public-forms.service.ts:87](../../backend/src/modules/marketing/forms/public-forms.service.ts#L87) `newStage`; [backend/src/modules/crm/leads/lead-conversion.service.ts:12](../../backend/src/modules/crm/leads/lead-conversion.service.ts#L12) `stage`; [backend/src/modules/crm/engagement.service.ts:32](../../backend/src/modules/crm/engagement.service.ts#L32) `stage`; [backend/src/modules/crm/deals/forecast.service.ts:14](../../backend/src/modules/crm/deals/forecast.service.ts#L14) `stage`; [backend/src/modules/crm/deals/deals.service.ts:152](../../backend/src/modules/crm/deals/deals.service.ts#L152) `stage`; [backend/src/modules/crm/deals/deals.repository.ts:50](../../backend/src/modules/crm/deals/deals.repository.ts#L50) `stage`; [backend/src/modules/crm/deals/deals.repository.ts:88](../../backend/src/modules/crm/deals/deals.repository.ts#L88) `newStage`; [backend/src/modules/crm/deals/deals.repository.ts:89](../../backend/src/modules/crm/deals/deals.repository.ts#L89) `previousStage`; [backend/src/modules/crm/deals/bulk-deals.service.ts:157](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L157) `stage`; [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts:39](../../backend/src/modules/crm/closing-requirements/closing-requirements.service.ts#L39) `stage`; [backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts:29](../../backend/src/modules/crm/closing-requirements/closing-requirements.repository.ts#L29) `stage`; [backend/src/modules/automation/workflows/workflows.repository.ts:123](../../backend/src/modules/automation/workflows/workflows.repository.ts#L123) `stage`; [backend/src/modules/automation/workflows/workflows.repository.ts:13](../../backend/src/modules/automation/workflows/workflows.repository.ts#L13) `stages`; [backend/src/modules/administration/product-interests/product-interests.repository.ts:8](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L8) `stage`
- Search matches across repository: 1665 in 251 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:107](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L107)
- Normalization assessment: Tenant/pipeline relationship and Deal pipeline-stage pair need database enforcement. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| pipelineId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | // defence-in-depth: derived from Pipeline.tenantId at creation, never independently editable | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| order | Int | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| probability | Int? | // 0-100 for revenue forecasting | 0 | KEEP — attribute owned by this row; not a separate entity |
| color | String? | // hex e.g. "#3fb950" | 5 | KEEP — attribute owned by this row; not a separate entity |
| description | String? | No explicit default; nullable | 5 | KEEP — attribute owned by this row; not a separate entity |
| isWon | Boolean | @default(false) // terminal: deal won | 0 | KEEP — attribute owned by this row; not a separate entity |
| isLost | Boolean | @default(false) // terminal: deal lost | 0 | KEEP — attribute owned by this row; not a separate entity |
| isDefault | Boolean | @default(false) // starting stage for new deals | 0 | KEEP — attribute owned by this row; not a separate entity |
| requiredFields | String[] | // Deal fields required before entry (REQ089) e.g. ["accountId", "value"] | 0 | KEEP: Ordered names of validation fields, not database entity IDs. |
| rottenAfterDays | Int? | // days after which a deal in this stage is flagged stale | 5 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Stage_pipelineId_fkey; validated=true
FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Stage_pkey; validated=true
PRIMARY KEY (id)
-- Stage_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "Stage_pipelineId_order_idx" ON public."Stage" USING btree ("pipelineId", "order");
CREATE UNIQUE INDEX "Stage_pkey" ON public."Stage" USING btree (id);
CREATE INDEX "Stage_tenantId_idx" ON public."Stage" USING btree ("tenantId");
CREATE INDEX "Stage_tenantId_pipelineId_idx" ON public."Stage" USING btree ("tenantId", "pipelineId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- Stage_pipelineId_tenantId_fkey; validated=true
FOREIGN KEY ("pipelineId", "tenantId") REFERENCES "Pipeline"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
-- Stage_pkey; validated=true
PRIMARY KEY (id)
-- Stage_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Stage_id_pipelineId_tenantId_key" ON public."Stage" USING btree (id, "pipelineId", "tenantId");
CREATE INDEX "Stage_pipelineId_order_idx" ON public."Stage" USING btree ("pipelineId", "order");
CREATE UNIQUE INDEX "Stage_pkey" ON public."Stage" USING btree (id);
CREATE INDEX "Stage_tenantId_idx" ON public."Stage" USING btree ("tenantId");
CREATE INDEX "Stage_tenantId_pipelineId_idx" ON public."Stage" USING btree ("tenantId", "pipelineId");
```

</details>

### TargetAudience

Reusable dynamic audience query. Category F. Keep normalized parent/child design

- Initial audit rows: **4**; immediately before cleanup: **4**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-02T02:10:11.903Z; updatedAt=2026-10-02T02:10:11.903Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TargetAudience_pkey" ON public."TargetAudience" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: TargetAudienceCondition.targetAudience; Campaign.targetAudience.
- Direct runtime-source read sites: [backend/src/modules/marketing/campaigns/audiences.service.ts:14](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L14); [backend/src/modules/marketing/campaigns/audiences.service.ts:23](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L23)
- Direct runtime-source write sites: [backend/src/modules/marketing/campaigns/audiences.service.ts:18](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L18)
- Possible nested relation access (review with parent): [backend/src/core/scheduler/campaign-scheduler.service.ts:94](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L94) `targetAudience`; [backend/src/modules/marketing/campaigns/campaigns.service.ts:70](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L70) `targetAudience`; [backend/src/modules/marketing/campaigns/campaigns.repository.ts:7](../../backend/src/modules/marketing/campaigns/campaigns.repository.ts#L7) `targetAudience`
- Search matches across repository: 101 in 40 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/marketing/campaigns/audiences.service.ts:14](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L14); [backend/src/modules/marketing/campaigns/audiences.service.ts:23](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L23); [backend/src/modules/marketing/campaigns/audiences.service.ts:18](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L18)
- Normalization assessment: Conditions correctly stored as independent ordered child rules. Final action: **KEEP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| source | String | @default("CONTACTS") | 0 | KEEP — attribute owned by this row; not a separate entity |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| description | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| isActive | Boolean | @default(true) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TargetAudience_pkey; validated=true
PRIMARY KEY (id)
-- TargetAudience_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "TargetAudience_pkey" ON public."TargetAudience" USING btree (id);
CREATE INDEX "TargetAudience_tenantId_idx" ON public."TargetAudience" USING btree ("tenantId");
CREATE INDEX "TargetAudience_tenantId_isActive_idx" ON public."TargetAudience" USING btree ("tenantId", "isActive");
```

</details>

### TargetAudienceCondition

Ordered audience predicate. Category B. Keep relational rows; values interpreted by validated operators

- Initial audit rows: **6**; immediately before cleanup: **6**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-02T02:10:11.903Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TargetAudienceCondition_pkey" ON public."TargetAudienceCondition" USING btree (id)`.
- Parent relations: targetAudience: TargetAudience (@relation(fields: [targetAudienceId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: None found; see nested access below.
- Possible nested relation access (review with parent): [backend/src/core/scheduler/campaign-scheduler.service.ts:96](../../backend/src/core/scheduler/campaign-scheduler.service.ts#L96) `conditions`; [backend/src/modules/marketing/campaigns/audiences.service.ts:14](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L14) `conditions`; [backend/src/modules/automation/workflows/workflows.service.ts:96](../../backend/src/modules/automation/workflows/workflows.service.ts#L96) `conditions`; [backend/src/modules/automation/workflows/workflows.repository.ts:51](../../backend/src/modules/automation/workflows/workflows.repository.ts#L51) `conditions`
- Search matches across repository: 26 in 15 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Nested parent reads/creates are active even with no direct delegate calls. Final action: **KEEP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| targetAudienceId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| field | String | // contact field name e.g. "status", "score", "source", "tags" | 0 | KEEP — attribute owned by this row; not a separate entity |
| operator | String | // equals\|not_equals\|contains\|gte\|lte\|in\|not_in | 0 | KEEP — attribute owned by this row; not a separate entity |
| value | String | // stored as string, cast at query time | 0 | KEEP — attribute owned by this row; not a separate entity |
| conditionOrder | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TargetAudienceCondition_pkey; validated=true
PRIMARY KEY (id)
-- TargetAudienceCondition_targetAudienceId_fkey; validated=true
FOREIGN KEY ("targetAudienceId") REFERENCES "TargetAudience"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "TargetAudienceCondition_pkey" ON public."TargetAudienceCondition" USING btree (id);
CREATE INDEX "TargetAudienceCondition_targetAudienceId_idx" ON public."TargetAudienceCondition" USING btree ("targetAudienceId");
```

</details>

### Task

Assigned scheduled work. Category A. Use TaskLead/TaskContact/TaskDeal/TaskAccount exclusively; derive singular API fields; retire five obsolete columns

- Initial audit rows: **24**; immediately before cleanup: **24**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): dueDate=2026-10-06T01:27:31.694Z; reminderAt=NULL; completedAt=2026-10-05T01:57:23.147Z; createdAt=2026-10-05T01:27:31.718Z; updatedAt=2026-10-05T01:57:23.150Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Task_id_tenantId_key" ON public."Task" USING btree (id, "tenantId")`; `CREATE UNIQUE INDEX "Task_pkey" ON public."Task" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); assignedUser: User (@relation("AssignedTasks", fields: [assignedUserId], references: [id])); assignedBy: User? (@relation("TaskAssignedBy", fields: [assignedById], references: [id])); completedBy: User? (@relation("TaskCompletedBy", fields: [completedById], references: [id])).
- Children: Activity.task; TaskLead.task; TaskContact.task; TaskDeal.task; TaskAccount.task.
- Direct runtime-source read sites: [backend/src/modules/notifications/notification-events.service.ts:118](../../backend/src/modules/notifications/notification-events.service.ts#L118); [backend/src/modules/reporting/reports/reports.service.ts:76](../../backend/src/modules/reporting/reports/reports.service.ts#L76); [backend/src/modules/reporting/reports/reports.service.ts:77](../../backend/src/modules/reporting/reports/reports.service.ts#L77); [backend/src/modules/reporting/reports/reports.service.ts:78](../../backend/src/modules/reporting/reports/reports.service.ts#L78); [backend/src/modules/crm/relationships/relationships.service.ts:53](../../backend/src/modules/crm/relationships/relationships.service.ts#L53); [backend/src/modules/crm/relationships/relationships.service.ts:115](../../backend/src/modules/crm/relationships/relationships.service.ts#L115); [backend/src/modules/crm/relationships/relationships.service.ts:223](../../backend/src/modules/crm/relationships/relationships.service.ts#L223); [backend/src/modules/operations/tasks/tasks.repository.ts:164](../../backend/src/modules/operations/tasks/tasks.repository.ts#L164); [backend/src/modules/operations/tasks/tasks.repository.ts:171](../../backend/src/modules/operations/tasks/tasks.repository.ts#L171); [backend/src/modules/operations/tasks/tasks.repository.ts:182](../../backend/src/modules/operations/tasks/tasks.repository.ts#L182); [backend/src/modules/operations/tasks/tasks.repository.ts:252](../../backend/src/modules/operations/tasks/tasks.repository.ts#L252); [backend/src/modules/operations/tasks/tasks.repository.ts:253](../../backend/src/modules/operations/tasks/tasks.repository.ts#L253); [backend/src/modules/operations/tasks/tasks.repository.ts:258](../../backend/src/modules/operations/tasks/tasks.repository.ts#L258); [backend/src/modules/operations/tasks/tasks.repository.ts:487](../../backend/src/modules/operations/tasks/tasks.repository.ts#L487); [backend/src/modules/crm/merge/merge.repository.ts:12](../../backend/src/modules/crm/merge/merge.repository.ts#L12); [backend/src/modules/crm/merge/merge.repository.ts:25](../../backend/src/modules/crm/merge/merge.repository.ts#L25); [backend/src/modules/crm/merge/merge.repository.ts:42](../../backend/src/modules/crm/merge/merge.repository.ts#L42); [backend/src/modules/administration/archived-data/archived-data.service.ts:51](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L51)
- Direct runtime-source write sites: [backend/src/modules/operations/tasks/tasks.repository.ts:224](../../backend/src/modules/operations/tasks/tasks.repository.ts#L224); [backend/src/modules/operations/tasks/tasks.repository.ts:232](../../backend/src/modules/operations/tasks/tasks.repository.ts#L232); [backend/src/modules/administration/archived-data/archived-data.service.ts:108](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L108)
- Possible nested relation access (review with parent): [backend/src/modules/notifications/notification-events.service.ts:121](../../backend/src/modules/notifications/notification-events.service.ts#L121) `task`; [backend/src/modules/operations/tasks/tasks.service.ts:46](../../backend/src/modules/operations/tasks/tasks.service.ts#L46) `task`; [backend/src/modules/operations/tasks/tasks.repository.ts:353](../../backend/src/modules/operations/tasks/tasks.repository.ts#L353) `task`; [backend/src/modules/crm/merge/merge.repository.ts:107](../../backend/src/modules/crm/merge/merge.repository.ts#L107) `tasks`
- Search matches across repository: 1799 in 228 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notification-events.service.ts:118](../../backend/src/modules/notifications/notification-events.service.ts#L118)
- Normalization assessment: Four scalar relationships duplicated ordered junctions; live-only organizationId unused. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| assignedUserId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| assignedById | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| completedById | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| title | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| description | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| status | String | @default("pending") // pending\|in_progress\|blocked\|completed\|cancelled | 0 | KEEP — attribute owned by this row; not a separate entity |
| priority | String | @default("Medium") // Low\|Medium\|High | 0 | KEEP — attribute owned by this row; not a separate entity |
| dueDate | DateTime | No explicit default; required | 0 | KEEP — lifecycle time or actor provenance |
| reminderAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| completedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |
| dealId (original compatibility column) | text | nullable=YES; default=none | 0 | DROP through guarded migration; still present in expanded live phase |
| organizationId (original compatibility column) | text | nullable=YES; default=none | column dropped | DROP through guarded migration; absent from current catalog |
| leadId (original compatibility column) | text | nullable=YES; default=none | 0 | DROP through guarded migration; still present in expanded live phase |
| accountId (original compatibility column) | text | nullable=YES; default=none | 0 | DROP through guarded migration; still present in expanded live phase |
| contactId (original compatibility column) | text | nullable=YES; default=none | 0 | DROP through guarded migration; still present in expanded live phase |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Task_assignedById_fkey; validated=true
FOREIGN KEY ("assignedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Task_assignedUserId_fkey; validated=true
FOREIGN KEY ("assignedUserId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- Task_completedById_fkey; validated=true
FOREIGN KEY ("completedById") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Task_contactId_fkey; validated=true
FOREIGN KEY ("contactId") REFERENCES "Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Task_dealId_fkey; validated=true
FOREIGN KEY ("dealId") REFERENCES "Deal"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Task_leadId_fkey; validated=true
FOREIGN KEY ("leadId") REFERENCES "Lead"(id) ON UPDATE CASCADE ON DELETE SET NULL
-- Task_pkey; validated=true
PRIMARY KEY (id)
-- Task_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Task_id_tenantId_key" ON public."Task" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Task_pkey" ON public."Task" USING btree (id);
CREATE INDEX "Task_tenantId_assignedUserId_status_idx" ON public."Task" USING btree ("tenantId", "assignedUserId", status);
CREATE INDEX "Task_tenantId_dealId_idx" ON public."Task" USING btree ("tenantId", "dealId");
CREATE INDEX "Task_tenantId_dueDate_idx" ON public."Task" USING btree ("tenantId", "dueDate");
CREATE INDEX "Task_tenantId_idx" ON public."Task" USING btree ("tenantId");
```

</details>

### TaskAccount

Ordered task-account association. Category B. Keep canonical multi-record associations

- Initial audit rows: **2**; immediately before cleanup: **2**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("taskId", "accountId").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TaskAccount_pkey" ON public."TaskAccount" USING btree ("taskId", "accountId")`.
- Parent relations: task: Task (@relation(fields: [taskId, tenantId], references: [id, tenantId], onDelete: Cascade)); account: Account (@relation(fields: [accountId, tenantId], references: [id, tenantId], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/operations/tasks/tasks.repository.ts:395](../../backend/src/modules/operations/tasks/tasks.repository.ts#L395); [backend/src/modules/operations/tasks/tasks.repository.ts:397](../../backend/src/modules/operations/tasks/tasks.repository.ts#L397)
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:48](../../backend/src/modules/operations/tasks/tasks.repository.ts#L48) `accountLinks`
- Search matches across repository: 44 in 16 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Already composite tenant-safe FKs and pair PK. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| taskId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| accountId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TaskAccount_accountId_tenantId_fkey; validated=true
FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- TaskAccount_pkey; validated=true
PRIMARY KEY ("taskId", "accountId")
-- TaskAccount_taskId_tenantId_fkey; validated=true
FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "TaskAccount_pkey" ON public."TaskAccount" USING btree ("taskId", "accountId");
CREATE INDEX "TaskAccount_tenantId_accountId_idx" ON public."TaskAccount" USING btree ("tenantId", "accountId");
```

</details>

### TaskContact

Ordered task-contact association. Category B. Keep canonical multi-record associations

- Initial audit rows: **2**; immediately before cleanup: **2**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("taskId", "contactId").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TaskContact_pkey" ON public."TaskContact" USING btree ("taskId", "contactId")`.
- Parent relations: task: Task (@relation(fields: [taskId, tenantId], references: [id, tenantId], onDelete: Cascade)); contact: Contact (@relation(fields: [contactId, tenantId], references: [id, tenantId], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/operations/tasks/tasks.repository.ts:373](../../backend/src/modules/operations/tasks/tasks.repository.ts#L373); [backend/src/modules/operations/tasks/tasks.repository.ts:375](../../backend/src/modules/operations/tasks/tasks.repository.ts#L375)
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:36](../../backend/src/modules/operations/tasks/tasks.repository.ts#L36) `contactLinks`
- Search matches across repository: 43 in 15 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Already composite tenant-safe FKs and pair PK. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| taskId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| contactId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TaskContact_contactId_tenantId_fkey; validated=true
FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- TaskContact_pkey; validated=true
PRIMARY KEY ("taskId", "contactId")
-- TaskContact_taskId_tenantId_fkey; validated=true
FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "TaskContact_pkey" ON public."TaskContact" USING btree ("taskId", "contactId");
CREATE INDEX "TaskContact_tenantId_contactId_idx" ON public."TaskContact" USING btree ("tenantId", "contactId");
```

</details>

### TaskDeal

Ordered task-deal association. Category B. Keep canonical multi-record associations

- Initial audit rows: **6**; immediately before cleanup: **6**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("taskId", "dealId").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TaskDeal_pkey" ON public."TaskDeal" USING btree ("taskId", "dealId")`.
- Parent relations: task: Task (@relation(fields: [taskId, tenantId], references: [id, tenantId], onDelete: Cascade)); deal: Deal (@relation(fields: [dealId, tenantId], references: [id, tenantId], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/operations/tasks/tasks.repository.ts:384](../../backend/src/modules/operations/tasks/tasks.repository.ts#L384); [backend/src/modules/operations/tasks/tasks.repository.ts:386](../../backend/src/modules/operations/tasks/tasks.repository.ts#L386)
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:40](../../backend/src/modules/operations/tasks/tasks.repository.ts#L40) `dealLinks`
- Search matches across repository: 43 in 15 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Already composite tenant-safe FKs and pair PK. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| taskId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| dealId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TaskDeal_dealId_tenantId_fkey; validated=true
FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- TaskDeal_pkey; validated=true
PRIMARY KEY ("taskId", "dealId")
-- TaskDeal_taskId_tenantId_fkey; validated=true
FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "TaskDeal_pkey" ON public."TaskDeal" USING btree ("taskId", "dealId");
CREATE INDEX "TaskDeal_tenantId_dealId_idx" ON public."TaskDeal" USING btree ("tenantId", "dealId");
```

</details>

### TaskLead

Ordered task-lead association. Category B. Keep canonical multi-record associations

- Initial audit rows: **19**; immediately before cleanup: **19**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY ("taskId", "leadId").
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TaskLead_pkey" ON public."TaskLead" USING btree ("taskId", "leadId")`.
- Parent relations: task: Task (@relation(fields: [taskId, tenantId], references: [id, tenantId], onDelete: Cascade)); lead: Lead (@relation(fields: [leadId, tenantId], references: [id, tenantId], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/operations/tasks/tasks.repository.ts:362](../../backend/src/modules/operations/tasks/tasks.repository.ts#L362); [backend/src/modules/operations/tasks/tasks.repository.ts:364](../../backend/src/modules/operations/tasks/tasks.repository.ts#L364)
- Possible nested relation access (review with parent): [backend/src/modules/operations/tasks/tasks.repository.ts:32](../../backend/src/modules/operations/tasks/tasks.repository.ts#L32) `leadLinks`
- Search matches across repository: 53 in 19 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Already composite tenant-safe FKs and pair PK. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| taskId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| leadId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| position | Int | @default(0) | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TaskLead_leadId_tenantId_fkey; validated=true
FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- TaskLead_pkey; validated=true
PRIMARY KEY ("taskId", "leadId")
-- TaskLead_taskId_tenantId_fkey; validated=true
FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "TaskLead_pkey" ON public."TaskLead" USING btree ("taskId", "leadId");
CREATE INDEX "TaskLead_tenantId_leadId_idx" ON public."TaskLead" USING btree ("tenantId", "leadId");
```

</details>

### Template

Reusable email/SMS authoring template. Category F. Keep; no campaign-body deduplication

- Initial audit rows: **2**; immediately before cleanup: **2**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-02T02:16:44.337Z; updatedAt=2026-10-02T02:16:44.337Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Template_pkey" ON public."Template" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: Campaign.emailTemplate; Campaign.smsTemplate.
- Direct runtime-source read sites: [backend/src/modules/marketing/templates/templates.service.ts:17](../../backend/src/modules/marketing/templates/templates.service.ts#L17); [backend/src/modules/marketing/templates/templates.service.ts:18](../../backend/src/modules/marketing/templates/templates.service.ts#L18); [backend/src/modules/marketing/templates/templates.service.ts:24](../../backend/src/modules/marketing/templates/templates.service.ts#L24); [backend/src/modules/marketing/templates/templates.service.ts:37](../../backend/src/modules/marketing/templates/templates.service.ts#L37); [backend/src/modules/marketing/templates/templates.service.ts:47](../../backend/src/modules/marketing/templates/templates.service.ts#L47); [backend/src/modules/marketing/campaigns/campaigns.service.ts:91](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L91); [backend/src/modules/automation/workflows/workflows.repository.ts:14](../../backend/src/modules/automation/workflows/workflows.repository.ts#L14); [backend/src/modules/automation/actions/actions.repository.ts:15](../../backend/src/modules/automation/actions/actions.repository.ts#L15); [backend/src/modules/administration/archived-data/archived-data.service.ts:61](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L61)
- Direct runtime-source write sites: [backend/src/modules/marketing/templates/templates.service.ts:31](../../backend/src/modules/marketing/templates/templates.service.ts#L31); [backend/src/modules/marketing/templates/templates.service.ts:41](../../backend/src/modules/marketing/templates/templates.service.ts#L41); [backend/src/modules/marketing/templates/templates.service.ts:49](../../backend/src/modules/marketing/templates/templates.service.ts#L49); [backend/src/modules/administration/archived-data/archived-data.service.ts:122](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L122)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 406 in 100 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/marketing/campaigns/campaigns.service.ts:91](../../backend/src/modules/marketing/campaigns/campaigns.service.ts#L91); [backend/src/modules/automation/workflows/workflows.repository.ts:14](../../backend/src/modules/automation/workflows/workflows.repository.ts#L14)
- Normalization assessment: Campaign inline content can deliberately override template. Final action: **KEEP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| type | String | // "Email" \| "SMS" | 0 | KEEP — attribute owned by this row; not a separate entity |
| category | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| subject | String? | // email only | 0 | KEEP — attribute owned by this row; not a separate entity |
| content | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Template_pkey; validated=true
PRIMARY KEY (id)
-- Template_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Template_pkey" ON public."Template" USING btree (id);
CREATE INDEX "Template_tenantId_idx" ON public."Template" USING btree ("tenantId");
CREATE INDEX "Template_tenantId_type_isArchived_idx" ON public."Template" USING btree ("tenantId", type, "isArchived");
```

</details>

### Tenant

Workspace identity and defaults. Category A. Keep tenant scoping and retained workspace identity; founding provenance is separate from current permissions

- Initial audit rows: **23**; immediately before cleanup: **23**; after cleanup: **1**; final live rows: **1**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-09-21T12:20:12.316Z; updatedAt=2026-10-03T02:18:54.686Z; onboardingCompletedAt=2026-10-03T02:18:53.677Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Tenant_pkey" ON public."Tenant" USING btree (id)`; `CREATE UNIQUE INDEX "Tenant_slug_key" ON public."Tenant" USING btree (slug)`.
- Parent relations: No declared Prisma parent relation.
- Children: User.tenant; RoleDefinition.tenant; UserRole.tenant; Session.tenant; TenantGroup.tenant; TenantGroupMember.tenant; Account.tenant; Lead.tenant; Contact.tenant; Pipeline.tenant; Stage.tenant; Deal.tenant; LeadDeal.tenant; ContactDeal.tenant; DealStageHistory.tenant; Task.tenant; Activity.tenant; Notification.tenant; ClosingFieldDefinition.tenant; TargetAudience.tenant; Campaign.tenant; MarketingForm.tenant; CampaignMetrics.tenant; CampaignContact.tenant; Template.tenant; Workflow.tenant; WorkflowTriggerRecord.tenant; WorkflowExecutionRun.tenant; WorkflowExecutionStep.tenant; AuditLog.tenant; EmailDeliveryLog.tenant; EmailEvent.tenant; UserPreference.tenant; TenantPreference.tenant; CrmImportJob.tenant; CrmImportUpload.tenant; RecordFile.tenant; ProductInterest.tenant.
- Direct runtime-source read sites: [backend/src/core/tenant/tenant.service.ts:5](../../backend/src/core/tenant/tenant.service.ts#L5); [backend/src/core/tenant/tenant.service.ts:17](../../backend/src/core/tenant/tenant.service.ts#L17); [backend/src/modules/notifications/notification-events.service.ts:32](../../backend/src/modules/notifications/notification-events.service.ts#L32); [backend/src/modules/notifications/notification-events.service.ts:152](../../backend/src/modules/notifications/notification-events.service.ts#L152); [backend/src/modules/administration/organization-settings/organization-settings.service.ts:12](../../backend/src/modules/administration/organization-settings/organization-settings.service.ts#L12); [backend/src/modules/administration/organization-settings/organization-settings.service.ts:20](../../backend/src/modules/administration/organization-settings/organization-settings.service.ts#L20)
- Direct runtime-source write sites: [backend/src/core/auth/onboarding.service.ts:17](../../backend/src/core/auth/onboarding.service.ts#L17); [backend/src/core/auth/auth.controller.ts:63](../../backend/src/core/auth/auth.controller.ts#L63); [backend/src/modules/administration/organization-settings/organization-settings.service.ts:24](../../backend/src/modules/administration/organization-settings/organization-settings.service.ts#L24)
- Possible nested relation access (review with parent): [backend/src/core/auth/auth.service.ts:23](../../backend/src/core/auth/auth.service.ts#L23) `tenant`; [backend/src/modules/marketing/forms/public-forms.service.ts:18](../../backend/src/modules/marketing/forms/public-forms.service.ts#L18) `tenant`
- Search matches across repository: 3821 in 545 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notification-events.service.ts:32](../../backend/src/modules/notifications/notification-events.service.ts#L32); [backend/src/modules/notifications/notification-events.service.ts:152](../../backend/src/modules/notifications/notification-events.service.ts#L152)
- Normalization assessment: ownerUserId captures founding identity; five historical orphaned dummy references were removed by authorized cleanup. Final action: **KEEP**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| domain | String? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| slug | String | @unique | 0 | KEEP — attribute owned by this row; not a separate entity |
| industry | String? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| companySize | String? | // "1-10" \| "11-50" \| "51-200" \| "200+" | 1 | KEEP — attribute owned by this row; not a separate entity |
| website | String? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| currency | String? | @default("PHP") // ISO 4217 — e.g. "USD", "EUR", "GBP". Drives all money formatting UI-side. | 0 | KEEP — attribute owned by this row; not a separate entity |
| email | String? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| phone | String? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| address | String? | No explicit default; nullable | 1 | KEEP — attribute owned by this row; not a separate entity |
| status | TenantStatus | @default(SANDBOX) | 0 | KEEP — attribute owned by this row; not a separate entity |
| onboardingStep | Int | @default(0) // 0=introduction, 1=workflow, 2=company, 3=completed | 0 | KEEP — attribute owned by this row; not a separate entity |
| onboardingCompletedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| ownerUserId | String? | // ID of the founding/registering user — set once at registration, immutable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Tenant_pkey; validated=true
PRIMARY KEY (id)
CREATE UNIQUE INDEX "Tenant_pkey" ON public."Tenant" USING btree (id);
CREATE UNIQUE INDEX "Tenant_slug_key" ON public."Tenant" USING btree (slug);
```

</details>

### TenantGroup

Named staff groups. Category F. Keep; add tenant reference key

- Initial audit rows: **1**; immediately before cleanup: **1**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-04T12:56:15.851Z; updatedAt=2026-10-04T12:56:15.851Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TenantGroup_pkey" ON public."TenantGroup" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: TenantGroupMember.group.
- Direct runtime-source read sites: [backend/src/modules/administration/groups/groups.repository.ts:30](../../backend/src/modules/administration/groups/groups.repository.ts#L30); [backend/src/modules/administration/groups/groups.repository.ts:38](../../backend/src/modules/administration/groups/groups.repository.ts#L38); [backend/src/modules/administration/groups/groups.repository.ts:68](../../backend/src/modules/administration/groups/groups.repository.ts#L68)
- Direct runtime-source write sites: [backend/src/modules/administration/groups/groups.repository.ts:45](../../backend/src/modules/administration/groups/groups.repository.ts#L45); [backend/src/modules/administration/groups/groups.repository.ts:52](../../backend/src/modules/administration/groups/groups.repository.ts#L52); [backend/src/modules/administration/groups/groups.repository.ts:61](../../backend/src/modules/administration/groups/groups.repository.ts#L61)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 44 in 16 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Tenant-aware member relation missing. Final action: **NORMALIZE**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @default(now()) @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TenantGroup_pkey; validated=true
PRIMARY KEY (id)
-- TenantGroup_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "TenantGroup_pkey" ON public."TenantGroup" USING btree (id);
CREATE INDEX "TenantGroup_tenantId_idx" ON public."TenantGroup" USING btree ("tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- TenantGroup_pkey; validated=true
PRIMARY KEY (id)
-- TenantGroup_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "TenantGroup_id_tenantId_key" ON public."TenantGroup" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "TenantGroup_pkey" ON public."TenantGroup" USING btree (id);
CREATE INDEX "TenantGroup_tenantId_idx" ON public."TenantGroup" USING btree ("tenantId");
```

</details>

### TenantGroupMember

Group membership. Category B. Keep pair uniqueness; composite member FKs

- Initial audit rows: **1**; immediately before cleanup: **1**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TenantGroupMember_groupId_userId_key" ON public."TenantGroupMember" USING btree ("groupId", "userId")`; `CREATE UNIQUE INDEX "TenantGroupMember_pkey" ON public."TenantGroupMember" USING btree (id)`.
- Parent relations: group: TenantGroup (@relation(fields: [groupId, tenantId], references: [id, tenantId], onDelete: Cascade)); user: User (@relation(fields: [userId, tenantId], references: [id, tenantId], onDelete: Cascade)); tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/administration/groups/groups.repository.ts:69](../../backend/src/modules/administration/groups/groups.repository.ts#L69); [backend/src/modules/administration/groups/groups.repository.ts:82](../../backend/src/modules/administration/groups/groups.repository.ts#L82)
- Possible nested relation access (review with parent): [backend/src/modules/administration/groups/groups.repository.ts:12](../../backend/src/modules/administration/groups/groups.repository.ts#L12) `members`
- Search matches across repository: 39 in 14 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Existing group/user uniqueness is correct; missing tenant FK enforcement. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| groupId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TenantGroupMember_groupId_fkey; validated=true
FOREIGN KEY ("groupId") REFERENCES "TenantGroup"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- TenantGroupMember_pkey; validated=true
PRIMARY KEY (id)
-- TenantGroupMember_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- TenantGroupMember_userId_fkey; validated=true
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE INDEX "TenantGroupMember_groupId_idx" ON public."TenantGroupMember" USING btree ("groupId");
CREATE UNIQUE INDEX "TenantGroupMember_groupId_userId_key" ON public."TenantGroupMember" USING btree ("groupId", "userId");
CREATE UNIQUE INDEX "TenantGroupMember_pkey" ON public."TenantGroupMember" USING btree (id);
CREATE INDEX "TenantGroupMember_tenantId_idx" ON public."TenantGroupMember" USING btree ("tenantId");
CREATE INDEX "TenantGroupMember_userId_idx" ON public."TenantGroupMember" USING btree ("userId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- TenantGroupMember_groupId_tenantId_fkey; validated=true
FOREIGN KEY ("groupId", "tenantId") REFERENCES "TenantGroup"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- TenantGroupMember_pkey; validated=true
PRIMARY KEY (id)
-- TenantGroupMember_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- TenantGroupMember_userId_tenantId_fkey; validated=true
FOREIGN KEY ("userId", "tenantId") REFERENCES "User"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE INDEX "TenantGroupMember_groupId_idx" ON public."TenantGroupMember" USING btree ("groupId");
CREATE UNIQUE INDEX "TenantGroupMember_groupId_userId_key" ON public."TenantGroupMember" USING btree ("groupId", "userId");
CREATE UNIQUE INDEX "TenantGroupMember_pkey" ON public."TenantGroupMember" USING btree (id);
CREATE INDEX "TenantGroupMember_tenantId_idx" ON public."TenantGroupMember" USING btree ("tenantId");
CREATE INDEX "TenantGroupMember_userId_idx" ON public."TenantGroupMember" USING btree ("userId");
```

</details>

### TenantPreference

Workspace preferences and operational state. Category F. Move mailbox mapping into MailboxThreadAssociation; remove compatibility rows after equivalence check; keep other preferences

- Initial audit rows: **49**; immediately before cleanup: **49**; after cleanup: **0**; final live rows: **2**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-02T08:17:57.286Z; updatedAt=2026-10-05T06:35:20.121Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "TenantPreference_pkey" ON public."TenantPreference" USING btree (id)`; `CREATE UNIQUE INDEX "TenantPreference_tenantId_module_key_key" ON public."TenantPreference" USING btree ("tenantId", module, key)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/notifications/notification-events.service.ts:31](../../backend/src/modules/notifications/notification-events.service.ts#L31); [backend/src/modules/notifications/notification-events.service.ts:131](../../backend/src/modules/notifications/notification-events.service.ts#L131); [backend/src/modules/preferences/preferences.repository.ts:57](../../backend/src/modules/preferences/preferences.repository.ts#L57); [backend/src/modules/crm/leads/lead-automation.service.ts:110](../../backend/src/modules/crm/leads/lead-automation.service.ts#L110); [backend/src/modules/crm/deal-stage-automation.service.ts:7](../../backend/src/modules/crm/deal-stage-automation.service.ts#L7); [backend/src/modules/administration/product-interests/product-interests.controller.ts:24](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L24); [backend/src/modules/administration/product-interests/product-interests.controller.ts:39](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L39); [backend/src/modules/administration/product-interests/product-interests.controller.ts:56](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L56)
- Direct runtime-source write sites: [backend/src/modules/notifications/notification-events.service.ts:112](../../backend/src/modules/notifications/notification-events.service.ts#L112); [backend/src/modules/notifications/notification-events.service.ts:142](../../backend/src/modules/notifications/notification-events.service.ts#L142); [backend/src/modules/preferences/preferences.repository.ts:68](../../backend/src/modules/preferences/preferences.repository.ts#L68); [backend/src/modules/preferences/preferences.repository.ts:82](../../backend/src/modules/preferences/preferences.repository.ts#L82); [backend/src/modules/crm/leads/lead-automation.service.ts:113](../../backend/src/modules/crm/leads/lead-automation.service.ts#L113); [backend/src/modules/crm/deal-stage-automation.service.ts:16](../../backend/src/modules/crm/deal-stage-automation.service.ts#L16); [backend/src/modules/administration/product-interests/product-interests.controller.ts:53](../../backend/src/modules/administration/product-interests/product-interests.controller.ts#L53)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 120 in 46 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notification-events.service.ts:31](../../backend/src/modules/notifications/notification-events.service.ts#L31); [backend/src/modules/notifications/notification-events.service.ts:131](../../backend/src/modules/notifications/notification-events.service.ts#L131); [backend/src/modules/notifications/notification-events.service.ts:112](../../backend/src/modules/notifications/notification-events.service.ts#L112); [backend/src/modules/notifications/notification-events.service.ts:142](../../backend/src/modules/notifications/notification-events.service.ts#L142)
- Normalization assessment: mailbox-thread JSON duplicated a queryable relationship; other values are configuration/cursors. Final action: **NORMALIZE**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| module | String | @db.VarChar(64) | 0 | KEEP — attribute owned by this row; not a separate entity |
| key | String | @db.VarChar(128) | 0 | KEEP — attribute owned by this row; not a separate entity |
| value | Json | No explicit default; required | 0 | KEEP JSON: Configuration and cursors remain JSON. mailbox-thread mapping is NORMALIZED into MailboxThreadAssociation in migrations 85/86. |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- TenantPreference_pkey; validated=true
PRIMARY KEY (id)
-- TenantPreference_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "TenantPreference_pkey" ON public."TenantPreference" USING btree (id);
CREATE INDEX "TenantPreference_tenantId_module_idx" ON public."TenantPreference" USING btree ("tenantId", module);
CREATE UNIQUE INDEX "TenantPreference_tenantId_module_key_key" ON public."TenantPreference" USING btree ("tenantId", module, key);
```

</details>

### User

Staff identity, credentials and primary routing role. Category D. Keep compatibility role; strengthen tenant keys; never infer primary role from arbitrary junction ordering

- Initial audit rows: **18**; immediately before cleanup: **18**; after cleanup: **1**; final live rows: **1**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-09-26T10:39:20.536Z; updatedAt=2026-10-03T05:54:45.120Z; emailVerified=2026-10-03T02:18:59.085Z; lastLoginAt=NULL; passwordChangedAt=NULL
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "User_pkey" ON public."User" USING btree (id)`; `CREATE UNIQUE INDEX "User_tenantId_email_key" ON public."User" USING btree ("tenantId", email)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: UserRole.user; Session.user; TenantGroupMember.user; Account.assignedUser; Lead.assignedUser; Lead.createdBy; Lead.updatedBy; Lead.convertedBy; Contact.assignedUser; Contact.owner; Deal.assignedUser; Deal.owner; LeadDeal.addedBy; ContactDeal.addedBy; DealStageHistory.movedBy; Task.assignedUser; Task.assignedBy; Task.completedBy; Activity.createdBy; Notification.user; MarketingForm.createdBy; AuditLog.user; UserPreference.user; CrmImportJob.createdBy; CrmImportUpload.actor; RecordFile.uploadedBy.
- Direct runtime-source read sites: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:28](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L28); [backend/src/core/auth/profile.service.ts:15](../../backend/src/core/auth/profile.service.ts#L15); [backend/src/core/auth/password-reset.service.ts:17](../../backend/src/core/auth/password-reset.service.ts#L17); [backend/src/core/auth/password-reset.service.ts:65](../../backend/src/core/auth/password-reset.service.ts#L65); [backend/src/core/auth/onboarding.service.ts:12](../../backend/src/core/auth/onboarding.service.ts#L12); [backend/src/core/auth/change-password.service.ts:13](../../backend/src/core/auth/change-password.service.ts#L13); [backend/src/core/auth/auth.service.ts:21](../../backend/src/core/auth/auth.service.ts#L21); [backend/src/core/auth/auth.service.ts:57](../../backend/src/core/auth/auth.service.ts#L57); [backend/src/core/auth/auth-user.ts:79](../../backend/src/core/auth/auth-user.ts#L79); [backend/src/modules/notifications/notifications.service.ts:37](../../backend/src/modules/notifications/notifications.service.ts#L37); [backend/src/modules/notifications/notification-events.service.ts:11](../../backend/src/modules/notifications/notification-events.service.ts#L11); [backend/src/modules/operations/tasks/tasks.repository.ts:192](../../backend/src/modules/operations/tasks/tasks.repository.ts#L192); [backend/src/modules/operations/tasks/tasks.repository.ts:263](../../backend/src/modules/operations/tasks/tasks.repository.ts#L263); [backend/src/modules/operations/tasks/tasks.repository.ts:281](../../backend/src/modules/operations/tasks/tasks.repository.ts#L281); [backend/src/modules/crm/leads/lead-automation.service.ts:34](../../backend/src/modules/crm/leads/lead-automation.service.ts#L34); [backend/src/modules/crm/leads/lead-automation.service.ts:44](../../backend/src/modules/crm/leads/lead-automation.service.ts#L44); [backend/src/modules/marketing/campaigns/audiences.service.ts:72](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L72); [backend/src/modules/crm/imports/import-rows.service.ts:83](../../backend/src/modules/crm/imports/import-rows.service.ts#L83); [backend/src/modules/crm/deals/bulk-deals.service.ts:73](../../backend/src/modules/crm/deals/bulk-deals.service.ts#L73); [backend/src/modules/crm/contacts-v2/contacts-v2.service.ts:65](../../backend/src/modules/crm/contacts-v2/contacts-v2.service.ts#L65); [backend/src/modules/automation/workflows/workflows.repository.ts:12](../../backend/src/modules/automation/workflows/workflows.repository.ts#L12); [backend/src/modules/automation/workflows/workflows.repository.ts:139](../../backend/src/modules/automation/workflows/workflows.repository.ts#L139); [backend/src/modules/automation/actions/actions.repository.ts:6](../../backend/src/modules/automation/actions/actions.repository.ts#L6); [backend/src/modules/administration/users/users.service.ts:39](../../backend/src/modules/administration/users/users.service.ts#L39); [backend/src/modules/administration/users/users.service.ts:41](../../backend/src/modules/administration/users/users.service.ts#L41); [backend/src/modules/administration/users/users.service.ts:42](../../backend/src/modules/administration/users/users.service.ts#L42); [backend/src/modules/administration/users/users.service.ts:48](../../backend/src/modules/administration/users/users.service.ts#L48); [backend/src/modules/administration/users/users.service.ts:65](../../backend/src/modules/administration/users/users.service.ts#L65); [backend/src/modules/administration/users/users.service.ts:99](../../backend/src/modules/administration/users/users.service.ts#L99); [backend/src/modules/administration/users/users.service.ts:118](../../backend/src/modules/administration/users/users.service.ts#L118); [backend/src/modules/administration/users/users.service.ts:129](../../backend/src/modules/administration/users/users.service.ts#L129); [backend/src/modules/administration/users/users.service.ts:137](../../backend/src/modules/administration/users/users.service.ts#L137); [backend/src/modules/administration/users/users.service.ts:151](../../backend/src/modules/administration/users/users.service.ts#L151); [backend/src/modules/administration/users/users.service.ts:155](../../backend/src/modules/administration/users/users.service.ts#L155); [backend/src/modules/administration/users/users.repository.ts:14](../../backend/src/modules/administration/users/users.repository.ts#L14); [backend/src/modules/administration/users/users.repository.ts:18](../../backend/src/modules/administration/users/users.repository.ts#L18); [backend/src/modules/administration/roles/roles.service.ts:160](../../backend/src/modules/administration/roles/roles.service.ts#L160); [backend/src/modules/administration/roles/roles.repository.ts:149](../../backend/src/modules/administration/roles/roles.repository.ts#L149); [backend/src/modules/administration/roles/roles.repository.ts:199](../../backend/src/modules/administration/roles/roles.repository.ts#L199); [backend/src/modules/administration/groups/groups.repository.ts:78](../../backend/src/modules/administration/groups/groups.repository.ts#L78); [backend/src/modules/administration/archived-data/archived-data.service.ts:57](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L57)
- Direct runtime-source write sites: [backend/src/core/auth/profile.service.ts:17](../../backend/src/core/auth/profile.service.ts#L17); [backend/src/core/auth/password-reset.service.ts:75](../../backend/src/core/auth/password-reset.service.ts#L75); [backend/src/core/auth/change-password.service.ts:20](../../backend/src/core/auth/change-password.service.ts#L20); [backend/src/core/auth/auth.controller.ts:75](../../backend/src/core/auth/auth.controller.ts#L75); [backend/src/modules/administration/users/users.service.ts:72](../../backend/src/modules/administration/users/users.service.ts#L72); [backend/src/modules/administration/users/users.service.ts:110](../../backend/src/modules/administration/users/users.service.ts#L110); [backend/src/modules/administration/users/users.service.ts:123](../../backend/src/modules/administration/users/users.service.ts#L123); [backend/src/modules/administration/users/users.service.ts:131](../../backend/src/modules/administration/users/users.service.ts#L131); [backend/src/modules/administration/users/users.service.ts:141](../../backend/src/modules/administration/users/users.service.ts#L141); [backend/src/modules/administration/users/users.service.ts:158](../../backend/src/modules/administration/users/users.service.ts#L158); [backend/src/modules/administration/users/users.service.ts:167](../../backend/src/modules/administration/users/users.service.ts#L167); [backend/src/modules/administration/roles/roles.repository.ts:95](../../backend/src/modules/administration/roles/roles.repository.ts#L95); [backend/src/modules/administration/roles/roles.repository.ts:208](../../backend/src/modules/administration/roles/roles.repository.ts#L208)
- Possible nested relation access (review with parent): [backend/src/integrations/gmail/mailbox-auth.service.ts:15](../../backend/src/integrations/gmail/mailbox-auth.service.ts#L15) `user`; [backend/src/core/permissions/permission.service.ts:7](../../backend/src/core/permissions/permission.service.ts#L7) `user`; [backend/src/core/auth/onboarding.service.ts:10](../../backend/src/core/auth/onboarding.service.ts#L10) `actor`; [backend/src/core/auth/change-password.service.ts:10](../../backend/src/core/auth/change-password.service.ts#L10) `actor`; [backend/src/core/auth/auth.service.ts:31](../../backend/src/core/auth/auth.service.ts#L31) `user`; [backend/src/modules/operations/tasks/tasks.service.ts:130](../../backend/src/modules/operations/tasks/tasks.service.ts#L130) `assignedUser`; [backend/src/modules/operations/tasks/tasks.service.ts:132](../../backend/src/modules/operations/tasks/tasks.service.ts#L132) `completedBy`; [backend/src/modules/operations/tasks/tasks.repository.ts:56](../../backend/src/modules/operations/tasks/tasks.repository.ts#L56) `assignedUser`; [backend/src/modules/operations/tasks/tasks.repository.ts:57](../../backend/src/modules/operations/tasks/tasks.repository.ts#L57) `assignedBy`; [backend/src/modules/operations/tasks/tasks.repository.ts:58](../../backend/src/modules/operations/tasks/tasks.repository.ts#L58) `completedBy`; [backend/src/modules/crm/record-files/record-files.service.ts:10](../../backend/src/modules/crm/record-files/record-files.service.ts#L10) `uploadedBy`; [backend/src/modules/crm/leads/lead-automation.service.ts:121](../../backend/src/modules/crm/leads/lead-automation.service.ts#L121) `assignedUser`; [backend/src/modules/crm/deals/deals.service.ts:267](../../backend/src/modules/crm/deals/deals.service.ts#L267) `assignedUser`; [backend/src/modules/crm/deals/deals.service.ts:268](../../backend/src/modules/crm/deals/deals.service.ts#L268) `owner`; [backend/src/modules/crm/deals/deals.repository.ts:52](../../backend/src/modules/crm/deals/deals.repository.ts#L52) `assignedUser`; [backend/src/modules/crm/deals/deals.repository.ts:78](../../backend/src/modules/crm/deals/deals.repository.ts#L78) `owner`; [backend/src/modules/crm/deals/deals.repository.ts:90](../../backend/src/modules/crm/deals/deals.repository.ts#L90) `movedBy`; [backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts:24](../../backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts#L24) `assignedUser`; [backend/src/modules/crm/contacts/contacts.repository.ts:61](../../backend/src/modules/crm/contacts/contacts.repository.ts#L61) `assignedUser`; [backend/src/modules/crm/contacts/contacts.repository.ts:63](../../backend/src/modules/crm/contacts/contacts.repository.ts#L63) `createdBy`; [backend/src/modules/crm/contacts/contacts.repository.ts:64](../../backend/src/modules/crm/contacts/contacts.repository.ts#L64) `updatedBy`; [backend/src/modules/crm/companies/companies.repository.ts:50](../../backend/src/modules/crm/companies/companies.repository.ts#L50) `assignedUser`; [backend/src/modules/crm/activities/activities.repository.ts:9](../../backend/src/modules/crm/activities/activities.repository.ts#L9) `createdBy`; [backend/src/modules/automation/workflows/workflows.repository.ts:21](../../backend/src/modules/automation/workflows/workflows.repository.ts#L21) `users`; [backend/src/modules/administration/roles/roles.repository.ts:34](../../backend/src/modules/administration/roles/roles.repository.ts#L34) `user`; [backend/src/modules/administration/product-interests/product-interests.repository.ts:15](../../backend/src/modules/administration/product-interests/product-interests.repository.ts#L15) `assignedUser`; [backend/src/modules/administration/groups/groups.repository.ts:16](../../backend/src/modules/administration/groups/groups.repository.ts#L16) `user`; [backend/src/modules/administration/audit/audit.service.ts:27](../../backend/src/modules/administration/audit/audit.service.ts#L27) `user`; [backend/src/modules/administration/archived-data/archived-data.service.ts:21](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L21) `actor`
- Search matches across repository: 4573 in 607 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/integrations/gmail/mailbox-ingestion.service.ts:28](../../backend/src/integrations/gmail/mailbox-ingestion.service.ts#L28); [backend/src/modules/notifications/notifications.service.ts:37](../../backend/src/modules/notifications/notifications.service.ts#L37); [backend/src/modules/notifications/notification-events.service.ts:11](../../backend/src/modules/notifications/notification-events.service.ts#L11); [backend/src/modules/marketing/campaigns/audiences.service.ts:72](../../backend/src/modules/marketing/campaigns/audiences.service.ts#L72); [backend/src/modules/automation/workflows/workflows.repository.ts:12](../../backend/src/modules/automation/workflows/workflows.repository.ts#L12); [backend/src/modules/automation/workflows/workflows.repository.ts:139](../../backend/src/modules/automation/workflows/workflows.repository.ts#L139)
- Normalization assessment: role is a primary identity; UserRole grants permissions; not an interchangeable duplicate. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| email | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| firstName | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| lastName | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| mustChangePassword | Boolean | @default(true) | 0 | KEEP — security credential/state |
| passwordChangedAt | DateTime? | No explicit default; nullable | 1 | KEEP — security credential/state |
| passwordHash | String? | // Legacy passwordless accounts use password recovery. | 0 | KEEP — security credential/state |
| phone | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| jobTitle | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| department | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| avatarUrl | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| lastLoginAt | DateTime? | No explicit default; nullable | 1 | KEEP — lifecycle time or actor provenance |
| role | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| status | UserStatus | @default(ACTIVE) | 0 | KEEP — attribute owned by this row; not a separate entity |
| emailVerified | DateTime? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- User_no_active_guest; validated=true
CHECK (((lower(TRIM(BOTH FROM role)) <> 'guest'::text) OR (status = 'INACTIVE'::"UserStatus")))
-- User_pkey; validated=true
PRIMARY KEY (id)
-- User_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "User_pkey" ON public."User" USING btree (id);
CREATE UNIQUE INDEX "User_tenantId_email_key" ON public."User" USING btree ("tenantId", email);
CREATE INDEX "User_tenantId_status_idx" ON public."User" USING btree ("tenantId", status);
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- User_no_active_guest; validated=true
CHECK (((lower(TRIM(BOTH FROM role)) <> 'guest'::text) OR (status = 'INACTIVE'::"UserStatus")))
-- User_pkey; validated=true
PRIMARY KEY (id)
-- User_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "User_id_tenantId_key" ON public."User" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "User_pkey" ON public."User" USING btree (id);
CREATE UNIQUE INDEX "User_tenantId_email_key" ON public."User" USING btree ("tenantId", email);
CREATE INDEX "User_tenantId_status_idx" ON public."User" USING btree ("tenantId", status);
```

</details>

### UserPreference

Per-user module display preferences. Category F. Keep config; document keys with relational content separately

- Initial audit rows: **27**; immediately before cleanup: **27**; after cleanup: **0**; final live rows: **3**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-03T12:31:14.980Z; updatedAt=2026-10-05T06:20:14.604Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "UserPreference_pkey" ON public."UserPreference" USING btree (id)`; `CREATE UNIQUE INDEX "UserPreference_tenantId_userId_module_key_key" ON public."UserPreference" USING btree ("tenantId", "userId", module, key)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id], onDelete: Cascade)); user: User (@relation(fields: [userId], references: [id], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/preferences/preferences.repository.ts:16](../../backend/src/modules/preferences/preferences.repository.ts#L16)
- Direct runtime-source write sites: [backend/src/modules/preferences/preferences.repository.ts:28](../../backend/src/modules/preferences/preferences.repository.ts#L28); [backend/src/modules/preferences/preferences.repository.ts:43](../../backend/src/modules/preferences/preferences.repository.ts#L43)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 89 in 26 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Flexible JSON is appropriate; tenant/user FK gap remains. Final action: **KEEP**. Risk: MEDIUM.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| module | String | @db.VarChar(64) | 0 | KEEP — attribute owned by this row; not a separate entity |
| key | String | @db.VarChar(128) | 0 | KEEP — attribute owned by this row; not a separate entity |
| value | Json | No explicit default; required | 0 | KEEP: Flexible preference or field definition; no independent record identity demonstrated. |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- UserPreference_pkey; validated=true
PRIMARY KEY (id)
-- UserPreference_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- UserPreference_userId_fkey; validated=true
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "UserPreference_pkey" ON public."UserPreference" USING btree (id);
CREATE INDEX "UserPreference_tenantId_module_idx" ON public."UserPreference" USING btree ("tenantId", module);
CREATE UNIQUE INDEX "UserPreference_tenantId_userId_module_key_key" ON public."UserPreference" USING btree ("tenantId", "userId", module, key);
```

</details>

### UserRole

Permission-bearing user role assignments. Category B. Use tenant-consistent composite FKs; retain API compound unique selector

- Initial audit rows: **15**; immediately before cleanup: **15**; after cleanup: **1**; final live rows: **1**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): No timestamp column; newest activity cannot be established from this table.
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "UserRole_pkey" ON public."UserRole" USING btree (id)`; `CREATE UNIQUE INDEX "UserRole_userId_roleId_tenantId_key" ON public."UserRole" USING btree ("userId", "roleId", "tenantId")`.
- Parent relations: user: User (@relation(fields: [userId, tenantId], references: [id, tenantId], onDelete: Cascade)); role: RoleDefinition (@relation(fields: [roleId, tenantId], references: [id, tenantId], onDelete: Cascade)); tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: None declared.
- Direct runtime-source read sites: [backend/src/modules/administration/roles/roles.repository.ts:143](../../backend/src/modules/administration/roles/roles.repository.ts#L143); [backend/src/modules/administration/roles/roles.repository.ts:160](../../backend/src/modules/administration/roles/roles.repository.ts#L160); [backend/src/modules/administration/roles/roles.repository.ts:173](../../backend/src/modules/administration/roles/roles.repository.ts#L173)
- Direct runtime-source write sites: [backend/src/modules/administration/roles/roles.repository.ts:155](../../backend/src/modules/administration/roles/roles.repository.ts#L155); [backend/src/modules/administration/roles/roles.repository.ts:209](../../backend/src/modules/administration/roles/roles.repository.ts#L209); [backend/src/modules/administration/roles/roles.repository.ts:210](../../backend/src/modules/administration/roles/roles.repository.ts#L210)
- Possible nested relation access (review with parent): [backend/src/modules/notifications/notification-events.service.ts:13](../../backend/src/modules/notifications/notification-events.service.ts#L13) `userRoles`; [backend/src/modules/crm/leads/lead-automation.service.ts:35](../../backend/src/modules/crm/leads/lead-automation.service.ts#L35) `userRoles`; [backend/src/modules/administration/roles/roles.repository.ts:14](../../backend/src/modules/administration/roles/roles.repository.ts#L14) `userRoles`
- Search matches across repository: 140 in 52 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: No direct worker/integration call; nested uses are listed above.
- Normalization assessment: Tenant equality is enforced only in services. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| userId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| roleId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- UserRole_pkey; validated=true
PRIMARY KEY (id)
-- UserRole_roleId_fkey; validated=true
FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- UserRole_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- UserRole_userId_fkey; validated=true
FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "UserRole_pkey" ON public."UserRole" USING btree (id);
CREATE UNIQUE INDEX "UserRole_userId_roleId_tenantId_key" ON public."UserRole" USING btree ("userId", "roleId", "tenantId");
CREATE INDEX "UserRole_userId_tenantId_idx" ON public."UserRole" USING btree ("userId", "tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- UserRole_pkey; validated=true
PRIMARY KEY (id)
-- UserRole_roleId_tenantId_fkey; validated=true
FOREIGN KEY ("roleId", "tenantId") REFERENCES "RoleDefinition"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- UserRole_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- UserRole_userId_tenantId_fkey; validated=true
FOREIGN KEY ("userId", "tenantId") REFERENCES "User"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
CREATE UNIQUE INDEX "UserRole_pkey" ON public."UserRole" USING btree (id);
CREATE UNIQUE INDEX "UserRole_userId_roleId_tenantId_key" ON public."UserRole" USING btree ("userId", "roleId", "tenantId");
CREATE INDEX "UserRole_userId_tenantId_idx" ON public."UserRole" USING btree ("userId", "tenantId");
```

</details>

### Workflow

Trigger/action configuration and current lifecycle. Category F. Keep JSON DSL and lifecycle guard; no enum tightening without accepted historical values

- Initial audit rows: **4**; immediately before cleanup: **4**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): createdAt=2026-10-02T02:34:44.648Z; updatedAt=2026-10-03T02:14:15.955Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "Workflow_pkey" ON public."Workflow" USING btree (id)`; `CREATE UNIQUE INDEX "Workflow_tenantId_normalizedName_key" ON public."Workflow" USING btree ("tenantId", workflow_name_key(name))`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])).
- Children: WorkflowTriggerRecord.workflow.
- Direct runtime-source read sites: [backend/src/modules/automation/workflows/workflows.repository.ts:25](../../backend/src/modules/automation/workflows/workflows.repository.ts#L25); [backend/src/modules/automation/workflows/workflows.repository.ts:35](../../backend/src/modules/automation/workflows/workflows.repository.ts#L35); [backend/src/modules/automation/workflows/workflows.repository.ts:37](../../backend/src/modules/automation/workflows/workflows.repository.ts#L37); [backend/src/modules/automation/workflows/workflows.repository.ts:38](../../backend/src/modules/automation/workflows/workflows.repository.ts#L38); [backend/src/modules/automation/workflows/workflows.repository.ts:56](../../backend/src/modules/automation/workflows/workflows.repository.ts#L56); [backend/src/modules/automation/workflows/workflows.repository.ts:93](../../backend/src/modules/automation/workflows/workflows.repository.ts#L93); [backend/src/modules/administration/archived-data/archived-data.service.ts:59](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L59)
- Direct runtime-source write sites: [backend/src/modules/automation/workflows/workflows.repository.ts:78](../../backend/src/modules/automation/workflows/workflows.repository.ts#L78); [backend/src/modules/automation/workflows/workflows.repository.ts:89](../../backend/src/modules/automation/workflows/workflows.repository.ts#L89); [backend/src/modules/administration/archived-data/archived-data.service.ts:115](../../backend/src/modules/administration/archived-data/archived-data.service.ts#L115)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 1335 in 217 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/automation/workflows/workflows.repository.ts:25](../../backend/src/modules/automation/workflows/workflows.repository.ts#L25); [backend/src/modules/automation/workflows/workflows.repository.ts:35](../../backend/src/modules/automation/workflows/workflows.repository.ts#L35); [backend/src/modules/automation/workflows/workflows.repository.ts:37](../../backend/src/modules/automation/workflows/workflows.repository.ts#L37); [backend/src/modules/automation/workflows/workflows.repository.ts:38](../../backend/src/modules/automation/workflows/workflows.repository.ts#L38); [backend/src/modules/automation/workflows/workflows.repository.ts:56](../../backend/src/modules/automation/workflows/workflows.repository.ts#L56); [backend/src/modules/automation/workflows/workflows.repository.ts:93](../../backend/src/modules/automation/workflows/workflows.repository.ts#L93); [backend/src/modules/automation/workflows/workflows.repository.ts:78](../../backend/src/modules/automation/workflows/workflows.repository.ts#L78); [backend/src/modules/automation/workflows/workflows.repository.ts:89](../../backend/src/modules/automation/workflows/workflows.repository.ts#L89)
- Normalization assessment: status and isActive are synchronized compatibility state. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| status | String | @default("DRAFT") | 0 | KEEP — attribute owned by this row; not a separate entity |
| activatedById | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| name | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| description | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| trigger | String | // e.g. "deal.stage_changed" \| "contact.created" \| "task.overdue" | 0 | KEEP — attribute owned by this row; not a separate entity |
| conditions | Json? | // WorkflowCondition[] typed JSON | 0 | KEEP: Validated condition/action DSL; referenced CRM IDs are validated by runtime. Definition versioning/relational targets require separate design. |
| actions | Json | // WorkflowAction[] typed JSON | 0 | KEEP: Validated condition/action DSL; referenced CRM IDs are validated by runtime. Definition versioning/relational targets require separate design. |
| isActive | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| isArchived | Boolean | @default(false) | 0 | KEEP — attribute owned by this row; not a separate entity |
| createdAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| updatedAt | DateTime | @updatedAt | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- Workflow_pkey; validated=true
PRIMARY KEY (id)
-- Workflow_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Workflow_pkey" ON public."Workflow" USING btree (id);
CREATE INDEX "Workflow_tenantId_idx" ON public."Workflow" USING btree ("tenantId");
CREATE INDEX "Workflow_tenantId_isActive_idx" ON public."Workflow" USING btree ("tenantId", "isActive");
CREATE UNIQUE INDEX "Workflow_tenantId_normalizedName_key" ON public."Workflow" USING btree ("tenantId", workflow_name_key(name));
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- Workflow_pkey; validated=true
PRIMARY KEY (id)
-- Workflow_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "Workflow_id_tenantId_key" ON public."Workflow" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "Workflow_pkey" ON public."Workflow" USING btree (id);
CREATE INDEX "Workflow_tenantId_idx" ON public."Workflow" USING btree ("tenantId");
CREATE INDEX "Workflow_tenantId_isActive_idx" ON public."Workflow" USING btree ("tenantId", "isActive");
CREATE UNIQUE INDEX "Workflow_tenantId_normalizedName_key" ON public."Workflow" USING btree ("tenantId", workflow_name_key(name));
```

</details>

### WorkflowExecutionRun

Execution attempt and summary. Category C. Composite trigger FK including workflowId and tenantId; keep indexed workflow projection

- Initial audit rows: **21**; immediately before cleanup: **21**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): startedAt=2026-10-05T01:27:31.289Z; completedAt=2026-10-05T01:27:31.863Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "WorkflowExecutionRun_pkey" ON public."WorkflowExecutionRun" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); trigger: WorkflowTriggerRecord (@relation(fields: [triggerId, workflowId, tenantId], references: [id, workflowId, tenantId])).
- Children: WorkflowExecutionStep.execution.
- Direct runtime-source read sites: [backend/src/modules/notifications/notification-events.service.ts:104](../../backend/src/modules/notifications/notification-events.service.ts#L104); [backend/src/modules/automation/workflows/workflows.repository.ts:40](../../backend/src/modules/automation/workflows/workflows.repository.ts#L40); [backend/src/modules/automation/workflows/workflows.repository.ts:112](../../backend/src/modules/automation/workflows/workflows.repository.ts#L112); [backend/src/modules/automation/workflows/workflows.repository.ts:115](../../backend/src/modules/automation/workflows/workflows.repository.ts#L115); [backend/src/modules/automation/workflows/workflows.repository.ts:151](../../backend/src/modules/automation/workflows/workflows.repository.ts#L151)
- Direct runtime-source write sites: [backend/src/modules/automation/workflows/workflows.repository.ts:98](../../backend/src/modules/automation/workflows/workflows.repository.ts#L98); [backend/src/modules/automation/workflows/workflows.repository.ts:106](../../backend/src/modules/automation/workflows/workflows.repository.ts#L106)
- Possible nested relation access (review with parent): None found.
- Search matches across repository: 77 in 33 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/notifications/notification-events.service.ts:104](../../backend/src/modules/notifications/notification-events.service.ts#L104); [backend/src/modules/automation/workflows/workflows.repository.ts:40](../../backend/src/modules/automation/workflows/workflows.repository.ts#L40); [backend/src/modules/automation/workflows/workflows.repository.ts:112](../../backend/src/modules/automation/workflows/workflows.repository.ts#L112); [backend/src/modules/automation/workflows/workflows.repository.ts:115](../../backend/src/modules/automation/workflows/workflows.repository.ts#L115); [backend/src/modules/automation/workflows/workflows.repository.ts:151](../../backend/src/modules/automation/workflows/workflows.repository.ts#L151); [backend/src/modules/automation/workflows/workflows.repository.ts:98](../../backend/src/modules/automation/workflows/workflows.repository.ts#L98); [backend/src/modules/automation/workflows/workflows.repository.ts:106](../../backend/src/modules/automation/workflows/workflows.repository.ts#L106)
- Normalization assessment: workflowId can disagree with trigger.workflowId. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| workflowId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| triggerId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| entityType | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| entityId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| status | String | @default("running") // running\|completed\|failed\|skipped | 0 | KEEP — attribute owned by this row; not a separate entity |
| startedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| completedAt | DateTime? | No explicit default; nullable | 0 | KEEP — lifecycle time or actor provenance |
| errorMessage | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- WorkflowExecutionRun_pkey; validated=true
PRIMARY KEY (id)
-- WorkflowExecutionRun_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- WorkflowExecutionRun_triggerId_fkey; validated=true
FOREIGN KEY ("triggerId") REFERENCES "WorkflowTriggerRecord"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "WorkflowExecutionRun_pkey" ON public."WorkflowExecutionRun" USING btree (id);
CREATE INDEX "WorkflowExecutionRun_tenantId_idx" ON public."WorkflowExecutionRun" USING btree ("tenantId");
CREATE INDEX "WorkflowExecutionRun_tenantId_startedAt_idx" ON public."WorkflowExecutionRun" USING btree ("tenantId", "startedAt");
CREATE INDEX "WorkflowExecutionRun_tenantId_workflowId_status_idx" ON public."WorkflowExecutionRun" USING btree ("tenantId", "workflowId", status);
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- WorkflowExecutionRun_pkey; validated=true
PRIMARY KEY (id)
-- WorkflowExecutionRun_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- WorkflowExecutionRun_triggerId_workflowId_tenantId_fkey; validated=true
FOREIGN KEY ("triggerId", "workflowId", "tenantId") REFERENCES "WorkflowTriggerRecord"(id, "workflowId", "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "WorkflowExecutionRun_id_tenantId_key" ON public."WorkflowExecutionRun" USING btree (id, "tenantId");
CREATE UNIQUE INDEX "WorkflowExecutionRun_pkey" ON public."WorkflowExecutionRun" USING btree (id);
CREATE INDEX "WorkflowExecutionRun_tenantId_idx" ON public."WorkflowExecutionRun" USING btree ("tenantId");
CREATE INDEX "WorkflowExecutionRun_tenantId_startedAt_idx" ON public."WorkflowExecutionRun" USING btree ("tenantId", "startedAt");
CREATE INDEX "WorkflowExecutionRun_tenantId_workflowId_status_idx" ON public."WorkflowExecutionRun" USING btree ("tenantId", "workflowId", status);
```

</details>

### WorkflowExecutionStep

Individual action execution result. Category C. Composite execution FK; retain independent output and errors

- Initial audit rows: **38**; immediately before cleanup: **38**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): executedAt=2026-10-05T01:27:31.671Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "WorkflowExecutionStep_pkey" ON public."WorkflowExecutionStep" USING btree (id)`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); execution: WorkflowExecutionRun (@relation(fields: [executionId, tenantId], references: [id, tenantId], onDelete: Cascade)).
- Children: None declared.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/automation/workflows/workflows.repository.ts:109](../../backend/src/modules/automation/workflows/workflows.repository.ts#L109); [backend/src/modules/automation/workflows/workflows.repository.ts:148](../../backend/src/modules/automation/workflows/workflows.repository.ts#L148)
- Possible nested relation access (review with parent): [backend/src/modules/automation/workflows/workflows.repository.ts:117](../../backend/src/modules/automation/workflows/workflows.repository.ts#L117) `steps`
- Search matches across repository: 55 in 29 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/automation/workflows/workflows.repository.ts:109](../../backend/src/modules/automation/workflows/workflows.repository.ts#L109); [backend/src/modules/automation/workflows/workflows.repository.ts:148](../../backend/src/modules/automation/workflows/workflows.repository.ts#L148)
- Normalization assessment: Scope can disagree with run; repeated stepIndex semantics must be retained. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| executionId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| stepIndex | Int | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| actionType | String | // create_task\|send_email\|assign_owner\|update_field\|send_sms\|change_status\|... | 0 | KEEP — attribute owned by this row; not a separate entity |
| status | String | // success\|failed\|skipped | 0 | KEEP — attribute owned by this row; not a separate entity |
| output | Json? | No explicit default; nullable | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| error | String? | No explicit default; nullable | 0 | KEEP — attribute owned by this row; not a separate entity |
| executedAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- WorkflowExecutionStep_executionId_fkey; validated=true
FOREIGN KEY ("executionId") REFERENCES "WorkflowExecutionRun"(id) ON UPDATE CASCADE ON DELETE CASCADE
-- WorkflowExecutionStep_pkey; validated=true
PRIMARY KEY (id)
-- WorkflowExecutionStep_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "WorkflowExecutionStep_executionId_idx" ON public."WorkflowExecutionStep" USING btree ("executionId");
CREATE UNIQUE INDEX "WorkflowExecutionStep_pkey" ON public."WorkflowExecutionStep" USING btree (id);
CREATE INDEX "WorkflowExecutionStep_tenantId_idx" ON public."WorkflowExecutionStep" USING btree ("tenantId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- WorkflowExecutionStep_executionId_tenantId_fkey; validated=true
FOREIGN KEY ("executionId", "tenantId") REFERENCES "WorkflowExecutionRun"(id, "tenantId") ON UPDATE CASCADE ON DELETE CASCADE
-- WorkflowExecutionStep_pkey; validated=true
PRIMARY KEY (id)
-- WorkflowExecutionStep_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE INDEX "WorkflowExecutionStep_executionId_idx" ON public."WorkflowExecutionStep" USING btree ("executionId");
CREATE UNIQUE INDEX "WorkflowExecutionStep_pkey" ON public."WorkflowExecutionStep" USING btree (id);
CREATE INDEX "WorkflowExecutionStep_tenantId_idx" ON public."WorkflowExecutionStep" USING btree ("tenantId");
```

</details>

### WorkflowTriggerRecord

Idempotent observed workflow event. Category C. Composite workflow FK; keep event payload snapshot

- Initial audit rows: **21**; immediately before cleanup: **21**; after cleanup: **0**; final live rows: **0**.
- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): triggeredAt=2026-10-05T01:27:31.268Z
- Primary key: PRIMARY KEY (id).
- Unique constraints/indexes: `CREATE UNIQUE INDEX "WorkflowTriggerRecord_pkey" ON public."WorkflowTriggerRecord" USING btree (id)`; `CREATE UNIQUE INDEX workflow_event_once ON public."WorkflowTriggerRecord" USING btree ("tenantId", "workflowId", "eventId")`.
- Parent relations: tenant: Tenant (@relation(fields: [tenantId], references: [id])); workflow: Workflow (@relation(fields: [workflowId, tenantId], references: [id, tenantId])).
- Children: WorkflowExecutionRun.trigger.
- Direct runtime-source read sites: None found; see nested access below.
- Direct runtime-source write sites: [backend/src/modules/automation/workflows/workflows.repository.ts:97](../../backend/src/modules/automation/workflows/workflows.repository.ts#L97)
- Possible nested relation access (review with parent): [backend/src/modules/automation/workflows/workflows.service.ts:95](../../backend/src/modules/automation/workflows/workflows.service.ts#L95) `trigger`; [backend/src/modules/automation/workflows/workflows.repository.ts:31](../../backend/src/modules/automation/workflows/workflows.repository.ts#L31) `trigger`; [backend/src/modules/automation/triggers/triggers.service.ts:11](../../backend/src/modules/automation/triggers/triggers.service.ts#L11) `trigger`
- Search matches across repository: 54 in 21 files. Complete locations are reproducible in the local source evidence JSON.
- Frontend contract dependency: API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.
- Worker/integration source dependencies: [backend/src/modules/automation/workflows/workflows.repository.ts:97](../../backend/src/modules/automation/workflows/workflows.repository.ts#L97)
- Normalization assessment: Workflow/tenant scope not enforced by FK. Final action: **NORMALIZE**. Risk: HIGH.

| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |
|---|---|---|---|---|
| eventId | String? | No explicit default; nullable | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| id | String | @id @default(uuid()) | 0 | KEEP — row identity |
| tenantId | String | No explicit default; required | 0 | KEEP — scope projection enforced by FK/middleware |
| workflowId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| triggerType | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| entityType | String | No explicit default; required | 0 | KEEP — attribute owned by this row; not a separate entity |
| entityId | String | No explicit default; required | 0 | KEEP — relationship or historical/provider identity; see declared parents |
| triggeredAt | DateTime | @default(now()) | 0 | KEEP — lifecycle time or actor provenance |
| payload | Json? | No explicit default; nullable | 0 | KEEP: Historical event, execution result, input or send-time snapshot; independent records already have rows. |

<details><summary>Initial live constraints and indexes</summary>

```sql
-- WorkflowTriggerRecord_pkey; validated=true
PRIMARY KEY (id)
-- WorkflowTriggerRecord_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- WorkflowTriggerRecord_workflowId_fkey; validated=true
FOREIGN KEY ("workflowId") REFERENCES "Workflow"(id) ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "WorkflowTriggerRecord_pkey" ON public."WorkflowTriggerRecord" USING btree (id);
CREATE INDEX "WorkflowTriggerRecord_tenantId_idx" ON public."WorkflowTriggerRecord" USING btree ("tenantId");
CREATE INDEX "WorkflowTriggerRecord_tenantId_triggeredAt_idx" ON public."WorkflowTriggerRecord" USING btree ("tenantId", "triggeredAt");
CREATE INDEX "WorkflowTriggerRecord_tenantId_workflowId_idx" ON public."WorkflowTriggerRecord" USING btree ("tenantId", "workflowId");
CREATE UNIQUE INDEX workflow_event_once ON public."WorkflowTriggerRecord" USING btree ("tenantId", "workflowId", "eventId");
```

</details>

<details><summary>Final live constraints and indexes (changed since initial audit)</summary>

```sql
-- WorkflowTriggerRecord_pkey; validated=true
PRIMARY KEY (id)
-- WorkflowTriggerRecord_tenantId_fkey; validated=true
FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- WorkflowTriggerRecord_workflowId_tenantId_fkey; validated=true
FOREIGN KEY ("workflowId", "tenantId") REFERENCES "Workflow"(id, "tenantId") ON UPDATE CASCADE ON DELETE RESTRICT
CREATE UNIQUE INDEX "WorkflowTriggerRecord_id_workflowId_tenantId_key" ON public."WorkflowTriggerRecord" USING btree (id, "workflowId", "tenantId");
CREATE UNIQUE INDEX "WorkflowTriggerRecord_pkey" ON public."WorkflowTriggerRecord" USING btree (id);
CREATE INDEX "WorkflowTriggerRecord_tenantId_idx" ON public."WorkflowTriggerRecord" USING btree ("tenantId");
CREATE INDEX "WorkflowTriggerRecord_tenantId_triggeredAt_idx" ON public."WorkflowTriggerRecord" USING btree ("tenantId", "triggeredAt");
CREATE INDEX "WorkflowTriggerRecord_tenantId_workflowId_idx" ON public."WorkflowTriggerRecord" USING btree ("tenantId", "workflowId");
CREATE UNIQUE INDEX workflow_event_once ON public."WorkflowTriggerRecord" USING btree ("tenantId", "workflowId", "eventId");
```

</details>

### _prisma_migrations

Prisma-owned migration ledger; category F. Retained unchanged by data cleanup. Primary key id. No business FK. Prisma migrate reads and writes it; application runtime does not. Original rows: 86. Never treat failed/rolled-back attempts as successful application.

## Every JSON field

| Field | Decision | Reason |
|---|---|---|
| Deal.closingValues | KEEP | Values for tenant-defined closing fields; definitions are relational, values are dynamic. |
| Deal.closingSnapshot | KEEP | Immutable closing evidence snapshot. |
| Activity.metadata | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| ClosingFieldDefinition.definition | KEEP | Flexible preference or field definition; no independent record identity demonstrated. |
| MarketingForm.publishedConfig | KEEP | Published definition snapshot differs intentionally from editable draft. |
| MarketingForm.fields | KEEP | Typed flexible builder configuration; individual submissions use FormSubmission. |
| MarketingForm.design | KEEP | Typed flexible builder configuration; individual submissions use FormSubmission. |
| MarketingForm.settings | KEEP | Typed flexible builder configuration; individual submissions use FormSubmission. |
| FormSubmission.publishedConfig | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| FormSubmission.values | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| FormSubmission.tracking | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| CampaignContact.personalization | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| Workflow.conditions | KEEP | Validated condition/action DSL; referenced CRM IDs are validated by runtime. Definition versioning/relational targets require separate design. |
| Workflow.actions | KEEP | Validated condition/action DSL; referenced CRM IDs are validated by runtime. Definition versioning/relational targets require separate design. |
| WorkflowTriggerRecord.payload | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| WorkflowExecutionStep.output | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| AuditLog.changeset | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| AuditLog.metadata | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |
| UserPreference.value | KEEP | Flexible preference or field definition; no independent record identity demonstrated. |
| TenantPreference.value | KEEP JSON | Configuration and cursors remain JSON. mailbox-thread mapping is NORMALIZED into MailboxThreadAssociation in migrations 85/86. |
| CrmImportRowResult.data | KEEP | Historical event, execution result, input or send-time snapshot; independent records already have rows. |

## Every scalar array field

| Field | Decision | Reason |
|---|---|---|
| Account.tags | KEEP | Simple tag values; no independently managed tag entity or FK identity. |
| Account.productInterests | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Account.activeProducts | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Lead.productInterest | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Lead.productInterestIds | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Contact.activeProducts | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Contact.productInterests | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Stage.requiredFields | KEEP | Ordered names of validation fields, not database entity IDs. |
| Deal.productInterestIds | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Deal.productInterests | HIDDEN RELATIONSHIP — NORMALIZED | Product junctions/FK own current selections. Compatibility arrays are empty for normalized stored rows and projected from canonical products; unresolved historical selections are retained explicitly. |
| Deal.tags | KEEP | Simple tag values; no independently managed tag entity or FK identity. |
| EmailAccount.scopes | KEEP | Provider-defined OAuth permission tokens. |
| MailboxMessage.recipients | KEEP | Captured email addresses for one provider message, not CRM person IDs. |
| MailboxMessage.labels | KEEP | Provider-defined message labels. |

## Live enum domains

| Enum | Values |
|---|---|
| CampaignStatus | DRAFT, ACTIVE, PAUSED, COMPLETED, SCHEDULED, SENDING, SENT, PARTIALLY_SENT, FAILED |
| CampaignType | EMAIL, SMS, MULTI_CHANNEL |
| ContactLifecycleStage | LEAD, QUALIFIED, CONTACT, CUSTOMER, CHURNED, DISQUALIFIED |
| ContactStatus | HOT, WARM, COLD, CANCELLED, CLOSED |
| CrmImportModule | LEAD, CONTACT, ACCOUNT, DEAL |
| Priority | LOW, MEDIUM, HIGH |
| TenantStatus | SANDBOX, ACTIVE, SUSPENDED, CANCELLED, DELETED |
| UserStatus | ACTIVE, INACTIVE, PENDING |

## Current live database triggers

Full function definitions are captured in private catalog evidence. Temporary compatibility bridges are removed by migration 86.

| Table | Trigger | Function |
|---|---|---|
| Account | crm_scope_immutable | crm_scope_immutable |
| Activity | crm_scope_immutable | crm_scope_immutable |
| Activity | scope_accountId | crm_check_relation_scope |
| Activity | scope_customerId | crm_check_relation_scope |
| Activity | scope_dealId | crm_check_relation_scope |
| Activity | scope_invoiceId | crm_check_relation_scope |
| Activity | scope_leadId | crm_check_relation_scope |
| Activity | scope_taskId | crm_check_relation_scope |
| Campaign | crm_scope_immutable | crm_scope_immutable |
| Campaign | scope_emailTemplateId | crm_check_relation_scope |
| Campaign | scope_smsTemplateId | crm_check_relation_scope |
| Campaign | scope_targetAudienceId | crm_check_relation_scope |
| CampaignContact | crm_scope_immutable | crm_scope_immutable |
| CampaignContact | scope_campaignId | crm_check_relation_scope |
| CampaignContact | scope_customerId | crm_check_relation_scope |
| CampaignContact | scope_leadId | crm_check_relation_scope |
| CampaignMetrics | crm_scope_immutable | crm_scope_immutable |
| CampaignMetrics | scope_campaignId | crm_check_relation_scope |
| Contact | crm_scope_immutable | crm_scope_immutable |
| Contact | scope_accountId | crm_check_relation_scope |
| ContactDeal | crm_relationship_projection | crm_relationship_projection |
| ContactDeal | crm_scope_immutable | crm_scope_immutable |
| ContactDeal | scope_contactId | crm_check_relation_scope |
| ContactDeal | scope_dealId | crm_check_relation_scope |
| CrmImportChunk | crm_child_parent_immutable | crm_child_parent_immutable |
| CrmImportJob | crm_import_source_scope | crm_import_source_scope |
| CrmImportJob | crm_scope_immutable | crm_scope_immutable |
| CrmImportJob | scope_createdbyid | crm_check_relation_scope |
| CrmImportRowResult | crm_child_parent_immutable | crm_child_parent_immutable |
| CrmImportRowResult | crm_import_record_scope | crm_import_record_scope |
| CrmImportUpload | crm_import_upload_immutable | crm_import_upload_immutable |
| CrmImportUpload | crm_scope_immutable | crm_scope_immutable |
| CrmImportUpload | scope_actorid | crm_check_relation_scope |
| Deal | Deal_preserve_won_history | preserve_deal_won_history |
| Deal | crm_scope_immutable | crm_scope_immutable |
| Deal | scope_accountId | crm_check_relation_scope |
| Deal | scope_customerId | crm_check_relation_scope |
| Deal | scope_leadId | crm_check_relation_scope |
| Deal | scope_pipelineId | crm_check_relation_scope |
| Deal | scope_stageId | crm_check_relation_scope |
| DealStageHistory | crm_scope_immutable | crm_scope_immutable |
| DealStageHistory | scope_dealId | crm_check_relation_scope |
| DealStageHistory | scope_newStageId | crm_check_relation_scope |
| DealStageHistory | scope_previousStageId | crm_check_relation_scope |
| EmailDeliveryLog | crm_scope_immutable | crm_scope_immutable |
| EmailDeliveryLog | scope_campaignId | crm_check_relation_scope |
| EmailDeliveryLog | scope_customerId | crm_check_relation_scope |
| EmailDeliveryLog | scope_leadId | crm_check_relation_scope |
| EmailEvent | crm_scope_immutable | crm_scope_immutable |
| EmailEvent | scope_deliveryLogId | crm_check_relation_scope |
| Lead | crm_scope_immutable | crm_scope_immutable |
| Lead | scope_accountId | crm_check_relation_scope |
| Lead | scope_contactId | crm_check_relation_scope |
| LeadDeal | crm_relationship_projection | crm_relationship_projection |
| LeadDeal | crm_scope_immutable | crm_scope_immutable |
| LeadDeal | scope_dealId | crm_check_relation_scope |
| LeadDeal | scope_leadId | crm_check_relation_scope |
| MailboxThreadAssociation | crm_mailbox_delete_bridge | crm_mailbox_delete_bridge |
| MailboxThreadAssociation | crm_mailbox_relation_bridge | crm_mailbox_relation_bridge |
| MarketingForm | crm_scope_immutable | crm_scope_immutable |
| Notification | crm_scope_immutable | crm_scope_immutable |
| Pipeline | crm_scope_immutable | crm_scope_immutable |
| Stage | crm_scope_immutable | crm_scope_immutable |
| Stage | scope_pipelineId | crm_check_relation_scope |
| TargetAudience | crm_scope_immutable | crm_scope_immutable |
| TargetAudienceCondition | crm_child_parent_immutable | crm_child_parent_immutable |
| Task | crm_scope_immutable | crm_scope_immutable |
| Task | scope_customerId | crm_check_relation_scope |
| Task | scope_dealId | crm_check_relation_scope |
| Task | scope_leadId | crm_check_relation_scope |
| TaskAccount | crm_relationship_projection | crm_relationship_projection |
| TaskContact | crm_relationship_projection | crm_relationship_projection |
| TaskDeal | crm_relationship_projection | crm_relationship_projection |
| TaskLead | crm_relationship_projection | crm_relationship_projection |
| Template | crm_scope_immutable | crm_scope_immutable |
| TenantPreference | crm_mailbox_delete_bridge | crm_mailbox_delete_bridge |
| TenantPreference | crm_mailbox_preference_bridge | crm_mailbox_preference_bridge |
| Workflow | crm_scope_immutable | crm_scope_immutable |
| WorkflowExecutionRun | crm_scope_immutable | crm_scope_immutable |
| WorkflowExecutionRun | scope_triggerId | crm_check_relation_scope |
| WorkflowExecutionRun | scope_workflowId | crm_check_relation_scope |
| WorkflowExecutionStep | crm_scope_immutable | crm_scope_immutable |
| WorkflowExecutionStep | scope_executionId | crm_check_relation_scope |
| WorkflowTriggerRecord | crm_scope_immutable | crm_scope_immutable |
| WorkflowTriggerRecord | scope_workflowId | crm_check_relation_scope |

## All migration files and final live ledger comparison

Historical files are unchanged by this work. Checksum comparison accepts only LF/CRLF differences. A mismatch is reported, not repaired by editing history.

| Migration | Lines | Successful live record | Checksum | Referenced tables |
|---|---|---|---|---|
| [20260723114720_init](../../backend/prisma/migrations/20260723114720_init/migration.sql) | 1360 | 1 | MATCH | SystemAdmin, PricingPlan, PlanFeature, Tenant, Subscription, PaymentMethod, User, RoleDefinition, RolePermission, UserRole, Session, TenantInvitation, TenantDocument, Environment, Organization, Contact, Pipeline, Stage, Deal, ContactDeal, DealStageHistory, DealAction, Task, Activity, Notification, TargetAudience, TargetAudienceCondition, Campaign, CampaignMetrics, CampaignContact, Template, Workflow, WorkflowTriggerRecord, WorkflowExecutionRun, WorkflowExecutionStep, Invoice, PaymentTransaction, ServiceOrder, Asset, InventoryItem, AuditLog, EmailDeliveryLog |
| [20260723122302_init_auth](../../backend/prisma/migrations/20260723122302_init_auth/migration.sql) | 37 | 1 | MATCH | User, VerificationToken, PasswordResetToken |
| [20260806120121_add_missing_columns](../../backend/prisma/migrations/20260806120121_add_missing_columns/migration.sql) | 42 | 1 | MATCH | Contact, Deal, Organization, User, LoginOtpToken |
| [20260806145801_add_registration_otp_token](../../backend/prisma/migrations/20260806145801_add_registration_otp_token/migration.sql) | 15 | 1 | MATCH | RegistrationOtpToken |
| [20260807000000_add_oauth_account_and_user_avatar](../../backend/prisma/migrations/20260807000000_add_oauth_account_and_user_avatar/migration.sql) | 3 | 1 | MATCH |  |
| [20260807080905_init](../../backend/prisma/migrations/20260807080905_init/migration.sql) | 3 | 1 | MATCH | Deal |
| [20260807100000_add_tenant_id_to_stage](../../backend/prisma/migrations/20260807100000_add_tenant_id_to_stage/migration.sql) | 16 | 1 | MATCH | Stage, Tenant |
| [20260807110000_add_contact_lifecycle](../../backend/prisma/migrations/20260807110000_add_contact_lifecycle/migration.sql) | 39 | 1 | MATCH | Contact |
| [20260807120000_normalize_deal_tags](../../backend/prisma/migrations/20260807120000_normalize_deal_tags/migration.sql) | 12 | 1 | MATCH | Deal |
| [20260807130000_add_stage_governance](../../backend/prisma/migrations/20260807130000_add_stage_governance/migration.sql) | 7 | 1 | MATCH | Stage, Pipeline |
| [20260807140000_add_email_account](../../backend/prisma/migrations/20260807140000_add_email_account/migration.sql) | 29 | 1 | MATCH | EmailAccount |
| [20260808000000_add_oauth_account](../../backend/prisma/migrations/20260808000000_add_oauth_account/migration.sql) | 49 | 1 | MATCH | User, OAuthAccount |
| [20260808063611_init_campaigns](../../backend/prisma/migrations/20260808063611_init_campaigns/migration.sql) | 91 | 1 | MATCH | Deal, Stage, SMSQueue, EmailEvent, AutomationRule, Tenant, Campaign, Contact, EmailDeliveryLog |
| [20260808100000_add_stripe_fields](../../backend/prisma/migrations/20260808100000_add_stripe_fields/migration.sql) | 59 | 1 | MATCH | Tenant, PricingPlan, Subscription, PaymentTransaction |
| [20260808163955_split_crm_models](../../backend/prisma/migrations/20260808163955_split_crm_models/migration.sql) | 339 | 1 | MATCH | Account, Lead, Customer, LeadDeal, CustomerDeal, Deal, Task, Activity, Invoice, ServiceOrder, CampaignContact, EmailDeliveryLog, SMSQueue, Tenant, User |
| [20260809000000_add_oauth_account_back](../../backend/prisma/migrations/20260809000000_add_oauth_account_back/migration.sql) | 47 | 1 | MATCH | OAuthAccount, User |
| [20260809170546_add_userid_to_login_otp_token](../../backend/prisma/migrations/20260809170546_add_userid_to_login_otp_token/migration.sql) | 9 | 1 | MATCH | LoginOtpToken |
| [20260809200000_sync_crm_rename](../../backend/prisma/migrations/20260809200000_sync_crm_rename/migration.sql) | 43 | 1 | MATCH | Task, Activity, Invoice, ServiceOrder |
| [20260810000000_add_deal_billing_frequency](../../backend/prisma/migrations/20260810000000_add_deal_billing_frequency/migration.sql) | 3 | 1 | MATCH | Deal |
| [20260810013530_perf_add_missing_indexes](../../backend/prisma/migrations/20260810013530_perf_add_missing_indexes/migration.sql) | 9 | 1 | MATCH |  |
| [20260812000000_remove_otp_tokens](../../backend/prisma/migrations/20260812000000_remove_otp_tokens/migration.sql) | 6 | 1 | MATCH | LoginOtpToken |
| [20260816101504_add_preference_tables](../../backend/prisma/migrations/20260816101504_add_preference_tables/migration.sql) | 48 | 1 | MATCH | UserPreference, TenantPreference, Tenant, User |
| [20260816120000_remove_service_orders_assets_inventory](../../backend/prisma/migrations/20260816120000_remove_service_orders_assets_inventory/migration.sql) | 11 | 1 | MATCH | InventoryItem, Asset, ServiceOrder |
| [20260821000000_add_lead_import](../../backend/prisma/migrations/20260821000000_add_lead_import/migration.sql) | 56 | 1 | MATCH | LeadImport, LeadImportResult, Tenant, User |
| [20260821000000_add_lead_updated_at](../../backend/prisma/migrations/20260821000000_add_lead_updated_at/migration.sql) | 3 | 1 | MATCH | Lead |
| [20260821100000_add_lead_missing_columns](../../backend/prisma/migrations/20260821100000_add_lead_missing_columns/migration.sql) | 23 | 1 | MATCH | Lead, User |
| [20260822000000_add_lead_conversion_fields](../../backend/prisma/migrations/20260822000000_add_lead_conversion_fields/migration.sql) | 14 | 1 | MATCH | Lead, Contact, User |
| [20260823000000_add_activity_account_campaign_constraints](../../backend/prisma/migrations/20260823000000_add_activity_account_campaign_constraints/migration.sql) | 35 | 1 | MATCH | Activity, Account, CampaignContact |
| [20260823000000_add_plan_feature_is_enabled](../../backend/prisma/migrations/20260823000000_add_plan_feature_is_enabled/migration.sql) | 4 | 1 | MATCH | PlanFeature |
| [20260823100000_add_payment_methods_to_pricing_plan](../../backend/prisma/migrations/20260823100000_add_payment_methods_to_pricing_plan/migration.sql) | 6 | 1 | MATCH | PricingPlan |
| [20260826000000_add_stripe_webhook_event_log](../../backend/prisma/migrations/20260826000000_add_stripe_webhook_event_log/migration.sql) | 30 | 1 | MATCH | StripeWebhookEvent |
| [20260826100000_add_subscription_seat_downgrade_fields](../../backend/prisma/migrations/20260826100000_add_subscription_seat_downgrade_fields/migration.sql) | 7 | 1 | MATCH | Subscription |
| [20260826200000_add_email_verification_token_and_onboarding](../../backend/prisma/migrations/20260826200000_add_email_verification_token_and_onboarding/migration.sql) | 34 | 1 | MATCH | Tenant, EmailVerificationToken, User |
| [20260827000000_patch_email_verified_active_users](../../backend/prisma/migrations/20260827000000_patch_email_verified_active_users/migration.sql) | 8 | 1 | MATCH | User |
| [20260902000000_add_contact_account_id](../../backend/prisma/migrations/20260902000000_add_contact_account_id/migration.sql) | 32 | 1 | MATCH | Contact, Account |
| [20260905000000_remove_organization_model](../../backend/prisma/migrations/20260905000000_remove_organization_model/migration.sql) | 68 | 1 | MATCH | Contact, Deal, Organization |
| [20260906000000_add_tenant_groups_domains](../../backend/prisma/migrations/20260906000000_add_tenant_groups_domains/migration.sql) | 101 | 1 | MATCH | TenantGroup, Tenant, TenantGroupMember, User, TenantDomain, TenantDomainSettings |
| [20260906113428_rename_plantype_free_to_starter](../../backend/prisma/migrations/20260906113428_rename_plantype_free_to_starter/migration.sql) | 11 | 1 | MATCH | Tenant |
| [20260906120000_add_subscription_none_and_owner_user_id](../../backend/prisma/migrations/20260906120000_add_subscription_none_and_owner_user_id/migration.sql) | 8 | 1 | MATCH |  |
| [20260906120001_tenant_owner_and_subscription_defaults](../../backend/prisma/migrations/20260906120001_tenant_owner_and_subscription_defaults/migration.sql) | 13 | 1 | MATCH | Tenant |
| [20260907000000_hash_invitation_tokens](../../backend/prisma/migrations/20260907000000_hash_invitation_tokens/migration.sql) | 24 | 1 | MATCH | TenantInvitation |
| [20260908000000_add_payment_methods_to_remaining_tables](../../backend/prisma/migrations/20260908000000_add_payment_methods_to_remaining_tables/migration.sql) | 25 | 1 | MATCH | SystemAdmin, PaymentMethod, TargetAudience, EmailAccount, AutomationRule |
| [20260909000000_add_marketing_forms](../../backend/prisma/migrations/20260909000000_add_marketing_forms/migration.sql) | 32 | 1 | MATCH | MarketingForm, Tenant, User |
| [20260909000001_add_tenant_currency](../../backend/prisma/migrations/20260909000001_add_tenant_currency/migration.sql) | 7 | 1 | MATCH | Tenant |
| [20260911000001_fix_role_defaults_and_backfill](../../backend/prisma/migrations/20260911000001_fix_role_defaults_and_backfill/migration.sql) | 75 | 1 | MATCH | User, TenantDomainSettings, RoleDefinition |
| [20260911000002_guest_free_plan_crud](../../backend/prisma/migrations/20260911000002_guest_free_plan_crud/migration.sql) | 78 | 1 | MATCH | RolePermission, Tenant |
| [20260912135215_tenant_document_key_prerequisite](../../backend/prisma/migrations/20260912135215_tenant_document_key_prerequisite/migration.sql) | 49 | 1 | MATCH | TenantDocument, CampaignContact |
| [20260912135216_add_business_verification](../../backend/prisma/migrations/20260912135216_add_business_verification/migration.sql) | 285 | 1 | MATCH | Activity, CampaignContact, Customer, CustomerDeal, Deal, EmailDeliveryLog, Invoice, SMSQueue, Task, Account, Lead, OAuthAccount, TenantDocument, TenantDomain, TenantDomainSettings, TenantGroup, AccountImport, AccountImportResult, ContactImport, ContactImportResult, Contact, Tenant, User |
| [20260917000000_tenant_company_website](../../backend/prisma/migrations/20260917000000_tenant_company_website/migration.sql) | 2 | 1 | MATCH | Tenant |
| [20260919000000_internal_accounts](../../backend/prisma/migrations/20260919000000_internal_accounts/migration.sql) | 5 | 1 | MATCH | User |
| [20260924110000_campaign_brevo_delivery](../../backend/prisma/migrations/20260924110000_campaign_brevo_delivery/migration.sql) | 20 | 1 | MATCH | TargetAudience, Campaign, CampaignContact, EmailDeliveryLog, EmailEvent, CampaignEmailQuota, Lead, Contact |
| [20261000000000_add_business_verification](../../backend/prisma/migrations/20261000000000_add_business_verification/migration.sql) | 33 | 1 | MATCH | Tenant, TenantDocument |
| [20261001000000_retire_guest_role](../../backend/prisma/migrations/20261001000000_retire_guest_role/migration.sql) | 45 | 1 | MATCH | User, RoleDefinition, Session, TenantInvitation, TenantDomainSettings |
| [20261001120000_add_crm_import_tables](../../backend/prisma/migrations/20261001120000_add_crm_import_tables/migration.sql) | 74 | 1 | MATCH | AccountImport, Tenant, User, AccountImportResult, ContactImport, ContactImportResult |
| [20261002000000_crm_environments](../../backend/prisma/migrations/20261002000000_crm_environments/migration.sql) | 343 | 1 | MATCH | User, AuditLog, Account, Lead, Contact, Pipeline, Stage, Deal, LeadDeal, ContactDeal, DealStageHistory, DealAction, Task, Activity, Notification, TargetAudience, Campaign, MarketingForm, CampaignMetrics, CampaignContact, Template, Workflow, WorkflowTriggerRecord, WorkflowExecutionRun, WorkflowExecutionStep, Invoice, PaymentTransaction, EmailDeliveryLog, SMSQueue, EmailEvent, AutomationRule, LeadImport, AccountImport, ContactImport |
| [20261003000000_remove_user_timezone_add_org_domain](../../backend/prisma/migrations/20261003000000_remove_user_timezone_add_org_domain/migration.sql) | 3 | 1 | MATCH | User, Tenant |
| [20261004000000_deal_imports_user_recovery](../../backend/prisma/migrations/20261004000000_deal_imports_user_recovery/migration.sql) | 60 | 1 | MATCH | PasswordResetToken, DealImport, DealImportResult, Tenant, User |
| [20261005000000_contact_relation_names](../../backend/prisma/migrations/20261005000000_contact_relation_names/migration.sql) | 68 | 1 | MATCH | Contact, CustomerDeal, Customer |
| [20261006000000_workflow_reliability](../../backend/prisma/migrations/20261006000000_workflow_reliability/migration.sql) | 11 | 1 | MATCH | Workflow, WorkflowTriggerRecord |
| [20261007000000_add_mfa](../../backend/prisma/migrations/20261007000000_add_mfa/migration.sql) | 48 | 1 | MATCH | User, MfaChallenge, MfaRecoveryCode |
| [20261008000000_remove_retired_billing_domains](../../backend/prisma/migrations/20261008000000_remove_retired_billing_domains/migration.sql) | 119 | 1 | MATCH | PlanFeature, Subscription, PaymentMethod, TenantDomain, TenantDomainSettings, Activity, Invoice, PaymentTransaction, SystemAdmin, Tenant, TargetAudience, EmailAccount, AutomationRule, PricingPlan, StripeWebhookEvent |
| [20261009000000_lead_archive_state](../../backend/prisma/migrations/20261009000000_lead_archive_state/migration.sql) | 6 | 1 | MATCH | Lead |
| [20261010000000_public_forms](../../backend/prisma/migrations/20261010000000_public_forms/migration.sql) | 56 | 1 | MATCH | MarketingForm, FormSubmission, Lead, Contact |
| [20261011000000_task_multiple_associations](../../backend/prisma/migrations/20261011000000_task_multiple_associations/migration.sql) | 135 | 1 | MATCH | Lead, Contact, Deal, Account, TaskLead, TaskContact, TaskDeal, TaskAccount, Task |
| [20261012000000_sales_automation](../../backend/prisma/migrations/20261012000000_sales_automation/migration.sql) | 7 | 1 | MATCH | Lead, Deal, FormSubmission |
| [20261013000000_record_files](../../backend/prisma/migrations/20261013000000_record_files/migration.sql) | 52 | 1 | MATCH | Lead, RecordFile, Tenant, Contact, Account, User |
| [20261014000000_product_interest_records](../../backend/prisma/migrations/20261014000000_product_interest_records/migration.sql) | 31 | 1 | MATCH | ProductInterest, Tenant, Lead, Deal, TenantPreference |
| [20261015000000_crm_panel_products_files](../../backend/prisma/migrations/20261015000000_crm_panel_products_files/migration.sql) | 8 | 1 | MATCH | Deal, RecordFile |
| [20261016000000_remove_two_factor_and_obsolete_account_fields](../../backend/prisma/migrations/20261016000000_remove_two_factor_and_obsolete_account_fields/migration.sql) | 24 | 1 | MATCH | MfaChallenge, MfaRecoveryCode, User, Account |
| [20261017000000_remove_crm_environments](../../backend/prisma/migrations/20261017000000_remove_crm_environments/migration.sql) | 602 | 1 | MATCH | TenantPreference, Environment, TaskLead, TaskContact, TaskDeal, TaskAccount, RecordFile, User, Account, Lead, Contact, Pipeline, Stage, Deal, LeadDeal, ContactDeal, DealStageHistory, DealAction, Task, Activity, Notification, TargetAudience, Campaign, MarketingForm, FormSubmission, CampaignMetrics, CampaignContact, Template, Workflow, WorkflowTriggerRecord, WorkflowExecutionRun, WorkflowExecutionStep, AuditLog, EmailDeliveryLog, SMSQueue, EmailEvent, AutomationRule, LeadImport, AccountImport, ContactImport, DealImport |
| [20261018000000_mailbox_engagement](../../backend/prisma/migrations/20261018000000_mailbox_engagement/migration.sql) | 27 | 1 | MATCH | Lead, Contact, Deal, EmailAccount, MailboxOAuthState, MailboxMessage |
| [20261019000000_deal_closing_requirements](../../backend/prisma/migrations/20261019000000_deal_closing_requirements/migration.sql) | 10 | 1 | MATCH | Deal, MailboxMessage |
| [20261020000000_conversion_fields_notifications](../../backend/prisma/migrations/20261020000000_conversion_fields_notifications/migration.sql) | 30 | 1 | MATCH | Notification, ClosingFieldDefinition, Tenant, TenantPreference |
| [20261021000000_remove_deal_fields_and_tenant_invitations](../../backend/prisma/migrations/20261021000000_remove_deal_fields_and_tenant_invitations/migration.sql) | 17 | 1 | MATCH | Deal, TenantInvitation |
| [20261022000000_workflow_record_lifecycle](../../backend/prisma/migrations/20261022000000_workflow_record_lifecycle/migration.sql) | 48 | 1 | MATCH | Lead, Contact, Account, Deal, Stage |
| [20261023000000_workflow_unique_names](../../backend/prisma/migrations/20261023000000_workflow_unique_names/migration.sql) | 42 | 1 | MATCH | Workflow |
| [20261024000000_workflow_action_retirement](../../backend/prisma/migrations/20261024000000_workflow_action_retirement/migration.sql) | 30 | 1 | MATCH | Workflow, Stage, ProductInterest |
| [20261025000000_remove_system_admin_and_legacy_auth_documents](../../backend/prisma/migrations/20261025000000_remove_system_admin_and_legacy_auth_documents/migration.sql) | 70 | 1 | MATCH | Session, RoleDefinition, User, UserRole, TenantDocument, RegistrationOtpToken, OAuthAccount, VerificationToken, SystemAdmin, Tenant |
| [20261026000000_module_action_permissions](../../backend/prisma/migrations/20261026000000_module_action_permissions/migration.sql) | 119 | 1 | MATCH | RolePermission |
| [20261027000000_crm_import_integrity](../../backend/prisma/migrations/20261027000000_crm_import_integrity/migration.sql) | 184 | 1 | MATCH | CrmImportUpload, Tenant, User, CrmImportJob, CrmImportRowResult, CrmImportChunk, LeadImport |
| [20261028000000_retire_legacy_crm_imports](../../backend/prisma/migrations/20261028000000_retire_legacy_crm_imports/migration.sql) | 20 | 1 | MATCH | LeadImport, LeadImportResult, CrmImportJob |
| [20261029000000_normalize_product_relationships](../../backend/prisma/migrations/20261029000000_normalize_product_relationships/migration.sql) | 147 | 1 | MATCH | Lead, LeadProductInterest, ProductInterest, LeadProductMatches, Contact, ContactProductInterest, ContactProductMatches, Account, AccountProductInterest, AccountProductMatches, Deal, DealProductMatches, LeadDeal, ContactDeal, TaskLead, TaskContact, TaskDeal, TaskAccount |
| [20261030000000_strengthen_relational_integrity](../../backend/prisma/migrations/20261030000000_strengthen_relational_integrity/migration.sql) | 178 | 1 | MATCH | RolePermission, UserRole, Session, TenantGroupMember, Stage, Deal, LeadDeal, ContactDeal, Notification, FormSubmission, WorkflowTriggerRecord, WorkflowExecutionRun, WorkflowExecutionStep, MailboxMessage, RoleDefinition, User, TenantGroup, Pipeline, Lead, Contact, MarketingForm, Workflow, EmailAccount, SMSQueue, Account |
| [20261031000000_retire_obsolete_infrastructure](../../backend/prisma/migrations/20261031000000_retire_obsolete_infrastructure/migration.sql) | 28 | 1 | MATCH | DealAction, AutomationRule, SMSQueue, EmailVerificationToken, Task |
| [20261101000000_expand_canonical_relationships](../../backend/prisma/migrations/20261101000000_expand_canonical_relationships/migration.sql) | 109 | 1 | MATCH | LeadDeal, ContactDeal, Deal, TaskLead, TaskContact, TaskDeal, TaskAccount, MailboxThreadAssociation, EmailAccount, TenantPreference, Task |
| [20261102000000_retire_relationship_compatibility](../../backend/prisma/migrations/20261102000000_retire_relationship_compatibility/migration.sql) | 56 | 0 | NOT APPLIED | Deal, MailboxThreadAssociation, Task |
