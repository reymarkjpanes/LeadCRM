# LeadCRM consistency and validation verification

Completed locally on 5 October 2026. Changes use the existing application services, tenant/RBAC checks, Prisma persistence, Zod contracts, and shared UI. No production records were used for testing and no browser-only data persistence was added.

## Requested report

| # | Area | Result |
|---|---|---|
| 1 | Header files | Existing `PageHeader` and `ModuleWorkspace` standardized; page files are listed below. Titles inherit the LeadCRM font and consistently use 20px / 700 / 28px with shared color and spacing. |
| 2 | Subheaders | Leads, Contacts, Accounts, Deals, Tasks, Campaigns, Workflows, Team Management, Roles & Permissions, Custom Fields, Products, Forms, Account Details, and General use the shared subtitle style. |
| 3 | Archived Data | **No main-page subheader.** The separate Archived Data Recovery section and its description remain. Confirmed at all five widths. |
| 4 | Create/Add | `CreateButton` reuses the existing primary `Button`, its colors, states, radius, padding, and icon sizing. |
| 5 | Mobile actions | Below the existing `sm` breakpoint, page Create/Add actions are 36px icon-only buttons with labels, tooltips, keyboard interaction and focus styling. Existing creation/import actions are preserved. |
| 6 | General validation | All six editable fields use the shared schema. Required name/email have red asterisks and inline errors; length limits match frontend and backend. Cancel restores the last saved draft; duplicate saves are locked and actual errors/success toasts are retained. |
| 7 | Backend validation | `UpdateOrganizationSettingsSchema` validates incoming changes; `organization-settings.service.ts` also validates required fields after merging a PATCH with the saved record. Existing transaction and audit logging remain. |
| 8 | Industry | The existing industry list was moved to one shared constant and reused by the Accounts dropdown, Organization dropdown, and server enum validation. |
| 9 | Telephone | Philippine landlines accept the requested `+63 (28) 123-3488` presentation and save `+63281233488`; country code, supported area code, digit count and separators are validated. Mobile numbers and excessive digits are rejected. |
| 10 | Email/domain | Required, trimmed, valid email is lowercased; all four supplied malformed examples fail. Hostnames are validated and lowercased; HTTP(S) prefixes/trailing slash normalize to a hostname. Invalid paths/text fail. |
| 11 | Groups refresh | Existing group-shaped skeleton appears on every refresh; existing request lock prevents duplicates. No plain loading message replaces the skeleton. |
| 12 | Products refresh | Uses the existing Leads table spinner during initial load and refresh; pagination is hidden. |
| 13 | Others ordering | The existing product sorting layer pins `Others` last before pagination, independent of ascending/descending sorting of other products. |
| 14 | Loading/pagination | Shared pagination suppresses itself during initial load/refresh. ModuleWorkspace also suppresses inline and footer pagination. Audited Leads, Contacts, Accounts, Tasks, Campaigns, Workflows, Users, Archived Data, Products and remaining shared pagination usages. Groups is not paginated. Existing matching spinner implementations were retained. |
| 15 | Selection gap | Audited Leads, Contacts, Accounts, Deals grid, Tasks, Campaigns, Workflows, Users, Products and Archived Data. Removed the shared selection-dependent spacer; bulk actions replace the existing toolbar without changing its height and scroll internally on narrow screens. Browser measurements show no pagination movement on selection for all nine populated selectable tables tested. Deals grid was audited in source; its live page uses the pipeline board. |
| 16 | Shared components | Updated PageHeader, Button/CreateButton, ModuleWorkspace, ModuleTableToolbar, LeadsPagination, generic Pagination, SelectedRowsBar, DataGrid interaction handling, DropdownMenu Escape handling and Sheet Escape handling. Grid wrappers for Leads/Contacts/Accounts/Deals/Tasks now use automatic height. Existing refresh buttons/loaders remain shared. |
| 17 | Workflow row click | Opens the existing detail Sheet. DataGrid excludes buttons, links, inputs, checkboxes and menu items from row-open handling. |
| 18 | Detail actions | Header order is Refresh, three-dot menu, Close. Menu uses existing edit builder, backend toggle, duplication and archive services; permissions and confirmation remain enforced. Details/list refresh and existing toasts follow successful mutations. |
| 19 | Refresh replacement | Removed the text refresh action; one shared icon button has tooltip, aria-label and loading/disabled feedback. It refreshes definition and activity without closing the panel. |
| 20 | Pause/Resume | Menu shows only Pause for active or Resume for paused workflows. Both persisted successfully against the disposable backend. |
| 21 | Workflow pagination | Replaced bespoke history controls with shared LeadsPagination; uses actual server total/page/limit metadata. Backend pagination remains tenant-scoped with a capped limit and stable ordering. Page 2 of 2 and refresh were exercised with 26 runs. |
| 22 | Responsive | Browser checks covered 1280px, 768px, 390px, 375px and 320px for every requested page, both Team tabs and Workflow details. Document/main/panel width measurements found no page overflow. Tables retain internal horizontal scrolling. A remaining Task 600px height was found, fixed and checked again. |
| 23 | Executed checks | Workspace lint/typechecks, relevant frontend suites, Organization schema/API suites, Workflow integration suite and production builds were run; exact results below. |
| 24 | Remaining issues | No known failing requirement in the tested scope. Physical-device and other-browser rendering were not tested: **I cannot confirm this.** Existing build warnings concern multiple lockfiles and the local API URL; Vite warns about the existing CommonJS config format. |

