# Roles & Permissions implementation report

Verified locally on October 4, 2026. This work changes the permission catalog, role editor, authorization, navigation, and related action controls. It retains the existing Roles & Permissions card styling.

## Final catalog

15 UI sections contain 75 applicable permissions. Team Management contains two independently authorized storage modules, users and groups, so the database catalog has 16 module names. The application retains its existing `module.action` key convention.

| Permission group | Exact permission keys | Count |
| --- | --- | ---: |
| Dashboard | `dashboard.view` | 1 |
| Leads | `leads.view`, `leads.create`, `leads.edit`, `leads.archive`, `leads.import` | 5 |
| Contacts | `contacts.view`, `contacts.create`, `contacts.edit`, `contacts.archive`, `contacts.import` | 5 |
| Accounts | `accounts.view`, `accounts.create`, `accounts.edit`, `accounts.archive`, `accounts.import` | 5 |
| Deals | `deals.view`, `deals.create`, `deals.edit`, `deals.archive`, `deals.manage_stages` | 5 |
| Tasks | `tasks.view`, `tasks.create`, `tasks.edit`, `tasks.complete`, `tasks.archive`, `tasks.assign` | 6 |
| Campaigns | `campaigns.view`, `campaigns.create`, `campaigns.edit`, `campaigns.send`, `campaigns.duplicate`, `campaigns.archive`, `campaigns.view_reports` | 7 |
| Workflows | `workflows.view`, `workflows.create`, `workflows.edit`, `workflows.activate`, `workflows.duplicate`, `workflows.archive`, `workflows.view_runs` | 7 |
| Forms | `forms.view`, `forms.create`, `forms.edit`, `forms.publish`, `forms.duplicate`, `forms.delete`, `forms.view_submissions` | 7 |
| Products | `products.view`, `products.create`, `products.edit`, `products.archive`, `products.view_closed_won` | 5 |
| Custom Fields | `custom_fields.view`, `custom_fields.create`, `custom_fields.edit`, `custom_fields.disable` | 4 |
| Archived Data | `archived_data.view`, `archived_data.restore` | 2 |
| Team Management | `users.view`, `users.create`, `users.edit`, `users.activate`, `users.archive`, `groups.view`, `groups.create`, `groups.edit`, `groups.delete` | 9 |
| Roles & Permissions | `roles.view`, `roles.create`, `roles.edit`, `roles.archive`, `roles.assign` | 5 |
| Organization Settings | `settings.view`, `settings.edit` | 2 |

The inspected implementation supports **Disable Custom Fields** and **Delete Groups**. Forms retain permanent deletion only while unpublished/draft. CRM records, tasks, campaigns, workflows, products, users, and roles use Archive labels. No Export permission was added. Products and Closed Won records are independent of Custom Fields; Closed Won Requirements belong to Custom Fields.

The legacy `/reporting` page remains available under `dashboard.view`, as requested. Its campaign reporting data requires `campaigns.view_reports`. There is no generic Reports & Analytics permission section.

## Removed or replaced permissions

Active catalogs, guards, DTOs, role templates, mock data, and seed/repair code now use the canonical catalog. Historical migrations and explicit rejection tests may still mention retired keys.

- The old `contacts.delete`, `accounts.delete`, `deals.delete`, `tasks.delete`, `campaigns.delete`, `workflows.delete`, `users.delete`, and `roles.delete` actions are replaced by the appropriate Archive permission.
- `settings.create`, `settings.delete`, `contacts.export`, `reports.view`, `reports.export`, `roles.manage`, `users.manage`, and `audit.view` no longer define active grants.
- Legacy `organizations` permission rows merge into `accounts`; other noncatalog module rows are removed by the migration.
- The broad Organization, Contacts & Accounts, Deals & Pipeline, Workflows & Automation, Marketing & Campaigns, and Reports & Analytics permission cards are replaced by the module sections above.
- No System Admin, Audit Trail UI, environment/sandbox, billing/subscription/Stripe, tenant-management, 2FA, Contact Type, or personal-profile permissions are in the new catalog.

