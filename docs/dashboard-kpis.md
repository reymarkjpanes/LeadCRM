# Dashboard reporting definitions

Dashboard, CSV and compatibility endpoints use `dashboard.service.ts` and the shared Dashboard contract. Browser collection loaders are not analytics sources. Each report is a repeatable-read snapshot; access is checked again before release.

## Authorization and population

The authenticated session supplies workspace/user. `dashboard.view` is the existing organization analytics permission and is mandatory. Module `deals.view`, `leads.view`, `tasks.view` grants enable dependent report data. Client Admin and other authorized roles, including custom roles, receive organization-wide aggregates within that tenant, regardless of assignment/owner/creator. Missing module permissions yield unavailable metrics rather than personal substitutes or zero. CSV and streams enforce current authorization. No permissions are automatically granted by this change.

Deals in sales metrics belong to the one active **Sales Pipeline**, are unarchived and not deleted. Authoritative Stage rows must have ordered names Lead, Contacted, Qualified, Closed Deal, Cancelled and matching terminal flags. IDs, order, configured probabilities and colors come from these rows. When configuration is invalid, Dashboard and its CSV mark affected metrics unavailable and keep actions from other valid pipelines. The legacy pipeline summary and deal velocity endpoints still return 409. Other pipelines are excluded from sales metrics.

Eligible Leads are unconverted, unarchived and not deleted, separate from the Deals pipeline's Lead stage.

## Dates

The Dashboard and Reports toolbars both default to **This Month**. The Dashboard toolbar controls the period for Revenue, Win Rate, Revenue Trend, Lead Source Performance, and the Sales Leaderboard. Inclusive dates use Asia/Manila, converted to half-open UTC `[start midnight, day after end midnight)`.

| Option | Inclusive calendar interval |
| --- | --- |
| Today | Today |
| Last 7 / 30 Days | Today and preceding 6 / 29 days |
| This Month | First day of this month through today |
| Last Month | Entire previous calendar month |
| Last 3 / 6 Months | First day two / five calendar months ago through today |
| This Year | January 1 through today |
| Custom | Valid ordered start and end, maximum 732 days |

Dashboard Revenue Trend groups ranges of up to 31 days by calendar week (Monday start) and longer ranges by calendar month. Reports defaults to Month and offers Week, Month, and Year grouping inside the selected dates. Only calendar buckets intersecting the selected period are generated. Empty successful buckets are zero. Query failures do not produce empty reports. Prisma timestamps store UTC without timezone; SQL explicitly casts input boundaries to UTC and groups closing dates in Manila. Asia/Manila is the existing shared reporting convention; there is no tenant-specific timezone field.

## KPIs and charts

| Metric | Formula and time basis |
| --- | --- |
| Total Revenue | Sum tenant-currency amounts of eligible Deals currently in Closed Deal with valid `closedAt` in the selected period |
| Revenue Trend | Identical revenue grouped by `closedAt`; sum reconciles with Total Revenue |
| Forecasted Revenue | Sum current Qualified-stage amounts in the authoritative Sales Pipeline, resolved by its validated Stage ID; probabilities and expectedCloseDate do not narrow or weight the forecast |
| Active Deals | Distinct currently Lead, Contacted or Qualified Deals |
| Total Leads | Current eligible Leads-module population |
| Dashboard Win Rate | Eligible wins divided by eligible wins plus cancellations closed in the selected period, × 100, rounded to one decimal. No wins means 0%. Valid wins count regardless of amount or currency. Unavailable outcome counts produce an unavailable rate. |
| Reports and CSV Win Rate | Currently won eligible Deals divided by all current eligible Deals (open, won, or cancelled), × 100. Zero when there are no eligible Deals. Independent of the selected period. |
| Average Deal Velocity | Mean fractional days from creation to eligible period Won closure, rounded to one decimal; no wins means unavailable |
| Won vs. Lost | Current terminal outcomes grouped by valid `closedAt` in the selected period |
| Pipeline Distribution | Current counts in three official open stages; sum equals Active Deals |
| Pipeline Value by Stage | Current tenant-currency open amounts in those stages; sum equals Open Pipeline Value |

