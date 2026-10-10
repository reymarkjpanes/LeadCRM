# Dashboard implementation and verification report

Organization scope, stage colors, chart aggregation, funnel periods and current verification are superseded by [the organization reporting refinements report](dashboard-organization-refinements.md). This document retains the earlier implementation evidence; its database ledger and production revision are historical snapshots.

Date: 9 October 2026. This report records verification before publication. **Production readiness is not confirmed by these local checks.** At verification time, the additive migration was not applied to the configured database, and authenticated acceptance of this Dashboard revision through Coolify remained outstanding. No production records, environment files or schemas were modified during local verification.

Release preflight: the phased deployment runner explicitly allows the additive Dashboard migration. All nine rollout tests and the disposable production-shaped migration replay passed. The read-only configured-database plan verified 97 applied migration checksums and selected only `20261115000000_dashboard_revisions`; all three guarded column retirements remain deferred.

## 1. Audit findings

- Dashboard previously calculated metrics from partially loaded DataContext arrays. Cross-user mutations did not refresh authoritative reports; Sync Metrics refreshed tasks only.
- The revenue card used lifetime wins, while the trend used six months and stage-change dates. Different periods/populations and timestamps explain the code-level card/trend mismatch. The original screenshot's specific ₱45,000 records were not independently reproduced.
- Win rate counted open Deals in its denominator. The current pipeline donut included Won. Forecast substituted an invented 10% when probability was zero/missing.
- Browser role checks were insufficient: older reporting queries could expose workspace-wide results to staff. The new service scopes every aggregate and rechecks access before release.
- Legacy Float amounts can have sub-cent precision. Per-Deal cent normalization before aggregation prevents separately rounded buckets/stages from diverging from their totals; stored values are preserved.
- Shared Chart.js wrappers ignored horizontal layout and custom tooltip formatting. Category labels and theme redraw also needed correction.
- `ownerId` is overwritten by ownership transfer. It cannot prove historic sales attribution. No initial milestone was recorded at Deal creation, so historical funnel starts cannot be assumed.
- Existing Inbox uses persisted revisions and bounded SSE. Notification outbox covers notification types, not every analytics mutation. Dashboard extends the existing revision/SSE approach.

## 2. Pipeline verification

Authoritative source: `Pipeline` / `Stage`, through the same active, case-insensitive **Sales Pipeline** lookup as `lead-automation.service.ts`. Exactly five ordered stages and terminal flags are validated. Dashboard never creates or repairs them.

The read-only configured-database audit used a PostgreSQL read-only transaction. One active Sales Pipeline was found, ID `4f291691-d648-4ce8-bc01-4c891fd84ad3`:

| Stage | Actual ID | Order | Color | Probability | Won / Lost |
| --- | --- | --- | --- | --- | --- |
| Lead | `62d0c201-01cc-4781-87ad-43618c013f44` | 0 | NULL | 0 | false / false |
| Contacted | `02f3f428-32ad-4f94-94a0-1d82361b64c1` | 1 | NULL | 0 | false / false |
| Qualified | `685f6ee0-9d40-48ee-81e4-9660e2d56a58` | 2 | NULL | 0 | false / false |
| Closed Won | `845fd9fb-f2b3-4f19-a9bf-753f07689ee1` | 3 | NULL | 100 | true / false |
| Closed Lost | `f9652c8b-9ff4-462b-90a5-f4b8bbb00064` | 4 | NULL | 0 | false / true |

Configured values were preserved. Neutral presentation is used for uncolored open stages, with an explicit warning. Zero is a valid configured probability. Browser fixtures separately use 10/40/70/100/0 and explicit colors to verify forwarding of configuration; they are not production analytics.

Audit: 10 eligible Deals; zero missing/invalid closing dates, zero unknown/other currencies, zero missing/negative amounts; **all 10 lack verified starting history**. No records were exported or rewritten. The connection's serving-app identity was not proven; I cannot confirm this is the database currently served by Coolify.

Verified existing transitions: open forward/backward/skips; Lost may reopen only to Qualified if never Won; Won requires Qualified and existing closing evidence and cannot reopen. Repeating closure does not rewrite `closedAt` or append another closure. Product/value snapshots remain immutable under normal CRM APIs.

## 3. KPI definitions

Full formulas and exclusions: [Dashboard definitions](dashboard-kpis.md).

