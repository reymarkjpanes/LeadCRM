# LeadCRM table consistency report

## Changes

- Tasks, Campaigns, Workflows and Products continue using the same `DataGrid` / `RowActionsMenu` as Leads. Added the missing 14px icons and the Leads archive divider/neutral archive styling. Menu width, spacing, hover, portal, viewport placement and toggle/outside-click behavior come from the existing component.
- Campaigns now uses Leads' `FilterButton`: blue `#2563EB` with white text while open, normal inactive styling when closed.
- Campaigns, Workflows and Archived Data show the existing `TableLoadingState` for both initial and subsequent requests. Their controls stay outside the loading area. Search/filter/page requests use the existing loading flags, including archive restore refresh.
- Workflows adds Duplicate and state-dependent Pause/Resume quick icons alongside View runs. Menu and quick actions share the existing mutation handlers, permission checks and busy lock. Every icon has a tooltip and accessible name.
- Products uses the extracted Leads `ModuleSearchInput`, with `Search products...`. Its Actions cell now has an Edit icon, tooltip and accessible name. It opens the existing Edit Product drawer; View remains in the row menu.
- Archived Data uses the same search component with `Search archived records...`. Search is sent to the existing archive endpoint. The backend applies case-insensitive search before counts/pagination while retaining tenant, environment and permission restrictions.
- Campaign and Workflow were added to the shared allowed archive types, so their tabs and All results use the already-existing source queries. Their existing restore routes are connected. Pipeline, Role and Template remain excluded from listing.
- Archived Data uses the existing recovery icon inside `TableIconButton`, with tooltip `Restore` and aria-label `Restore archived record`. The confirmation and restore business behavior are preserved.
- `TableIconButton` now supports a separate accessible label and stops click propagation so a Product edit click cannot be overridden by the row's View handler.

## Shared Leads components reused

`DataGrid`, `RowActionsMenu`, `FilterButton`, `TableLoadingState`, existing tooltip primitives and DataGrid icon-button styling. The original Leads toolbar input was extracted without changing its visual classes into `ModuleSearchInput`, now also used by Products and Archived Data. Existing `LeadsPagination` and the horizontally scrolling archive-tab container remain in place.

## Checks actually run

- `npm run lint`: passed for frontend, backend and shared packages.
- Targeted frontend Vitest run: **55 passed across 7 files**. Covered menu placement/toggle/outside click, Task actions, Campaign filter/loading/menu actions, Workflow menu and quick actions, Product edit behavior, archive search/restore/pagination and campaign server pagination. jsdom emitted its existing unimplemented `window.scrollTo` warnings.
- Focused PostgreSQL-backed archive integration run: **5 passed, 26 intentionally filtered out**. Covered Campaign/Workflow restoration, unauthorized and cross-tenant/environment rejection, server search, All aggregation, filtered counts and pagination, full-name/email search, and maximum query length.
- A broader backend run was attempted: **15 passed, 16 failed, 30 skipped**. The legacy CRM archive fixture lacks current schema columns including `Lead.productInterestIds` and `RecordFile.dealId`; cascading connection errors followed. The sales-automation suite skipped because its disposable-database requirement was not met. This broader run did not pass. Existing removed-category test expectations were updated to the requested category policy.
- `git diff --check`: passed.
- `npm run build`: passed for frontend and backend. The initial sandboxed attempt failed with `EPERM` while resolving the home-directory workspace root; the approved rerun completed successfully and generated 189 pages. Next.js warned about multiple lockfiles and a local backend URL pointing to localhost. Deployment configuration was not changed.

### Responsive browser checks

Used the actual module components and project CSS in an isolated local Vite preview with fixture API/auth data. The temporary preview files and server were removed after checking.

| Width | Products | Campaigns | Workflows | Archived Data | Tasks |
| --- | --- | --- | --- | --- | --- |
| 320px | Passed | Passed | Passed | Passed | Passed |
| 375px | Passed | Passed | Passed | Passed | Passed |
| 390px | Passed | Passed | Passed | Passed | Passed |
| 768px | Passed | Passed | Passed | Passed | Passed |
| 1440px | Passed | Passed | Passed | Passed | Passed |

At each width, document width stayed within the viewport. All four bottom-row menus stayed within the viewport and closed when the same trigger was clicked again. At 320px, additionally verified Campaign active blue/white and inactive white styles, the Product Edit drawer, the archive tabs' horizontal scrolling (571px content inside a 288px container), Workflow tab selection, and restore confirmation.

These checks cover the module views in the fixture preview, not the complete authenticated application shell or production data. For full-shell responsiveness, production mutations and live deployment behavior: **I cannot confirm this.**

### Test commands

```powershell
npm run lint
npm run build
npm --prefix frontend test -- src/shared/components/data-grid/__tests__/row-actions-menu.test.tsx src/features/tenant/settings/ui/__tests__/archived-data.test.tsx src/features/tenant/settings/ui/product-interests-settings.test.tsx src/features/tenant/automation/workflows/ui/workflows-page.test.tsx src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx src/features/tenant/operations/tasks/__tests__/task-interactions.test.tsx src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx
npm --prefix backend test -- src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts src/modules/crm/leads/sales-automation.integration.test.ts
npm --prefix backend test -- src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts -t 'searches before pagination|Campaign|Workflow'
git diff --check
```

## Files changed

- [backend/src/modules/administration/archived-data/archived-data.service.ts](../backend/src/modules/administration/archived-data/archived-data.service.ts)
- [backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts](../backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts)
- [backend/src/modules/crm/leads/sales-automation.integration.test.ts](../backend/src/modules/crm/leads/sales-automation.integration.test.ts)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx](../frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx](../frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx)
- [frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx](../frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx)
- [frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx](../frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx)
- [frontend/src/features/tenant/operations/tasks/ui/task-table.tsx](../frontend/src/features/tenant/operations/tasks/ui/task-table.tsx)
- [frontend/src/features/tenant/settings/services/archived-data.service.ts](../frontend/src/features/tenant/settings/services/archived-data.service.ts)
- [frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx](../frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx)
- [frontend/src/features/tenant/settings/ui/archived-data.tsx](../frontend/src/features/tenant/settings/ui/archived-data.tsx)
- [frontend/src/features/tenant/settings/ui/product-interests-settings.test.tsx](../frontend/src/features/tenant/settings/ui/product-interests-settings.test.tsx)
- [frontend/src/features/tenant/settings/ui/products-page.tsx](../frontend/src/features/tenant/settings/ui/products-page.tsx)
- [frontend/src/shared/components/crm/module-workspace.tsx](../frontend/src/shared/components/crm/module-workspace.tsx)
- [frontend/src/shared/components/data-grid/__tests__/row-actions-menu.test.tsx](../frontend/src/shared/components/data-grid/__tests__/row-actions-menu.test.tsx)
- [frontend/src/shared/components/data-grid/table-icon-button.tsx](../frontend/src/shared/components/data-grid/table-icon-button.tsx)
- [shared/src/contracts/archived-data.contract.ts](../shared/src/contracts/archived-data.contract.ts)
- [frontend/src/shared/components/crm/module-search-input.tsx](../frontend/src/shared/components/crm/module-search-input.tsx)
- This report: `docs/table-consistency-report.md`.
