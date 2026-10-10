# Dashboard and Leads UI polish — 11 October 2026

Implemented as targeted UI changes. Financial reporting, CRM APIs, database schema, permissions, tenant scope and synchronization hooks are unchanged. The existing Dashboard endpoint now returns all qualifying authorized actions instead of a capped preview, as required for the scrollable Action Center. No production database records were modified.

## Revenue Trend audit and change

The parent is `grid grid-cols-1 lg:grid-cols-12 gap-5`. Revenue Trend spans eight desktop columns and Action Center spans four. Both cards already use a column flex layout and a 320px minimum height. Grid's default stretch alignment gives them the same desktop row height. Originally, Action Center's natural-height list determined a taller row as its action count increased.

The chart region was fixed at `h-[220px]`, so it stayed at 220px even when its card stretched. The existing Chart.js adapter already uses responsive sizing and `maintainAspectRatio: false`. The constraint was the Dashboard chart region, rather than the chart library or financial data.

The parent grid, card minimum heights, horizontal padding and header spacing remain unchanged. The Revenue Trend header now prevents flex shrinking. The plot region is `relative flex-1 min-h-[220px]`, containing an `absolute inset-0` wrapper around the existing `ResponsiveContainer`. This gives percentage sizing a measurable parent and keeps the canvas from contributing an intrinsic height that could grow the grid repeatedly. The plot fills the remaining card height. Stacked layouts retain the 220px chart minimum independently of Action Center's height.

## Stable Action Center

The list reserves five 6.75rem action slots and four existing 0.625rem gaps: a 36.25rem desktop viewport at the existing `lg` breakpoint. Below `lg`, it reserves three slots and two gaps: a bounded 21.5rem viewport. At the default Medium density these are 108px slots, a 580px desktop viewport and a 344px stacked viewport. Using rem units preserves the slot count when the existing Small/Medium/Large font-density preference scales typography and spacing. The header remains outside the scroll region. Empty and permission-unavailable states occupy that same list area. Action count changes therefore do not grow or collapse either desktop card.

The list uses `overflow-y-auto`, `overflow-x-hidden`, the existing `custom-scrollbar`, and a stable scrollbar gutter. Five items fit without scrolling; the sixth and subsequent items remain in the same list and are accessible by mouse wheel, touch or keyboard. Links keep their existing routing, keys, colors, padding, status and due-date presentation. Two title lines fit in each slot; the full title remains in the accessible link text and native hover title. Inset focus outlines stay visible inside the scroll viewport. No effect remounts or resets the list on background updates.

The old backend preview limits were six tasks, three hot leads and three stale deals. Only `take`/`slice` display caps were removed. Eligibility predicates, task queries, overdue/type/priority/date ordering, tenant/assignment scoping, permission checks, pending counts and revenue calculations remain intact. No new endpoint or shared contract was needed.

The chart's lower edge matches the card's existing 24px bottom padding. Canvas height matches its chart region; desktop cards retain equal heights, independently of action count. Completing all tasks retains the established desktop card and chart heights.

Measured at 1440px in the final browser acceptance run:

| Actions | Card height | Chart height | List viewport | List content | Internal scrolling |
| --- | --- | --- | --- | --- | --- |
| 0 | 704px | 594px | 580px | 580px | No |
| 1 | 704px | 594px | 580px | 580px | No |
| 4 | 704px | 594px | 580px | 580px | No |
| 5 | 704px | 594px | 580px | 580px | No |
| 6 | 704px | 594px | 580px | 698px | Yes |
| 10 | 704px | 594px | 580px | 1170px | Yes |
| All completed | 704px | 594px | 580px | 580px | No |

The disposable test data includes one actual October 2026 observation of PHP 45,000, and a three-month period with August PHP 30,000, September PHP 20,000 and October PHP 45,000. Week, Month and Year continue to request the existing server aggregations, update the title/calendar labels, reconcile revenue and won counts, and render currency tooltips. The single-point marker and zero-anchored monetary scale remain in the existing chart adapter; no extra observations or months were added by the UI.

## Dashboard export and Leads table

Dashboard's Export CSV button, Download import, export state and handler were removed. Date range and Sync Metrics retain their existing classes and gap. Reports reused this same Dashboard view, so its existing export was moved into the Reports page and passed through an optional toolbar slot with the current query, report and styling. Reports still downloads the authorized CSV. The shared query helper, CSV utility and backend export endpoint remain intact.

Leads' trailing Actions column was generated by `DataGrid` when `LeadsDataGrid` supplied its email `quickActions`. That Leads-only configuration and its unused type import were removed. Shared DataGrid now omits the header, cells, 100px column slot and associated quick-action count automatically. All Leads, My Leads and Active Leads use the same corrected component.

The three-dot menu already supplies Send Email through `recordEmailComposeHref`; it remains unchanged, along with permitted View, Edit, Convert, Merge and Archive actions. Selection, row navigation, business fields, sorting, filters, counts and pagination retain their existing paths. Actions was not a persisted registry column, so no saved visibility or width preference migration is needed. Other modules' quick actions and CSV features were not removed.

## Verification

