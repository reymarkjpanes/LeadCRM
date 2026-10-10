# Inbox redesign and scoped Gmail delivery

Status: implementation verified locally on 2026-10-08; production deployment has
not been verified. The user's latest instruction replaces the original Pub/Sub/watch
requirements with server-owned Gmail checks, avoiding Pub/Sub usage. The existing
Gmail integration, OAuth flow, mailbox persistence and composer are reused.

The sender follow-up removes the invented Gmail From address. Staff sends and
drafts explicitly use the connected mailbox. The retained legacy system helper
requires a configured sender and otherwise fails before contacting Gmail; its
configured display name is Camxian Technologies. Brevo remains the transactional
email transport. No additional Coolify variables are required for this correction.

## Final synchronization approach

One backend worker checks each connected mailbox using its persisted Gmail History
cursor, normally every 60 seconds. Initial/expired-cursor recovery uses bounded
queries for the two fixed senders and current assigned CRM correspondents. It
checks metadata before requesting message bodies. It stores allowed messages and
notifies open Inbox tabs through authenticated SSE. Browser reloads only read saved
data; they do not start Gmail sync.

Google documents History-based partial synchronization independently of optional
push notifications: [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync).
Pub/Sub's purpose is to notify the backend about mailbox changes, after which the
backend still retrieves changes from Gmail: [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push).
This implementation has no Pub/Sub resources, webhook, watch calls or credentials.
It still uses the existing backend and Gmail API; this report does not promise that
unrelated hosting, Workspace or Google Cloud services are free.

## Executed verification

| Check | Result |
| --- | --- |
| Disposable database runner | 77 passed: 25 engagement rules, 32 existing mailbox integration, 20 scoped mailbox/scheduling/incremental-sync/sender tests. Full forward migration chain replayed in each isolated database. |
| Provider wrapper, ownership, environment suites | 61 passed across 3 files. |
| Inbox and shared Task date/time suites | 48 passed across 6 files. |
| Shared typecheck | `npm --prefix shared run lint` passed. |
| Backend typecheck | `npm --prefix backend run lint` passed; final production build also ran TypeScript after the interval change. |
| Frontend typecheck | `npm --prefix frontend run lint` passed. |
| Backend production build | Passed, including Prisma Client generation. |
| Frontend production build | Passed with process-local `API_URL=https://api.example.invalid/api/v1`; this did not replace local or production environment URLs. |
| Browser acceptance | 22 checks passed; 0 browser page errors. 1440, 768, 390, 375 and 320 px tested for Inbox, conversation, composer and schedule picker. |
| Two-tab automatic update | One simulated Gmail History request persisted one relevant message; unrelated message excluded. Both tabs updated in 3.388 seconds from the controlled due sync, with zero browser POST `/sync` calls. This is not provider-to-production latency. |
| Scheduled transition | API-created future schedule survived browser reload; controlled due-time worker sent once; Scheduled disappeared and Sent appeared through SSE without loading flashes. |
| Process restart | `node backend/scripts/verify-mailbox-restart.mjs` passed with 3 independent worker processes, shared disposable database and exactly 1 simulated send. |
| Environment parity | Backend `.env` and `.env.example`: matching 52 keys. Frontend `.env.local` and `.env.example`: matching 11 keys. No Pub/Sub keys remain. Secret values are not in examples. |
| Whitespace | `git diff --check` passed. Git emitted only Windows LF/CRLF conversion notices. |

The API, database, permissions, compiled backend, Next proxy and SSE were real local
components. Google responses were simulated and no real email was sent. The full
repository test suite was not run; only the listed relevant suites were run.

## Production configuration inspected

Coolify's existing LeadCRM backend and frontend showed Running. The backend uses
`https://api.lead-crm.tech`, port 4000, and
`npm --prefix backend run db:deploy && npm --prefix backend start`. The existing
callback value is `https://api.lead-crm.tech/api/v1/integrations/gmail/callback`.
The saved Gmail OAuth client matches Google Cloud's LeadCRM project
`leadcrm-510308`. Its OAuth detail page repeatedly failed to load, so registration
of the exact callback inside Google could not be inspected: **I cannot confirm this.**

