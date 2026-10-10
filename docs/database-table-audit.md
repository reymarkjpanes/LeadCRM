# LeadCRM database table audit

**Audit date:** 2026-10-02  
**Scope:** current repository and configured PostgreSQL schema source; read-only audit. No schema, migration, or data was changed.

## Executive summary

`backend/prisma/schema.prisma` defines **66 Prisma models**. Repository tracing found **34 ACTIVE**, **24 SUPPORTING / INTERNAL**, **4 LIKELY UNUSED**, and **4 UNCERTAIN** models. The database itself could not be reached from this environment, so deployed table presence, applied migration state, exact row counts, newest row timestamps, and live foreign-key metadata are **not verified**. **I cannot confirm this.**

The four likely-unused candidates are `DealAction`, `VerificationToken`, `SMSQueue`, and `AutomationRule`. This means no active application path was found; it is not authorization to delete them. Their live data and retention needs must be checked first. No migration was created or applied.

The migration directory contains 74 migrations, including files dated through 2026-10-21 (later than this audit date). A checked-in migration is not proof it has run. The migration state of the configured database could not be read.

## Data verification limitation

The Prisma datasource is PostgreSQL and reads `DATABASE_URL` / `DIRECT_URL`. A safe metadata/count query was attempted against the configured Supabase pooler in a read-only transaction. The host was unreachable. For **each of the 66 models**, row count and newest `createdAt`/`updatedAt` are therefore **unverified**. I cannot determine whether any record is currently being created, whether historical rows exist, whether the configured database is production or staging, or whether each listed schema relation corresponds to an applied database foreign key. Schema-declared relationships below are not a substitute for live catalog verification.

## Model inventory

“Code access” describes current repository evidence, not live database activity. R = read, W = write. “Indirect” means Prisma relation include/select or nested write. The row and activity status applies per row throughout this inventory: **Rows: unverified; newest activity: unverified.** Relationship names summarize schema-declared FK relations (including parent/child links); inspect the schema for full column/index definitions. Live FK presence was not verifiable.

