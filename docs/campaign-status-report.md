# Campaign status and tracking verification — 2026-10-08

Implemented against the current repository. The final clarification keeps `SENDING` in the backend/database enum and removes `ACTIVE`, `SCHEDULED`, `PAUSED`, and `COMPLETED`. Normal filter options remain Sent, Partially Sent, Delivered, Failed, Draft. Provider confirmation changes Sending to Sent automatically; HTTP acceptance alone does not.

This is a local implementation and verification report. The shared Supabase database was inspected read-only. These changes have not been committed, pushed, deployed, or applied to that database.

## Required report

| # | Item | Result |
|---|---|---|
| 1 | Files changed | Full inventory below. Changes reuse the existing Campaign module, report API, DataGrid, Badge, cached-page hook, and webhook persistence. |
| 2 | Prisma enum before/after | Before: `SENDING, SENT, PARTIALLY_SENT, FAILED, DRAFT, ACTIVE, PAUSED, COMPLETED, SCHEDULED`. Final: `SENDING, SENT, PARTIALLY_SENT, DELIVERED, FAILED, DRAFT`. Non-null with Draft default. |
| 3 | Delivered migration | `20261108000000_campaign_delivered_status` adds Delivered. `20261109000000_campaign_final_statuses` removes the four obsolete enum members through a transactionally replaced enum, retaining every campaign, recipient and event. |
| 4 | Migration application | Both applied successfully to fresh disposable PostgreSQL-compatible databases by replaying migration history. The dedicated historical-data migration test passed. Not applied to shared Supabase. Its audit found 1 Draft, 6 Sent, 1 Failed; no records used the four removed values. Latest applied migration there was `20261107000000_textbee_webhook_receipts`. |
| 5 | Shared contracts | CampaignStatus contains exactly six values. Shared Campaign, send-result, recipient-report and frontend types agree. Separate submission timestamps and `submissionComplete` describe execution without conflating submission and delivery. |
| 6 | Status filters | Exactly Sent, Partially Sent, Delivered, Failed, Draft. No Sending option, per the original normal-filter requirement. |
| 7 | Type filters | Exactly Email and SMS. Historical Multi-Channel records remain stored/readable. |
| 8 | Table badges | One CampaignStatusBadge wraps the existing shared Badge. Draft/Sending neutral, Sent info, Partially Sent warning, Delivered success, Failed destructive. Table and report share its labels. |
| 9 | Draft | Only saved, unstarted drafts are editable/sendable. An atomic Draft-to-Sending claim and submission-start timestamp prevent duplicate sends. |
| 10 | Sent | Every eligible recipient has provider-confirmed sent/delivered evidence, no failures, and not all are delivered. A Brevo `request` or TextBee `MESSAGE_SENT` establishes sending evidence. |
| 11 | Partially Sent | At least one successful sent/delivered recipient and at least one terminal failure. A failed recipient is not simultaneously counted as successful because it has an earlier sent timestamp. |
| 12 | Delivered | Frozen eligible recipient count is positive, the snapshot is complete, every eligible recipient has a delivered timestamp, and none failed. Excluded rows do not affect the denominator. |
| 13 | Failed | All eligible recipients terminally failed and none is successful. Unconfirmed submission or unknown state is not fabricated as failure. |
| 14 | Precedence | Draft; all Delivered; mixed success/failure; all Failed; all successful Sent; otherwise retain Sending/current supported historical status. Opens/clicks never supply delivery evidence. Removed historical statuses are converted using this evidence; inconclusive removed statuses become Sending rather than an invented final outcome. |
| 15 | Email recalculation | Existing Brevo handler locks the campaign, inserts the idempotent EmailEvent, updates CampaignContact/EmailDeliveryLog, then calls the common `recalculateCampaignDelivery` helper in the same transaction. Send completion uses the same helper. |
| 16 | SMS recalculation | Existing TextBee handler validates/matches the event, records the receipt, updates CampaignContact, and invokes the same helper in its transaction. |
| 17 | List refresh | Existing useCampaignsData/useCachedPage refresh every 7.5 seconds while the list is active and the document is visible. Current rows remain visible. No hard reload. |
| 18 | Report status refresh | The returned canonical campaign status replaces both header badge and details status on every successful report refresh. |
| 19 | Brevo Delivered | Only actual delivered webhook evidence writes deliveredAt. Late terminal failures take precedence. Soft bounces remain retryable; engagement and spam complaints do not manufacture delivery failure. |
| 20 | Brevo Open | Persist actual opened/unique_opened events through existing EmailEvent and first openedAt. Recipient opens count once; latest activity includes later distinct events. |
| 21 | Brevo Click | Preserve HTTP(S) URLs from click payloads; correlate with the saved Brevo message ID; insert deduplicated EmailEvent; set first clickedAt; recalculate unique-recipient counts. Fixed deduplication that could collapse separate clicks when the provider reused the original send epoch. |
| 22 | Brevo production configuration | Read-only dashboard: active LeadCRM transactional webhook points to `https://api.lead-crm.tech/api/v1/webhooks/brevo`, Token authentication selected. Sent, Delivered, Opened, Unique opened, Clicked, blocked, hard/soft bounce, invalid, deferred, spam, unsubscribe are enabled. Error/proxy-open/first-opening options were off. Anonymous tracking was set to No. Monitoring showed 19 retries, 1 failed, 10 delivered webhook requests in its displayed last-24-hour window. Token equality and a new end-to-end callback were not verified. I cannot confirm this. |
| 23 | TextBee Sent | `MESSAGE_SENT` stores sentAt and can move the campaign from Sending to Sent once all eligible recipients are confirmed. |
| 24 | TextBee Delivered | `MESSAGE_DELIVERED` stores deliveredAt; all confirmed eligible deliveries produce Delivered. Final recipient outcomes retain the existing non-regression protection. |
| 25 | TextBee Failed | `MESSAGE_FAILED` records a terminal failure and recomputes Partial/Failed as appropriate. Unknown states display neutral Pending. |
| 26 | TextBee production configuration | Read-only dashboard: active webhook points to `https://api.lead-crm.tech/api/v1/webhooks/textbee`, with MESSAGE_SENT, MESSAGE_DELIVERED, MESSAGE_FAILED, UNKNOWN_STATE selected. A signing secret is present; it was not revealed or changed. Three historical MESSAGE_SENT webhook requests showed successful delivery to the endpoint. That is callback delivery, not proof of SMS handset delivery. Current secret equality/new send receipt: I cannot confirm this. |
| 27 | Email report realtime | Scoped polling in the existing CampaignReportView. No separate realtime/tracking framework. Open, click, recipient activity, links and campaign status update together from the report API. |
| 28 | SMS report realtime | Same report polling and guard. Backend recipient/campaign statuses replace displayed values automatically. |
| 29 | Intervals | Report: 2,500 ms. Campaign list: 7,500 ms. No global polling added. |
| 30 | Visibility | Automatic requests pause when document.hidden and resume immediately on visibility change. In-flight guards prevent overlap; listeners/timers and the active report request are cleaned up on unmount. Background refresh keeps loaded content visible. |
| 31 | Idempotency | EmailEvent unique provider keys remain authoritative. Repeated opens/clicks use link and both provider timestamps, with compatibility handling for prior keys. Recipient engagement counts once. TextBee retains raw-body HMAC validation and unique idempotency receipts; repeated/final/out-of-order events do not inflate counts or regress terminal state. |
| 32 | Top Links columns | Exactly Link, Total Clicks, Click Rate, Last Clicked. Unique Clicks is no longer a visible column. |
| 33 | Total Clicks | Count saved distinct click events per URL; retries are deduplicated. Three separate clicks by one recipient count three when provider event metadata distinguishes them. |
| 34 | Click Rate | Unique recipient emails for a URL divided by the frozen campaign recipientCount. Repeat clicks do not increase the numerator. |
| 35 | Last Clicked | Maximum saved click event time for each URL, using the shared local-time formatter. Safe HTTP(S) links open in a new tab with noopener/noreferrer. |
| 36 | Eye controls | Both Eye/EyeOff preview-visibility controls removed. |
| 37 | Panel icon | One existing Lucide PanelRight icon immediately after Send Now; dynamic Show/Hide live preview accessible label, aria-expanded and aria-controls. |
| 38 | Desktop preview | Existing preview opens/closes inline. Existing Monitor/Smartphone switching retained. Browser checked at 1440 and 768 pixels. |
| 39 | Mobile preview | Browser checked at 390, 375 and 320 pixels. Save/Send/Panel actions occupy one row without overlap; measured page scroll width equals viewport width. At 320, visible Save retains the full Save Draft accessible label. Single preview toggle worked both directions. |
| 40 | Requires Review metric | Removed. SMS metrics are exactly Recipients, Submitted, Sent, Delivered, Failed. Email remains Recipients, Delivered, Opened, Clicked, Bounced. |
| 41 | Requires Review filter | Removed. SMS has no email-only Opened/Clicked/Bounced filters or columns. Uncertain SMS recipients remain Pending, not falsely Sent or Delivered. |
| 42 | Controlled Email | Disposable database tests exercised provider handlers/HTTP validation and persisted delivery, open, repeated click, failure, report aggregation and cross-tenant protections. Browser API fixture showed engagement/status/links updating without reload. No new real email was sent/opened/clicked through Brevo. I cannot confirm this. |
| 43 | Controlled SMS | Disposable database tests exercised actual TextBee handler logic and signed callback validation, with mocked transport. Browser fixture showed Submitted/Sending → Sent → Delivered without reload. No new real SMS or handset receipt was tested. I cannot confirm this. |
| 44 | Status matrix | All requested Draft/Sent/Partial/Delivered/Failed cases passed. Both channels also verify that four of five sent confirmations leave Sending and the fifth changes it to Sent before any delivery confirmation. |
| 45 | Backend tests | 42 Campaign integration tests; 31 focused status/content/pagination/SMS-service tests; 4 migration/deployment guard tests, all passed. |
| 46 | Frontend tests | 63 tests across Campaign builder/report/list/templates, server pagination, visibility/polling and shared cached-page integration, all passed. Both channel reports explicitly test automatic Sending → Sent. |
| 47 | Shared typecheck | `npm --prefix shared run lint` passed (tsc --noEmit). |
| 48 | Frontend typecheck | `npm --prefix frontend run lint` passed; production build also completed its type checks. |
| 49 | Backend typecheck | `npm --prefix backend run lint` passed; production build also completed tsc. |
| 50 | Frontend build | `npm --prefix frontend run build` passed with server-only API_URL set to the verified public API hostname. No credentials were copied. |
| 51 | Backend build | `npm --prefix backend run build` passed, including Prisma generation. Prisma validate also passed. |
| 52 | Diff check | `git diff --check` passed. Git reported line-ending conversion notices only. |
| 53 | Limitations | Matching backend/frontend deployment and shared-database migrations remain pending. New live provider sends, webhook secret equality, recipient inbox/handset delivery and post-deployment UI were not verified. I cannot confirm this. Identical click metadata without a distinct provider timestamp cannot safely distinguish an extra click from a retry. No provider redirect URL is guessed when the original destination is absent from the payload. |

