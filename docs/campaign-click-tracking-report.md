# Campaign hyperlink and click-report verification

Verified on 2026-10-09. The implementation is local and reviewable. The existing deployed Brevo integration passed the authorized two-link test, but the new code has not been deployed. Production readiness is **not confirmed**.

The user's follow-up simplifies the email report to **Recipients, Delivered, Submitted, Opened, Total Clicks, Bounced**. Opened and Total Clicks count distinct recipients using persisted provider events or retained recipient timestamps. One recipient clicking several times or clicking several links contributes one to the campaign's Total Clicks. Top Clicked Links now contains only Link URL and Total Clicks, with each recipient counted once per destination and links ranked by recipient count. CSV exports use the same definitions. The API's event totals and rates remain available for compatibility; they are no longer displayed or exported. Historical destination receipts remain visible even when complete repeatable event totals are unavailable. This follow-up supersedes the earlier UI metric requirements below.

The builder and campaign draft create/update services now persist sanitized anchors for pasted HTTP/S URLs. Preview and sending retain the same destinations and template variables. The exact screenshot URL `https://camxian.com/product-services/` was verified through draft persistence, editing and the real Brevo transport with its HTTP request intercepted in the disposable integration suite. No additional production email was sent. Already-delivered emails containing bare text cannot acquire provider tracking retroactively.

The production revision endpoint was rechecked at 09:13 UTC on 2026-10-09 and still reported **4bd2cbe99b3468c073be12df77936b020c507f03**, predating the published Campaigns/Inbox commit **4f228c0b8f974e84d72e89b3687c016f46516bef**. The deployment planner also reproduced `REVIEW_MIGRATIONS_AFTER_DEFERRED_RELATIONSHIP_RETIREMENT` against the current migration inventory: the additive `20261114000000_mailbox_thread_metadata` migration was missing from its reviewed independent list. That migration only adds empty-default reference and attachment metadata to historical mail. The planner now includes it while continuing to defer relationship, CRM and Lead column retirements, reject unknown migrations and reject failed migration history. This is a locally verified release repair; a production deployment is still required and has not been verified.

Follow-up validation: 65 Campaigns frontend tests, 33 rendering/Brevo transport tests, 45 disposable Campaigns integration tests and 9 rollout tests passed (152 total). The mailbox migration compatibility check confirmed preservation of historical messages, bodies, identifiers, CRM links and accounts. All three workspace type checks and builds passed. Desktop browser verification at 1440 px showed the six cards and two link columns; 320, 390 and 768 px checks showed no document overflow. The browser-downloaded CSV matched the recipient counts, omitted removed metrics and included all six fixture link destinations. Screenshots and CSV are ignored at `data/outputs/campaign-clicks/report-six-metrics-desktop.png`, `report-six-metrics-mobile.png` and `report-six-metrics.csv`; those artifacts use the isolated fixture, not production engagement data.

The final report layout places the existing outline export button alongside the heading and shows its accessible download icon alone below 640 px. Manual refresh uses the shared spinner over the retained recipient table, including when a background poll is already running. The 19 report tests and frontend type check passed after these changes; the complete three-workspace build passed again. Browser checks confirmed heading/button alignment, mobile CSV download and the visible refresh spinner. Coolify's failed backend deployment for `4f228c0` confirms the same migration-review error described above; the running backend rolled back to `4bd2cbe`. These are observations before publishing this follow-up release.

## 1. Root cause findings

The original **Email Sample clicked test** campaign (`f658e348-260f-47bf-905c-a53ee1160510`, subject **Sample clicked test**) contained a bare `https://camxian.com/` in its stored body. Brevo's actual message preview contained **zero anchors** and reported that the email did not contain links. Its history and persisted CRM records showed delivery/open evidence and no click. Gmail's own URL recognition made the visible text clickable after delivery, bypassing provider tracking. These observations establish the missing HTML anchor as the original failure; tracking being disabled was not the cause demonstrated by this test.

## 2. URL conversion implementation

