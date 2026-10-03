# LeadCRM UI behavior verification — 2026-10-03

Implemented the requested pipeline and toolbar changes. No dependencies were added. Business APIs and pipeline/restore rules are unchanged; the only backend change registers Campaigns, Workflows, and Users columns in the existing preference system.

## Changes

- **Pipeline:** Reused dnd-kit core/sortable/utilities with PointerSensor, KeyboardSensor, sortableKeyboardCoordinates, verticalListSortingStrategy and the existing GripVertical icon. Drag listeners are attached only to the left handle. Cards reposition with sortable transforms. Inputs remain editable and selectable.
- **Persistence:** Calls the existing `pipelinesApi.reorderStages` method, PATCH `/crm/pipelines/:id/stages/reorder`, with every existing stage ID once. Uses the returned canonical stage ordering. Unsaved names remain keyed by stage ID; a rejected reorder restores the prior order. The backend continues validating tenant ownership and complete, unique IDs. Existing semantics allow every stage to reorder; protected starting/Won/Lost deletion rules and reference checks remain unchanged.
- **Modal:** The panel is a bounded flex column with a non-scrolling header. Only the body scrolls. Close X, backdrop handling, Escape and focus trapping remain available. Delete icons use the danger color. New Stage and its blue icon-only Plus button share one row, with tooltip/aria-label, Enter submission, pending guard, blank-input disabling and clearing after success.
- **Campaigns:** Leads search/filter styling, active-filter blue state, and right-aligned Refresh/Manage Columns. The toolbar also remains available when the list is empty. Existing metrics and campaign behavior remain unchanged.
- **Workflows:** Same shared toolbar and independent configurable columns, with existing filters and workflow actions preserved.
- **Team Users:** Tabs/count and New User occupy the top row; search/filter and right-aligned refresh/columns occupy the second row. The mobile create action becomes an accessible Plus button. Refresh retains loaded data while fetching so a valid current page does not reset.
- **Team Groups:** Same top-row arrangement with New Group. Adds group-name search, a Members filter sourced from actual group membership, and guarded data refresh. Existing list/cards and forms remain. **Groups does not support configurable columns; no Manage Columns control was added.**
- **Archived Data:** Existing type tabs remain. Uses Leads search and a right-aligned Refresh button. Restore uses Lucide **ArchiveRestore**, with tooltip and aria-label “Restore”, distinct from RefreshCw. Existing confirmation and restore service remain. The archive table has no existing column-preference configuration; no Manage Columns control was added.

## Shared components and preferences

Reused ModuleSearchInput, FilterButton, RefreshButton, ManageColumnsDrawer, useColumnPreferences, ModuleFilterRail, TableIconButton, Dialog primitives, Button, Tooltip primitives, DataGrid and LeadsPagination. Extracted the existing Leads Manage Columns button into ManageColumnsButton, used by Leads and the new ModuleTableToolbar. useModuleTableColumns connects the existing drawer/preferences to standalone grids and restores focus to its trigger.

Shared column definitions match each module's actual fields. The existing preference API stores settings under distinct `campaigns`, `workflows`, and `users` module keys, retaining its tenant/user scoping, validation and rollback behavior. Leads uses its original key and registry.

## Browser checks actually performed

Used the actual changed React components and project CSS in a temporary local Vite fixture with synthetic API/auth data. The fixture and server were removed after testing. No production CRM records were modified.

| View | Widths checked (900px height) | Result |
| --- | --- | --- |
| Team Users | 1440, 768, 390, 375, 320px | No page-level horizontal overflow; top-row create action and second-row controls fit |
| Team Groups | 1440, 768, 390, 375, 320px | No page-level horizontal overflow; create action stays with tabs; no fake columns control |
| Pipeline modal | 1440, 768, 390, 375, 320px | Close visible when scrolled to New Stage; exactly one scrolling body; input/Plus on same row; no horizontal overflow |
| Campaigns | 1440, 768, 390, 375, 320px | No page-level horizontal overflow; shared search height 32px |
| Workflows | 1440, 768, 390, 375, 320px | No page-level horizontal overflow; shared search height 32px |
| Archived Data | 1440, 768, 390, 375, 320px | No page-level horizontal overflow; Refresh and ArchiveRestore visibly distinct |