- Revenue: current eligible Won, valid authoritative `closedAt` in selected period, tenant currency.
- Forecast: current three open stages, amount × configured probability / 100. Expected close date does not narrow this current forecast.
- Active Deals: current eligible Lead + Contacted + Qualified. Total Leads: current unconverted, unarchived, undeleted Leads-module records.
- Win rate: period Won / (Won + Lost). Average velocity: actual fractional creation-to-Won days; no denominator means unavailable.
- Currency is never converted/mixed. Invalid same-currency amounts and probabilities make affected monetary metrics unavailable, with warnings. Missing closure dates are excluded/disclosed.
- Manila calendar boundaries are half-open UTC. Nine date options, bounded custom validation and daily/monthly buckets share one contract. Pipeline/forecast/leads/actions are explicitly current state.

## 4. Chart implementation

Retained Revenue Trend, open-stage donut, Action Center and Sales Leaderboard card structure. Replaced Revenue & Deals with grouped Won vs. Lost. Added horizontal open Pipeline Value and actual-history Deal Pipeline Conversion Funnel. Won and Lost are separate branches.

Revenue and outcome text tables, visible stage counts/percentages/values and milestone labels provide essential text alternatives. Tooltips use full currency formatting; labels honor stage configuration. A single-day revenue bucket has a visible point. Header controls, cards, fonts, icons, borders, theme container and surrounding layout remain consistent with the existing UI.

Incomplete historical starts disable progression rates. Milestone counts show only recorded events. Future starts use existing `DealStageHistory`; no synthetic historical path is backfilled.

## 5. Real-time architecture

`DashboardRevision` stores analytics, leads, actions and access counters per tenant. Database triggers increment the relevant counter in the business transaction. Failed transactions roll back both data and counters. The compact persisted state survives backend process/replica restarts.

Authorized SSE observes committed counters every three seconds, sends heartbeats, ends after 45 seconds and advertises a three-second reconnect delay. Each observation checks current session and RBAC. Events contain counters only. Next's existing cookie proxy streams bodies without buffering; no additional event broker, WebSocket host or sticky session is required.

The hook batches 150ms bursts, retrieves authoritative snapshots, cancels superseded requests and rejects stale identity/filter responses. Initial connection, reconnection, online/focus/wake and foreground 30-second reconciliation recover missed changes. Transport failures retain clearly marked stale data; access loss clears it. Auth's separate access subscription stays mounted when a module guard hides Dashboard, enabling later grants to restore it.

## 6. Module synchronization

| Source | Verification and actual dependency |
| --- | --- |
| Leads | Real HTTP creation and reassignment update two browser sessions; current count and Hot Lead actions use Lead rows |
| Deals | HTTP creation, forward/backward/skipped stage movement, Won/Lost closure, reopening, archive/restore and reassignment; committed integration amount correction updates forecast/value |
| Tasks | Real creation and completion update/remove pending Action Center items; completed/cancelled excluded |
| Workflows | Actual active `deal.updated` Workflow moved an open Deal through the canonical stage action; persisted execution completed and Dashboard reflected the commit |
| Team Management | Actual deactivation transfers CRM assignments, clears departing session and retains captured revenue credit |
| Roles & Permissions | HTTP permission revocation hides sensitive Dashboard; restoration remounts it without reload; module-specific restrictions enforced by backend |
| Contacts / Accounts | No independent metric in this Dashboard; canonical conversions/association actions update relevant Lead/Deal/Task tables. Individual conversion scenarios were not browser-tested here |
| Campaigns / Inbox | No invented engagement or follow-up metrics. Existing integrations update Dashboard if they commit supported CRM/Task changes; provider-specific end-to-end scenarios were not run |

Deletion and other integrations are covered at the persisted-table trigger boundary. Rollback, session expiry/revocation, cross-tenant isolation, duplicate events and stale responses have focused automated coverage. Full browser proof for every upstream provider and deletion path remains unverified.

## 7. Reconciliation results

SQL fixture: ₱45,000 revenue equals summed revenue buckets; 1 Won + 1 Lost gives 50% Win Rate. Three open Deals sum to Active Deals = 3; stage values ₱1,000 + ₱2,000 + ₱3,000 = ₱6,000; configured weighted forecast = ₱3,000; one Won duration = 4 days.

Boundary fixture recognized a win exactly at Manila month start, even with database session timezone set to Manila. Explicit UTC comparisons corrected an initially failing boundary test.

Browser fixture recognized one ₱1,000 Won Deal, displayed actual trend and leaderboard, moved a second Deal to Lost (50% rate), then reopened it (100% rate, one open Deal). Repeated Won recognition retained one closing timestamp/history event. Final snapshots reconcile revenue/trend, open counts/distribution and open values/stage sums.

Scale fixture: 1,000 Deals, 5,500 recorded events, 100 Won and 900 open; revenue ₱100,000, open counts 900, and value/count/revenue reconciliation passed. This is synthetic acceptance data, never configured production data.