## Status matrix actually exercised

| Eligible | Confirmed success | Failed | Delivered | Expected | Result |
|---:|---:|---:|---:|---|---|
| N/A | 0 | 0 | 0 | Draft | Pass |
| 5 | 0 | 0 | 0 | Sending after acceptance | Pass |
| 5 | 4 | 0 | 0 | Sending | Pass, Email and SMS |
| 5 | 5 | 0 | 0 | Sent | Pass, Email and SMS |
| 5 | 5 | 0 | 2 | Sent | Pass, Email and SMS |
| 5 | 4 | 1 | 0–4 | Partially Sent | Pass |
| 5 | 5 | 0 | 5 | Delivered | Pass, Email and SMS |
| 5 | 0 | 5 | 0 | Failed | Pass, Email and SMS |

Incomplete snapshots, excluded recipients, unconfirmed submissions, engagement-only events, legacy email acceptance timestamps, repeated callbacks, terminal failure precedence, and removed-status API filters were also covered.

## Changed source files

- `.gitignore`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261108000000_campaign_delivered_status/migration.sql`
- `backend/prisma/migrations/20261109000000_campaign_final_statuses/migration.sql`
- `backend/scripts/audit-campaign-status.cjs`
- `backend/scripts/verify-campaign-status-migration.test.mjs`
- `backend/scripts/deploy-crm-imports.cjs`
- `backend/scripts/verify-canonical-rollout.test.cjs`
- `backend/src/database/seeders/demo-full.seed.ts`
- `backend/src/database/seeders/reymark.seed.ts`
- `backend/src/modules/marketing/campaigns/campaign-delivery-status.ts`
- `backend/src/modules/marketing/campaigns/campaigns.service.ts`
- `backend/src/modules/marketing/campaigns/campaigns.repository.ts`
- `backend/src/modules/marketing/campaigns/brevo-webhook.ts`
- `backend/src/modules/marketing/campaigns/textbee-webhook.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaign-delivery-status.test.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts`
- `shared/src/types/campaign.types.ts`
- `shared/src/contracts/campaign-email.ts`
- `shared/src/contracts/campaign.contract.ts`
- `frontend/src/store/types/campaign.types.ts`
- `frontend/src/store/mockData/campaigns.mock.ts`
- `frontend/src/shared/services/campaigns.api.ts`
- `frontend/src/shared/hooks/use-cached-page.ts`
- `frontend/src/features/tenant/dashboard/hooks/use-dashboard.ts`
- `frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts`
- `frontend/src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-status-badge.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-report-view.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-builder.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-report-view.test.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx`
- `scripts/campaign-status-preview.cjs`
- `docs/textbee-sms.md`
- `docs/campaign-status-report.md`

The dashboard and seed/mock changes only remove references to retired Campaign status values. No Deal stage, CRM engagement classification, tenant/auth guard, or unrelated module flow was changed.

## Reproduction and release boundary

Executed commands:

```text
npm --prefix shared run lint
npm --prefix backend run lint
npm --prefix frontend run lint
npm --prefix backend run db:generate
npx --no-install prisma validate                  (cwd: backend)
node backend/scripts/test-campaign-groups.mjs src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts
npm --prefix backend test -- src/modules/marketing/campaigns/__tests__/campaign-delivery-status.test.ts src/modules/marketing/campaigns/__tests__/campaign-content.test.ts src/modules/marketing/campaigns/__tests__/campaign-pagination.test.ts src/shared/services/__tests__/sms.service.test.ts
npm --prefix frontend test -- src/features/tenant/marketing/campaigns/ui/__tests__ src/features/tenant/marketing/campaigns/hooks/__tests__/campaign-server-pagination.test.tsx src/shared/hooks/__tests__/cached-page.integration.test.tsx
node --test backend/scripts/verify-campaign-status-migration.test.mjs backend/scripts/verify-canonical-rollout.test.cjs
npm --prefix backend run build
npm --prefix frontend run build
git diff --check
```

The database test runner creates disposable PGlite databases and replays the repository's migrations; it does not reset or write to the configured workspace database. Windows sandbox restrictions required approved retries for Prisma, Vitest and Next.js. Initial failed attempts were repaired and the final runs above passed.

For the local UI fixture, run `node scripts/campaign-status-preview.cjs` from the repository root, then the frontend on port 3109 with API_URL `http://127.0.0.1:4109/api/v1` and both mock-auth/mock-data flags false. The fixture serves only local synthetic data and never contacts providers or a database. Its JSON state file controls response changes for browser polling checks. Local evidence is saved under `data/outputs/campaign-status-*` and ignored by Git.

The enum replacement must ship with the matching backend because the old server still queries obsolete enum members. Stop campaign submission workers during that coordinated deployment and run the existing `npm --prefix backend run db:deploy` path. The deployment migration allowlist now recognizes these two reviewed Campaign migrations without enabling unrelated deferred relationship retirement. Then deploy the matching frontend, verify the final enum/read APIs, and perform approved live provider tests before claiming production completion. There is no reset, dropped Campaign table, recipient deletion, or guessed Delivered backfill.

Provider lifecycle and timestamp behavior were checked against [Brevo transactional webhooks](https://developers.brevo.com/docs/transactional-webhooks), [Brevo webhook configuration](https://developers.brevo.com/reference/create-webhook), and [TextBee webhook events](https://textbee.dev/docs/webhooks/events). TextBee callback authentication, retries and idempotency retain the documented [raw-body HMAC and receipt contract](https://textbee.dev/docs/webhooks).
