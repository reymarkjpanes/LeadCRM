# Organization Dashboard and pipeline refinements

Pre-publication verification report, 9 October 2026, Asia/Manila. The checks below were recorded before publication and deployment. Production readiness is not confirmed by these local checks. This report supersedes the scope, chart and color behavior described in the earlier Dashboard implementation report. Business definitions are maintained in [Dashboard reporting definitions](dashboard-kpis.md).

## 1. Audit findings

Non-admin analytics included `assignedUserId` restrictions in Lead counts, Deal SQL, exclusions and agent ranking. This produced different organization results depending on the viewer. Stage.color already existed, with server hex validation and committed analytics invalidation, but the management dialog exposed names only. The funnel used the global reporting period and observed all milestones through generation time. Revenue automatically switched daily/monthly granularity. The area wrapper ignored zero minimum and calendar tick formatters. Action Center capped an inner list at 300px. Deals selectors had no cross-session metadata subscription.

The current read-only configured-database audit found one active, correctly ordered five-stage Sales Pipeline. Its existing colors are unset, and open-stage probabilities are explicitly zero; neither was overwritten. Ten eligible Deals have no recorded starting milestone, with no missing/invalid closing dates, other currencies or missing/negative amounts in the audit. This configured connection has not been proven to be the database served by Coolify.

## 2. Organization-wide reporting

The existing dashboard.view grant now enables tenant-wide analytics for Client Admin and explicitly authorized custom/staff roles. Each dependent module retains its canView check. Analytics never narrow by the viewer, creator, owner or assigned agent. No role grants were added. Server rechecks access before releasing a repeatable-read snapshot. Compatibility Lead-status and task-completion report endpoints also use tenant-wide aggregates. Action Center retains tenant actions for Client Admin and permitted assigned actions for others.

## 3. KPI and chart reconciliation

Controlled disposable database: two eligible agents, two Lead records, four open Deals and two Won / one Lost outcomes.

| Measure | Verified value |
| --- | ---: |
| Revenue | PHP 66,000 |
| Agent-attributed revenue | PHP 45,000 + PHP 21,000 |
| Open stage counts | 1 + 2 + 1 = 4 |
| Open stage values | PHP 1,000 + PHP 4,000 + PHP 3,000 = PHP 8,000 |
| Forecast | PHP 100 + PHP 1,600 + PHP 2,100 = PHP 3,800 |
| Total Leads | 2 |
| Won / Lost / Win rate | 2 / 1 / 66.7% |
| Mean creation-to-Won duration | 4 days |

Admin and authorized staff/custom-role analytics, distribution, trend, cohort and leaderboard match. Private action details retain separate visibility. Week, Month and Year buckets reconcile to the same global-period revenue. Historical custom cohorts exclude events recorded after the To day. The leaderboard remains top five; unknown/ineligible historical attribution and lower-ranked agents can legitimately explain differences from total revenue. These fixture totals are not production totals.

## 4. Stage color implementation

Reuses Stage.color and the existing deals.manage_stages API. Shared six-digit hex validation and shared suggested defaults apply across the management dialog, Deals adapter and Dashboard. Saved colors take precedence; null legacy values receive a presentation default until explicitly saved. New canonical stages are initialized with defaults. The dialog adds picker, hex input and preview below each name, saves both fields, blocks duplicate requests and restores rejected values. Official names, IDs, order and terminal outcomes remain protected. Color-only writes leave Deals and history unchanged.

## 5. Dashboard cleanup

Removed the automatic/assigned-record subtitle, reporting-limitations accordion, Revenue Trend date/timezone subtitle and expandable revenue/outcome table. Removed the four funnel progression rows. Diagnostics, nullable unavailable metrics, CSV warnings and real error/retry states remain. Header text can shrink and wrap beside the new filter controls; visual inspection caught and corrected narrow-screen funnel-heading clipping. Card styling, navigation, typography and themes are preserved.

Follow-up: the welcome message now has the current Manila weekday and full date directly below it, followed by bold 24-hour time with seconds. A separate clock component updates every second and on focus/visibility changes, without driving chart or report refreshes. The global period explanation and the funnel's eligible-cohort/milestone explanatory note were removed from presentation; reporting filters and backend calculations remain intact.

The Dashboard date-range, Export CSV and Sync Metrics toolbar buttons now show only their icons below the existing 640px `sm` breakpoint, with 44px touch targets. Labels and original button sizing remain at 640px and above. Accessible names, loading states and title hints remain available on small screens.

## 6. Revenue Trend

