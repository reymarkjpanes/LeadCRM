# Settings layout and Archived Data implementation

Profile Settings, Appearance and Account Details now use `w-full max-w-6xl` (up to 1,152px), keeping their existing cards, padding and responsive field layouts. Archived Data uses the existing Leads DataGrid with configured columns and restore actions.

## Shared UI reused

- `DataGrid`: table headers/rows, borders, hover states, temporary controlled selection, select-all, keyboard navigation and two-axis scrolling. No new table design or table library.
- `TableLoadingState`: the existing Leads spinner; heading and filters remain visible.
- `PaginationControls`: server totals, page size, range, page indicator and previous/next controls.
- `Tooltip` and `RefreshCw`: icon-only mobile Restore with an accessible record-specific label and 44px target.
- `ConfirmActionDialog`: individual and bulk confirmation. Added focus containment, Escape dismissal and focus restoration to this existing component.

Selection clears on filter/page/workspace changes and is never persisted. Bulk restore processes at most the selected visible page (maximum 50 records) through individual endpoints, reporting actual successes and failures. Failed records remain eligible for retry. No new bulk endpoint or bulk request body was introduced.

## Backend and actual endpoints

Browser requests use the existing `/api/proxy` forwarding layer. Backend paths:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/administration/archived-data?type=Lead&page=1&limit=25` | New paginated aggregate query. Omit type for All. |
| PATCH | `/api/v1/crm/leads/:id/restore` | Existing Lead restore |
| PATCH | `/api/v1/crm/contacts/:id/restore` | Existing Contact restore |
| PATCH | `/api/v1/crm/accounts/:id/restore` | Existing Account restore |
| PATCH | `/api/v1/crm/deals/:id/restore` | Existing Deal restore; added UUID validation |
| PATCH | `/api/v1/administration/users/:id/restore` | Existing User restore; added UUID and inactive-state checks |
| PATCH | `/api/v1/administration/archived-data/:type/:id/restore` | New missing-type restore route; type is Pipeline, Role, Workflow, Campaign or Template |

The old UI combined three paginated CRM APIs with DataContext arrays; its non-CRM fallback sometimes modified browser storage or merely showed an unsupported-action message. There was no complete aggregate archive query or restore route for the five types above. The new service explicitly selects database models and reads only bounded pages and display fields. Existing working restore endpoints remain in use.

## Database behavior and security

- Restores update the original row; IDs, relationships and history remain intact. Nothing is deleted and recreated.
- Existing CRM archive flags/metadata are handled by their established services. New missing-type restores clear `isArchived`; User restoration changes `INACTIVE` to `ACTIVE`, matching the existing user archive architecture.
- Workflow recovery leaves it paused/inactive. Campaign recovery preserves status and delivery history and does not enqueue sending.
- Real `deletedAt` values supply Archived On; no date is invented for types without an archive timestamp. The column is omitted when the displayed page has no timestamp.
- Authentication, workspace readiness, tenant scoping, active environment scoping and existing per-module RBAC are enforced. Client Admin retains the established bypass. User/Role identities remain tenant-wide as defined by the existing schema.
- Shared Zod schemas allowlist types, validate UUIDs, reject unexpected query fields and bound page/limit values. Each bulk item is independently checked by its individual backend endpoint; no arbitrary model names or client tenant IDs reach queries.
- Protected/system roles cannot be restored through the generic route. User restoration rejects System Admin users and already-active accounts.
- Successful mutations invalidate archive/source caches and refresh the shared role, pipeline, deal or account state where needed. Environment switches stop further bulk requests.
- No browser storage is used for archived rows, selection or restore state.

**No database migration required.**

## Verification executed

- Frontend targeted tests: **46 passed** across Archived Data, API cache invalidation, environment transport, Leads/DataGrid interactions and Security Settings.
- Backend archive integration suite: **26 passed**, using isolated in-memory PostgreSQL-compatible PGlite with real Prisma and authenticated HTTP requests. Covers all ten types, preservation, pagination, UUID/query validation, unauthorized access, tenant/environment isolation and repeat restores.
- Final `npm run lint`: passed across frontend, backend and shared (TypeScript checks). A test-only unsupported locator option found by this check was corrected before the successful rerun.
- Backend `npm --prefix backend run build`: passed (Prisma generation and TypeScript).
- Frontend `npm --prefix frontend run build`: passed, including type validation and 189 generated pages. The initial sandbox attempt failed with filesystem `EPERM`; the approved rerun succeeded. Existing warnings remain about multiple workspace lockfiles and the local backend URL configuration.
- `git diff --check`: passed.

Browser verification used the actual Settings and DataGrid components in a temporary Vite fixture with synthetic API responses, not live tenant data. The fixture was removed after checking. Database behavior was verified separately by the integration suite.

| Viewport | Archive page overflow | Table behavior | Restore |
| --- | --- | --- | --- |
| 320px | None | 954px content scrolls inside 286px table region | Icon-only, 44px target, keyboard tooltip |
| 375px | None | Horizontal table scrolling | Icon-only |
| 768px | None | Horizontal table scrolling | Normal text action |
| 1440px | None | Table expands to content width | Normal text action |

Filter tabs stay on a single scrolling row. Profile and Account fields stack on mobile and use two columns at 768px. Profile header, Personal Information, Security, Appearance and Account cards measured 1,152px at desktop fixture width. Appearance was checked at 320px, 375px and 768px without page overflow. Bulk confirmation was also exercised in the browser.

## Files changed

Frontend:

- `frontend/src/features/tenant/settings/ui/settings-page.tsx`
- `frontend/src/features/tenant/settings/ui/profile-form.tsx`
- `frontend/src/features/tenant/settings/ui/archived-data.tsx`
- `frontend/src/features/tenant/settings/services/archived-data.service.ts` (new)
- `frontend/src/features/tenant/settings/ui/__tests__/archived-data.test.tsx`
- `frontend/src/shared/components/crm/confirm-action-dialog.tsx`
- `frontend/src/shared/cache/invalidate-api-page-cache.ts`
- `frontend/src/shared/cache/__tests__/api-invalidation.test.ts`
- `frontend/src/lib/api/environment-transport.ts`
- `frontend/src/lib/api/environment-transport.test.ts`
- `frontend/src/store/DataContext.tsx`

Backend:

- `backend/src/api/routes/administration.routes.ts`
- `backend/src/modules/administration/archived-data/archived-data.controller.ts` (new)
- `backend/src/modules/administration/archived-data/archived-data.service.ts` (new)
- `backend/src/modules/administration/users/users.controller.ts`
- `backend/src/modules/administration/users/users.service.ts`
- `backend/src/modules/crm/deals/deals.controller.ts`
- `backend/src/modules/crm/contacts/__tests__/crm-archive.integration.test.ts`

Shared and documentation:

- `shared/src/contracts/archived-data.contract.ts` (new)
- `shared/src/index.ts`
- `docs/settings-archive-verification.md` (this report)

