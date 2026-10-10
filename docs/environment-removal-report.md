# Environment feature removal report

Implemented in the working tree; not deployed to Render/Vercel and not applied to the configured application database. The screenshot supplied with the request was used as UI reference.

## Frontend and API

- Deleted the topbar EnvironmentSwitcher component, Sandbox/Live options, descriptions, indicator, confirmation dialog, and switching-only tests. No disabled Live selector or placeholder remains.
- Removed AuthContext switching state/actions and activeEnvironment from user/shared types. Removed dataset-dependent cache keys, remount keys, mock metadata, and obsolete help content. Tenant/user cache identities and auth lifecycle protection remain.
- Deleted the environment transport module, generation tracking, switching locks, frontend API method, and X-CRM-Environment proxy header.
- Confirmed the actual old route in auth.routes.ts was PATCH /api/v1/auth/environment. Its registration, controller, service, validation contract, and switching tests were removed. An authenticated request now returns 404.
- Auth, session, task, workflow, and other CRM response types no longer expose environment fields.
- Desktop 1440×900 and mobile 390×844 Settings previews were inspected in a browser using mock data. Search, inbox, notifications, and profile controls remain aligned, with no environment control or leftover gap. This UI preview is separate from the real authenticated HTTP checks.

## Backend and isolation

The existing Prisma scope enforcement was retained in core/tenant/tenant-context.ts, tenant-models.ts, and tenant-prisma.ts, with tenantId as its only scope. This preserves nested reads/writes, counts, scoped relationships, raw-query restrictions, and cross-tenant safeguards. The auth middleware still validates sessions, user status, employee account rules, password/onboarding requirements, and permissions as before. tenantMiddleware and workspaceReadyMiddleware remain intact.

Campaign scheduler, provider webhooks, public forms, workflows, tasks, products, imports, archives, lead assignment, and file handling now use their tenant directly. New file object paths omit the dataset segment. Existing stored objectKey values are preserved so existing Live attachments remain addressable.

## Exact database changes

New migration: [20261017000000_remove_crm_environments](../backend/prisma/migrations/20261017000000_remove_crm_environments/migration.sql). Existing applied migration files were not edited.

- Removed model/table Environment and Tenant.environments. The old table was unused resource-monitoring metadata, not the parent of CRM data. Its columns were id, tenantId, envCode, type, cpuUsage, ramUsage, storageUsage, uptimePct, isDefault, lastCheckedAt, createdAt, updatedAt. Its tenant FK, tenant index, and tenantId/envCode unique index disappear with it.
- Removed User.activeEnvironment and the CrmEnvironment enum.
- Removed the environment column from these 38 tables: Account, Lead, Contact, Pipeline, Stage, Deal, LeadDeal, ContactDeal, DealStageHistory, DealAction, Task, Activity, Notification, TargetAudience, Campaign, MarketingForm, FormSubmission, CampaignMetrics, CampaignContact, Template, Workflow, WorkflowTriggerRecord, WorkflowExecutionRun, WorkflowExecutionStep, AuditLog, EmailDeliveryLog, SMSQueue, EmailEvent, AutomationRule, LeadImport, AccountImport, ContactImport, DealImport, TaskLead, TaskContact, TaskDeal, TaskAccount, RecordFile.
- No environmentId column existed in the inspected schema.
- Removed/replaced the environment-bearing indexes and unique keys, including Lead creationKey, Deal automationKey, and workflow_event_once. Tenant uniqueness remains.
- Replaced 12 environment-bearing composite foreign keys: TaskLead→Task/Lead, TaskContact→Task/Contact, TaskDeal→Task/Deal, TaskAccount→Task/Account, and RecordFile→Deal/Lead/Contact/Account. They now use record ID plus tenantId.
- Kept the existing database triggers; crm_scope_immutable and crm_check_relation_scope now enforce tenant-only invariants. Child-parent immutability remains.

## Live data preservation