Month is the default. Week/Month/Year controls change SQL calendar grouping and the corresponding title without changing the global range. Weeks start Monday under the existing Manila reporting convention. Only intersecting buckets are generated. The Won Deals indicator remains in the header beside the filter. Nonnegative data requests a zero minimum; the chart wrapper preserves negative data when that minimum is absent. Currency tooltips, readable calendar ticks and automatic tick spacing are verified by focused tests.

## 7. Action Center

Removed the list's maximum height and inner scrolling, using natural page scrolling. Titles wrap rather than clip. Selection includes overdue tasks before high-priority current tasks, followed by Hot Leads and configured stale Deals. Existing bounded action counts and permission scope remain.

## 8. Conversion Funnel

Independent calendar Week/Month/Year-to-date and Custom Range controls default to Month. Client and server reject invalid, reversed and future ranges. Both date inputs cap selectable dates at Manila today. Custom observation cutoff is the earlier of generation time and the end of the To day. Counts use actual distinct stage history within the creation cohort, including separate Won and Lost branches. Missing initial history is retained and disclosed in diagnostics; no events or percentages are invented. Selected filters, cutoff and warnings also flow into CSV exports.

## 9. Real-time verification

Dashboard keeps the existing persisted tenant revision stream. Duplicate revisions are ignored; changing filters retains one subscription. Aborted/superseded requests cannot replace newer reports. A single shared Deals metadata feed hashes committed authorized stage metadata, uses the existing session/RBAC SSE lifecycle and refreshes selectors across sessions. Deal-only writes do not invalidate that metadata hash. Reconnection and focus restore authoritative data; Sync Metrics remains available.

The Next proxy explicitly streams the new metadata endpoint. A regression test verifies delivery before upstream closure; otherwise the proxy would buffer metadata until its 45-second session ended. The browser acceptance harness uses real cookies, Express, the optimized Next build behind local HTTPS, isolated browser contexts and disposable PostgreSQL-compatible storage. Final browser results and responsive screenshots are recorded under ignored data/outputs/dashboard-verification. See the final testing entry below for the completed result.

Final run: both viewers observed PHP 2,800 from two agents' wins without reload. All five color saves reached both Dashboard viewers and another Deals session, and persisted when the manager reopened. Recovery assertions require an actual stage change to appear, rather than an unchanged total. Across 22 measured mutation checks, response-to-verified-display averaged 2.15 seconds (maximum 5.95 seconds); event-to-verified-display averaged 0.99 seconds for 17 observed events. These measurements include local polling, render and assertion overhead, and are not production SLA evidence. Five final authorized aggregate query measurements were 424.4, 851.4, 175.3, 105.5 and 95.1ms.

## 10. Security verification

Integration tests cover current tenant auth, browser tenant-ID rejection, cross-tenant reporting and stage writes, module restriction, denied analytics/export/SSE, color-write permission, custom roles, access revocation and persisted session invalidation. The roles suite fixture was corrected to acknowledge per-user onboarding; the product gate is unchanged. Streams revalidate auth and permission on every observation. Pipeline payloads contain a metadata hash rather than record details.

## 11. Files modified

Actual changed-file inventory (repository-relative paths):

```text
backend/scripts/test-dashboard-access.mjs
backend/scripts/verify-dashboard-browser.mjs
backend/src/api/routes/crm.routes.ts
backend/src/modules/administration/roles/__tests__/roles.integration.test.ts
backend/src/modules/crm/leads/lead-automation.service.ts
backend/src/modules/crm/pipeline/pipeline.dto.ts
backend/src/modules/crm/pipeline/pipeline.repository.ts
backend/src/modules/reporting/reports/dashboard.events.ts
backend/src/modules/reporting/reports/dashboard.integration.test.ts
backend/src/modules/reporting/reports/dashboard.service.ts
backend/src/modules/reporting/reports/reports.controller.ts
frontend/app/api/proxy/[...path]/__tests__/proxy-cookie-forwarding.test.ts
frontend/app/api/proxy/[...path]/route.ts
frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.test.tsx
frontend/src/features/tenant/crm/pipeline/ui/pipeline-stages-dialog.tsx
frontend/src/features/tenant/dashboard/hooks/use-dashboard-report.test.tsx
frontend/src/features/tenant/dashboard/hooks/use-dashboard-report.ts
frontend/src/features/tenant/dashboard/ui/dashboard.tsx
frontend/src/features/tenant/help/content/dashboard.ts
frontend/src/lib/api/adapters/pipeline.adapter.ts
frontend/src/shared/components/charts/ChartComponents.test.tsx
frontend/src/shared/components/charts/ChartComponents.tsx
frontend/src/store/DataContext.tsx
shared/src/contracts/dashboard.contract.ts
shared/src/contracts/pipeline-stage.contract.ts
shared/src/index.ts
docs/API.md
docs/dashboard-implementation-report.md
docs/dashboard-kpis.md
docs/dashboard-organization-refinements.md
```