Valid closure means `createdAt <= closedAt <= generatedAt`. Missing or invalid closing timestamps are excluded and disclosed. Repeated same-stage closure preserves one timestamp and transition. Confirmed wins are final. Cancelled Deals with a verified history of no wins may reopen into Lead or Qualified. Reopening clears `closedAt`, removes the period outcome, and restores the Deal to the current pipeline. Historical cancellation milestones remain in conversion history.

Currencies are never converted or mixed. Money uses tenant currency (PHP when unset); other/unknown currencies are excluded and warned, while counts remain currency-independent. Reporting normalizes each stored amount to two decimal places before summing, consistent with the Product price contract and currency presentation. This keeps bucket/stage sums reconciled even for legacy Float values with extra precision; stored amounts are not rewritten. Negative/nonfinite/missing same-currency amounts make affected monetary totals unavailable. Forecast is unavailable only when Qualified amounts are invalid; invalid Lead or Contacted amounts do not affect it. No Qualified Deals means zero forecast. Dashboard, Reports and CSV use this same forecast, while Open Pipeline Value retains the sum of all open stages. Existing CRM APIs protect immutable Product/value snapshots; subscriptions also cover committed integration/database corrections.

## Lead Source Performance

Dashboard shows distinct currently Won Deals grouped by trimmed saved `Deal.leadSource`, using the existing authorized Sales Pipeline population and valid `closedAt` boundaries. Missing or blank sources are “Not specified”; related Lead/Contact sources are not inferred. Counts include eligible Deals regardless of their currency or monetary-data validity.

The chart uses the Dashboard toolbar dates, including applied custom dates. Sync Metrics and realtime reconciliation update it with the rest of Dashboard. No wins displays “No won deals for this period.” Request errors appear in the Dashboard report status.

Up to five individual source groups are shown, reserving one slot for nonzero “Not specified”. Overflow and saved “Others” values form a single Others bar. Displayed bars sort by won count descending, then source name. Revenue, current Pipeline Overview, and other metrics retain their existing definitions.

## Reports: Deal Pipeline Conversion Funnel

Reports and CSV retain their historical milestone counts, rates, creation-period filter and observation cutoff. Dashboard no longer displays the current-stage funnel boxes or Historical Conversion Rates section.

Cohort: eligible organization Deals **created in the independent funnel interval**. Default Month, Week (Monday start), and Year run from their calendar start through today in Manila. Custom From/To dates must be valid, ordered, historical and at most 732 days; both browser and server enforce this. Milestones count distinct Deals with actual `DealStageHistory.newStageId` events from creation through the earlier of report generation and the end of the selected To day (23:59:59.999 Manila). Custom reports therefore exclude later events. The response and CSV carry the actual observation cutoff. Current stage alone is not proof. Verified start has null previous stage and timestamp matching creation. The existing migration records future starts with a valid actor/owner/assignee. Old events are never reconstructed.

Open milestones are Lead → Contacted → Qualified. Won and Lost are separate branches. Repeated/backward/reopened transitions count each milestone once; skipped stages are not inferred.

Rates use intersections: Lead-and-Contacted / Lead; Contacted-and-Qualified / Contacted; Qualified-and-Won / Qualified; Qualified-and-Lost / Qualified. These describe cohort milestone attainment, not strict consecutive movement order. If any cohort Deal lacks a verified start, counts show only recorded events and progression rates are unavailable. Empty denominators are unavailable.

## Sales Leaderboard

At first future transition into Won, the database captures assigned agent and eligibility in `revenueOwnerId` / `revenueOwnerEligible`. Eligibility follows active assignment rules: non-administrative, non-Guest with actual active-role Lead and Deal view/edit grants. Reassignment cannot rewrite captured achievement. Deactivated agents retain credit. Legacy unknown attribution is disclosed and omitted, without guessing from mutable `ownerId`.