| Model / table | Status | Purpose and important relations | Code access evidence | Rows / activity | Risk and recommendation |
|---|---|---|---|---|---|
| `SystemAdmin` | SUPPORTING / INTERNAL | Historical operator table. Current System Admin identity uses `User` plus `Session`; no model relation. | No `systemAdmin` Prisma delegate found. `docs/plans/final-role-model.md` says this historical table is retained without data deletion. | Unverified / unverified | Keep pending a separate retention decision; absence of current reads is not evidence that retained identities can be discarded. |
| `Tenant` | ACTIVE | Tenant/workspace root; related to nearly all tenant-scoped CRM, auth, workflow, integration, import, and history models. | R/W in `core/tenant`, auth/onboarding, system-admin provisioning, and domain repositories. | Unverified / unverified | High tenant-isolation impact. Keep. |
| `User` | ACTIVE | Tenant user and primary role identity; relates to sessions, role assignments, CRM ownership, tasks, audit, imports, and preferences. | R/W in auth, administration, roles, CRM assignment, notifications, and integrations. | Unverified / unverified | High auth/RBAC impact. Keep. |
| `RoleDefinition` | ACTIVE | Tenant role definitions; parent of `RolePermission` and `UserRole`. | R/W in `modules/administration/roles` and user administration. | Unverified / unverified | High RBAC impact. Keep. |
| `RolePermission` | ACTIVE | Per-role module CRUD grants; child of `RoleDefinition`. | R/W in roles repository and permission middleware/services. | Unverified / unverified | High RBAC impact. Keep. |
| `UserRole` | ACTIVE | User-to-role junction scoped by tenant. | R/W in role/user services and role backfill/repair scripts. | Unverified / unverified | High RBAC impact. Keep. |
| `Session` | SUPPORTING / INTERNAL | Revocable auth sessions; references `User` and `Tenant`. | R/W in `core/auth/session.service.ts`, auth middleware, password change/reset, and Gmail OAuth binding. | Unverified / unverified | High security impact. Keep. |
| `OAuthAccount` | UNCERTAIN | Legacy social-login provider identity and token storage; references `User`. Separate Gmail credentials live in `EmailAccount`. | No current production delegate call found; public OAuth login is retired and the NextAuth route returns 404. OAuth-only token/account records may remain. | Unverified / unverified | High: provider tokens and identity linkage. Preserve until rows, credential revocation, and retention are verified. |
| `TenantGroup` | ACTIVE | Tenant-scoped group parent; has `TenantGroupMember` children. | R/W in `modules/administration/groups/groups.repository.ts`. | Unverified / unverified | Keep. |
| `TenantGroupMember` | ACTIVE | Group-to-user junction; references group, user, and tenant. | R/W in the groups repository. | Unverified / unverified | Keep; active relation table. |
| `TenantDocument` | UNCERTAIN | Historical business-verification document metadata; references `Tenant`. Entire model and `Tenant.documents` relation are `@@ignore` / `@ignore`. | No current application delegate found. Schema comment says “Retired storage only”; legacy files may still be referenced by saved paths. | Unverified / unverified | High data-retention risk. Do not remove until rows, backing-file retention, and migration reconciliation are inspected. |
| `Account` | ACTIVE | Company/account record; relates to tenant, assigned user, leads/contacts/deals/tasks/files. | R/W in company repository, imports, task relationships, deal imports, and CRM services. | Unverified / unverified | Keep. |
| `Lead` | ACTIVE | Prospect record; relates to account, user assignments, deals, tasks, activities, campaigns, forms, imports, and files. | R/W in lead/contact/deal/form/workflow/automation/Gmail modules. | Unverified / unverified | Keep. |
| `Contact` | ACTIVE | Person/customer record; relates to account, leads, deals, tasks, campaigns, imports, Gmail, and files. | R/W in contacts and related CRM, campaign, form, Gmail, and task services. | Unverified / unverified | Keep. |
| `Pipeline` | ACTIVE | Tenant deal pipeline; parent of stages and deals. | R/W in pipeline repository, deal services, imports, reporting, and workflow options. | Unverified / unverified | Keep. |
| `Stage` | ACTIVE | Pipeline stage; referenced by deals and stage-history old/new stage relations. | R/W in pipeline/deal services and workflow/Gmail resolution. | Unverified / unverified | Keep. |
| `Deal` | ACTIVE | Sales opportunity; references tenant, pipeline, stage, account/lead/contact and users; parent of history, tasks, and files. | R/W in deals repository/services, reporting, Gmail, workflows, imports, and CRM services. | Unverified / unverified | Keep. |
| `LeadDeal` | ACTIVE | Lead-to-deal junction, with tenant and creator relations. | R/W in deals repository, lead automation/conversion, relationships, and merge services. | Unverified / unverified | Keep; active relation table. |
| `ContactDeal` | ACTIVE | Contact-to-deal junction, with tenant and creator relations. | R/W in deals repository, contact conversion, relationships, and merge services. | Unverified / unverified | Keep; active relation table. |
| `DealStageHistory` | SUPPORTING / INTERNAL | Historical stage transitions; references deal, user, and old/new stages. | R/W in deal/pipeline services; read by engagement, notifications, Gmail, and workflow-related code. | Unverified / unverified | High history/integrity value. Keep. |
| `DealAction` | LIKELY UNUSED | Historical manual deal-action records; references tenant, deal, and actor. Not the same table as `Activity`. | No runtime Prisma reads/writes, route, or controller found. `API.md` still documents actions routes, but the current deals/router source has no such routes; current operations use `Activity`, `AuditLog`, and `DealStageHistory`. | Unverified / unverified | High historical-audit loss risk. Candidate only after row count, retention review, stale API/docs cleanup, and a forward migration plan. |
| `Task` | ACTIVE | Operational task; related to tenant, assignees, CRM records, and four explicit task-link tables. | R/W in operations/tasks; read/written by CRM, workflow, notification, and archive services. | Unverified / unverified | Keep. |
| `Activity` | SUPPORTING / INTERNAL | CRM activity/timeline history; references tenant, creator, and optional CRM records/task. | R/W in activities, CRM relationships/conversion/merge, Gmail sync, automation, file, and closing-requirement services. | Unverified / unverified | High customer-history value. Keep. |
| `Notification` | SUPPORTING / INTERNAL | User notification/in-app event records; references tenant and user. | R/W in notification services and event handlers. | Unverified / unverified | Operational/user-history data. Keep. |
| `ClosingFieldDefinition` | ACTIVE | Tenant-configurable Closed Won requirements. | R/W in `modules/crm/closing-requirements` service/repository. | Unverified / unverified | Keep. |
| `TargetAudience` | ACTIVE | Saved campaign audience; parent of conditions and related to campaigns. | R/W in `modules/marketing/campaigns/audiences.service.ts`, seeds, and campaign services. | Unverified / unverified | Keep. |
| `TargetAudienceCondition` | ACTIVE | Audience filter child rows. Relation reads and nested creates are used; no separate delegate is required. | Indirect R/W via `conditions` include and nested create in `audiences.service.ts`; tenant middleware also maps it to `TargetAudience`. | Unverified / unverified | Keep; active child relation, not orphaned. |
| `Campaign` | ACTIVE | Campaign definition and delivery state; relates to tenant, audience, templates, contacts, metrics, and delivery logs. | R/W in campaign services, scheduler, workflow actions, reports, webhooks, and notifications. | Unverified / unverified | Keep. |
| `MarketingForm` | ACTIVE | Tenant public-form definition; related to creator and submissions. | R/W in forms repository/service and public forms service. | Unverified / unverified | Keep. |
| `FormSubmission` | SUPPORTING / INTERNAL | Public form submission/idempotency history; related to form and converted lead/contact. | R/W in public forms service/repository and automation event flow. | Unverified / unverified | Keep; protects submission and deduplication history. |
| `CampaignMetrics` | SUPPORTING / INTERNAL | Campaign delivery/engagement snapshots; references campaign and tenant. | Written after delivery and webhook updates. Current metrics API reads aggregate counters from `Campaign`, not this snapshot table. | Unverified / unverified | Keep as reporting/history snapshots. |
| `CampaignContact` | SUPPORTING / INTERNAL | Per-recipient campaign delivery, suppression, and outcome state; references campaign and lead/contact. | R/W in campaign delivery, webhooks, audiences, archive, and campaign tests. | Unverified / unverified | High delivery/suppression history value. Keep. |
| `Template` | ACTIVE | Email/SMS template; campaigns reference email and SMS templates. | R/W in templates module; read by campaigns and workflow options/actions. | Unverified / unverified | Keep. |
| `Workflow` | ACTIVE | Current workflow definitions and activation/archive state; parent of trigger records and runs. | R/W in `modules/automation/workflows`, actions, triggers, and frontend workflow API. | Unverified / unverified | Keep. |
| `WorkflowTriggerRecord` | SUPPORTING / INTERNAL | Idempotent workflow trigger/event claim; references workflow and tenant. | Created by `workflows.repository.ts`; read with workflow run history. | Unverified / unverified | High replay/deduplication value. Keep. |
| `WorkflowExecutionRun` | SUPPORTING / INTERNAL | Workflow execution result/history; references trigger and tenant. | R/W in workflow repository and execution/history services. | Unverified / unverified | Keep; user-visible history and execution audit. |
| `WorkflowExecutionStep` | SUPPORTING / INTERNAL | Per-step execution results; references workflow run and tenant. | R/W in workflow execution/history services. | Unverified / unverified | Keep; history and troubleshooting. |
| `AuditLog` | SUPPORTING / INTERNAL | Security, administrative, and CRM audit history; references tenant and optional user. | R/W via `core/audit/audit.service.ts` and system-admin/administration services. | Unverified / unverified | High compliance/security value. Keep. |
| `EmailDeliveryLog` | SUPPORTING / INTERNAL | Outbound message submission/suppression history; optional campaign/lead/contact references. | R/W in email and campaign sending; read in audience suppression and webhook flows. | Unverified / unverified | High integration and compliance value. Keep. |
| `VerificationToken` | LIKELY UNUSED | Generic legacy email-verification token model; no relations. Distinct from the custom email-verification model. | No current runtime references found; no active Prisma adapter path was found and `frontend/app/api/auth/[...nextauth]/route.ts` returns 404. | Unverified / unverified | Low-to-medium, but token data may remain. Check rows and expiry/retention; remove any adapter dependency/model and unique indexes before a reviewed drop. |
| `PasswordResetToken` | SUPPORTING / INTERNAL | Time-limited password-recovery token. | R/W in current `core/auth/password-reset.service.ts` and administrator recovery flow. | Unverified / unverified | High auth impact. Keep. |
| `RegistrationOtpToken` | UNCERTAIN | Registration OTP challenge data. | R/W remains in `core/auth/verification.service.ts`; controller/helper code exists but auth routes do not register it and public registration is documented retired. | Unverified / unverified | Token/security data and dormant code remain. First verify no external caller/unexpired rows; only then consider removing the orphan helper/controller and table. |
| `EmailVerificationToken` | UNCERTAIN | Single-use magic-link verification hash; optional `User` FK. | R/W remains in `core/auth/verification.service.ts`; verification controller is not mounted in current auth routes. | Unverified / unverified | Token/security data and dormant code remain. Confirm no route/caller and no unexpired links; remove helper/relation/FK/indexes before any table migration. |
| `EmailAccount` | SUPPORTING / INTERNAL | Per-user Gmail connection; encrypted access/refresh tokens and sync cursors; parent of mailbox messages. | R/W in Gmail mailbox auth/sync services and setup/maintenance scripts. | Unverified / unverified | High integration/credential impact. Keep. |
| `MailboxOAuthState` | SUPPORTING / INTERNAL | One-time Gmail OAuth state bound to user session; no other model relation. | R/W in `integrations/gmail/mailbox-auth.service.ts`; expiry cleanup and one-time consumption. | Unverified / unverified | Security-critical transient state. Keep. |
| `MailboxMessage` | SUPPORTING / INTERNAL | Gmail-synced message/thread and CRM association history; references `EmailAccount`. | R/W in Gmail sync and ingestion; read in engagement and CRM association logic. | Unverified / unverified | High integration/history value. Keep. |
| `SMSQueue` | LIKELY UNUSED | Legacy scheduled SMS queue; FK relations to tenant, campaign, lead, and contact. | No runtime Prisma reads/writes or worker for this model found. Scheduler calls `sendBulkSms`, but it is a no-op stub; workflow report identifies SMS provider/scheduler sending as placeholder. | Unverified / unverified | Medium/high: may contain message content and phone numbers. Verify pending/sent rows and retention; remove tenant/campaign/lead/contact relations and indexes only after export/retention decision. |
| `EmailEvent` | SUPPORTING / INTERNAL | Provider email events (e.g. bounce/unsubscribe); references `EmailDeliveryLog` and tenant. | W in Brevo webhook; R in audience suppression checks. | Unverified / unverified | High delivery/suppression value. Keep. |
| `AutomationRule` | LIKELY UNUSED | Legacy JSON-based automation definitions; references tenant. Current workflows use `Workflow` plus trigger/run/step history. | No runtime Prisma reads/writes, controller, or worker found; appears only in schema/tenant model registry/migration history. Current workflow engine is active. | Unverified / unverified | Medium/high: historical rule definitions may be valuable. Confirm records were not migrated/are not required, export if present, then remove registry/relation and indexes before a forward drop. |
| `UserPreference` | ACTIVE | Per-user tenant preference storage. | R/W in user preference services. | Unverified / unverified | Keep. |
| `TenantPreference` | SUPPORTING / INTERNAL | Tenant-keyed application preferences, including mailbox-thread/deal automation state. | R/W in Gmail sync/engagement, automation, and preference services. | Unverified / unverified | Keep; preference and integration state. |
| `LeadImport` | ACTIVE | Lead import job/summary; parent of result rows; references creator/tenant. | R/W in lead-import service and import UI API. | Unverified / unverified | Keep. |
| `LeadImportResult` | SUPPORTING / INTERNAL | Per-row lead import outcome; child of `LeadImport`. | Read/written through nested import results in lead-import service. | Unverified / unverified | Keep as import history. |
| `AccountImport` | ACTIVE | Account import job/summary; parent of result rows. | R/W in account-import service. | Unverified / unverified | Keep. |
| `AccountImportResult` | SUPPORTING / INTERNAL | Per-row account import outcome; child of `AccountImport`. | Read/written through nested import results in account-import service. | Unverified / unverified | Keep as import history. |
| `ContactImport` | ACTIVE | Contact import job/summary; parent of result rows. | R/W in contact-import service. | Unverified / unverified | Keep. |
| `ContactImportResult` | SUPPORTING / INTERNAL | Per-row contact import outcome; child of `ContactImport`. | Read/written through nested import results in contact-import service. | Unverified / unverified | Keep as import history. |
| `DealImport` | ACTIVE | Deal import job/summary; parent of result rows. | R/W in deal-import repository/service. | Unverified / unverified | Keep. |
| `DealImportResult` | SUPPORTING / INTERNAL | Per-row deal import outcome; child of `DealImport`. | Read/written through nested import results in deal-import repository/service. | Unverified / unverified | Keep as import history. |
| `CampaignEmailQuota` | SUPPORTING / INTERNAL | Global daily campaign-email reservation counter; independent of tenant. | Upserted and atomically incremented in `modules/marketing/campaigns/campaigns.service.ts`. | Unverified / unverified | Operational send-limit protection. Keep. |
| `TaskLead` | ACTIVE | Tenant-safe task-to-lead junction. | R/W in operations task repository. | Unverified / unverified | Keep; active relation table. |
| `TaskContact` | ACTIVE | Tenant-safe task-to-contact junction. | R/W in operations task repository. | Unverified / unverified | Keep; active relation table. |
| `TaskDeal` | ACTIVE | Tenant-safe task-to-deal junction. | R/W in operations task repository. | Unverified / unverified | Keep; active relation table. |
| `TaskAccount` | ACTIVE | Tenant-safe task-to-account junction. | R/W in operations task repository. | Unverified / unverified | Keep; active relation table. |
| `RecordFile` | ACTIVE | Tenant-scoped file metadata for CRM records; references uploader and optional lead/contact/account/deal. | R/W in `modules/crm/record-files/record-files.service.ts` and frontend CRM file APIs. | Unverified / unverified | High data/reference impact; object storage keys also matter. Keep. |
| `ProductInterest` | ACTIVE | Tenant product catalog used by deal product selection and price snapshots. | R/W in product-interest administration and deal services/imports. | Unverified / unverified | Keep. |