Internal audit recording and tenant isolation remain part of the existing backend. The retained user-record history endpoint uses Users access and is filtered to User records; it does not grant access to a restored Audit Trail screen.

## Role validation and dependencies

Role names are trimmed, reject whitespace-only values, and retain the backend's 2–50 character limit. Description is optional with the existing 200-character limit. Tenant-scoped, case-insensitive duplicate names are rejected, including concurrent create/update conflicts.

The backend validates every permission module and action flag, rejects unknown fields and duplicate module rows, and rejects actions without that module's View permission. Unknown permission keys fail even for Client Admin.

The UI enables View when an action is selected and clears the module's actions when View is disabled. Backend checks require View independently, including for manually submitted requests and stored grants. This covers Create/Edit, Campaign Send/Reports, Pipeline Stages, Workflow Runs, and Archived Data Restore without circular dependencies.

Each master switch affects only its own section. Counters use only that section's actions; partial selections show a distinct partial state with accessible text. Team Management's user and group permissions share the section but retain their own View dependencies.

Cross-module operations also check the necessary related access. Archive lists/restoration require source-module View access; workflow restoration leaves the workflow paused. Role assignment and user activation are separate from personal-detail editing. Task completion and reassignment are separate from task editing, including mixed update payloads and bulk actions. Modifying an active workflow retains the existing activation checks.

## Client Admin and database result

The existing schema stores flags in `RolePermission`, related to `RoleDefinition`; assignments live in `UserRole`. There is no independent Permission table or permission-ID join table to invent.

[The new transactional migration](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/prisma/migrations/20261026000000_module_action_permissions/migration.sql>) adds the 15 additional action flags in place. It merges legacy Accounts grants, splits historical shared access where no explicit target row exists, maps prior archive/import behavior, removes obsolete module rows, clears inapplicable flags, and adds View prerequisites. It preserves roles, users, and user-role assignments.

Existing Client Admin system roles receive all 75 applicable grants; inapplicable flags remain false. Seeds and the repair process use the same catalog. Core administrator restrictions prevent renaming/restricting/archiving its protected role and prevent changes to built-in administrator access that would remove its role or deactivate/archive its user. No System Admin role is created.

Newly separated sensitive actions default **off for custom roles**. Administrators must explicitly grant actions such as Send Campaigns, Manage Pipeline Stages, Assign Tasks, or Activate Workflows after migration. Existing valid role assignments are not reset.

The migration was replayed against a disposable PostgreSQL-compatible PGlite database. Assertions confirmed that the existing test user and assignment survived, obsolete permission rows were removed, archive/import grants were mapped, and Client Admin had all 75 actions. Production was not migrated or reset. Whether the deployed database has this schema and these resulting grants: **I cannot confirm this.**

## Frontend enforcement

- Sidebar module links and direct routes use the applicable View permissions. Create/import routes additionally check their action. Settings sub-navigation checks each administration/customization permission; users and groups remain independent.
- Profile Settings, Appearance, and personal Account Details remain accessible to authenticated users without Organization Settings permissions.
- CRM create, inline edit, archive and import controls use their module grants. Pipeline configuration uses `deals.manage_stages`.
- Tasks use separate create/edit/complete/assign/archive controls. Completion/reassignment can operate without general editing.
- Campaign creation, editing, sending, duplication, archiving and reporting are separate. Draft editing does not permit Send. Report-only metrics are hidden without Reports access.
- Workflow activation/pause, duplication, archival and runs have separate controls.
- Forms use their own create/edit/publish/duplicate/delete/submission grants. Published-form deletion is still blocked.
- Product Closed Won access, Custom Field disable, archived restoration, user activation, group deletion, role assignment and organization editing follow their respective grants.

## Backend enforcement

The shared authorization service resolves current tenant-scoped, nonarchived roles and exact action flags. It does not infer privileged actions from Edit. Routes keep authentication, workspace readiness, and tenant middleware.

