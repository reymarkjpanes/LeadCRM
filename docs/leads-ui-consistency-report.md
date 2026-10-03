# Leads UI consistency implementation report

Implemented the requested Campaigns, Workflows, Team Management, Archived Data, and Forms changes. No database schema, authentication, tenant-scope, or RBAC changes. No production deployment was performed.

## Reused Leads components

- Extracted the original Leads footer into `LeadsPagination`, which is now used by Leads and all four requested targets. It retains `PageSizeSelect`, original borders, spacing, typography, previous/next controls, and adds wrapping for narrow widths. All targets offer the same 10/20/25/50/100 sizes.
- Workflows uses the existing `DataGrid`, `ModuleFilterRail`, and `TableLoadingState`.
- Extracted the Leads toolbar filter and refresh controls into `FilterButton` and `RefreshButton`, then used them in both the Leads workspace and Workflows.
- Extracted existing DataGrid quick-action styling into `TableIconButton`, reused by DataGrid and Workflows. Workflow actions have 44px mobile targets, compact desktop sizing, tooltips, aria-labels, focus rings, and disabled styles.
- Forms continues to use the existing portal-based `RowActionsMenu`, including its viewport collision positioning and confirmation dialog.

## Changes by area

| Area | Result |
| --- | --- |
| Campaigns pagination | Replaced numbered pagination with the Leads footer. Requests real server pages and uses `meta.total`; removed slicing of a capped response. Changing page size resets to page 1. Page loads use the existing table spinner without replacing the whole page. |
| Workflows table | Existing Leads DataGrid with Name, Trigger, Status, Last run, Runs, and Actions. Horizontal scrolling keeps columns readable. Existing loading and empty-state patterns retained. |
| Workflows filter | Existing Leads desktop rail and mobile drawer, with status and trigger selections, filter search, and clear filters. Contact terminology is changed only for display; internal trigger identifiers remain intact. |
| Workflows refresh | Icon-only Leads refresh control, labelled “Refresh workflows”, with spinning icon and disabled state during requests. |
| Workflows actions | Edit, Duplicate, View runs, Pause/Resume, and Archive are icon-only. Existing endpoints and confirmation behavior are retained. Duplicate creates an inactive copy. |
| Workflows pagination | Server page/limit requests, real filtered count, shared Leads footer, reset on filter/size changes, and page clamping after count reductions. |
| Team Management | Shared footer is visible even for a single page. Existing API-backed complete user loading, filters, table, and local page slicing remain unchanged. No localStorage data source was added. |
| Archived Data | Shared Leads footer uses the existing server-filtered total and page/limit requests. Archive type filters and table remain unchanged. |
| Forms cards | Removed the standalone Unpublish link. Published menu order is Edit, Duplicate, Unpublish, Delete. Delete remains disabled with its helper text while published. |
| Form builder | Published forms show Unpublish immediately after Discard changes. Drafts omit it. Uses the existing backend unpublish endpoint, updates the parent list and builder, preserves unsaved edits, and displays success/error feedback. |
| Form deletion | Published deletion remains disabled. Draft deletion still requires permanent-deletion confirmation. No Forms archiving was added. |

## API contracts and pagination defect corrections

Existing paths reused, all relative to `/api/v1` (browser calls use `/api/proxy`):

- `GET /marketing/campaigns`, plus existing templates and campaign metrics reads.
- `GET /automation/workflows`, `GET /automation/triggers`, `GET /automation/actions`.
- `POST /automation/workflows` for duplicate; `PATCH /automation/workflows/:id/toggle`; `PATCH /automation/workflows/:id/archive`; existing workflow execution history requests.
- `GET /administration/users` through `usersService`.
- `GET /administration/archived-data` with its existing archive type, page, and limit contract.
- `GET /marketing/forms`; `PATCH /marketing/forms/:id/unpublish`; existing duplicate, publish, update, and delete endpoints remain in use.

The Campaigns UI previously fetched only a capped batch and reported that batch length as the total, making larger datasets incomplete. It now requests each page from the same endpoint. To preserve existing multi-select filter behavior before paging, campaign `status` and `type` also accept comma-separated enum values; scalar values still work. Search retains name/description matching.

Workflows previously fetched every server page and then paginated locally. Its existing list query now applies selected status/trigger filters before both the page query and count. This avoids filtering only the current page and reporting an incorrect total. These small query changes retain tenant/environment scoping and add no routes or database fields. Shared list query interfaces document the client/server contract. Workflow writes invalidate the workflow list cache.

## Verification actually executed

- `npm run lint`: PASS for frontend, backend, and shared (three TypeScript checks).
- `npm --prefix backend run db:generate`: PASS; refreshed a stale local Prisma client using the unchanged schema. The initial backend type check had failed because generated task relations were missing; the rerun passed. No migration ran.
- Frontend targeted Vitest run: **46 passed across 6 files** — Forms, Team Management, Archived Data, row actions menu, Workflows page, and Campaign server-pagination hook.
- Frontend API cache invalidation suite: **12 passed**.
- Backend targeted pagination tests: **2 passed** — verifies matching filters/count/page queries and tenant/environment scope using mocked database calls.
- `git diff --check`: PASS.
- Frontend production build: PASS on the first permitted retry. An initial sandbox build failed with a Windows `EPERM readlink` error; the same build outside the sandbox succeeded. The final post-review production build also passed, including generation of all 189 static pages.

Browser verification used the actual modified React modules and styles in a temporary local Vite harness with in-memory API fixtures and a test auth context. The harness was removed afterward. No production records were changed.