Saved and verified `GMAIL_SYNC_INTERVAL_SECONDS=60` in Coolify production and preview
configuration. The temporary Pub/Sub audience setting was replaced. No Pub/Sub
topic, subscription, service account or IAM grant was created. The project's topic
inventory showed no topics and its credential inventory showed no service accounts.

The new migration and worker code remain local. The saved Coolify interval is ready
for the next deployment; it does not mean the current running image contains these
changes. Production migration application, new worker startup, live scoped Inbox
behavior and live scheduled delivery: **I cannot confirm this.**

## Requested acceptance report

Numbers correspond to the original requested final report. Items superseded by the
latest instruction are explicitly identified.

| # | Item | Implementation / result |
| --- | --- | --- |
| 1 | Files changed | Exact source inventory below; local environment files and ignored screenshots are listed separately. |
| 2 | Inbox layout | Existing page now has Inbox/unread heading, Work email panel, search/filter/sort, table and floating Compose. Existing font and theme retained. |
| 3 | Current dropdown | Removed. |
| 4 | Categories | Primary, Promotions, Social, Updates and associated category queries removed. |
| 5 | Filter | All emails, Unread only, Sent, Scheduled, Drafts only. |
| 6 | Sort | Newest first, Oldest first, Unread first; separate from filter. |
| 7 | Rows | Checkbox, sender, subject, snippet and date; unread emphasis and mobile stacking/truncation. Star omitted because there is no supported star action. |
| 8 | Conversation | Wrapped subject/metadata, contained HTML, compact CRM links, reachable actions, shared reply/forward composer. |
| 9 | Mobile Inbox | Tested at 390/375/320 px with usable controls and no page overflow. |
| 10 | Mobile conversation | Subject and addresses wrap; body constrained; actions remain reachable. |
| 11 | Mobile Compose | Viewport-bounded dialog, usable Send/dropdown and scrollable body. |
| 12 | One-line toolbar | All 11 toolbar buttons had the same vertical position below Send at every width. Horizontal overflow is inside the toolbar only. |
| 13 | Fixed senders | Exact normalized `reymarkjpanes@12066156.brevosend.com` and `info@camxian.com`; no domain-wide permission. |
| 14 | Assigned Leads | Current tenant, current user `assignedUserId`, active/nondeleted Leads and Leads View permission. |
| 15 | Assigned Contacts | Same canonical assignment and Contact View constraints. |
| 16 | Reassignment | Fresh backend scope removes former owner's access, including direct thread/mutation calls and Client Admin. Queued send authorization is checked again at delivery. |
| 17 | Server scope | Central mailbox scope used by list, search, unread, thread, ingestion, drafts and mutations. |
| 18 | Provider query | Exact sender/recipient terms; excludes spam/trash; message and draft reconciliation queries remain scoped. History IDs get header authorization before body fetch. |
| 19 | Large scopes | Queries split at 40 terms or about 3000 characters; durable query/page continuation. 2000-address test passed. |
| 20 | Search | Literal persisted search intersects backend scope; user input cannot inject Gmail search operators. |
| 21 | Threads | Returns authorized stored messages only; stale CRM links are hidden. |
| 22 | Archive/trash | Every supplied ID is authorized before provider mutations. |
| 23 | Historical unrelated mail | Retained in database but excluded from scoped reads and actions; migration does not delete history. |
| 24 | Automatic updates | Backend periodic History sync → scoped persistence → authenticated SSE → list refresh in place. |
| 25 | Gmail watch | Removed per latest instruction; no `users.watch` required. |
| 26 | Pub/Sub | Removed per latest instruction; no topic/subscription/service account required. |
| 27 | Watch renewal | Not applicable; removed with Pub/Sub. |
| 28 | Incremental History | Handles additions, label changes and deletions in bounded durable batches. |
| 29 | Cursor | Stored on EmailAccount; committed after completed processing; interrupted pages replay safely. |
| 30 | Invalid cursor | HTTP 404 resets cursor/continuation for scoped reconciliation, preserving rows. |
| 31 | Realtime transport | Authenticated same-origin SSE carrying revision signals only; shared per-account database observer. |
| 32 | Page reload | No reload used for automatic updates. |
| 33 | Visible table | Existing rows retained during refresh; two-tab acceptance found no main-loading flashes. |
| 34 | Page load | Reads persisted authorized rows/counts/status. |
| 35 | Reload sync | Removed automatic POST sync on mount/navigation/reload. |
| 36 | Single flight | Renewable 180-second database lease with claim ownership checks; bounded 20-ID/45-second work segments. |
| 37 | Burst coalescing | Pub/Sub superseded. Multiple requests use one account signal/lease; concurrent due workers produced one effective History request. |
| 38 | Frontend deduplication | In-flight key dedupe, AbortController, stale response IDs, debounced search/events. |
| 39 | Multiple tabs | Share server sync; both receive persisted updates. Browser acceptance verified one History call. |
| 40 | 429/403 | Provider wrapper retains bounded retries/concurrency and distinguishes retryable quota responses; sync retry deadlines are durable. |
| 41 | Retry-After | Provider date/seconds respected; shared cooldown prevents immediate repeated reads/writes. |
| 42 | Rate-limit UI | Small sync status; saved rows stay visible. Sync disabled during known cooldown. |
| 43 | Sync now | Explicit shared-lease sync with deduplication, continuation and cooldown handling. Refresh-table control reads saved data only. |
| 44 | Polling interval | Backend Gmail interval defaults to 60 seconds, configurable 60–3600; discovery every 10 seconds. Continuations/explicit work can run sooner. |
| 45 | Browser Gmail polling | None. SSE observes database state; browsers do not independently call Gmail. |
| 46 | Drafts | Scoped Gmail draft save/edit/delete; persistent draft mapping; edits retain reply thread; draft send consumes the provider draft. Scheduled active drafts cannot be edited/deleted through ordinary draft endpoints. |
| 47 | Scheduled | Queries creator/account/tenant-owned persisted queue; shows pending, uncertain and failed states; no Gmail `in:scheduled` query. |
| 48 | Task picker | Extracted shared ManilaDateTimePicker and existing Manila utilities; Task editor and Compose reuse it. |
| 49 | Cancel | Closes picker without saving or sending; verified 0 queued rows. |
| 50 | Done | Validates future time and saves Gmail draft plus durable server schedule; no immediate send. |
| 51 | Manila time | Calendar/Hour/Minute/AM-PM use existing Manila conversion; server stores UTC; past date/time rejected. |
| 52 | Persistence | ScheduledMailboxEmail stores due time, draft, creator/account, idempotency key, status, claims and delivery result. |
| 53 | Migration | Forward `20261106000000_scoped_mailbox_delivery`; normalized address projections, indexes, durable sync state and schedule table. Replayed in disposable DBs, not applied to production. |
| 54 | Worker | Existing persistent backend owns independent sync and due-send loops; scheduled delivery checks every 10 seconds. |
| 55 | Duplicate prevention | Unique request/draft keys, atomic claim, durable sending state and deterministic RFC Message-ID; uncertain sends reconcile Sent without blind resend. |
| 56 | Failures | Bounded retries/reconciliation and visible safe failure message; reassigned/revoked recipients are not sent. |
| 57 | Restart | Three separate compiled worker processes passed durable pending→sent recovery with exactly one simulated send. Expired/uncertain claims separately tested. |
| 58 | Scheduled→Sent | Persisted send outcome increments revision; both tabs updated via SSE without reload in acceptance. |
| 59 | Production callback | Coolify value and matching OAuth client verified; Google callback details unavailable. I cannot confirm this. |
| 60 | Production Pub/Sub | Not required per latest instruction; code/config removed. |
| 61 | Production worker | Existing persistent process/start command verified; new worker not deployed. I cannot confirm this. |
| 62 | Production migration | New migration remains local. I cannot confirm this. |
| 63 | Scope tests | Fixed sender, assigned Lead/Contact, reassignment, historical privacy, search/thread/actions, draft scope and large-address bounds passed. |
| 64 | Realtime tests | Local interval→History→DB→proxy→SSE two-tab flow passed with simulated Gmail. Actual live Gmail path: I cannot confirm this. |
| 65 | Rate-limit tests | Wrapper retry/backoff, Retry-After, cooldown and uncertain-write tests passed. |
| 66 | Schedule tests | Future validation, idempotency, due send, reassignment, expired claims, uncertain acceptance, bounded reconciliation and independent process restart passed locally. |
| 67 | Backend tests | 138 total across the listed six suites, plus independent restart script. |
| 68 | Frontend tests | 48 passed across the listed six suites. |
| 69 | Shared typecheck | Passed. |
| 70 | Backend typecheck | Passed. |
| 71 | Frontend typecheck | Passed. |
| 72 | Backend build | Passed; Prisma generated. |
| 73 | Frontend build | Passed using an explicit non-secret test API URL. |
| 74 | Diff check | Passed. |
| 75 | Limitations | Live provider delivery, production migration/worker/SSE/OAuth callback registration and deployed UI were not verified. I cannot confirm this. Periodic updates have interval latency; Gmail quota/backoff still applies. |