| Area | Enforcement locations and behavior |
| --- | --- |
| CRM | CRM routes plus record-file, relationship and service checks enforce independent Leads/Contacts/Accounts/Deals grants, imports, archive/recovery and pipeline configuration. |
| Tasks | Operations routes and task service enforce Complete/Assign separately, inspect generic updates, and reject the obsolete bulk-delete action. |
| Campaigns | Marketing routes and campaign service enforce Send, Duplicate, Archive and Reports independently; report data is masked when unavailable. |
| Workflows | Automation routes/services separate activate, duplicate, archive and runs; workflow actions retain their own runtime permission checks. |
| Forms | Marketing routes separate publishing, deletion and submissions; the published-form deletion guard remains. |
| Products / Custom Fields | Administration routes and closing-requirements service enforce their distinct modules, Closed Won visibility, and disable-only requests. Product picker reads needed by existing CRM/Form screens retain scoped read access. |
| Archived Data | Administration routes and archive service require archive access and the source module's View permission. Restoration does not trigger workflow activation or campaign sending. |
| Team / Roles / Settings | Administration routes and user/role services enforce fine-grained user, group, role and organization actions. Role payloads are validated server-side. |
| Dashboard / Reporting | Reporting aggregate routes use Dashboard View; campaign reports use Campaign Reports. |
| Related surfaces | Preference controllers, mailbox integration, record activity, and automatic Lead ownership use the correct independent module grants. Contacts access no longer grants Lead automation access. |

All 75 permission checks were exercised with allow/deny cases against real database role rows, including each action's View prerequisite. Representative authenticated HTTP calls cover direct-endpoint denial and the requested Sales Staff, Campaign Staff, Sales Manager and restricted-user scenarios. This is not a claim that every possible endpoint/payload combination has an individual HTTP test.

## Tests actually executed

| Command or selected suite | Final result |
| --- | --- |
| `node scripts/test-permissions-db.mjs` | **21 passed**, 3 files; migration assertions also passed. Includes all 75 grants/prerequisites, temporary role combinations, direct HTTP denial, Client Admin protection, task completion/assignment, user assignment/activation, custom-field disable and Lead/Contact automation separation. |
| Backend unit selections: tasks.service, reserved-role, primary-role, workflow-input-security, workflow-validation | **38 passed**, 5 files. |
| `node scripts/test-forms-db.mjs` | **31 passed**, 2 files; published-form deletion protection included. |
| `node backend/scripts/test-workflow-polish.mjs src/modules/operations/tasks/__tests__/tasks.integration.test.ts` | **15 passed**. |
| `node backend/scripts/test-mailbox-db.mjs` | **79 passed**, 2 files. |
| `node backend/scripts/test-crm-completion.mjs` | **14 passed**; migration-preservation assertions also passed. |
| Frontend Vitest selections: roles-permissions, archived-data, task-editor, task-related-record-creator, workflows-page, campaigns-page, campaign-builder, module-access-guard; run with `--no-file-parallelism` | **68 passed**, 8 files. |
| Frontend Vitest selections: user-panel, team-management-users, closing-fields-settings, forms | **24 passed**, 4 files. |
| Frontend Vitest selections: task-interactions, pipeline-stages-dialog | **10 passed**, 2 files. |
| `node scripts/test-sales-db.mjs src/modules/crm/leads/sales-automation.integration.test.ts src/modules/crm/leads/crm-completion.integration.test.ts` | **25 passed, 3 failed, 14 skipped**. The CRM completion tests were subsequently run with their dedicated harness and all 14 passed, as shown above. |

The three remaining sales-automation failures reach the existing error **“Deal must be Qualified before completing Closed Won requirements.”** Their names are:

- preserves both owners and sibling Deals while Won resolves one Contact and Account exactly once
- reuses normalized contact identity, preserves historical fields and rolls back ambiguous conversion
- matches formatted phones and company whitespace without duplicating historical records

That sales qualification rule was not changed. The entire sales suite is not passing; an unchanged-baseline run was not performed, so whether those failures also occur on the original commit: **I cannot confirm this.** The permission-specific Lead owner eligibility regression test passes.