## Likely-unused candidates and forward-only removal plans

These are candidates only. **Do not drop** until live row counts, timestamps, database FKs/indexes, backup/retention requirements, and all deployed application versions have been checked. Do not edit or rewrite applied migrations. A removal would require a new forward migration after data and compatibility review.

### `DealAction`

- **Why likely unused:** no current Prisma delegate, service, controller, route, worker, or frontend API call found. The current deal API source has no actions route even though `docs/API.md` lists one. Current deal changes use `Activity`, `AuditLog`, and `DealStageHistory`.
- **Before a migration:** verify there is no deployed version still serving the documented action endpoint; resolve the stale API/workflow documentation; decide whether existing action rows are required as audit history.
- **Schema/code cleanup:** remove `DealAction` relations from `Tenant`, `User`, and `Deal`; remove its `tenantModels` registry entry; remove `DealActionType` only if no remaining consumer exists. Do not remove the distinct `Activity.type = 'deal_action'` behavior without separate evidence.
- **Database objects:** inspect/drop outbound FKs to `Tenant`, `Deal`, and `User`, then the table and its indexes (`dealId,tenantId`; `tenantId,actionType`; `tenantId,performedAt`; `tenantId`). Use a reviewed forward migration and preserve/export rows if retention requires it.
- **Impact/rollback:** deletes old per-action payload/actor/timestamp history; rollback needs a backup/export and cannot recreate deleted row contents from schema alone.