- Workspace `npm run lint`: passed in shared, backend and frontend. These scripts perform TypeScript checks.
- `npm run build`: passed in all three workspaces, including Prisma client generation and 180 Next.js generated pages. Production mocks were disabled and an explicit test HTTPS backend URL was supplied. The existing multiple-lockfile workspace-root warning is nonblocking.
- Focused frontend tests: 67 passed across nine suites covering Dashboard revision/filter hooks, chart formatting/single-point behavior, Reports CSV, Leads cells/selection/navigation/email, row menus, sorting, created-date filtering, background refresh and Inbox compose navigation.
- Reporting SQL/HTTP integration tests: 19 passed against a disposable PostgreSQL-compatible database. Coverage includes financial reconciliation, organization scope, calendar boundaries, action ordering, tenant/RBAC restrictions, CSV authorization and committed revision/SSE behavior. New coverage verifies all 34 qualifying task/lead/deal fixtures beyond the old caps, the staff viewer's 17 assigned actions, cross-tenant exclusion, and removal of task actions after permission revocation.
- Browser acceptance: 106 checks passed with zero page errors against the final production build. All eight requested widths passed for Week/Month/Year with single and multiple observations, and All/My/Active Leads. The My Leads checks used an eligible staff session with six assigned records. Exact five-slot geometry, no scroll at five, scroll at six, all additional actions, stable heights through additions/completions, preserved scroll position on an SSE addition and completion, wheel/keyboard/touch scrolling, focus visibility and existing task navigation passed. Small/Medium/Large density checks at 320px and 1440px also passed, including action text/due-date fit and slot counts. Reports CSV downloaded successfully; the Lead row menu opened the existing Compose email dialog with the correct recipient after editing/reassignment/status updates and refresh.
- Broader Dashboard browser regression: 44 checks passed with zero page errors against the same final build. Coverage includes two-viewer organization metrics, deal creation/stage changes/closure/reopening, won attribution, Workflow movement, archive/restore, reassignment, offline and server reconnects, live permission revocation/restoration, all nine date filters, conversion funnel periods and historical cohorts, export endpoint authorization, failed-request recovery, light/dark responsive layouts and deactivation with historical revenue preserved. An earlier run stopped at an outdated theme selector matching portal containers; the corrected final run completed successfully.
- `git diff --check`: passed for the final diff.

The reproducible browser harness uses the optimized frontend build, a local HTTPS gateway, real HttpOnly sessions, the actual Next proxy, Express, disposable SQL and Dashboard SSE. It checks 320, 375, 390, 430, 768, 1024, 1440 and 1920px for all three revenue intervals and all three Leads tabs. It exercises 0/1/4/5/6/10 actions, exact slot geometry, the sixth-item scrolling threshold, unchanged card/chart heights, background additions and completions without scroll resets, font density, mouse wheel, Home/End, Tab focus, mobile touch swipes and existing action navigation. It also checks single/multiple observations, tooltips, date changes, Sync Metrics, Reports downloads, Lead API creation and editing, assignment/status changes, search, status filters, sorting, selection, details, pagination, scrolling and existing email compose handoff.

Run with an installed Playwright package:

```powershell
$env:UI_POLISH_OUTPUT = '<absolute evidence directory outside the repository>'
node backend/scripts/verify-dashboard-browser.mjs '<installed Playwright package path>' --ui-polish
```

For focused Leads checks, append `--leads-only`. Earlier attempts hit Windows sandbox access errors and test-fixture/locator mismatches; these are not passing acceptance runs. Use the final `results.json` and log.

For the broader Dashboard regression, omit `--ui-polish` and set `DASHBOARD_VERIFICATION_OUTPUT` to an evidence directory outside the repository.

Final refinement evidence is under `C:/Users/Julie Ann Tiron/.codex/visualizations/2026/10/10/01a12681-0355-7fb2-8531-284c73d1e4bd/action-center-scroll-density/`, with the run log beside it as `action-center-scroll-density-run.log`. Representative screenshots include `dashboard-actions-5.png`, `dashboard-actions-6.png`, `dashboard-actions-scrolled.png`, `dashboard-multiple-tooltip.png`, `dashboard-month-320.png`, `leads-320.png` and `leads-1920.png`. Earlier evidence in `dashboard-leads-ui/`, `action-center-scroll/` and `action-center-scroll-final/` predates the final density adjustment.

The final broader regression evidence is in the neighboring `action-center-regression-final/` directory, with `action-center-regression-final-run.log` beside it. Its `results.json` records 44 passing checks and no page errors.

## Files changed

- `frontend/src/features/tenant/dashboard/ui/dashboard.tsx`
- `frontend/src/features/tenant/crm/leads/ui/leads-data-grid.tsx`
- `frontend/src/features/tenant/reporting/ui/reports-page.tsx`
- `frontend/src/features/tenant/crm/leads/ui/__tests__/leads-table-records.test.tsx`
- `frontend/src/shared/components/charts/ChartComponents.test.tsx`
- `frontend/src/features/tenant/reporting/ui/reports-page.test.tsx`
- `backend/scripts/verify-dashboard-browser.mjs`
- `backend/scripts/verify-dashboard-leads-ui.mjs`
- `backend/src/modules/reporting/reports/dashboard.service.ts`
- `backend/src/modules/reporting/reports/dashboard.integration.test.ts`
- `docs/verification/dashboard-leads-ui-polish.md`

## Deployment and limits

No Coolify deployment was performed. Local production-build/browser evidence does not establish the deployed site's behavior. I cannot confirm this. No real email was sent; compose handoff preserves the existing provider path, but live delivery remains unverified. The full repository test suite, every unrelated module's export UI and high-volume action load testing were not executed. Returning all qualifying actions increases response size with action count; the existing endpoint has been validated with the disposable fixtures above, not with a production-scale backlog.