The initial parallel frontend run had role-editor timeouts; the sequential rerun above passed. Vitest emitted existing configuration warnings, and jsdom emitted unsupported `window.scrollTo` notices.

Temporary database roles and users existed only in disposable test databases, which the test harnesses close and discard. Browser QA uses in-memory fixture roles and does not write production data.

## Build and lint actually executed

- `npm --prefix backend run db:generate`: **passed**.
- `npm run lint`: **passed** across the three workspaces.
- `npm --prefix backend run lint`: **passed again** after the final permission regression test.
- `npm run build`: **passed**, including backend/shared compilation and the Next.js production build (180 generated pages).
- `git -c core.safecrlf=false diff --check`: **passed**, including the final report check.

The first sandboxed production build encountered a Windows `EPERM` path/readlink issue; the approved rerun completed successfully. Build warnings included multiple lockfiles affecting Next.js root inference and the local API base URL. Deployment still needs its existing backend environment configuration.

## Responsive verification

The actual Roles & Permissions component and application CSS were rendered in a local Vite QA harness with in-memory providers. Create and Edit screens were checked at **1440px, 768px, 390px, 375px, and 320px** viewport widths.

All tested widths had no horizontal document overflow. Permission labels wrapped, switches stayed within the page, and Cancel/Create/Save controls remained accessible. The 15 section switches and 75 permission switches were checked for bounds. Master counts, individual-action View dependency and partial state were exercised.

Screenshots: [desktop](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/docs/qa/roles-permissions/edit-desktop.jpg>) and [320px](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/docs/qa/roles-permissions/edit-320.jpg>).

These are component browser checks, supplemented by authenticated backend tests. A complete deployed-browser session with each new role against production was not run. Production responsive behavior, production permission rows, and deployed end-to-end results: **I cannot confirm this.**

## Changed-file manifest

### Frontend files