### `VerificationToken`

- **Why likely unused:** no current source reference or adapter was found; the only NextAuth API route returns 404. Current active password recovery uses `PasswordResetToken`; registration/magic-link helpers use the other token models.
- **Before a migration:** inspect live rows/expiry and verify no deployed frontend/backend instance uses an adapter path.
- **Schema/code cleanup:** remove model and any adapter configuration if found. There is no FK/relation to remove.
- **Database objects:** drop this table and its unique token and `(identifier, token)` constraints/indexes in a new forward migration.
- **Impact/rollback:** expired credential rows are expected to be short-lived, but verify rather than assume. Restore requires backup if any history must be retained.

### `SMSQueue`

- **Why likely unused:** no runtime read/write, queue worker, or integration for this model exists. Scheduled SMS reaches a stub `sendBulkSms`; current workflow documentation calls SMS provider sending a placeholder.
- **Before a migration:** count rows by status, check newest timestamps, confirm no external/local Android gateway or older deployed worker consumes it, and retain/export message and phone data if required.
- **Schema/code cleanup:** remove relations from `Tenant`, `Campaign`, `Lead`, and `Contact`, plus `tenantModels` registry entry. Review SMS campaign UI/types separately; they do not use this table today.
- **Database objects:** inspect/drop FKs to tenant/campaign/lead/contact, then indexes on `(tenantId,status)`, `(tenantId,scheduledFor)`, and `tenantId`, followed by table.
- **Impact/rollback:** any queued/sent message and delivery/error history is lost unless exported; rollback requires backup.