The migration runs in one transaction. It locks tables, records every retained row, and identifies obsolete rows only by the stored SANDBOX enum value. PRODUCTION records and nullable tenant-wide audit records are retained; they are not copied or reassigned to another tenant.

Five child tables inherit deletion eligibility from an explicitly retired parent: TargetAudienceCondition, LeadImportResult, AccountImportResult, ContactImportResult, DealImportResult. The migration inspects all catalog foreign keys, including composite keys. A retained record pointing to any retired record aborts the migration before deletion. Unexpected incoming dependencies from another schema also require review.

Foreign-key actions are temporarily suspended and restored within the transaction, so deletion does not use cascading or SET NULL behavior. Full retained-row multisets are compared before dropping schema fields; any unexpected change rolls back. The production lead-assignment cursor is renamed from PRODUCTION to default, and the Sandbox cursor is removed. A conflicting existing default cursor aborts instead of overwriting it.

Tests confirmed Live values, IDs, links, shared audit rows and assignment cursor survive, Sandbox rows are removed, and a retained dependency causes a complete rollback. Existing object storage files are not deleted or moved by this SQL.

Apply with a verified backup and a maintenance window: stop old application processes, run npm --prefix backend run db:deploy, then start the updated backend/frontend. The new code and old schema must not serve traffic together. The migration takes exclusive locks and snapshots retained rows, so schedule enough database capacity and downtime for the actual dataset.

Actual hosted Live record preservation: **I cannot confirm this.** No hosted migration or production-data read was performed. A post-deployment smoke check remains necessary.

## Seeds, configuration, and remaining terminology

- Seeder now creates one default pipeline and does not persist a selected dataset. Seeder verification and fixtures no longer expect dataset fields. No separate Sandbox/Live records are seeded.
- Updated disposable forms/sales/preview runners to replay real migration history instead of reconstructing the retired schema. Added a single-workspace authenticated acceptance runner and preservation/rollback migration tests.
- Removed an empty, untracked 20260929000000_sales_automation directory after verifying it contained no files; it blocked Prisma replay with P3015. No applied SQL was changed.
- No Render/Vercel variable was identified as exclusive to the removed feature, so **no deployment variable removal is required** based on this repository. Hosted dashboard-only variables were not inspected: **I cannot confirm this.**
- NODE_ENV, database URLs, Render/Vercel configuration, and BREVO_SANDBOX_EMAILS remain. The latter is a development-deployment email recipient allowlist, not an application dataset selector; its audience UI wording is now “Delivery restricted.”
- TenantStatus.SANDBOX is retained because it describes legacy account/subscription state used by unrelated auth/public-form validation. It does not select or scope CRM records. Old diagnostic scripts also contain the historical tenant name “Demo Sandbox”; it is not the removed feature.
- Historical migration SQL, upgrade regression fixtures, and historical reports retain old names intentionally. Three.js Environment, HTML/ARIA terms, and generic references to environment variables are unrelated.

## Checks actually run

| Check | Result |
| --- | --- |
| npm run lint | Passed all 3 workspaces after the test fixes; latest log build/lint-fixed.log |
| npm run build | Passed backend and frontend after the fixes; build/production-build-fixed.log. A sandbox EPERM readlink restriction required rerunning with approved filesystem access. |
| Prisma migration deploy on disposable PostgreSQL-compatible database | All 70 migrations applied successfully, including the new migration; build/migration-deploy.log |
| Migration preservation/rollback + authenticated archive/file regression | 33 passed in 2 files; build/removal-regression-tests.log |
| Real PostgreSQL authenticated single-workspace acceptance | 11 passed: login, all requested module reads, settings, no environment fields, old endpoint 404, tenant/session isolation; build/smoke-tests.log |
| Forms migration/validation/HTTP runner | 31 passed in 2 files; build/forms-runner-tests.log |
| Sales migration + sales/forms regression runner | 60 passed in 3 files; build/sales-runner-tests.log |
| Profile, user import, organization settings on isolated PostgreSQL | 14 passed in 3 files; build/postgres-acceptance.log |
| Full backend suite | 532 passed, 153 skipped (59 passed files, 11 skipped), no failures; build/backend-tests-fixed.log |
| Full frontend suite | 814 passed in 98 files, no failures; build/frontend-tests-fixed.log |
| Additional workflow/task PostgreSQL suites | 43 passed in 2 files, no failures; build/fix-workflow-tests.log |
| Additional campaign PostgreSQL suite | 27 passed, no failures; build/fix-campaign-tests.log |
| Validation error regression tests | 5 passed, covering ESM/CommonJS Zod errors and private handling of unrelated/malformed errors; build/fix-validation-tests.log |
| Desktop/mobile browser header inspection | Passed in local mock preview; build/environment-removal-desktop.png and build/environment-removal-mobile.png |
| Repository feature-reference scan and git diff --check | Passed after cleanup; standard infrastructure/legacy account terminology remains as explained above |

