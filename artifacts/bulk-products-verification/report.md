# LeadCRM bulk actions and Products implementation

Implemented in the local workspace on September 30, 2026. No deployment, production database mutation, schema migration, or Git commit was performed.

## Shared UI and module changes

- Added `SelectedRowsBar`, with a fixed bottom position, safe-area inset, wrapping actions, a measured spacer, selected count, Clear selection, and minimum 44px button height. It appears only with selected rows.
- Reused `BulkSelectionBar` as the confirmation/mutation wrapper over that presentation. It handles partial results and stops sequential mutations across an environment switch.
- Migrated Tasks, Leads, Contacts, Accounts, Archived Data, Team Management, Campaigns, Workflows, and Products to the shared presentation.
- Tasks now exposes Archive in both bulk controls and the row menu. The bulk bar retains Mark as done, Assign, and Reschedule. Archived Tasks are listed and recoverable in Archived Data.
- Leads, Contacts, Accounts, Team, Campaigns, and Products offer only Archive in their bulk actions. Archived Data offers Restore. Workflows offers Pause and Archive; already inactive workflows are skipped safely by bulk Pause.
- Team Management now uses the existing DataGrid and Leads pagination, preserves search/filters and role checks, and offers View, Edit, the current Active/Inactive action, and Archive. The existing user archive model remains INACTIVE; inactive rows remain accessible through the Inactive filter.
- Campaigns now uses DataGrid with View, Duplicate, Archive. Duplication reads the saved full campaign before creating a draft. Existing status badges, report/builder behavior, metrics, filters, and pagination remain.
- Workflows uses the existing DataGrid with View, Edit, Duplicate, Pause/Resume, Archive. View opens the existing builder read-only. Run-history access remains.
- Reused the existing RowActionsMenu for all updated grids: trigger precedes checkbox, portal placement avoids table clipping, and toggle/outside-click/Esc behavior remains shared.

## Products

- Added the Products tab at `/settings?tab=products`, immediately below Custom Fields and above Archived Data. Uses the existing settings route shell.
- Header: Products / Manage products and their default Deal values. Add Product has an accessible compact mobile button.
- Uses DataGrid, search, name/value sorting, refresh, pagination, PHP currency display, selection, and View/Edit/Archive menus.
- Add/Edit use the existing SlidingDrawer and shared product schema. Names are trimmed and required, max 200 characters; values are numeric, finite, non-negative, and limited to two decimal places. Existing server duplicate-name rules remain in effect.
- View uses skeleton loading for details and the Closed Won customer list, with pagination and permission-aware Deal access.
- Product management was removed from the Product Interest field editor. That card now describes the field and links to Products, with the existing enable-field action when disabled.
- Reuses `ProductInterest`, its `active` flag, catalog hook, validation, and APIs. Archive sets `active: false`; it does not delete the product or update historical Deal values. Existing selectors and automatic Deal creation use the same active catalog. Existing historical relationships/snapshots are preserved.
- No database or Prisma schema changes and no second product table.

## API endpoints

All paths below are relative to `/api/v1` and pass through existing authentication, tenant/environment, validation, and permission layers.

| Operation | Endpoint used |
| --- | --- |
| Task row/bulk archive | `POST /operations/tasks/bulk`, `{ operation: "archive", ids }` (existing persisted archive operation) |
| Existing individual Task archive | `PATCH /operations/tasks/:id/archive` remains available; UI shares the bulk operation |
| Lead archive | `PATCH /crm/leads/:id/archive` |
| Contact archive | `PATCH /crm/contacts/:id/archive` |
| Account archive | `PATCH /crm/accounts/:id/archive` |
| Archived records list | `GET /administration/archived-data` |
| Lead/Contact/Account/Deal restore | `PATCH /crm/{leads,contacts,accounts,deals}/:id/restore` |
| User archive/restore | `PATCH /administration/users/:id/{archive,restore}` |
| User Active/Inactive | `PUT /administration/users/:id` through the existing user adapter |
| Task restore | `PATCH /administration/archived-data/Task/:id/restore` (Task support added to existing generic route) |
| Campaign archive | `PATCH /marketing/campaigns/:id/archive` |
| Campaign duplicate | Existing `GET /marketing/campaigns/:id`, then `POST /marketing/campaigns` |
| Workflow Pause/Resume | `PATCH /automation/workflows/:id/toggle`, `{ isActive }` |
| Workflow archive | `PATCH /automation/workflows/:id/archive` |
| Workflow duplicate | Existing detail GET, then `POST /automation/workflows` as inactive draft |
| Product list/create | Existing `GET` / `POST /administration/product-interests` |
| Product edit | Existing `PATCH /administration/product-interests/:id` |
| Product archive | Existing `DELETE /administration/product-interests/:id`; this is already a soft archive (`active: false`) |
| Product detail | Added `GET /administration/product-interests/:id` |
| Product Closed Won lookup | Added `GET /administration/product-interests/:id/closed-won?page=1&limit=25` |

The Closed Won query requires the same tenant and active environment, a pipeline stage whose `isWon` flag is true, and either the legacy `productInterestId` or membership in `productInterestIds`. It loads actual Deal/Lead/Contact junctions, account, assigned user, Deal value, and `closedAt`; it does not infer wins from Lead/Contact status. It uses bounded pages (maximum 100), validates the product UUID and query, and requires both settings.view and deals.view. Historical archived Deals remain eligible when actually in a won stage.