Revenue uses the same period/currency eligibility as Total Revenue. Rank: revenue descending, won count descending, stable user ID; top five across all organization agents. Organization revenue may exceed leaderboard sums when historical attribution is unknown, administrative/ineligible, or outside the displayed top five.

## Action Center

Action Center retains a separate operational scope: Client Admin receives permitted tenant actions; other roles receive permitted assigned actions. Current nonarchived tasks exclude completed/cancelled; overdue tasks precede high-priority tasks, then Hot Deals and configured stale Deals. A Deal that qualifies for both appears once with both labels. All qualifying actions are returned. Qualifying action count controls empty state. Existing taskboard/CRM routes are destinations. Contacts, Accounts, Inbox and Campaigns have no synthetic metric; their existing actions update Dashboard when they mutate supported Task/Lead/Deal records.

Stale Deals use the current stage's `rottenAfterDays`. Client Admins can set a positive integer through `PUT /api/v1/crm/stages/:id`; unconfigured stages have no timer. The clock starts at `stageChangedAt` or, for legacy Deals, `createdAt`. It resets on a stage move, a recorded staff edit, a Deal note, call, meeting or logged SMS, qualifying Deal email, or completion of a task linked to the Deal at that time. No-op saves, background bookkeeping and unrelated activity do not reset it. Older audit entries can establish a field change but may not identify whether a person or automation made it.

The server compares UTC instants and includes the exact threshold: one day is 24 hours, independent of Manila midnight. Closed, Cancelled, archived and deleted Deals and Deals in archived pipelines are excluded. Pipeline badges display days inactive separately from days in stage. Committed revisions refresh the Action Center after updates; the existing 30-second foreground refresh catches time crossings. Each qualifying Deal contributes one action link. Staleness does not change CRM records or create tasks or notifications.

## Automatic updates and recovery

Database triggers update tenant revisions in the same transaction as Deal/Stage/Pipeline/history, Lead, Task and access changes. Rollback removes counter changes. Counters survive replica/process restarts. This extends existing bounded Inbox SSE, without another event service.

Streams observe committed counters every three seconds, heartbeat and end at 45 seconds. EventSource reconnects after three seconds. Sessions/RBAC are revalidated every observation; payloads contain counters only. Next preserves streaming/no-buffer headers. Auth access subscriptions remain outside module guards so revocation and later grants refresh existing permissions.

The hook batches bursts, ignores identical notifications, refreshes authoritative aggregates on connection/reconnect/focus/wake/online, and reconciles every 30 seconds while foregrounded. Changing the Dashboard toolbar dates requests one report for all sales metrics and keeps the existing subscription. Request generation and cancellation prevent stale identity or filter responses. Failed refreshes preserve the prior report for the same filters with an error. Access loss clears it. Sync Metrics is a read-only fallback. CSV takes a fresh authorized snapshot using the Reports definitions, selected chart filters, observation cutoff, diagnostic warnings, time bases and formula-injection escaping.

## Stage colors

`Stage.color` is the existing database field. Existing `deals.manage_stages` writes validate six-digit hex using a shared schema. Saved values take precedence over shared defaults, also used by Deals adapters and Dashboard charts. The management dialog exposes color picker, hex value and preview; failed writes revert the edited stage and concurrent saves are blocked. Official Sales Pipeline names, IDs, order and terminal outcomes are protected. Color updates do not write Deals or history. A separate, single shared Deals metadata subscription uses the existing authenticated SSE lifecycle, emitting a hash of authorized stage metadata only; unrelated Deal writes do not trigger selector refreshes. Reconnection and focus reconcile metadata. Dashboard uses its existing committed analytics revision.

See [current implementation evidence](dashboard-organization-refinements.md), [API](API.md), [architecture](ARCHITECTURE.md) and [Coolify deployment](setup/coolify-production.md).