The previously reported failures were fixed at the user's request. Both default full suites now pass. The backend's existing database-gated tests remain skipped in the default run; workflow/task and campaign checks were also executed explicitly against isolated real PostgreSQL databases, with all 70 tests passing. No new skips or disabled assertions were introduced.

Deals property tests now mock the real transaction/read path, explicitly accept zero while rejecting negative values, and generate valid plain-text names so random sanitization does not obscure numeric-bound checks. Frontend fixtures supply required emails, use the current checkbox product selector and product ID arrays, and expect the existing formatted currency. Workflow/task fixtures supply valid catalog products and emails; they distinguish canonical API statuses from stored Contact enum values and assert the current Closed plus convertedAt conversion state.

The production change in this follow-up is confined to validation error classification. ESM and CommonJS can load distinct Zod constructors, so instanceof alone missed errors from shared contracts. The error middleware now recognizes the validated issue shape across those constructors and returns HTTP 400 with field errors. Unknown and malformed errors still return a private generic HTTP 500. Campaign integration confirms a client-supplied tenantId is rejected without creating a campaign.

An additional Prisma schema-drift comparison could not connect to the disposable socket after migration deployment (P1001); **I cannot confirm this.** Migration application, catalog removal, data-preservation and tenant-invariant checks did execute successfully.

The hosted application, hosted module loads, and hosted migration are unverified: **I cannot confirm this.** No commit, push, or deployment was performed.

## Files changed

The complete working-tree inventory follows (M = modified, D = deleted, A = new). Paths are repository-relative.