- [frontend/qa/roles/fixtures.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/qa/roles/fixtures.tsx>)
- [frontend/qa/roles/index.html](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/qa/roles/index.html>)
- [frontend/qa/roles/preview.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/qa/roles/preview.tsx>)
- [frontend/src/features/tenant/administration/roles/services/roles.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/administration/roles/services/roles.service.ts>)
- [frontend/src/features/tenant/administration/roles/ui/permission-matrix.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/administration/roles/ui/permission-matrix.tsx>)
- [frontend/src/features/tenant/administration/roles/ui/permissions-tab.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/administration/roles/ui/permissions-tab.tsx>)
- [frontend/src/features/tenant/administration/roles/ui/role-builder-modal.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/administration/roles/ui/role-builder-modal.tsx>)
- [frontend/src/features/tenant/administration/roles/ui/role-card.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/administration/roles/ui/role-card.tsx>)
- [frontend/src/features/tenant/administration/roles/ui/role-detail-drawer.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/administration/roles/ui/role-detail-drawer.tsx>)
- [frontend/src/features/tenant/administration/roles/ui/roles-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/administration/roles/ui/roles-page.tsx>)
- [frontend/src/features/tenant/automation/workflows/ui/workflow-builder-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/automation/workflows/ui/workflow-builder-page.tsx>)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx>)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx>)
- [frontend/src/features/tenant/crm/accounts/config/record-detail.config.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/accounts/config/record-detail.config.tsx>)
- [frontend/src/features/tenant/crm/accounts/ui/accounts-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/accounts/ui/accounts-page.tsx>)
- [frontend/src/features/tenant/crm/contacts/config/record-detail.config.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/config/record-detail.config.tsx>)
- [frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx>)
- [frontend/src/features/tenant/crm/deals/config/record-detail.config.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/deals/config/record-detail.config.tsx>)
- [frontend/src/features/tenant/crm/leads/config/record-detail.config.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/leads/config/record-detail.config.tsx>)
- [frontend/src/features/tenant/crm/leads/ui/leads-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/leads/ui/leads-page.tsx>)
- [frontend/src/features/tenant/crm/pipeline/ui/pipeline-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/pipeline/ui/pipeline-page.tsx>)
- [frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.tsx>)
- [frontend/src/features/tenant/crm/shared/import/configs/account-import.config.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/shared/import/configs/account-import.config.ts>)
- [frontend/src/features/tenant/crm/shared/import/configs/contact-import.config.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/shared/import/configs/contact-import.config.ts>)
- [frontend/src/features/tenant/crm/shared/import/configs/lead-import.config.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/crm/shared/import/configs/lead-import.config.ts>)
- [frontend/src/features/tenant/layout/crm-layout.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/layout/crm-layout.tsx>)
- [frontend/src/features/tenant/layout/use-layout.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/layout/use-layout.ts>)
- [frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts>)
- [frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx>)
- [frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx>)
- [frontend/src/features/tenant/marketing/campaigns/ui/campaign-builder.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/campaigns/ui/campaign-builder.tsx>)
- [frontend/src/features/tenant/marketing/campaigns/ui/campaign-report-view.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/campaigns/ui/campaign-report-view.tsx>)
- [frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx>)
- [frontend/src/features/tenant/marketing/forms/ui/form-builder-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/forms/ui/form-builder-page.tsx>)
- [frontend/src/features/tenant/marketing/forms/ui/form-share-panel.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/forms/ui/form-share-panel.tsx>)
- [frontend/src/features/tenant/marketing/forms/ui/forms-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/marketing/forms/ui/forms-page.tsx>)
- [frontend/src/features/tenant/operations/tasks/__tests__/task-editor.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/__tests__/task-editor.test.tsx>)
- [frontend/src/features/tenant/operations/tasks/__tests__/task-related-record-creator.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/__tests__/task-related-record-creator.test.tsx>)
- [frontend/src/features/tenant/operations/tasks/ui/related-tasks.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/ui/related-tasks.tsx>)
- [frontend/src/features/tenant/operations/tasks/ui/task-board.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/ui/task-board.tsx>)
- [frontend/src/features/tenant/operations/tasks/ui/task-editor.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/ui/task-editor.tsx>)
- [frontend/src/features/tenant/operations/tasks/ui/task-related-record-creator.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/ui/task-related-record-creator.tsx>)
- [frontend/src/features/tenant/operations/tasks/ui/task-selector.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/ui/task-selector.tsx>)
- [frontend/src/features/tenant/operations/tasks/ui/task-table.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/ui/task-table.tsx>)
- [frontend/src/features/tenant/operations/tasks/use-tasks.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/operations/tasks/use-tasks.ts>)
- [frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx>)
- [frontend/src/features/tenant/settings/ui/__tests__/roles-permissions.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/__tests__/roles-permissions.test.tsx>)
- [frontend/src/features/tenant/settings/ui/__tests__/user-panel.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/__tests__/user-panel.test.tsx>)
- [frontend/src/features/tenant/settings/ui/archived-data.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/archived-data.tsx>)
- [frontend/src/features/tenant/settings/ui/closing-fields-settings.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/closing-fields-settings.tsx>)
- [frontend/src/features/tenant/settings/ui/deal-stage-automation-settings.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/deal-stage-automation-settings.tsx>)
- [frontend/src/features/tenant/settings/ui/products-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/products-page.tsx>)
- [frontend/src/features/tenant/settings/ui/roles-permissions.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/roles-permissions.tsx>)
- [frontend/src/features/tenant/settings/ui/settings-page.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/settings-page.tsx>)
- [frontend/src/features/tenant/settings/ui/team-management-groups.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/team-management-groups.tsx>)
- [frontend/src/features/tenant/settings/ui/team-management-users.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/team-management-users.tsx>)
- [frontend/src/features/tenant/settings/ui/team-management.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/team-management.tsx>)
- [frontend/src/features/tenant/settings/ui/user-panel.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/features/tenant/settings/ui/user-panel.tsx>)
- [frontend/src/shared/components/command-palette.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/command-palette.tsx>)
- [frontend/src/shared/components/crm/crm-record-view.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/crm-record-view.tsx>)
- [frontend/src/shared/components/crm/deal-card-menu.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/deal-card-menu.tsx>)
- [frontend/src/shared/components/crm/module-workspace.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/module-workspace.tsx>)
- [frontend/src/shared/components/crm/record-action-bar.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/record-action-bar.tsx>)
- [frontend/src/shared/components/crm/record-files-tab.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/record-files-tab.tsx>)
- [frontend/src/shared/components/crm/record-timeline-tab.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/crm/record-timeline-tab.tsx>)
- [frontend/src/shared/components/rbac-guard.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/components/rbac-guard.tsx>)
- [frontend/src/shared/hooks/use-permissions.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/hooks/use-permissions.ts>)
- [frontend/src/shared/hooks/use-record-activities.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/hooks/use-record-activities.ts>)
- [frontend/src/shared/providers/module-access-guard.test.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/providers/module-access-guard.test.tsx>)
- [frontend/src/shared/providers/module-access-guard.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/providers/module-access-guard.tsx>)
- [frontend/src/shared/services/campaigns.api.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/services/campaigns.api.ts>)
- [frontend/src/shared/services/roles.api.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/services/roles.api.ts>)
- [frontend/src/shared/services/workflows.api.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/shared/services/workflows.api.ts>)
- [frontend/src/store/AuthContext.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/store/AuthContext.tsx>)
- [frontend/src/store/DataContext.tsx](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/store/DataContext.tsx>)
- [frontend/src/store/mockData/users.mock.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/frontend/src/store/mockData/users.mock.ts>)