## Executed verification

- Workspace `npm run lint`: final rerun passed all three workspaces after test additions.
- `npm run build`: frontend and backend reported 2 successful tasks; 189 frontend pages generated. Initial attempts encountered a Windows Prisma DLL lock from the preview process, then sandbox readlink permissions. Preview processes were stopped and the approved unsandboxed build succeeded. Existing build warnings mention multiple lockfiles and the local default API URL; deployment configuration was not changed.
- Seven-file frontend run: **44 passed**, covering Products/field settings, Archived Data, Team, Workflows, Tasks, shared row menu, and Campaign server pagination.
- Follow-up Team suite: **6 passed**, including the added status-action and confirmed bulk-archive test.
- New Campaign table/menu suite: **3 passed**, covering saved-data duplication, View, confirmed selected archive, refresh, and permission restrictions.
- Sales/product database integration suite: final rerun **30 passed** against disposable PostgreSQL; includes product create/edit/archive rules, history/value preservation, actual Closed Won relationships, isolation, validation, permission checks, and the 100-row pagination boundary.
- Targeted Task archive/restore database test: **1 passed, 14 skipped** using `node backend/scripts/test-tasks-isolated.mjs src/modules/operations/tasks/__tests__/tasks.integration.test.ts -t "bulk archives persist"`.
- Broader existing Tasks/Workflows isolated runner: **32 passed, 11 failed**. Failures included stale CRM fixtures missing required fields/product selections and existing task fixture/timeout failures. These were not all repaired as part of this scoped change. Full-suite success: **I cannot confirm this.**
- `git diff --check`: passed (only Windows line-ending notices).

Browser verification used the actual local frontend/API and a disposable in-memory PostgreSQL database, with mock data/auth disabled:

| Check | Observed result |
| --- | --- |
| Products bar at 320 / 375 / 390px | Within viewport; page width matched viewport; buttons 44px high; wraps at 320px |
| Tasks bar at 320 / 375 / 390px | Within viewport; page width matched viewport; all five buttons 44px high; three rows at 320px and two at 375/390px |
| Product bottom-row menu at 320 / 390px | Menu stayed within viewport; same trigger toggled closed |
| Product Edit at 320px | Fields within viewport; no page overflow |
| Product View at 320px | Skeleton observed, then database-backed details and Closed Won empty state rendered correctly |
| Task archive and selected restore | Created local task, archived via confirmation, found it in Archived Data, confirmed Restore, saw success and refreshed empty archive list |

One transient local database connection error during archive listing recovered with Retry. No production data was involved. Every module/device combination, physical-device system safe areas, and production deployment behavior: **I cannot confirm this.** Shared-component reuse and unit tests cover the remaining modules, but they were not all manually exercised at every width.

Screenshots: [Tasks at 320px](tasks-320.jpg), [Products at 320px](products-320.jpg).

## Changed files

The following inventory includes implementation, contract, and test files. Screenshot/report artifacts are listed separately.
- `backend/scripts/test-tasks-isolated.mjs`
- `backend/src/api/routes/administration.routes.ts`
- `backend/src/modules/administration/archived-data/archived-data.service.ts`
- `backend/src/modules/administration/product-interests/product-interests.controller.ts`
- `backend/src/modules/administration/product-interests/product-interests.repository.ts`
- `backend/src/modules/administration/product-interests/product-interests.service.ts`
- `backend/src/modules/crm/leads/sales-automation.integration.test.ts`
- `backend/src/modules/operations/tasks/__tests__/tasks.integration.test.ts`
- `frontend/src/features/tenant/automation/workflows/ui/workflow-builder-page.tsx`
- `frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx`
- `frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx`
- `frontend/src/features/tenant/crm/accounts/ui/accounts-page.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contacts-page.tsx`
- `frontend/src/features/tenant/crm/leads/ui/leads-page.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx`
- `frontend/src/features/tenant/operations/tasks/__tests__/task-interactions.test.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/task-board.tsx`
- `frontend/src/features/tenant/operations/tasks/ui/task-table.tsx`
- `frontend/src/features/tenant/settings/services/archived-data.service.ts`
- `frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx`
- `frontend/src/features/tenant/settings/ui/__tests__/team-management-users.test.tsx`
- `frontend/src/features/tenant/settings/ui/archived-data.tsx`
- `frontend/src/features/tenant/settings/ui/product-editor.tsx`
- `frontend/src/features/tenant/settings/ui/product-interests-settings.test.tsx`
- `frontend/src/features/tenant/settings/ui/product-interests-settings.tsx`
- `frontend/src/features/tenant/settings/ui/products-page.tsx`
- `frontend/src/features/tenant/settings/ui/settings-page.tsx`
- `frontend/src/features/tenant/settings/ui/team-management-users.tsx`
- `frontend/src/features/tenant/settings/ui/user-panel.tsx`
- `frontend/src/shared/components/crm/bulk-selection-bar.tsx`
- `frontend/src/shared/components/crm/module-workspace.tsx`
- `frontend/src/shared/components/crm/selected-rows-bar.tsx`
- `shared/src/contracts/archived-data.contract.ts`
- `shared/src/contracts/product-interests.contract.ts`

Artifacts: report.md, tasks-320.jpg, products-320.jpg in artifacts/bulk-products-verification/.