### `AutomationRule`

- **Why likely unused:** no runtime read/write/controller/job found. The current workflow engine persists definitions in `Workflow` and execution state in `WorkflowTriggerRecord`, `WorkflowExecutionRun`, and `WorkflowExecutionStep`.
- **Before a migration:** check for old rules, determine whether any definitions were migrated or must be preserved, and confirm no old deployment/worker is still active.
- **Schema/code cleanup:** remove `Tenant.AutomationRule[]`, model, and `tenantModels` registry entry. Keep `Workflow` and its history tables.
- **Database objects:** inspect/drop `AutomationRule_tenantId_fkey`, tenant/active and tenant/trigger indexes (and any live tenant-only index), then table.
- **Impact/rollback:** existing rule JSON and activation settings are not reproduced by Workflow automatically; export/translate rows before removal if needed. Rollback requires a data backup.

## Uncertain models requiring additional verification

- **`OAuthAccount`:** account-login OAuth is retired and no current reads/writes were found, but it can contain access/refresh/id tokens and user identity links. Gmail OAuth uses separate `EmailAccount`/`MailboxOAuthState` tables. Inspect row counts, token retention/revocation, and legacy account access before considering cleanup.
- **`TenantDocument`:** schema explicitly marks it retired and ignored, but it represents historical business-document metadata and references external file paths. Inspect table rows and actual file storage/retention; check the earlier migration issue noted in `docs/plans/final-role-model.md` before any schema change.
- **`RegistrationOtpToken` and `EmailVerificationToken`:** current helper/controller source still reads/writes these models, although the routes are not mounted and public registration/verification is documented as retired. Remove/resolve dormant code first, check unexpired rows and foreign keys, then reclassify. Do not treat them as confirmed unused today.