Browser interactions verified: pointer-handle and keyboard stage reordering; text selection does not reorder; edited names survive reorder; Enter creates one stage and clears the input; order survives reopening against the fixture; Escape closes; protected stage deletion is disabled. Verified Groups search/filter retention through refresh and New Group opening. Verified archive confirmation and successful fixture restoration. Saved column visibility for Campaigns, Workflows and Users, reloaded, and verified each module retained its own settings.

A desktop stage-grid positioning issue found in browser testing was corrected and visually checked. The final small Campaigns empty-state toolbar adjustment and drawer focus-return wiring were type/build checked after the browser session.

## Automated verification

- `npm --prefix frontend run lint`: passed during implementation.
- `npm run lint`: final run passed all three workspaces (TypeScript checks).
- `npm run build`: passed frontend and backend. Initial sandbox run failed with EPERM while Next.js read the parent directory; approved execution outside the sandbox succeeded. Final build also succeeded.
- Frontend targeted Vitest run: **51 tests passed across 6 files** — pipeline stages, Campaigns, Workflows, Team Users, Archived Data, and shared column drawer saving.
- Backend targeted Vitest run: **21 tests passed across 3 files** — preference service reconciliation, registry validation, and user independence.
- `git diff --check`: passed.

Pipeline tests cover original rename/delete-confirmation behavior plus ID-only reorder persistence, dirty-name preservation, rollback, protected deletion, and duplicate create submission prevention. Users tests cover current-page/search retention during a pending refresh. Existing archive tests verify actual endpoint selection and confirmation behavior with mocked transport.

Non-blocking tool output included Vite's config-loader warning, jsdom scrollTo notices, Next.js multiple-lockfile root inference, and the existing localhost backend configuration notice.

## Verification limits

Live database persistence, deployed endpoint behavior, and the full authenticated app shell at the requested widths were not exercised. **I cannot confirm this.** Browser evidence applies to the actual components in the synthetic local fixture; persistence and restore API calls were verified using mocked responses and existing service tests.

## Files changed

- [backend/src/modules/preferences/column-registry.ts](../backend/src/modules/preferences/column-registry.ts)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx](../frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx](../frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx)
- [frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.test.tsx](../frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.test.tsx)
- [frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.tsx](../frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.tsx)
- [frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx](../frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx)
- [frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx](../frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx)
- [frontend/src/features/tenant/settings/ui/__tests__/team-management-users.test.tsx](../frontend/src/features/tenant/settings/ui/__tests__/team-management-users.test.tsx)
- [frontend/src/features/tenant/settings/ui/archived-data.tsx](../frontend/src/features/tenant/settings/ui/archived-data.tsx)
- [frontend/src/features/tenant/settings/ui/team-management-groups.tsx](../frontend/src/features/tenant/settings/ui/team-management-groups.tsx)
- [frontend/src/features/tenant/settings/ui/team-management-users.tsx](../frontend/src/features/tenant/settings/ui/team-management-users.tsx)
- [frontend/src/features/tenant/settings/ui/team-management.tsx](../frontend/src/features/tenant/settings/ui/team-management.tsx)
- [frontend/src/shared/components/crm/filter-button.tsx](../frontend/src/shared/components/crm/filter-button.tsx)
- [frontend/src/shared/components/crm/module-workspace.tsx](../frontend/src/shared/components/crm/module-workspace.tsx)
- [frontend/src/shared/components/crm/refresh-button.tsx](../frontend/src/shared/components/crm/refresh-button.tsx)
- [shared/src/index.ts](../shared/src/index.ts)
- [frontend/src/shared/components/crm/manage-columns-button.tsx](../frontend/src/shared/components/crm/manage-columns-button.tsx)
- [frontend/src/shared/components/crm/module-table-toolbar.tsx](../frontend/src/shared/components/crm/module-table-toolbar.tsx)
- [frontend/src/shared/hooks/use-module-table-columns.tsx](../frontend/src/shared/hooks/use-module-table-columns.tsx)
- [shared/src/contracts/module-table-columns.ts](../shared/src/contracts/module-table-columns.ts)
- [docs/ui-behavior-verification.md](../docs/ui-behavior-verification.md)
