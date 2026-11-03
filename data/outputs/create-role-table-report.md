# Create Custom Role table verification

Implemented the table only in Settings > Roles & Permissions > Create Custom Role. The edit view, role list, separate builder modal, role API, validation, and permission enforcement retain their existing flows.

## Files changed for this task

1. [roles-permissions.tsx](<../../frontend/src/features/tenant/settings/ui/roles-permissions.tsx>) — create-view table, shared form controls, search/filter, counts, and local pagination.
2. [settings-page.tsx](<../../frontend/src/features/tenant/settings/ui/settings-page.tsx>) — consume extracted navigation metadata; preserve the pre-existing unrelated password-settings edit.
3. [settings-navigation.ts](<../../frontend/src/features/tenant/settings/settings-navigation.ts>) — existing Settings navigation definitions extracted for icon reuse.
4. [data-grid.tsx](<../../frontend/src/shared/components/data-grid/data-grid.tsx>) — honor existing custom-header and unclipped-cell options.
5. [checkbox.tsx](<../../frontend/src/shared/components/ui/checkbox.tsx>) — optional native, accessible, visible indeterminate state.
6. [filter-button.tsx](<../../frontend/src/shared/components/crm/filter-button.tsx>) — forward button ref and standard attributes for dropdown compatibility.
7. [roles-permissions.test.tsx](<../../frontend/src/features/tenant/settings/ui/__tests__/roles-permissions.test.tsx>) — focused creation, payload, selection, filtering, pagination, and existing-flow coverage.
8. [module-table-toolbar.test.tsx](<../../frontend/src/shared/components/crm/__tests__/module-table-toolbar.test.tsx>) — Filter button ref, keyboard, focus, and disabled compatibility.
9. [custom-cell-controls.test.tsx](<../../frontend/src/shared/components/data-grid/__tests__/custom-cell-controls.test.tsx>) — custom headers, unclipped cells, pin positions, and unchanged defaults.
10. [checkbox.test.tsx](<../../frontend/src/shared/components/ui/__tests__/checkbox.test.tsx>) — mixed state, refs, controlled/uncontrolled, and disabled behavior.
11. [preview-roles.mjs](<../../scripts/preview-roles.mjs>) — repair the existing local preview's browser environment shim and ignore Next build output.

## Existing components reused

DataGrid and its table/scroll/empty-state/summary rendering; Checkbox; Input; Label; Button; PageHeader; Badge; ModuleTabs; ModuleSearchInput; FilterButton; DropdownMenu; LeadsPagination and PageSizeSelect. Icons come from existing sidebar and extracted Settings navigation definitions.

No new UI component, selection hook, table system, API, dependency, or validation system was added. The new navigation file contains extracted configuration only. Optional shared-component extensions preserve their default rendering and behavior.

## RBAC source and behavior

The source is [permission-modules.ts](<../../shared/src/constants/permission-modules.ts>): PERMISSION_GROUPS, PERMISSION_MODULES, action labels, and togglePermissionSelection, intersected with the permission list already loaded through DataContext. The inspected catalog contains 15 display groups, 16 underlying modules, and 76 permissions; displayed counts are derived.

The five primary columns are View/Create/Edit/Archive/Import. Other supported grants remain available as labeled checkboxes in Additional Permissions. Team Management keeps distinct Users and Groups grants. Unsupported cells show a dash and cannot enable a grant. The existing API payload retains its false defaults for unsupported flags.

Row/header selection, mixed states, and counts use the existing permission-ID state. Global selection includes hidden and paginated rows. Existing View prerequisites remain enforced by the shared selection utility. Search matches display names only. Search, filter, and pagination preserve selected permissions.

## Verification results

- Seven focused frontend suites passed: **70 tests**. Suites covered RolesPermissions, Settings navigation, Checkbox, custom DataGrid cells, existing sorting interactions, ModuleTabs, and ModuleTableToolbar.
- After correcting a missing generic annotation in the new DataGrid test, its focused rerun passed **3 tests** and `npm --prefix frontend run lint` passed. In this repository that command runs TypeScript `tsc --noEmit`.
- `npm --prefix frontend run build` passed, including compilation, type validation, and generation of 180 static pages. The first attempt stopped at the existing explicit-API_URL configuration guard. The successful attempt used a process-local build-only `API_URL=https://api.example.test/api/v1`; no environment file was edited.
- `git diff --check` passed for task paths; only Git line-ending advisory messages were emitted. Existing unrelated working-tree edits were preserved. No backend or RBAC catalog file was changed by this task.
- Local browser fixture checks passed at **320, 375, 390, 430, 768, 1024, and 1440px**. No page-level horizontal overflow; fields and summary stayed within the content width; all 15 rows remained present. Fields stack below 1024px and align side-by-side at 1024px and above. The table scrolls horizontally when needed and fits fully at 1440px. Additional permission controls fit their cells; header actions and Filter remain accessible.
- Browser interactions verified the visible row/header checkbox targets, mixed states, View dependencies, search preservation, global selection, mobile filtering, and the empty state. No browser console errors were observed during the successful verification session.

## Evidence and compatibility limits

- Desktop screenshot (historical local evidence; artifact retired)
- 320px screenshot (historical local evidence; artifact retired)
- Responsive measurements (historical local evidence; artifact retired)

Browser acceptance used the existing in-memory role preview. Payload tests exercised the existing client against mocked HTTP responses. These checks do not establish live database persistence or production deployment. The existing CRM mobile scrolling behavior, including unpinning columns below 768px, is retained.

Both remote main branches and checkout HEAD were verified at d0fdf549 during the initial audit. Work remains in the existing dirty feature checkout; this task did not commit, push, merge, or deploy changes.