## 8. Security verification

Backend session/tenant middleware and existing RBAC remain authoritative. SQL is parameterized and explicitly scoped by trusted tenant, pipeline and staff assignment. User-supplied tenant fields are rejected. A permission change during aggregation blocks release under obsolete scope. Missing module grants return unavailable/empty dependent sections, with no organization-wide fallback.

Tests verify anonymous 401, cross-tenant query rejection, separate tenant aggregates/counters/events, module restriction, denied CSV, denied stream and live stream session revocation. CSV formula injection including leading whitespace is escaped. Browser permission revocation/restoration and real ownership-transfer deactivation passed. Event payloads contain no record names/IDs. Report HTTP responses and CSV use no-store.

## 9. Performance results

Database-side SQL aggregates and bounded action/leaderboard rows avoid loading full CRM collections for calculation. Partial indexes cover eligible Deal closing/cohort scans and tenant/deal/stage/history dates. There is no per-record query loop in production aggregation.

Final scale measurement on the completed backend: PGlite WASM, one Prisma connection, 1,000 Deals / 5,500 history events; six end-to-end service measurements **165.9–320.5ms, mean 211.8ms** (includes access checks). An earlier run measured 61.4–108.7ms; the final result above supersedes it and illustrates local measurement variability. Query reconciliation passed. This is not a production SLA, large-tenant concurrency test or Coolify network measurement.

Final two-session browser measurements: ordinary CRM/Workflow SSE receipt to verified DOM **223–698ms**; ordinary mutation response to verified display **2,574–5,563ms**. The longest Workflow sample crossed a 45-second connection rotation. Restart recovery took **3,507ms**, permission revocation **953ms**, restoration **1,883ms**, offline recovery **363ms** and deactivation **1,300ms** after successful mutation response. Five final small-fixture service queries measured **42.4–52.6ms**.

SSE measurements include query, React rendering and locator observation and are an upper bound for the event's visual completion. Response measurements start after the mutation returns; commit already occurred, so these are not exact database-commit timestamps. Counters were observed in real native EventSource subscriptions without replacing transport. Raw evidence is in ignored `results.json`. No deployed latency claim is made.

Tenant counters serialize concurrent writes to a small row. Foreground reconciliation and 45-second native reconnect deliberately bound stale recovery; connection rotation may extend display latency beyond a normal three-second observation interval.

## 10. Files modified

