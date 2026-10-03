# Tasks alignment verification

Verified on 2026-09-29. Scope: Tasks list UI and the API operation needed for confirmed deletion.

## Implementation

- Tasks uses the Leads `ModuleWorkspace`, `ModuleFilterRail`, `DataGrid`, `RowActionsMenu`, `TableLoadingState`, `ManageColumnsDrawer`, and `LeadsPagination`.
- The List/Kanban/Workload selectors and duplicate Tasks column drawer were removed.
- Sorting uses DataGrid's header cycle and passes title/due date/created sorting to the existing Tasks query API. Pagination and filtering remain server-driven.
- View opens the existing editor read-only; Edit retains the existing save flow. Row menus contain View, Edit, Delete.
- Bulk actions are Clear selection, Mark as done, Assign, Reschedule, Delete. Selection is reconciled after a refresh.
- Reschedule uses the shared date/time pickers in a dialog and submits an ISO timestamp through the existing bulk API. Cancel sends no mutation.
- Both row and bulk deletion use a confirmation dialog, then `POST /api/v1/operations/tasks/bulk` with `{ operation: "delete", ids }`. There was no registered permanent Task delete operation. The new operation extends the existing strict shared schema and route, requires `deals.delete`, validates the active actor, scopes deletion to tenant/environment, and writes an audit event. Existing archive callers retain their behavior.
- Production columns continue using the existing preferences API. No new localStorage persistence was added; the Tasks column mock now keeps preferences in memory.
- Shared workspace additions are optional props used by Tasks; existing callers retain their defaults.

## Checks

| Check | Result |
| --- | --- |
| Frontend, backend and shared TypeScript checks | Passed |
| Focused frontend Tasks and DataGrid tests | 46 passed |
| Backend Tasks service tests | 17 passed |
| Isolated PostgreSQL/HTTP runner | 38 passed, 4 unrelated Lead creation/conversion failures listed below |
| Desktop browser fixture, 1366 × 900 | Passed |
| Mobile browser fixture, 320 × 740 | Passed |

The browser fixture rendered the actual Tasks page and shared components with controlled local data. It checked toolbar visibility during refresh, disabled refresh, filter placement and queries, ascending/descending queries, column visibility saving, pagination, synchronized selection, exact bulk/row actions, date/time submission, delete confirmation/cancellation, read-only View, bottom-row menu bounds, mobile filter drawer, and no document-level horizontal overflow. No production data was changed.

The new isolated HTTP/database tests passed for permanent deletion, link cleanup, updated counts, rescheduling persistence, invalid dates/IDs, foreign assignees, tenant/environment isolation, and permission denial. The existing runner creates a disposable in-memory PostgreSQL database.

Commands:

```sh
npm --prefix frontend run lint
npm --prefix backend run lint
npm --prefix shared run lint
npm --prefix frontend test -- src/features/tenant/operations/tasks/__tests__ src/shared/components/data-grid/__tests__/row-actions-menu.test.tsx src/shared/components/data-grid/__tests__/sorting-interaction.test.tsx --maxWorkers=1
npm --prefix backend test -- src/modules/operations/tasks/__tests__/tasks.service.test.ts
node backend/scripts/test-tasks-isolated.mjs
```

## Unrelated failures in the broader database runner

- Two workflow conversion tests expect legacy Lead statuses `Converted` and `Inquiry`; the current CRM returns `Closed` and `Warm`.
- Two existing Tasks association tests submit legacy Lead creation payloads and expect HTTP 201; the Leads endpoint returns HTTP 400.

These tests and the related CRM behavior were not changed as part of the Tasks alignment. No database migration is required. Deploy the updated backend and shared contract with the frontend to enable permanent deletion.