## Orphaned relation tables

No orphaned relation table was found in the current Prisma schema/code pass:

- `LeadDeal` and `ContactDeal` are queried/written by deal, conversion, relationship, and merge services.
- `TaskLead`, `TaskContact`, `TaskDeal`, and `TaskAccount` are explicitly maintained by the operations task repository and enforce same-tenant links.
- `TargetAudienceCondition` is actively read through relation includes and written by nested creates in the audience service.

`DealAction` has multiple FKs, but it is an event/history entity, not a join table. Its application use appears retired; historical rows and retention remain unverified.

## Possible unused columns

### Present in Prisma schema but ignored by Prisma Client

`Tenant.approvedById`, `Tenant.approvedAt`, `Tenant.verificationStatus`, `Tenant.businessType`, and `Tenant.verificationRejectionReason` are marked `@ignore`. `Tenant.documents` and the whole `TenantDocument` model are ignored. No live runtime access to these tenant business-verification fields was found. `businessType` references elsewhere in the UI belong to Lead/Contact data and are not evidence of access to `Tenant.businessType`.

Recommendation: treat these as **possible legacy cleanup only**. Verify physical column presence, current rows, any SQL/admin tooling, and the retained-document decision before proposing a drop.

### Removed from current schema, but migration state is unknown

- The checked-in `20261016000000_remove_two_factor_and_obsolete_account_fields` migration drops MFA columns from `User`, Account `taxId`, `customerType`, and `customerSince`, and drops `MfaChallenge`/`MfaRecoveryCode`.
- The checked-in `20261017000000_remove_crm_environments` migration removes Sandbox/environment-scoping data and `environment` columns from CRM, workflow, import, and related tables. It explicitly preserves Production/tenant-wide rows and handles Sandbox child rows. This file is later than the audit date; its application cannot be assumed.
- The checked-in `20261021000000_remove_deal_fields_and_tenant_invitations` migration drops `Deal.confidence`, `Deal.description`, and `TenantInvitation`. It is also later than the audit date.

