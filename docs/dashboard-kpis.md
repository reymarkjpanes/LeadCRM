# Dashboard reporting definitions

Dashboard, CSV and compatibility endpoints use `dashboard.service.ts` and the shared Dashboard contract. Browser collection loaders are not analytics sources. Each report is a repeatable-read snapshot; access is checked again before release.

## Authorization and population

The authenticated session supplies workspace/user. `dashboard.view` is the existing organization analytics permission and is mandatory. Module `deals.view`, `leads.view`, `tasks.view` grants enable dependent report data. Client Admin and other authorized roles, including custom roles, receive organization-wide aggregates within that tenant, regardless of assignment/owner/creator. Missing module permissions yield unavailable metrics rather than personal substitutes or zero. CSV and streams enforce current authorization. No permissions are automatically granted by this change.

Eligible Deals belong to the one active **Sales Pipeline**, are unarchived and not deleted. Authoritative Stage rows must have ordered names Lead, Contacted, Qualified, Closed Won, Closed Lost and matching terminal flags. IDs, order, configured probabilities and colors come from these rows. Ambiguous/invalid configuration returns 409 without rewriting history. Other pipelines are excluded with a warning.

Eligible Leads are unconverted, unarchived and not deleted, separate from the Deals pipeline's Lead stage.

## Dates

Default: This Month. Inclusive dates use Asia/Manila, converted to half-open UTC `[start midnight, day after end midnight)`.

| Option | Inclusive calendar interval |
| --- | --- |
| Today | Today |
| Last 7 / 30 Days | Today and preceding 6 / 29 days |
| This Month | First day of this month through today |
| Last Month | Entire previous calendar month |
| Last 3 / 6 Months | First day two / five calendar months ago through today |
| This Year | January 1 through today |
| Custom | Valid ordered start and end, maximum 732 days |

Revenue Trend defaults to calendar Month. Week (Monday start), Month and Year group identical eligible closures inside the global date interval; they never change that interval. Only calendar buckets intersecting the selected period are generated. Empty successful buckets are zero. Query failures do not produce empty reports. Prisma timestamps store UTC without timezone; SQL explicitly casts input boundaries to UTC and groups closing dates in Manila. Asia/Manila is the existing shared reporting convention; there is no tenant-specific timezone field.

## KPIs and charts

| Metric | Formula and time basis |
| --- | --- |
| Total Revenue | Sum tenant-currency amounts of currently Closed Won eligible Deals with valid `closedAt` in period |
| Revenue Trend | Identical revenue grouped by `closedAt`; sum reconciles with Total Revenue |
| Forecasted Revenue | Current open amount × configured Stage probability / 100, summed; expectedCloseDate does not narrow current forecast |
| Active Deals | Distinct currently Lead, Contacted or Qualified Deals |
| Total Leads | Current eligible Leads-module population |
| Win Rate | Period Won / (Won + Lost) × 100; no outcomes means unavailable |
| Average Deal Velocity | Mean fractional days from creation to eligible period Won closure, rounded to one decimal; no wins means unavailable |
| Won vs. Lost | Current terminal outcomes grouped by valid `closedAt`, matching Win Rate population |
| Pipeline Distribution | Current counts in three official open stages; sum equals Active Deals |
| Pipeline Value by Stage | Current tenant-currency open amounts in those stages; sum equals Open Pipeline Value |

Valid closure means `createdAt <= closedAt <= generatedAt`. Missing/invalid closing timestamps are excluded and disclosed. Repeated same-stage closure preserves one timestamp and transition. Existing rules prohibit reopening Won; never-won Lost Deals may reopen into Qualified. Reopening clears `closedAt`, removes period outcome and restores current pipeline. Historical Lost milestones remain in conversion history.

Currencies are never converted or mixed. Money uses tenant currency (PHP when unset); other/unknown currencies are excluded and warned, while counts remain currency-independent. Reporting normalizes each stored amount to two decimal places before summing, consistent with the Product price contract and currency presentation. This keeps bucket/stage sums reconciled even for legacy Float values with extra precision; stored amounts are not rewritten. Negative/nonfinite/missing same-currency amounts make affected monetary totals unavailable. Missing/invalid probability makes forecast unavailable. Configured zero is valid, never replaced with invented probability. Existing CRM APIs protect immutable Product/value snapshots; subscriptions also cover committed integration/database corrections.

## Deal Pipeline Conversion Funnel