Paths relative to the repository root:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261115000000_dashboard_revisions/migration.sql` (new)
- `backend/src/core/tenant/tenant-models.ts`
- `backend/src/api/routes/auth.routes.ts`
- `backend/src/api/routes/reporting.routes.ts`
- `backend/src/modules/reporting/reports/dashboard.service.ts` (new)
- `backend/src/modules/reporting/reports/dashboard.controller.ts` (new)
- `backend/src/modules/reporting/reports/dashboard.events.ts` (new)
- `backend/src/modules/reporting/reports/dashboard.integration.test.ts` (new)
- `backend/src/modules/reporting/reports/reports.controller.ts`
- `backend/src/modules/reporting/reports/reports.service.ts`
- `backend/scripts/audit-dashboard-data.mjs` (new)
- `backend/scripts/benchmark-dashboard.mjs` (new)
- `backend/scripts/verify-dashboard-browser.mjs` (new)
- `backend/scripts/verify-dashboard-deployment.mjs` (new)
- `frontend/app/api/proxy/[...path]/route.ts`
- `frontend/src/store/AuthContext.tsx`
- `frontend/src/features/tenant/dashboard/ui/dashboard.tsx`
- `frontend/src/features/tenant/dashboard/index.ts`
- `frontend/src/features/tenant/dashboard/hooks/use-dashboard-report.ts` (new)
- `frontend/src/features/tenant/dashboard/hooks/use-dashboard-report.test.tsx` (new)
- `frontend/src/features/tenant/dashboard/hooks/use-dashboard.ts` (removed obsolete browser-calculation hook)
- `frontend/src/features/tenant/dashboard/ui/__tests__/dashboard-lead-count.test.ts` (removed implementation-mirroring test)
- `frontend/src/shared/components/charts/ChartComponents.tsx`
- `frontend/src/shared/components/charts/ChartComponents.test.tsx` (new)
- `shared/src/contracts/dashboard.contract.ts` (new)
- `shared/src/index.ts`
- `docs/dashboard-implementation-report.md` (new)
- `docs/dashboard-kpis.md`
- `docs/API.md`
- `docs/setup/coolify-production.md`
- `.gitignore`

No dependencies or unrelated modules were redesigned. Generated evidence is ignored.

## 11. Database changes

Additive migration creates tenant `DashboardRevision`, nullable captured revenue-owner/eligibility fields and same-tenant FK, immutable attribution capture trigger, future starting-event trigger, transactional revision triggers and three indexes. User/role/permission and relevant tenant configuration changes invalidate access. Frequent login/profile no-op writes are filtered.

No column drops, destructive reset, attribution/history backfill or live migration. Full migration history including the new migration replayed successfully in disposable databases. Configured ledger latest is `20261114000000_notification_delivery`; new columns are absent. Deployment must apply the reviewed migration before running this Prisma/client revision.

## 12. Testing results

- Backend: **28 passed**, three files (Dashboard integration including real HTTP/SSE and fractional money reconciliation, existing Deal normalization and lifecycle).
- Frontend: **24 passed**, five files (hook, chart adapter and existing authentication lifecycle/preservation).
- Two-session browser: **39 checks passed**; real Next proxy, Express, cookie sessions and disposable PostgreSQL-compatible database. Final visual repetition verifies labels/themes at 1440, 1024, 768, 390, 375 and 320px; screenshots include lower cards.
- Final all-workspace lint passed in all three workspaces. Backend, frontend and shared package production builds passed. `git diff --check` passed.
- Read-only configured DB audit passed; scale reconciliation passed; public deployment probes passed.

Early failed attempts were corrected: sandbox EPERM/connectivity, fixture IDs, immutable Deal pricing assumptions, duplicated UI locators, stale test HTTP connection on restart, initial UTC SQL boundary comparison and a test deactivation that correctly hit ownership-transfer guards. The SSE test uses the canonical session-revocation service. These earlier attempts are not counted as passing tests. Full repository/provider suites were not run.

## 13. Deployment verification

Read-only public checks on 9 October: frontend login 200; API `/health` 200; API `/api/v1/health` 200 and production revision **`e17cce441e9002ad2b7f111fdb305537119d0224`**; unauthenticated backend and same-origin Dashboard requests both 401. That SHA matches the pre-change checkout, not these uncommitted Dashboard changes. Public auth rejection does not prove the new route is deployed.

No authenticated Coolify dashboard/application session was available. No deployment, migration, restart, production login or production SSE acceptance was performed. I cannot confirm this Dashboard revision is running, that Coolify forwards its streams correctly, or that live multi-user metrics reconcile.

The repository's existing production API origin works for the production build. [Coolify instructions](setup/coolify-production.md) now document the required migration, both stream paths, no-buffer headers and proxy lifetime. After a reviewed release, verify matching frontend/backend revision and migration ledger, two authenticated users, permission changes, disconnect/restart recovery and actual live-data reconciliation.

## 14. Remaining issues

1. Apply and verify the reviewed additive migration through the existing deployment process, deploy the same reviewed revision to frontend/backend, and perform authenticated Coolify acceptance. These changes have not been published.
2. Ten existing eligible Deals lack starting history. Their conversion counts can show verified events only; rates remain unavailable until reliable historical evidence exists. No blind repair is appropriate.
3. Existing wins lack the new captured attribution. They are omitted from leaderboard with an explicit limitation. Current mutable ownership is insufficient evidence for backfill.
4. Official stage colors are unset and open probabilities are configured zero. Presentation warns about colors; forecast honors zero. Business administrators may configure these through existing Deals settings if desired.
5. Production dataset/concurrency/proxy latency, provider-driven CRM effects, every conversion/deletion path and deployed accessibility behavior are unverified. Local evidence cannot establish those results.

The implemented behavior and safeguards are reviewable locally. The mandatory production definition of done remains open until deployment and authenticated acceptance are verified.

## Reproducing local evidence

Build backend first. Run the three backend test files and five frontend test files listed above with the workspace Vitest commands. Set the process-only production API origin for frontend build; do not rewrite environment files.

Run `node backend/scripts/verify-dashboard-browser.mjs <installed-playwright-package-path>` for real cookie/proxy/SQL browser acceptance; `node backend/scripts/benchmark-dashboard.mjs` for disposable scale measurement. Both create isolated databases, replay migrations and clean up owned resources. Browser screenshots use the existing scoped theme preference/event contract and cover upper and lower cards; no production UI session is used.

`node backend/scripts/audit-dashboard-data.mjs` performs a transaction-enforced read-only configured DB audit. `node backend/scripts/verify-dashboard-deployment.mjs` performs public read-only probes. Results/screenshots are ignored under `data/outputs/dashboard-verification/`; they contain no session tokens or connection credentials. Do not use the disposable replay script against a configured/live database.