The corresponding fields/models are absent from the current Prisma schema where applicable, but the live database was unavailable. **I cannot confirm this.** No column or table was altered during this audit.

No other column was labeled unused solely from a name scan. Fields without an explicit source reference may still be returned in whole-record Prisma results, included in API serializers, stored for historical records, or used by indexes/constraints; a column-by-column cleanup would need to trace each model’s projections, DTOs, filters/sorts, relations, indexes, and migrations before classifying it.

## Historical database objects outside the 66-model Prisma schema

The migration history contains objects that are no longer Prisma models. Presence in the live database cannot be verified. The relevant create/drop history includes:

- `ServiceOrder`, `Asset`, `InventoryItem` — create in initial migration; drop planned in `20260816120000_remove_service_orders_assets_inventory`.
- `Organization` — create in initial migration; drop in `20260905000000_remove_organization_model`.
- `Customer`, `CustomerDeal` — created during the CRM split and later dropped while the current `Contact`/`ContactDeal` model was established.
- `LoginOtpToken` — created in `20260806120121_add_missing_columns`; dropped in `20260812000000_remove_otp_tokens`.
- Billing/domain tables `PricingPlan`, `PlanFeature`, `Subscription`, `PaymentMethod`, `TenantDomain`, `TenantDomainSettings`, `Invoice`, `PaymentTransaction`, `StripeWebhookEvent` — `20261008000000_remove_retired_billing_domains` contains drops; it is future-dated relative to this audit.
- `MfaChallenge`, `MfaRecoveryCode` — create in `20261007000000_add_mfa`; drop in the later `20261016000000_remove_two_factor_and_obsolete_account_fields` migration.
- `Environment` — created by `20261002000000_crm_environments`; drop and Sandbox-row cleanup are in the later `20261017000000_remove_crm_environments` migration.
- `TenantInvitation` — present in the initial migration; drop is in the later `20261021000000_remove_deal_fields_and_tenant_invitations` migration.

Do not interpret a drop statement in migration history as proof the database has applied it. Before calling any of these physically present/absent, read `_prisma_migrations` and inspect the live catalog with a read-only connection.

## Search and migration review performed

- Parsed all model declarations, relations, ignored models/fields, and indexes in `backend/prisma/schema.prisma`.
- Searched Prisma delegate usage and indirect relations across backend runtime modules, auth, controllers/routes, integrations/Gmail, campaigns/webhooks, workflows, jobs/scheduler, imports, administration, reporting, seeders, scripts, tests, and fixtures.
- Searched frontend API/domain source and relevant Next.js auth route behavior; reviewed the shared contracts and the current forms, workflow, campaign, task, import, file, Gmail, RBAC, and notification pathways where relevant.
- Inspected migration directory names and table create/drop statements across all 74 migration directories, then read migrations relevant to campaign tables, CRM imports/relations, auth/MFA, billing/domain retirement, environments, and later field/invitation cleanup.
- Read `README.md`, `docs/ARCHITECTURE.md`, `docs/STRUCTURE.md`, `docs/API.md`, `docs/internal-crm-cleanup.md`, `docs/plans/internal-camxian-crm.md`, `docs/plans/final-role-model.md`, and the workflow production report.
- Database attempt: configured PostgreSQL endpoint was unreachable; no production/live row counts or applied migration records were read.
- No tests were run, no database reset was used, no migration history was modified, and no DDL/data change was made.

## Recommended next steps

1. Obtain a read-only connection to the intended database and confirm its identity/environment; collect the public table list, exact row counts, newest activity, and live inbound/outbound FKs/indexes, including `_prisma_migrations`.
2. Reconcile applied migrations with the checked-in schema, especially future-dated billing, MFA, CRM-environment, and invitation cleanup files.
3. Review candidate table rows and retention with the system owner. Preserve or export `DealAction`, SMS, and automation history/configuration where needed; confirm token expiry/cleanup for token candidates.
4. Resolve stale routes/docs and orphan auth helpers before any model removal. Then present a separate cleanup proposal with an explicit forward migration, exact live constraints/indexes, backup/rollback plan, and expected data impact.
5. Do not apply any drop migration until that review is approved. No drop-table migration was created as part of this audit.