Generated screenshots, logs, CSV and audit evidence are ignored Git inputs. No environment files were edited.

## 12. Database changes

No new migration is needed or added. Existing Stage.color is reused. Read-only audit confirmed applied 20261115000000_dashboard_revisions and existing revenueOwnerId/revenueOwnerEligible columns on the configured connection. No live writes, history backfills, resets or column drops were performed.

## 13. Tests executed

- Backend reporting/Deals/workflow regression run: 50 passed; its 16 environment-gated role/permission cases were subsequently run on a fresh disposable database and all 16 passed.
- Focused frontend hook, color-dialog and chart tests: 17 passed.
- Additional Deal normalization/lifecycle regressions: 15 passed. Final reporting reconciliation and metadata-stream rerun: all 18 passed, including explicit 66.7% win rate, both agents' credited revenue, color metadata changes and live Deals permission revocation.
- Proxy regressions: 26 passed, including immediate pipeline SSE delivery and production HTTPS origin enforcement.
- Total distinct automated tests: 82 backend and 43 frontend, all 125 passed across the executed suites. Repeated runs are not counted again.
- Backend, frontend and shared production builds passed. Repository lint passed across all three workspaces. The final frontend build also checked types/lint and included the corrected Dashboard help text. `git diff --check` passed.
- Full authenticated optimized-build browser acceptance after the mobile header correction, before the clock follow-up: all 43 checks passed, zero page errors. All five saved colors were reloaded and observed in both Dashboard sessions and a separate Deals session. Week/Month/Year, custom historical validation, CSV, failure/Retry, cross-agent writes, Workflow transitions, offline and server-restart recovery, permission revoke/regrant, deactivation and reconciliation passed.
- Clock follow-up: frontend production build passed, plus all five focused authenticated browser checks. Verified the clock advances, matches Manila date/time, renders time in bold, removes both requested notes, and fits 1440/390/320px. Zero page errors; desktop and mobile screenshots visually inspected. Evidence is in ignored `clock-results.json` and `clock-*.png`. The full 43-check run was not repeated for this UI-only follow-up.
- Responsive-toolbar follow-up: frontend production build passed and all seven focused browser checks passed, with zero page errors. Explicitly checked labels at 1440/640px, icon-only controls at 639/390/320px, exact 44px mobile targets and no horizontal overflow. Mobile and breakpoint screenshots visually inspected. This latest focused run replaces the ignored clock UI evidence; the full reporting suite was not repeated for the button presentation change.
- Dashboard passed all 12 light/dark viewport combinations at 1440, 1024, 768, 390, 375 and 320px: no horizontal overflow, chart clipping, or out-of-viewport chart headings/filter controls. Stage management dialog passed bounds checks at 1440, 768, 390 and 320px. Final desktop, zero-revenue, mobile funnel and mobile dialog screenshots were visually inspected.
- The older scripts/test-permissions-db.mjs upgrade-fixture replay failed before tests with its seeded migration scenario. The fresh full-migration replay and 16 authenticated role/permission tests passed through backend/scripts/test-dashboard-access.mjs. The old upgrade harness remains a separate limitation.

## 14. Deployment results

Read-only pre-publication checks at 18:49 Manila: frontend login and both API health URLs returned 200; backend and same-origin unauthorized Dashboard requests returned 401. Production API reported revision 6f2e3cd842e12670bafb0b93bda3c3d45a42997a. These changes had not yet been deployed. No authenticated Coolify/production browser session was available in the accessible browser inventory at that time. Public health/auth rejection does not establish authenticated metrics, cross-user synchronization or frontend/backend release equality. Subsequent release verification is recorded separately against the published commit.

## 15. Remaining issues

Authenticated production acceptance, production organization totals, serving-database identity, Coolify deployment and cross-user production synchronization remain unverified. I cannot confirm this implementation is production-ready. Ten configured-database Deals lack starting milestones; retrospective data cannot be reconstructed from current stage. Explicit zero probabilities are preserved rather than replaced with invented forecast weights. Full repository/provider suites and production concurrency/SLA measurements were not run.