## Header file inventory

Paths below are relative to the repository root.

- `frontend/src/shared/components/ui/page-header.tsx`
- `frontend/src/shared/components/crm/module-workspace.tsx`
- `frontend/src/features/tenant/crm/leads/ui/leads-page.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx`
- `frontend/src/features/tenant/crm/accounts/ui/accounts-page.tsx`
- `frontend/src/features/tenant/crm/pipeline/ui/pipeline-page.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/task-board.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx`
- `frontend/src/features/tenant/marketing/forms/ui/forms-page.tsx`
- `frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx`
- `frontend/src/features/tenant/settings/ui/team-management.tsx`
- `frontend/src/features/tenant/settings/ui/roles-permissions.tsx`
- `frontend/src/features/tenant/administration/roles/ui/roles-page.tsx`
- `frontend/src/features/tenant/settings/ui/closing-fields-settings.tsx`
- `frontend/src/features/tenant/settings/ui/products-page.tsx`
- `frontend/src/features/tenant/settings/ui/settings-page.tsx` (Archived Data and Account Details)
- `frontend/src/features/tenant/settings/ui/organization-settings-form.tsx`

## Executed validation

- `npm run lint`: all three workspaces passed. These repository lint scripts run `tsc --noEmit` (frontend, backend, shared); there is no separate ESLint script.
- `npm --prefix frontend test -- --maxWorkers=2 --testTimeout=15000 src/features/tenant/settings src/features/tenant/automation/workflows src/shared/components/crm src/shared/components/data-grid src/shared/components/ui src/features/tenant/crm/leads/ui src/features/tenant/crm/contacts/ui src/features/tenant/crm/accounts/ui src/features/tenant/marketing/campaigns/ui src/features/tenant/marketing/forms/ui src/features/tenant/operations/tasks/ui`: **53 files, 527 tests passed**.
- `node backend/scripts/test-settings-isolated.mjs`: **2 files, 36 tests passed**, using fresh migrated in-memory PostgreSQL.
- `node backend/scripts/test-workflow-polish.mjs src/modules/automation/workflows/__tests__/workflow.integration.test.ts`: **52 tests passed**, using fresh migrated in-memory PostgreSQL.
- `npm run build`: **frontend and backend passed**, including Prisma generation, backend TypeScript and frontend production compilation/type validation/static generation.
- `npm --prefix frontend test -- --maxWorkers=2 --testTimeout=15000 src/features/tenant/operations/tasks`: **5 files, 29 tests passed** after the Task height correction.
- Final shared-toolbar regression run (`settings`, `automation/workflows`, shared `crm`/`data-grid`, Campaign UI and Tasks): **50 files, 506 tests passed**.
- `npm run build --workspace frontend`: **passed again after the final toolbar correction**, including type validation and 180 generated pages.
- `git diff --check`: passed.

Earlier stale UI test expectations were corrected and rerun successfully. A busy broad test run had a timeout; the final bounded-worker suite passed. Windows sandbox restrictions and a running Prisma DLL lock blocked initial build/test attempts; the approved runs resolved those environmental failures. The disposable UI database occasionally dropped its idle connection; retry succeeded, and the UI displayed the real API error instead of reporting success.

Manual browser checks exercised Organization required/email/domain errors, the existing industry dropdown, telephone display, cancel restoration and normalized saving; mobile create menus; group refresh skeleton; table loading without pagination; selected rows; Workflow row opening, menu toggle/Escape, Pause/Resume, activity refresh and paginated history. No campaigns or external messages were sent.

## Saved evidence

- [Responsive measurements](verification/responsive-checks.json)
- [Selection measurements](verification/selection-checks.json)
- [Workflow panel measurements](verification/workflow-panel-checks.json)
- [General at 320px](verification/general-320.png)
- [Archived Data at 320px](verification/archived-320.png)
- [Workflow menu and pagination at 320px](verification/workflow-detail-320.png)
- [Task selection at 320px](verification/tasks-selected-320.png)
- [Campaigns on desktop](verification/campaigns-desktop.png)

See [API documentation](API.md) for the updated organization validation and Workflow history contracts.