| Area | Widths actually tested | Additional browser checks |
| --- | --- | --- |
| Campaigns | 320, 375, 768, 1440px | Footer stayed in bounds; changed size and navigated next/previous. |
| Workflows | 320, 375, 768, 1440px | Footer stayed in bounds; table scrolled horizontally. Mobile filter labels fit at 320/375; desktop filter sat beside the table. Keyboard focus scrolled to actions; 44px mobile buttons and tooltip verified. |
| Team Management | 320, 375, 768, 1440px | Footer stayed in bounds; next page showed remaining users. |
| Archived Data | 320, 375, 768, 1440px | Footer stayed in bounds; Contact filter changed count to its filtered result; size dropdown remained accessible. |
| Forms cards | 320, 375, 768, 1440px | Menu stayed in bounds; published action order and disabled Delete checked; unpublish updated status and enabled Delete. At 320×380 the menu flipped above its trigger. |
| Form builder | 320, 375, 768, 1440px | Menu fit; Discard changes/Unpublish order checked; unpublish immediately showed Draft. |

## Remaining limitations

- Responsive checks covered the actual module contents in the fixture harness, not an authenticated full-shell deployment against a live database.
- Database integration tests and live production mutations were not run. Backend persistence for unpublish reuses the existing implementation; tests verified frontend requests and returned-state handling, including failure and unsaved-edit behavior.
- Team Management intentionally retains its existing fetch-all API loading and client slicing to preserve its department/multi-select filtering behavior; totals derive from that complete API dataset.
- Build warnings report multiple workspace lockfiles and the local proxy backend URL (`localhost:4000`). These pre-existing environment settings were not changed.
- Vitest emitted its existing config-format warning and jsdom `scrollTo` notices; the tests passed.

## Files changed

- [backend/src/modules/automation/workflows/workflows.repository.ts](../backend/src/modules/automation/workflows/workflows.repository.ts)
- [backend/src/modules/marketing/campaigns/campaigns.service.ts](../backend/src/modules/marketing/campaigns/campaigns.service.ts)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx](../frontend/src/features/tenant/automation/workflows/ui/workflows-page.tsx)
- [frontend/src/features/tenant/crm/leads/ui/leads-page.tsx](../frontend/src/features/tenant/crm/leads/ui/leads-page.tsx)
- [frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts](../frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts)
- [frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx](../frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx)
- [frontend/src/features/tenant/marketing/forms/ui/form-builder-page.tsx](../frontend/src/features/tenant/marketing/forms/ui/form-builder-page.tsx)
- [frontend/src/features/tenant/marketing/forms/ui/forms-page.tsx](../frontend/src/features/tenant/marketing/forms/ui/forms-page.tsx)
- [frontend/src/features/tenant/marketing/forms/ui/forms.test.tsx](../frontend/src/features/tenant/marketing/forms/ui/forms.test.tsx)
- [frontend/src/features/tenant/settings/ui/__tests__/team-management-users.test.tsx](../frontend/src/features/tenant/settings/ui/__tests__/team-management-users.test.tsx)
- [frontend/src/features/tenant/settings/ui/archived-data.tsx](../frontend/src/features/tenant/settings/ui/archived-data.tsx)
- [frontend/src/features/tenant/settings/ui/team-management-users.tsx](../frontend/src/features/tenant/settings/ui/team-management-users.tsx)
- [frontend/src/shared/cache/invalidate-api-page-cache.ts](../frontend/src/shared/cache/invalidate-api-page-cache.ts)
- [frontend/src/shared/components/crm/module-workspace.tsx](../frontend/src/shared/components/crm/module-workspace.tsx)
- [frontend/src/shared/components/data-grid/data-grid.tsx](../frontend/src/shared/components/data-grid/data-grid.tsx)
- [frontend/src/shared/components/data-grid/row-actions-menu.tsx](../frontend/src/shared/components/data-grid/row-actions-menu.tsx)
- [frontend/src/shared/components/page-size-select.tsx](../frontend/src/shared/components/page-size-select.tsx)
- [frontend/src/shared/services/workflows.api.ts](../frontend/src/shared/services/workflows.api.ts)
- [shared/src/index.ts](../shared/src/index.ts)
- [backend/src/modules/automation/workflows/__tests__/workflow-pagination.test.ts](../backend/src/modules/automation/workflows/__tests__/workflow-pagination.test.ts)
- [backend/src/modules/marketing/campaigns/__tests__/campaign-pagination.test.ts](../backend/src/modules/marketing/campaigns/__tests__/campaign-pagination.test.ts)
- [frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx](../frontend/src/features/tenant/automation/workflows/ui/workflows-page.test.tsx)
- [frontend/src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx](../frontend/src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx)
- [frontend/src/shared/components/crm/filter-button.tsx](../frontend/src/shared/components/crm/filter-button.tsx)
- [frontend/src/shared/components/crm/leads-pagination.tsx](../frontend/src/shared/components/crm/leads-pagination.tsx)
- [frontend/src/shared/components/crm/refresh-button.tsx](../frontend/src/shared/components/crm/refresh-button.tsx)
- [frontend/src/shared/components/data-grid/table-icon-button.tsx](../frontend/src/shared/components/data-grid/table-icon-button.tsx)
- [shared/src/contracts/list-pagination.ts](../shared/src/contracts/list-pagination.ts)
- This report: `docs/leads-ui-consistency-report.md`.