`shared/src/contracts/campaign-links.ts` owns the shared link transformation, URL validation, tag/attribute allowlist and destination extraction. Frontend DOMPurify and backend sanitize-html apply that policy before the text-node transformation. Personalization values are escaped before rendering. Existing anchors and attributes are left alone; line breaks become `<br>`; generated URLs/text are escaped once. Unsafe schemes, userinfo URLs, controls and invalid URLs are rejected for generated tracking links.

HTTP/S subdomains, paths, query parameters, encoded characters and fragments are retained. Terminal sentence punctuation and unmatched closing brackets are excluded. Ambiguous terminal punctuation is treated as prose; an explicit anchor preserves an intentionally punctuation-ending destination.

Drafts retain sanitized source text and template variables; reopening and sending use the same transformation as preview. The body remains the existing textarea. SMS bypasses HTML conversion. Preview links use original destinations in a sandboxed iframe, without provider redirects or click-event handlers.

## 3. Brevo sending audit

LeadCRM uses its own campaigns, audience snapshots and delivery logs, sending each email through **Brevo Transactional Email API `POST /v3/smtp/email`**, with `htmlContent`. It does not use Brevo's Email Campaign API. No API migration or custom tracking redirect was introduced. The application supplies its configured sender and does not supply a reply-to override. The inspected live message used sender **Camxian Technologies** / `reymarkjpanes@12066156.brevosend.com`; Brevo displayed the existing account reply-to `reymarkjpanes@gmail.com`.

The live account's **Anonymous tracking** setting was **No**. Active transactional webhook subscription **2202583** targeted `https://api.lead-crm.tech/api/v1/webhooks/brevo`, had token authentication configured, and included Sent, Delivered, Opened, UniqueOpened and Click. No secret was recorded in this report. Brevo generated its own `sendibt2.com/tr/cl/…` URLs in both provider preview and delivered Gmail HTML. See the official [transactional send API](https://developers.brevo.com/reference/send-transac-email), [link rewriting explanation](https://help.brevo.com/hc/en-us/articles/209421325-Why-is-the-URL-of-my-links-different-from-what-I-have-chosen), and [anonymous tracking setting](https://help.brevo.com/hc/en-us/articles/11643306229906-Can-I-anonymize-the-tracking-of-opens-and-clicks-for-my-emails).

The local Brevo API key returned HTTP **401** for read-only webhook/event queries. This did not prevent the separately verified deployed sender and webhook from working. Historical API reconciliation with valid deployed credentials was not performed.

## 4. Tracking verification

The user explicitly authorized one new campaign to the original report's single mailbox, then confirmed clicking both links. No marketing audience was contacted and neither campaign was resent.

| Evidence | Verified value |
|---|---|
| Campaign | `5f832ef0-cfeb-4401-a8cc-d87e3fa927d7` |
| Subject | LeadCRM controlled link verification 2026-10-09 |
| Recipient population | One authorized mailbox |
| Provider message | `<202610090742.42555038166@smtp-relay.mailin.fr>` |
| Provider request | 2026-10-09T07:42:31.148Z |
| Delivered | 2026-10-09T07:42:32.000Z |
| Opened | 2026-10-09T07:44:56.026Z |
| Home click | 2026-10-09T07:44:57.445Z |
| Products click | 2026-10-09T07:45:01.396Z |

Brevo History recorded two click events, its Clicked Links showed one for each destination, and read-only Prisma inspection found the same two persisted events associated with this campaign. The existing authenticated live CRM report automatically displayed one clicking recipient and both original destinations with one click each, without reloading.

`https://camxian.com/` opened the intended home page. `https://camxian.com/products` reached that exact destination but the external website returned **Page not found**. The application preserves the requested destination rather than substituting another route.

This live test used explicit anchors through the **previously deployed** code. It proves provider rewriting, delivery, click ingestion and existing report synchronization. It does **not** prove the new automatic linkifier, new webhook deduplication or new report cards in production. Its raw persisted population yields two total clicks, one unique clicking recipient, one delivered recipient and one opened recipient: expected CTR/CTOR 100% and each link's share 50%. The new version deliberately marks pre-v2 engagement history unavailable rather than presenting potentially collapsed historical totals as complete.