Cohort: eligible organization Deals **created in the independent funnel interval**. Default Month, Week (Monday start), and Year run from their calendar start through today in Manila. Custom From/To dates must be valid, ordered, historical and at most 732 days; both browser and server enforce this. Milestones count distinct Deals with actual `DealStageHistory.newStageId` events from creation through the earlier of report generation and the end of the selected To day (23:59:59.999 Manila). Custom reports therefore exclude later events. The response and CSV carry the actual observation cutoff. Current stage alone is not proof. Verified start has null previous stage and timestamp matching creation. The existing migration records future starts with a valid actor/owner/assignee. Old events are never reconstructed.

Open milestones are Lead → Contacted → Qualified. Won and Lost are separate branches. Repeated/backward/reopened transitions count each milestone once; skipped stages are not inferred.

Rates use intersections: Lead-and-Contacted / Lead; Contacted-and-Qualified / Contacted; Qualified-and-Won / Qualified; Qualified-and-Lost / Qualified. These describe cohort milestone attainment, not strict consecutive movement order. If any cohort Deal lacks a verified start, counts show only recorded events and progression rates are unavailable. Empty denominators are unavailable.

## Sales Leaderboard

At first future transition into Won, the database captures assigned agent and eligibility in `revenueOwnerId` / `revenueOwnerEligible`. Eligibility follows active assignment rules: non-administrative, non-Guest with actual active-role Lead and Deal view/edit grants. Reassignment cannot rewrite captured achievement. Deactivated agents retain credit. Legacy unknown attribution is disclosed and omitted, without guessing from mutable `ownerId`.

Revenue uses the same period/currency eligibility as Total Revenue. Rank: revenue descending, won count descending, stable user ID; top five across all organization agents. Organization revenue may exceed leaderboard sums when historical attribution is unknown, administrative/ineligible, or outside the displayed top five.

## Action Center

Action Center retains a separate operational scope: Client Admin receives permitted tenant actions; other roles receive permitted assigned actions. Current nonarchived tasks exclude completed/cancelled; overdue tasks precede high-priority tasks, then Hot Leads and configured stale Deals. Display is bounded to six tasks, three eligible Hot Leads and three open Deals exceeding official stage `rottenAfterDays`. The list uses natural page scrolling without a constrained inner scroll area. Qualifying action count controls empty state. Existing taskboard/CRM routes are destinations. Contacts, Accounts, Inbox and Campaigns have no synthetic metric; their existing actions update Dashboard when they mutate supported Task/Lead/Deal records.

## Automatic updates and recovery

Database triggers update tenant revisions in the same transaction as Deal/Stage/Pipeline/history, Lead, Task and access changes. Rollback removes counter changes. Counters survive replica/process restarts. This extends existing bounded Inbox SSE, without another event service.

Streams observe committed counters every three seconds, heartbeat and end at 45 seconds. EventSource reconnects after three seconds. Sessions/RBAC are revalidated every observation; payloads contain counters only. Next preserves streaming/no-buffer headers. Auth access subscriptions remain outside module guards so revocation and later grants refresh existing permissions.

The hook batches bursts, ignores identical notifications, refreshes authoritative aggregates on connection/reconnect/focus/wake/online, and reconciles every 30 seconds while foregrounded. Changing chart filters does not create another subscription. Request generation/cancellation prevent stale identity/filter responses. Failed data requests preserve the prior report with an error; access loss clears it. The connection-status subtitle is removed. No frontend metric persistence or incremental event arithmetic. Sync Metrics is a read-only fallback. CSV takes a fresh authorized snapshot using identical definitions, selected chart filters, observation cutoff, diagnostic warnings, time bases and formula-injection escaping.

## Stage colors

`Stage.color` is the existing database field. Existing `deals.manage_stages` writes validate six-digit hex using a shared schema. Saved values take precedence over shared defaults, also used by Deals adapters and Dashboard charts. The management dialog exposes color picker, hex value and preview; failed writes revert the edited stage and concurrent saves are blocked. Official Sales Pipeline names, IDs, order and terminal outcomes are protected. Color updates do not write Deals or history. A separate, single shared Deals metadata subscription uses the existing authenticated SSE lifecycle, emitting a hash of authorized stage metadata only; unrelated Deal writes do not trigger selector refreshes. Reconnection and focus reconcile metadata. Dashboard uses its existing committed analytics revision.

See [current implementation evidence](dashboard-organization-refinements.md), [API](API.md), [architecture](ARCHITECTURE.md) and [Coolify deployment](setup/coolify-production.md).
