# Leads table consistency verification

Implemented locally on `main` on 2026-10-12. No deployment, database migration, or production data change was performed.

## Result

The default visible columns are First Name, Last Name, Email, Phone, Company Name, Status, and Assigned Agent. Other registered columns remain available in Manage Columns, including Created, Source, Product Interest, and the existing communication columns.

First Name renders only `row.firstName`, beside the existing blue avatar, with the existing blue text, hover classes, alignment, and row navigation. Avatar initials use the first letters of First Name and Last Name, retaining the two-letter fallback for a single name. Last Name renders only `row.lastName`, with the Contacts table's normal text classes and an em dash for null, undefined, or empty values. The company subtitle was removed. The dedicated Company Name renderer still reads `row.companyName`.

Both name columns support sorting and resizing. Last Name is visible by default and can be hidden through Manage Columns. The backend's Leads query allowlist and saved-sort registry now accept `lastName`, so server pagination retains the selected name ordering.

## Exact source and test files changed

| File | Change |
| --- | --- |
| `frontend/src/features/tenant/crm/leads/ui/leads-data-grid.tsx` | Separate name renderers, remove company subtitle, enable Last Name sort and width |
| `frontend/src/shared/constants/column-registries.ts` | Name labels, Last Name registration, seven-column defaults, unique ordering for additional columns |
| `backend/src/modules/preferences/column-registry.ts` | Matching labels/defaults/order and Last Name sortable metadata |
| `backend/src/modules/crm/contacts/contacts.repository.ts` | Add `lastName` to the existing Leads query's safe sort allowlist; this compatibility path queries `prisma.lead` |
| `shared/src/contracts/lead-column-migration.ts` | Backward-compatible Leads-only preference normalization |
| `shared/src/contracts/lead-column-migration.js` | Generated CommonJS companion synchronized by the shared build |
| `frontend/src/features/tenant/crm/leads/ui/__tests__/leads-table-records.test.tsx` | Actual names, initials, missing values, company placement, navigation and selection assertions |
| `frontend/src/shared/components/data-grid/__tests__/sorting-interaction.test.tsx` | Separate name sorting and updated labels; retain optional Created/Source sorting checks |
| `backend/src/modules/preferences/__tests__/lead-name-columns.test.ts` | System defaults, custom layouts, widths, visibility, read-only user/tenant resolution and migration idempotence |
| `backend/src/modules/preferences/__tests__/preferences-service.property.test.ts` | Account for name migration before the existing registry reconciliation property |
| `backend/src/modules/crm/contacts/__tests__/lead-list-sorting.test.ts` | Name sorting before pagination, tenant/search constraints, All/My/Active scope filters and safe-sort fallback |

## Saved preferences

Normalization runs through the existing shared helper, already used by the frontend preference hook and backend reconciliation. It does not write or delete preference records on read.

- Configurations without saved preferences use the new system defaults.
- Snapshots whose visible columns exactly match the old default sequence receive the new seven-column sequence. Their widths are retained; Created and Source remain registered but become hidden.
- Other old layouts retain existing column order relative to one another, visibility, and widths. Last Name is inserted immediately after First Name. Numeric order positions are compacted to accommodate the insertion.
- An existing Last Name entry retains its explicitly saved order, visibility, and width. Repeated normalization is idempotent.
- The earlier email/phone migration remains intact, and other modules are unaffected.

These cases passed the backend preference tests, including resolution from both user and tenant defaults without repository writes/deletes.

## Table and responsive verification

The browser preview bundles the actual shared DataGrid, LeadsDataGrid, Manage Columns drawer, and existing application CSS. It uses the supplied example records plus a missing Last Name fixture. Auth, navigation, field-layout and lookup services are isolated for local UI verification. The before renderer and registry were copied from the unchanged source before implementation. These screenshots are local mock previews, not production screenshots.

| Width | Light | Dark |
| --- | --- | --- |
| 320 | Passed | Passed |
| 375 | Passed | Passed |
| 390 | Passed | Passed |
| 430 | Passed | Passed |
| 768 | Passed | Passed |
| 1024 | Passed | Passed |
| 1440 | Passed | Passed |
| 1920 | Passed | Passed |

All 16 cases passed header/cell alignment, container bounds, name/company placement, missing Last Name, and row-height checks. Horizontal overflow stays inside the existing table scroll container. Desktop light and mobile dark screenshots were also visually inspected.

Browser interactions passed: First Name sorting; Last Name ascending/descending/reset; clicking Josh returns the Josh record; individual and select-all selection; quick filtering by Panes; Last Name drag resizing; and Manage Columns hiding/saving Last Name. The drawer retains its existing behavior of staying open after Save. There were no page errors. Measurements and interaction results are in [browser-results.json](browser-results.json).

All Leads, My Leads and Active Leads use the same `LeadsDataGrid` in `leads-page.tsx`. Backend tests exercised all three existing scope filters with Last Name sorting. No separate renderer or view-specific presentation change was required.

Tenant filters, mutation authorization, Sales assignment restrictions, and Edit permission guards were not modified. Database-backed Sales/RBAC session tests were not run; the browser preview does not establish live authorization behavior. Lead creation/editing, imports, conversion, relationships, bulk-action handlers, pagination, and Contacts styling were not changed.

## Checks

- Backend: 42 tests passed across six preference and Leads query files.
- Frontend: 183 distinct relevant tests passed across 15 files, including selection, row actions, resizing, Manage Columns saving, local preference migration, empty states, visible columns, and both name sorts. A Windows Vitest worker initialization timeout prevented the first combined run from completing; the affected sorting file subsequently passed all 11 tests on its own. The final renderer file passed all six tests after the avatar fallback adjustment.
- Repository TypeScript checks: all three workspaces passed after regenerating the stale local Prisma client.
- Monorepo production build: all three workspaces passed. The build used a temporary `API_URL=https://api.example.test/api/v1` process value because the local environment lacks a valid production backend URL. No environment file was edited and this test URL was not deployed.
- `git diff --check`: passed.

## Screenshots and artifact files

Before: 1440px light (historical local evidence; artifact retired).

After: 1440px light (historical local evidence; artifact retired), 1440px dark (historical local evidence; artifact retired), 390px light (historical local evidence; artifact retired), 390px dark (historical local evidence; artifact retired).

The complete artifact additions are this `README.md`, `browser-results.json`, `before-1440-light.png`, and `after-{320,375,390,430,768,1024,1440,1920}-{light,dark}.png` (one PNG for every width/theme combination).

## Deployment

Not deployed. `https://lead-crm.tech` was not checked during this task. Production behavior and database-backed authorization are not claimed as verified.