## 5. Analytics implementation

The report reads persisted, tenant-scoped recipient snapshots and provider receipts in one RepeatableRead transaction. It makes no provider network requests and uses a bounded number of relation queries, rather than per-recipient queries.

- Total clicks/opens: eligible persisted provider event receipts.
- Unique clicks/opens: distinct normalized recipient email identities within the campaign.
- CTR: unique clicking recipients / recipients with provider-confirmed `deliveredAt` × 100.
- CTOR: unique clicking recipients / unique opened recipients × 100.
- Zero denominators: unavailable, without fabricated opens or division by zero.
- A validated click without a destination contributes to campaign activity but cannot appear in a per-link row.
- Incomplete historical populations, missing receipt history or legacy engagement keys: unavailable totals/rates; historical recipient/list evidence is retained.

Existing Submitted totals remain provider submission acceptance, separate from delivery confirmation. The report labels the historical Campaign.sentAt field **Submitted**, because that field records submission completion rather than a provider sent event. Campaign list Opened and Clicked mean unique recipients. Average Open Rate is the weighted email-only unique-open/submitted ratio; Engagement uses the existing email open/submitted definition. SMS contributes to Submitted but not email open/click denominators and shows no email engagement values. Active campaigns retain the existing Scheduled/Sending definition.

Counts are provider-reported activity, not a claim of human engagement. The inspected transactional webhook contract exposes no reliable bot classification used by this integration. No unsupported filtering was invented. Open tracking remains sensitive to email-client privacy behavior; see Brevo's [privacy and bot-activity guidance](https://help.brevo.com/hc/en-us/articles/4406537065618-About-Apple-Mail-Privacy-Protection-MPP-and-bot-activity-in-Brevo).

## 6. Top Links Clicked, filters and export

The existing report's bottom section uses the shared DataGrid with **Link URL, Total Clicks, Unique Clicks, Click Share**. Exact original destination strings are grouped together across placements; different query strings/fragments remain distinct. Ordering is total clicks descending, unique recipients descending, then ordinal URL order. Five rows display initially; Show All includes every destination. Truncation retains the full URL in accessible text/title and the original clickable destination.

The report reuses **FilterButton and ModuleFilterRail**, including the existing mobile filter drawer. It supports Delivery Status and Engagement checkbox groups, filter search, counts and Clear filters. Selections are OR within each group and AND between groups; recipient text search further narrows the result. SMS does not offer email-only engagement filters.

CSV exports use the authorized report response. Campaign metrics and all links match the entire-campaign cards; recipient rows follow the current search and checkbox selections, and their scope is written into the file. Percentages use the same calculation with full numeric precision; the UI rounds to one decimal. Timestamps are UTC ISO 8601. CSV cells are quoted, quotes doubled, and formula-like values prefixed with an apostrophe. Failed/stale report refreshes disable export until recovery.

## 7. Event processing and synchronization

Callbacks are authenticated before message lookup. Mapping uses provider message ID plus recipient email, then the stored delivery log's tenant and campaign; subject text is not used. Campaign updates serialize event processing. Receipt insertion uses the existing unique `providerEventKey` and `skipDuplicates` in the same transaction as recipient/log/aggregate updates.

Repeatable engagement keys now contain a v2 marker and a hash of original destination plus provider timestamps. Brevo's webhook `id` identifies the subscription, so it is not treated as an event ID. Equal legacy receipts are recognized on retry. Same-second clicks with different provider millisecond timestamps remain distinct. Earliest opened/clicked timestamps are retained when events arrive out of order, while last activity reflects the latest receipt. Missing delivery logs return a retryable 503, covering a callback racing the send response. See the [official webhook payload contract](https://developers.brevo.com/docs/transactional-webhooks).

The authorized report polls persisted data every 2.5 seconds while visible, resumes on visibility/focus/online changes, blocks overlapping requests, aborts on unmount and rejects stale responses after changing campaign. Loaded rows remain visible during refresh with an explicit error when a query fails. Provider delivery remains asynchronous.