### Backend files

- [backend/src/api/middleware/__tests__/role-authorization.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/middleware/__tests__/role-authorization.test.ts>)
- [backend/src/api/middleware/rbac.middleware.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/middleware/rbac.middleware.ts>)
- [backend/src/api/routes/administration.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/routes/administration.routes.ts>)
- [backend/src/api/routes/automation.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/routes/automation.routes.ts>)
- [backend/src/api/routes/crm.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/routes/crm.routes.ts>)
- [backend/src/api/routes/integrations.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/routes/integrations.routes.ts>)
- [backend/src/api/routes/marketing.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/routes/marketing.routes.ts>)
- [backend/src/api/routes/operations.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/routes/operations.routes.ts>)
- [backend/src/api/routes/reporting.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/api/routes/reporting.routes.ts>)
- [backend/src/core/permissions/permission.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/core/permissions/permission.service.ts>)
- [backend/src/core/permissions/permissions.integration.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/core/permissions/permissions.integration.test.ts>)
- [backend/src/integrations/gmail/mailbox-ingestion.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/integrations/gmail/mailbox-ingestion.service.ts>)
- [backend/src/integrations/gmail/mailbox-sync.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/integrations/gmail/mailbox-sync.service.ts>)
- [backend/src/integrations/gmail/mailbox.integration.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/integrations/gmail/mailbox.integration.test.ts>)
- [backend/src/modules/administration/archived-data/archived-data.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/administration/archived-data/archived-data.service.ts>)
- [backend/src/modules/administration/audit/audit.controller.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/administration/audit/audit.controller.ts>)
- [backend/src/modules/administration/roles/__tests__/roles.integration.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/administration/roles/__tests__/roles.integration.test.ts>)
- [backend/src/modules/administration/roles/roles.dto.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/administration/roles/roles.dto.ts>)
- [backend/src/modules/administration/roles/roles.repository.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/administration/roles/roles.repository.ts>)
- [backend/src/modules/administration/roles/roles.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/administration/roles/roles.service.ts>)
- [backend/src/modules/administration/users/users.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/administration/users/users.service.ts>)
- [backend/src/modules/automation/actions/action-permissions.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/automation/actions/action-permissions.ts>)
- [backend/src/modules/automation/workflows/workflows.controller.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/automation/workflows/workflows.controller.ts>)
- [backend/src/modules/automation/workflows/workflows.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/automation/workflows/workflows.service.ts>)
- [backend/src/modules/crm/closing-requirements/closing-requirements.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/closing-requirements/closing-requirements.service.ts>)
- [backend/src/modules/crm/leads/crm-completion.integration.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/leads/crm-completion.integration.test.ts>)
- [backend/src/modules/crm/leads/lead-automation.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/leads/lead-automation.service.ts>)
- [backend/src/modules/crm/leads/sales-automation.integration.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/leads/sales-automation.integration.test.ts>)
- [backend/src/modules/crm/leads/sales-automation.preview.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/leads/sales-automation.preview.ts>)
- [backend/src/modules/crm/record-files/record-files.routes.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/record-files/record-files.routes.ts>)
- [backend/src/modules/crm/relationships/relationships.controller.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/crm/relationships/relationships.controller.ts>)
- [backend/src/modules/marketing/campaigns/campaigns.controller.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/marketing/campaigns/campaigns.controller.ts>)
- [backend/src/modules/marketing/campaigns/campaigns.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/marketing/campaigns/campaigns.service.ts>)
- [backend/src/modules/operations/tasks/__tests__/tasks.integration.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/operations/tasks/__tests__/tasks.integration.test.ts>)
- [backend/src/modules/operations/tasks/__tests__/tasks.service.test.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/operations/tasks/__tests__/tasks.service.test.ts>)
- [backend/src/modules/operations/tasks/tasks.repository.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/operations/tasks/tasks.repository.ts>)
- [backend/src/modules/operations/tasks/tasks.service.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/operations/tasks/tasks.service.ts>)
- [backend/src/modules/preferences/preferences.controller.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/preferences/preferences.controller.ts>)
- [backend/src/modules/preferences/table-preferences.controller.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/modules/preferences/table-preferences.controller.ts>)
- [backend/src/shared/constants/permissions.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/shared/constants/permissions.ts>)

