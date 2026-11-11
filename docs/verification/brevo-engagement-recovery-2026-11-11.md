# Brevo engagement recovery — November 11, 2026

Base: upstream `main`, `c875d39421d6e86b14280644e4e5fe0642503946`.
Implementation branch: `codex/brevo-engagement-recovery`.
Combined pull-request branch: `codex/brevo-dashboard-repairs`.

## Confirmed findings

- Recovery previously selected only recipients without delivery confirmation and
  excluded status `delivered`. Its provider-event map contained no engagement
  types. A missed open/click therefore remained missing after delivery, even when
  the recovery worker was enabled and Brevo retained the evidence.
- The authenticated webhook already accepts `opened`, `unique_opened` and `click`.
  Delivery remains separate from engagement. Report counts use persisted events
  and recipient timestamps, with distinct-recipient click counts.
- Existing receipt keys included raw webhook timestamp fields. Replaying the same
  evidence from history could create another event because history exposes a date
  instead of the callback's send epoch and event timestamp.
- Email reports already poll every 2.5 seconds. The proxy uses `no-store`; no
  report-cache defect was established. A report request had no client deadline,
  allowing a stalled transport to retain the in-flight lock indefinitely.
- Worker startup already honors `CAMPAIGN_DELIVERY_RECONCILIATION_ENABLED`
  independently of the general background-worker policy. Recovery starts after
  one minute and resumes scanning persisted messages after a restart.

The original callback failure has **not** been established. These code findings
explain why missed engagement cannot recover; they do not prove whether the
production callbacks were absent, rejected, or failed during persistence.

## Changes

- Extend the existing Brevo recovery path to recent delivered messages with
  missing engagement. Retain the five-message batch, 30-day submission window,
  two-minute grace period, four-second provider timeout and existing cursor/timer.
  Continue excluding archived campaigns and failed/excluded recipients. Recipients
  with delivery, open and click evidence need no further recovery lookup.
- Accept documented history event names and convert only matching message ID,
  recipient and valid provider timestamps into the existing receipt writer.
  Preserve provider dates, repeat evidence and available click destinations.
  Missing destinations prove engagement without inventing a URL. Log truncated
  history instead of silently claiming the provider returned every event.
- Use canonical engagement keys based on resolved event time and destination,
  recognizing old receipts and coarse history timestamps. Merge later verified
  destination attribution into an otherwise identical unattributed click.
  Mark second-precision history receipts until their corresponding callback is
  matched, then claim them with the callback's precise identity. This prevents
  history-first double counting while retaining distinct millisecond repeats.
  Reports recognize both existing v2 and new v3 repeatable receipts.
- Retain Email polling at 2.5 seconds, SMS cadence and retry backoff. Add a
  30-second request deadline, discard late responses, coalesce concurrent refreshes,
  suspend hidden/offline timers and refresh on visibility/focus/reconnection.
- Log sanitized webhook rejection stages, unmatched evidence, persistence/lookup
  failures and report synchronization failures. No authorization headers, API
  keys, recipient addresses or email content are added to diagnostics.

No public endpoints, shared contracts, dependencies, database migrations or
additional workers are introduced. Recovery never submits or resends messages.
Submission/scheduling code and delivery-status calculation are unchanged.

Changed files:

- `backend/src/modules/marketing/campaigns/brevo-status-reconciliation.ts`
- `backend/src/modules/marketing/campaigns/brevo-webhook.ts`
- `backend/src/modules/marketing/campaigns/campaigns.service.ts`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-report-view.tsx`
- `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaign-reconciliation-scheduler.test.ts`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-report-view.test.tsx`
- This verification report.

## Validation

- Campaign integration: 107 tests passed on disposable native PostgreSQL 17.6,
  with a bounded connection pool, durability enabled and mocked outbound providers.
- SMS tracking integration: 40 tests passed on a separate disposable native
  PostgreSQL database.
- Delivery, reconciliation lifecycle, worker-policy and campaign-content unit
  suites: 44 tests passed.
- Campaign report UI: 33 tests passed.
- Backend application/test TypeScript and frontend TypeScript checks passed.
- `git diff --check` passed.

Regression coverage includes Delivered/open/unique-open/click handling, repeated
events, v2 compatibility, missing URL attribution, timestamp/identity rejection,
recovery after Delivered, no resends, tenant/RBAC checks, scheduled Email/SMS,
restart and shutdown behavior, request overlap, timeout recovery, late responses,
report/recipient updates, hidden tabs and reconnection.

Continuation review added two history-before-callback regressions. Both initially
failed with two persisted events instead of one when a second-precision history
event preceded its millisecond callback. The correction preserves the original
history timestamp, deduplicates the callback and its retries, and retains a later
separate event in the same second. The complete 107-test campaign integration
suite passed after the correction; none of its tests were skipped.

The fake-clock UI regression verifies that confirmed engagement appears at the
next 2,500 ms refresh. This is simulated timing, **not measured production latency**.
Normal display latency also includes API/database/network time. History recovery
uses the existing minute timer and rotating batches; it is not a 2.5-second worker.

## Production evidence and remaining verification

- Signed-in in-app Brevo logs showed two distinct sends to the screenshot's
  recipient at 10:22 and 10:23 Asia/Manila on November 11. Both message histories
  contained first-opening evidence at 10:25 and later opening evidence. They must
  be matched separately; identical recipient/subject is not sufficient identity.
- Coolify showed a successful production backend deployment of `c875d394` at
  00:52:16 UTC. This verifies deployment history, not the active API route's SHA.
- On continuation, upstream main remained `c875d394`. At approximately 11:31
  Asia/Manila, uncached frontend `/api/release`, proxy `/api/proxy/health` and
  direct backend `/api/v1/health` all returned HTTP 200, production, and the full
  commit `c875d39421d6e86b14280644e4e5fe0642503946`. The earlier health timeouts did
  not recur. These revisions predate the local engagement repair.
- Brevo inspection confirmed the recorded opens, and Coolify confirmed the
  successful backend deployment. Authenticated LeadCRM correlation and further
  configuration inspection were unavailable after browser-control failure.
  No production settings or campaign data were changed, and no live campaign was sent.

Before calling the production incident resolved, complete these checks:

1. After release, recheck all three serving revision endpoints against the repair's
   merge commit. The current pre-release revisions and upstream main were verified.
2. Inspect the active Brevo webhook URL, subscribed events, authentication method
   and recent delivery HTTP responses without exposing credentials.
3. Inspect the production recovery flag and startup/runtime logs. Confirm successful
   provider history GETs; an enabled timer alone does not establish recovery.
4. Match each exact provider message ID/email/time to its campaign, recipient and
   delivery log. Inspect persisted events and distinguish callback receipt,
   rejection, persistence failure and display failure.
5. Deploy the reviewed repair only under the authorized release workflow. Verify
   existing message history is recoverable and recovery creates no submissions.
6. Measure provider-event persistence to authenticated report display with both
   metrics and recipient activity changing while status remains Delivered.

Sources: [Brevo transactional webhooks](https://developers.brevo.com/docs/transactional-webhooks),
[transactional event history](https://developers.brevo.com/reference/get-email-event-report).