## 8. Mobile preview drawer

The existing Sheet is used below the existing `lg` breakpoint; the desktop side-by-side preview is retained. One shared preview instance renders for the current layout. The mobile Sheet overlays sticky headers, locks background/form scrolling, scrolls its own preview, respects safe-area insets, traps focus, closes with Close/Escape/backdrop and returns focus without resetting values. An observed form scroll position of **388 px** was preserved through opening/closing.

The side-panel toggle switches between Show and Hide for the active mobile drawer, and toggles that drawer without resetting the campaign form. The drawer also provides its own visible Close control because it overlays the form toolbar.

Browser checks covered **320, 375, 390, 430, 768 and 1440 px**. Email/SMS preview and light/dark views were exercised with local fixtures. Narrow screens showed one overlay preview and no page-level horizontal overflow; desktop retained the inline preview. The configured sender is fetched through the existing authenticated API rather than hardcoded in the preview. Unavailable configuration is displayed transparently. These checks were local, not on the new deployed code.

## 9. Files modified for this task

Shared:

- `shared/src/contracts/campaign-links.ts` (new)
- `shared/src/contracts/campaign.contract.ts`
- `shared/src/index.ts`

Backend:

- `backend/src/modules/marketing/campaigns/campaign-content.ts`
- `backend/src/modules/marketing/campaigns/brevo-webhook.ts`
- `backend/src/modules/marketing/campaigns/campaign-delivery-status.ts`
- `backend/src/modules/marketing/campaigns/campaigns.repository.ts`
- `backend/src/modules/marketing/campaigns/campaigns.service.ts`
- `backend/src/modules/marketing/campaigns/campaigns.controller.ts`
- `backend/src/api/routes/marketing.routes.ts`
- `backend/src/shared/services/email.service.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaign-content.test.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts`
- `backend/scripts/audit-campaign-clicks.cjs` (new, read-only)

Frontend:

- `frontend/src/features/tenant/marketing/campaigns/services/campaign-html.ts` (new)
- `frontend/src/features/tenant/marketing/campaigns/services/campaign-report-export.ts` (new)
- `frontend/src/features/tenant/marketing/campaigns/services/campaign-report-export.test.ts` (new)
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-builder.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaign-report-view.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/campaigns-page.tsx`
- Corresponding builder/report/page tests under `ui/__tests__/`
- `frontend/src/shared/components/ui/sheet.tsx` (focus/stacking opt-in)
- `frontend/src/shared/services/campaigns.api.ts`

Support: `scripts/campaign-click-preview.cjs` (new isolated fixture), `.gitignore` (local evidence exclusion), and this report. Existing FilterButton/ModuleFilterRail are reused without source changes. Unrelated Inbox/Gmail work was already present and was preserved.

## 10. Database changes

**No Campaigns schema change or migration.** Existing Campaign, CampaignContact, EmailDeliveryLog, EmailEvent and unique providerEventKey support the implementation. Old events were neither deleted nor rewritten. No database migration was deployed. The unrelated mailbox schema/migration changes in the working tree are outside this task.

## 11. Security findings

Authenticated tenant context and existing campaign view/report/send permissions remain in the canonical API routes. Sender configuration exposes no API key. Report parent and nested recipient/log/event queries explicitly enforce tenant scope. Integration checks exercised tenant IDOR, missing permissions, forged/duplicate callbacks, cross-tenant audience/template references and delivery transitions.

The webhook retains constant-time comparison of hashed bearer values, a minimum configured token length, rate limiting and HTTPS enforcement in production. Click/open callbacks require provider timestamps; unsafe click URLs and excessive future timestamps are rejected. Preview HTML uses the shared restrictive policy and an iframe sandbox. Export formula protection and failed-report export blocking are tested.

## 12. Executed checks

| Check | Outcome |
|---|---|
| Backend focused content/delivery/pagination suites | 43 tests passed |
| Disposable PostgreSQL + authenticated Campaigns HTTP integration | 44 tests passed; provider send calls mocked |
| Frontend builder/page/CSV suites | 27 tests passed; all 17 builder tests passed again after the mobile Show/Hide follow-up |
| Frontend report suite, including shared filters and unattributed clicks | 19 tests passed on the final rerun |
| Frontend audience/hooks/pagination suites | 18 tests passed |
| Root `npm run lint` | All three workspaces passed before the final report-only changes |
| Frontend `npm --prefix frontend run lint` after shared-filter change | Passed |
| Root `npm run build` | All three workspaces passed before the later mobile toggle label/handler adjustment; backend/shared reused successful cache entries |
| `git diff --check` | Passed |
| Controlled live Brevo/Gmail/CRM tracking | Two persisted click events, one recipient, two destinations |
| Local responsive browser/report/export checks | Passed within the fixture boundary described above |

These focused suites total **151 passing tests** (87 backend, 64 frontend). Vitest initially failed in the Windows sandbox with temporary-cache EPERM before tests ran; approved retries outside the sandbox passed. A report test had an inconsistent zero-click fixture with a positive click total; the fixture was corrected and rerun. The timestamp-label assertion was scoped to the field label because Sent remains a valid provider-backed campaign status. Turbo initially encountered sandbox Access denied; the approved build succeeded. Next.js warned about multiple workspace lockfiles; Vitest warned about future native config loading. Neither warning was treated as a test failure. The full repository test suite was not run.

Browser evidence and downloaded CSV are ignored under `data/outputs/campaign-clicks/`, including `report-shared-filter-desktop.jpg`, `report-shared-filter-mobile-390.jpg`, `filtered-report.csv`, `mobile-email-dark-390.jpg`, `mobile-sms-390.jpg`, and `live-report-two-clicks.jpg`. Synthetic fixture counts are UI evidence only and are never represented as production engagement.

## 13. Deployment results

The existing public backend health endpoint returned 200 with production commit **4bd2cbe99b3468c073be12df77936b020c507f03**. Authenticated production CRM/Brevo/Gmail inspection established the controlled test described above. That deployed revision predates these changes. No authenticated Coolify deployment session was available. This acceptance report was recorded before the user's subsequent request to publish Campaigns and Inbox changes to both main branches. Commit/push results are reported separately; no new production deployment or server setting change is verified here.

Frontend/backend revision alignment, final production payload generation, deployed new metrics/export/filter/drawer behavior, and production error logs after rollout: **I cannot confirm this.** A successful local build is not deployment evidence.

## 14. Remaining issues and release gates

1. Deploy the reviewed frontend/backend/shared changes through the authorized release workflow, verify exact serving revisions, then validate the new automatic rendering and report/drawer in the deployed application. The single previously authorized test was already sent; another send requires authorization for that specific test.
2. Verify a post-deployment campaign with automatically generated anchors reaches Brevo, produces v2 receipts and reconciles with the new report/export. Existing historical receipts remain unavailable where their completeness cannot be established.
3. The report distinguishes draft/not sent/no links/pending/recorded/incomplete history and query failures. It cannot independently distinguish **provider tracking disabled**, **delayed callbacks** and **provider synchronization outage** because the current API has no authoritative tracking-configuration/health input. It does not infer disabled tracking or fabricate zero counts from a failed provider request. Separate automatic disabled/outage diagnostics remain unimplemented.
4. The local provider API credential returned 401; valid account-authorized read access is needed for API reconciliation/backfill. No historical totals were manufactured.
5. Provider retries with exactly the same message, URL and timestamp tuple are indistinguishable from legitimate repeated clicks having that identical tuple. The documented deduplication policy preserves distinguishable timestamps; no stable per-event identifier was available. Transactional bot classification and human-only counts cannot be confirmed.
6. The external `/products` URL returns Page not found. Its redirect was correctly tracked, but a working destination should be chosen by the campaign author or repaired on Camxian's website.

The local changes and verified existing provider flow are ready for review. The full production-ready definition of done remains open at these release gates.