### Database schema, migration, seed and repair files

- [backend/prisma/migrations/20261026000000_module_action_permissions/migration.sql](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/prisma/migrations/20261026000000_module_action_permissions/migration.sql>)
- [backend/prisma/schema.prisma](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/prisma/schema.prisma>)
- [backend/src/database/scripts/repair-role-permissions.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/database/scripts/repair-role-permissions.ts>)
- [backend/src/database/seeders/production-test.seed.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/database/seeders/production-test.seed.ts>)
- [backend/src/database/seeders/roles.seed.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/database/seeders/roles.seed.ts>)
- [backend/src/database/seeders/tenant-generator.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/backend/src/database/seeders/tenant-generator.ts>)

### Shared contracts and catalog

- [shared/src/constants/permission-modules.js](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/constants/permission-modules.js>)
- [shared/src/constants/permission-modules.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/constants/permission-modules.ts>)
- [shared/src/constants/permissions.js](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/constants/permissions.js>)
- [shared/src/constants/permissions.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/constants/permissions.ts>)
- [shared/src/constants/role-templates.js](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/constants/role-templates.js>)
- [shared/src/constants/role-templates.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/constants/role-templates.ts>)
- [shared/src/contracts/task.contract.js](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/contracts/task.contract.js>)
- [shared/src/contracts/task.contract.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/contracts/task.contract.ts>)
- [shared/src/types/roles.ts](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/shared/src/types/roles.ts>)

### Verification scripts and artifacts

- [.gitignore](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/.gitignore>)
- [docs/qa/roles-permissions/edit-320.jpg](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/docs/qa/roles-permissions/edit-320.jpg>)
- [docs/qa/roles-permissions/edit-desktop.jpg](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/docs/qa/roles-permissions/edit-desktop.jpg>)
- [scripts/preview-roles.mjs](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/scripts/preview-roles.mjs>)
- [scripts/test-permissions-db.mjs](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/scripts/test-permissions-db.mjs>)

This report is also new: [docs/roles-permissions-report.md](<C:/Users/Julie Ann Tiron/Desktop/LeadCRM/docs/roles-permissions-report.md>).