## Reproduce local acceptance

Run from the repository root:

```powershell
npm --prefix backend run build
node backend/scripts/test-mailbox-db.mjs
npm --prefix backend test -- src/integrations/gmail/gmail-read.test.ts src/integrations/gmail/mailbox-ownership.test.ts src/config/validate-env.test.ts
npm --prefix frontend test -- src/features/tenant/inbox src/features/tenant/operations/tasks/__tests__/task-data.test.tsx src/features/tenant/operations/tasks/__tests__/task-editor.test.tsx
node backend/scripts/verify-mailbox-restart.mjs
# PLAYWRIGHT_MODULE may point to an installed Playwright package when not local.
node backend/scripts/verify-mailbox-browser.mjs
```

Acceptance scripts create disposable local databases and simulated provider
responses. They never use deployment database credentials or send real email.
Browser screenshots and JSON results are written to the ignored
`data/outputs/mailbox-browser/` directory.

## Changed-file inventory

The following inventory is generated from the final workspace diff. `.env` and
`.env.local` remain ignored. Screenshots are verification artifacts, not source.

- `.gitignore`
- `backend/.env.example`
- `backend/prisma/migrations/20261106000000_scoped_mailbox_delivery/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/scripts/test-mailbox-db.mjs`
- `backend/scripts/verify-mailbox-browser.mjs`
- `backend/scripts/verify-mailbox-restart.mjs`
- `backend/src/api/routes/integrations.routes.ts`
- `backend/src/config/validate-env.test.ts`
- `backend/src/config/validate-env.ts`
- `backend/src/core/tenant/tenant-models.ts`
- `backend/src/integrations/gmail/gmail-read.test.ts`
- `backend/src/integrations/gmail/gmail-read.ts`
- `backend/src/integrations/gmail/gmail.controller.ts`
- `backend/src/integrations/gmail/gmail.service.ts`
- `backend/src/integrations/gmail/mailbox-auth.service.ts`
- `backend/src/integrations/gmail/mailbox-events.ts`
- `backend/src/integrations/gmail/mailbox-ingestion.service.ts`
- `backend/src/integrations/gmail/mailbox-ownership.test.ts`
- `backend/src/integrations/gmail/mailbox-scope.ts`
- `backend/src/integrations/gmail/mailbox-store.ts`
- `backend/src/integrations/gmail/mailbox-sync.service.ts`
- `backend/src/integrations/gmail/mailbox.integration.test.ts`
- `backend/src/integrations/gmail/scheduled-mailbox.service.ts`
- `backend/src/integrations/gmail/scoped-mailbox.integration.test.ts`
- `backend/src/server.ts`
- `docs/inbox-redesign-report.md`
- `docs/setup/coolify-production.md`
- `frontend/.env.example`
- `frontend/app/api/proxy/[...path]/route.ts`
- `frontend/src/features/tenant/inbox/services/gmail.service.ts`
- `frontend/src/features/tenant/inbox/ui/compose-modal.tsx`
- `frontend/src/features/tenant/inbox/ui/compose-schedule.test.tsx`
- `frontend/src/features/tenant/inbox/ui/email-conversation-view.tsx`
- `frontend/src/features/tenant/inbox/ui/email-detail-view.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-email-list.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-page.test.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-page.tsx`
- `frontend/src/features/tenant/operations/tasks/task-data.ts`
- `frontend/src/features/tenant/operations/tasks/ui/task-editor.tsx`
- `frontend/src/lib/manila-time.ts`
- `frontend/src/shared/components/ui/manila-date-time-picker.tsx`
- `shared/src/contracts/mailbox.contract.ts`

Local configuration updated: backend/.env and frontend/.env.local (ignored; credentials not listed).