```text
A	backend/prisma/migrations/20261017000000_remove_crm_environments/migration.sql
M	backend/prisma/schema.prisma
D	backend/prisma/verify-environment-migration.cjs
A	backend/scripts/replay-crm-migrations.mjs
A	backend/scripts/test-single-workspace.mjs
A	backend/src/api/middleware/__tests__/error.middleware.test.ts
M	backend/src/api/middleware/auth.middleware.ts
M	backend/src/api/middleware/error.middleware.ts
M	backend/src/api/routes/auth.routes.ts
M	backend/src/config/database.config.ts
M	backend/src/core/auth/__tests__/build-auth-user-response.unit.test.ts
M	backend/src/core/auth/__tests__/profile.integration.test.ts
M	backend/src/core/auth/__tests__/profile.service.test.ts
M	backend/src/core/auth/auth-user.ts
M	backend/src/core/auth/auth.controller.ts
D	backend/src/core/environment/__tests__/environment.integration.test.ts
D	backend/src/core/environment/environment-context.ts
D	backend/src/core/environment/environment-models.ts
D	backend/src/core/environment/environment-prisma.ts
D	backend/src/core/environment/environment.controller.ts
D	backend/src/core/environment/environment.service.ts
M	backend/src/core/scheduler/campaign-scheduler.service.ts
A	backend/src/core/tenant/tenant-context.ts
A	backend/src/core/tenant/tenant-models.ts
A	backend/src/core/tenant/tenant-prisma.ts
M	backend/src/database/seeders/seeder.seed.ts
M	backend/src/modules/administration/archived-data/archived-data.service.ts
M	backend/src/modules/administration/organization-settings/organization-settings.integration.test.ts
M	backend/src/modules/administration/product-interests/product-interests.repository.ts
M	backend/src/modules/administration/product-interests/product-interests.service.ts
M	backend/src/modules/administration/users/users-import.integration.test.ts
M	backend/src/modules/automation/actions/action-dispatcher.ts
M	backend/src/modules/automation/workflows/__tests__/workflow.integration.test.ts
M	backend/src/modules/automation/workflows/workflow.engine.ts
M	backend/src/modules/automation/workflows/workflows.service.ts
M	backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts
M	backend/src/modules/crm/deals/__tests__/deals-repository-error.property.test.ts
M	backend/src/modules/crm/deals/__tests__/deals-value-bound.property.test.ts
M	backend/src/modules/crm/leads/lead-automation.service.ts
M	backend/src/modules/crm/leads/sales-automation.integration.test.ts
M	backend/src/modules/crm/leads/sales-automation.preview.ts
M	backend/src/modules/crm/record-files/record-files.service.ts
M	backend/src/modules/marketing/campaigns/__tests__/campaign-content.test.ts
M	backend/src/modules/marketing/campaigns/__tests__/campaign-pagination.test.ts
M	backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts
M	backend/src/modules/marketing/campaigns/audiences.service.ts
M	backend/src/modules/marketing/campaigns/brevo-webhook.ts
M	backend/src/modules/marketing/campaigns/campaigns.service.ts
M	backend/src/modules/marketing/forms/forms.integration.test.ts
M	backend/src/modules/marketing/forms/forms.preview.ts
M	backend/src/modules/marketing/forms/forms.repository.ts
M	backend/src/modules/marketing/forms/forms.validation.test.ts
M	backend/src/modules/marketing/forms/public-forms.service.ts
M	backend/src/modules/operations/tasks/__tests__/tasks.integration.test.ts
M	backend/src/modules/operations/tasks/__tests__/tasks.service.test.ts
M	backend/src/modules/operations/tasks/tasks.repository.ts
M	backend/src/modules/operations/tasks/tasks.service.ts
M	backend/src/scripts/verify-seeder-data.ts
M	backend/src/shared/services/email.service.ts
A	backend/src/tests/migrations/remove-crm-environments.test.ts
A	backend/src/tests/replay-crm-migrations.ts
M	backend/src/tests/security-preview.mjs
A	backend/src/tests/single-workspace.integration.test.ts
M	docs/API.md
M	docs/ARCHITECTURE.md
M	docs/crm-environments.md
A	docs/environment-removal-report.md
M	docs/STRUCTURE.md
M	frontend/app/api/proxy/[...path]/__tests__/proxy-cookie-forwarding.test.ts
M	frontend/app/api/proxy/[...path]/route.ts
M	frontend/scripts/check-crm-loading.cjs
M	frontend/scripts/check-forms-general.cjs
M	frontend/src/features/system-admin/tenants/ui/client-management.tsx
M	frontend/src/features/tenant/automation/workflows/ui/workflow-builder-page.tsx
M	frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx
M	frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx
M	frontend/src/features/tenant/crm/accounts/ui/account-detail-page.tsx
M	frontend/src/features/tenant/crm/contacts/ui/contact-detail-page.tsx
M	frontend/src/features/tenant/crm/deals/ui/deal-detail-page.tsx
M	frontend/src/features/tenant/crm/deals/ui/deal-form.test.tsx
M	frontend/src/features/tenant/crm/leads/ui/lead-detail-page.tsx
M	frontend/src/features/tenant/crm/pipeline/ui/pipeline-page.tsx
M	frontend/src/features/tenant/help/content/campaigns.ts
M	frontend/src/features/tenant/help/content/contacts-accounts.ts
M	frontend/src/features/tenant/help/content/dashboard.ts
M	frontend/src/features/tenant/help/content/deals-tasks.ts
M	frontend/src/features/tenant/help/content/getting-started.ts
M	frontend/src/features/tenant/help/content/index.ts
M	frontend/src/features/tenant/help/content/leads.ts
M	frontend/src/features/tenant/help/content/settings.ts
M	frontend/src/features/tenant/help/content/troubleshooting.ts
M	frontend/src/features/tenant/help/content/workflows.ts
M	frontend/src/features/tenant/help/ui/help-shared.tsx
D	frontend/src/features/tenant/layout/__tests__/environment-switcher.test.tsx
M	frontend/src/features/tenant/layout/crm-layout.tsx
D	frontend/src/features/tenant/layout/environment-switcher.tsx
M	frontend/src/features/tenant/layout/topbar.tsx
M	frontend/src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx
M	frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx
M	frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx
M	frontend/src/features/tenant/marketing/campaigns/ui/audience-panel.tsx
M	frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx
M	frontend/src/features/tenant/marketing/forms/ui/forms-page.tsx
M	frontend/src/features/tenant/marketing/forms/ui/forms.test.tsx
M	frontend/src/features/tenant/notifications/hooks/use-notifications.ts
M	frontend/src/features/tenant/operations/tasks/__tests__/task-data.test.tsx
M	frontend/src/features/tenant/operations/tasks/__tests__/task-editor.test.tsx
M	frontend/src/features/tenant/operations/tasks/__tests__/task-interactions.test.tsx
M	frontend/src/features/tenant/operations/tasks/ui/task-selector.tsx
M	frontend/src/features/tenant/operations/tasks/use-tasks.ts
M	frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx
M	frontend/src/features/tenant/settings/ui/__tests__/roles-permissions.test.tsx
M	frontend/src/features/tenant/settings/ui/archived-data.tsx
M	frontend/src/features/tenant/settings/ui/products-page.tsx
M	frontend/src/features/tenant/settings/ui/profile-form.tsx
M	frontend/src/lib/api/client.ts
D	frontend/src/lib/api/environment-transport.test.ts
D	frontend/src/lib/api/environment-transport.ts
M	frontend/src/shared/cache/invalidate-api-page-cache.ts
M	frontend/src/shared/components/__tests__/global-omnibox.test.tsx
M	frontend/src/shared/components/crm/__tests__/crm-status-forms.test.tsx
M	frontend/src/shared/components/crm/__tests__/panel-migrations.test.tsx
M	frontend/src/shared/components/crm/bulk-selection-bar.tsx
M	frontend/src/shared/components/crm/crm-record-view.tsx
M	frontend/src/shared/components/global-omnibox.tsx
M	frontend/src/shared/hooks/__tests__/use-module-counts.test.ts
M	frontend/src/shared/hooks/use-cached-page.ts
M	frontend/src/shared/hooks/use-record-activities.test.ts
M	frontend/src/shared/hooks/use-record-activities.ts
M	frontend/src/shared/hooks/use-record-detail.ts
M	frontend/src/shared/services/auth.api.ts
M	frontend/src/store/__tests__/auth-context.phase2-preservation.test.tsx
D	frontend/src/store/__tests__/environment-switch.test.tsx
M	frontend/src/store/AuthContext.tsx
M	frontend/src/store/DataContext.tsx
M	frontend/src/store/mockData/users.mock.ts
M	frontend/src/store/types/shared.types.ts
M	frontend/src/store/types/user.types.ts
M	scripts/test-forms-db.mjs
M	scripts/test-sales-db.mjs
M	scripts/verify-deployment.cjs
M	shared/src/contracts/auth.contract.ts
M	shared/src/contracts/campaign-email.ts
D	shared/src/contracts/environment.contract.js
D	shared/src/contracts/environment.contract.ts
M	shared/src/contracts/task.contract.ts
M	shared/src/contracts/workflow-catalog.js
M	shared/src/contracts/workflow-catalog.ts
M	shared/src/contracts/workflow.contracts.ts
M	shared/src/index.js
M	shared/src/index.ts
```
