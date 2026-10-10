# Inbox conversation implementation and production audit

Verified locally on 2026-10-08–09 (Asia/Manila). The changes remain uncommitted in the working tree. No production deployment, production migration, infrastructure shutdown, token rotation, or real email send was performed.

**Local implementation is complete; production readiness is not established.** Public production health reports an older backend revision without the current scoped-mailbox implementation. Production configuration, migration state, worker ownership and live Gmail acceptance remain release gates.

## Production evidence

Public endpoint checks were refreshed on 2026-10-09 (Asia/Manila). No authenticated production mailbox or deployment-console access was available.

| Item | Observed result |
| --- | --- |
| Current local main; origin/main; upstream/main | `efc31104828f44dfda13e009f217aff6bc65754a` at audit time. This task's changes are not in that commit. |
| Frontend proxy health | `https://lead-crm.tech/api/proxy/health` returned HTTP 200, production, backend commit `d826e91c05ca08d507ed9915c730fc259935632c`. |
| Intended public backend | `https://api.lead-crm.tech/api/v1/health` returned HTTP 200 and the same backend commit. |
| Deployed frontend commit | The proxy health response identifies the backend, not the frontend. **I cannot confirm this.** |
| Backend equals current main | No. The reported backend SHA differs from both main remotes. |
| Scoped implementation at reported backend revision | Inspecting Git object `d826e91c05ca08d507ed9915c730fc259935632c` found no `mailbox-scope.ts`. Its legacy `fetchEmails` uses an unscoped default provider query, `-in:spam -in:trash -in:drafts`. |
| Does production run the current scoped implementation? | Public revision evidence indicates it does not. Runtime source inspection and authenticated production acceptance were unavailable; **I cannot confirm this.** The older revision is a likely explanation for full-mailbox visibility, not proof of a newly introduced frontend filtering defect. |
| Exact frontend `API_URL` | Public proxy and intended backend report the same revision; that is consistent with the intended route. The actual runtime variable and routing configuration were not inspected. **I cannot confirm this.** |
| Old Render deployment | `https://leadcrm-backend-os8d.onrender.com/health` returned HTTP 503 on the refreshed probe. This does not prove the service is stopped or that its worker is inactive. **I cannot confirm this.** |
| Production migration / backup / restart | No authenticated deployment or database administration session was available. **I cannot confirm this.** |
| Coolify persistent worker and exclusive production ownership | Local persistent-worker behavior was exercised; production process configuration and old Render worker ownership were not available. **I cannot confirm this.** |

The production values/presence of `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `APP_URL`, `ALLOWED_ORIGINS`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_SYNC_INTERVAL_SECONDS`, and optional `GMAIL_TEST_MAILBOX_OVERRIDE` were not inspected. Neither were deployed frontend `API_URL` and `NEXT_PUBLIC_USE_MOCK_DATA`. **I cannot confirm this.** Source contracts were inspected; no secret values were copied or printed. The exact Google-console OAuth callback match is unverified. **I cannot confirm this.**

## Conversation and composer

- Replaced the horizontal message buttons with one chronological vertical thread. The subject appears once. Latest and unread messages initially expand; older rows show avatar, sender, snippet and timestamp. Semantic buttons expose `aria-expanded`, `aria-controls`, labels and focus styles.
- The global toolbar contains Back, Archive and Trash. Expanded messages have compact Reply/Forward controls; one larger Reply/Forward pair follows the conversation.
- CRM links sit below the subject. Only current backend-provided open Deal options are selectable. Association refreshes the visible Deal link, suppresses concurrent submits and remains idempotent in the database. It never changes Deal stage, value, status or win confirmation.
- Kept the existing Inbox list, search, filters, sort, selection, pagination and ComposeModal. Returning from a thread preserves current list state; refresh/SSE keep the conversation open where authorized.
- Reply uses normalized Reply-To when present for inbound mail, otherwise From; outbound replies target the customer recipient. It adds Re only when absent, starts with a blank body and preserves the authorized provider thread/RFC reply headers through the backend.
- Forward starts with an empty To field, a single Fwd prefix, escaped sender/date/subject/To/Cc metadata and the full sanitized original body. Source-message authorization is checked for new, saved and scheduled forwards. No auto-send or Reply All was added.
- Removed dead file/image selection and filename state. No attachment can appear selected and then silently be omitted from delivery. Rich text, lists, safe links, emoji, draft save/delete, send, schedule, minimize/fullscreen and Escape remain in the existing composer.
- Fixed body loss across minimize/restore. Unchanged send retries reuse a UUID. Send/schedule/save pause on provider retryAt while preserving editor content; close/discard cannot interrupt an in-flight mutation.
- Normal list dates, full message dates and forwarded metadata use Asia/Manila, alongside the existing Manila scheduling picker. Stored UTC dates are unchanged. Midnight/calendar formatting is tested independently of browser timezone.

## Persistence, read state and API

New migration: `backend/prisma/migrations/20261113000000_mailbox_message_headers/migration.sql`.

It adds `MailboxMessage.ccRecipients` (empty array), `replyToAddress` (nullable), `sourceMessageId` (nullable), and `MailboxSendReceipt`. The source ID allows authorization to be rechecked when a saved forward/reply is used later. The receipt stores request identity, a payload hash, delivery state and provider IDs, preventing repeated interactive delivery after lost responses or concurrent requests. Its mailbox/tenant foreign key and account/request uniqueness are enforced. It is registered with the existing tenant middleware. No original message, identifier, CRM link, Activity or scheduled history is deleted or recreated; historical header values are not invented.

Migration deployment must precede starting the new backend, whose Prisma client expects the added columns/table. The old backend can coexist with these additive columns during a controlled rollout. Before production rollout, use the existing backup process, verify the backup, apply the repository's full pending forward-migration chain via `npm --prefix backend run db:deploy`, then deploy/restart matching frontend/backend revisions and verify data/worker health. These production steps were not executed. **I cannot confirm this.**

Backend API prefix is `/api/v1/integrations/gmail`; the browser continues through `/api/proxy/integrations/gmail`.

| Endpoint | Change |
| --- | --- |
| `PATCH /threads/:threadId/read-state` | Added strict `{ isRead: boolean }` contract. Supports read/unread; opening an unread conversation calls read. No new unread menu was added. |
| `POST /threads/:threadId/archive` | Added whole-authorized-conversation archive. |
| `POST /threads/:threadId/trash` | Added whole-authorized-conversation trash. |
| `GET /threads/:threadId` | Persisted chronological non-draft messages, CC/Reply-To, current authorized CRM links and immediate association overlay. No provider resync. |
| `PATCH /threads/:threadId/deal` | Current customer assignment plus Deal view/edit required; updated context/revision after association. Historical fixed-sender visibility cannot authorize a former customer's Deal. |
| `GET /emails` | Added persisted CC/Reply-To fidelity; scheduled entries remain inside current assignment/draft scope. Existing list/search/pagination contract retained. |
| `POST /send` | Optional request UUID, durable deduplication, every-recipient edit/scope validation, optional authorized forward source. |
| `POST /drafts`, `DELETE /drafts/:draftId` | Preserve separate actual Gmail draft IDs; validate current scope and retained source before provider mutation. Save accepts optional forward source. |
| `POST /scheduled` | Preserve mandatory request UUID and UTC scheduling; validate all recipients, module edit permissions and source both at creation and delivery. |
| `POST /archive`, `POST /trash` | Existing bulk endpoints retained; drafts rejected before provider mutation. |

Read/archive/trash resolve the authenticated owner and recompute current scope, then select eligible provider message IDs on the server. They never mutate the provider thread wholesale. Draft/scheduled payloads and unrelated messages are excluded. Already-read/archived rows skip provider writes. Labels change only after each successful provider operation. Successful partial progress also increments mailboxVersion so other tabs refresh. None of these actions creates email Activity, changes engagement timestamps or deletes CRM history. The existing SSE and persisted list refresh update Inbox and topbar unread counts.

CC survives parsing, persistence, refresh and reconstruction. A single valid Reply-To is normalized; malformed, multiple-address or CR/LF values become null, preserving the message but rejecting that header as a delivery target. A syntactically valid out-of-scope Reply-To produces an actionable authorization error when sending.

## Security and mailbox scope audit

No new permission key, Gmail integration, browser Gmail call, credential store, localStorage mailbox store or independent worker was introduced. Existing OAuth state/PKCE/session binding, token encryption/refresh, employee account validation, tenant readiness, authenticated proxy, mailbox ownership and sensitive `Cache-Control: no-store` protections remain. Reading requires existing Leads/Contacts view permission; composing also requires the matching module edit permission for every recipient. Deal association requires Deal view/edit.

The follow-up audit for requirements 102–138 found and closed additional authorization gaps in the local implementation. A historical Lead/Contact link could authorize an unrelated participant address as thread continuity. Continuation now intersects current valid assigned email addresses; changing or invalidating the CRM email removes its old address immediately on scope refresh. Empty/invalid-email records no longer supply record IDs to mailbox scope. Converted Leads are excluded according to the canonical active Leads list; their old assignments cannot bypass current Contact assignment. Historical rows remain intact.

Saved forward/reply drafts could also remain readable after their source was reassigned, including a forward addressed to a different still-assigned Contact. Draft and Scheduled lists now require retained source authorization. Scheduled rows must resolve through an authorized saved draft; interrupted reservations without a saved draft remain in the database but are not listed. History checks the retained source before requesting a draft body, including when Gmail replaces the draft's message ID. Ingestion preserves the source relationship across those replacements. Personal Gmail drafts authored under a fixed-sender alias cannot gain access through the inbound sender rule.

Scheduled delivery rechecks the user, permissions, source, saved draft and every current recipient. It retrieves draft headers with Gmail's [metadata format](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format), so provider edits to To/Cc can be rejected without downloading the draft body. A nonempty Bcc header is rejected because the CRM composer does not support hidden recipients. Uncertain-delivery reconciliation also rechecks authorization; an exact receipt lookup never becomes a mailbox-wide fallback or automatic resend. Confirmed-send ingestion gates full content through message metadata.

| Required scope item | Current implementation and evidence |
| --- | --- |
| 1. Fixed senders | Exactly `reymarkjpanes@12066156.brevosend.com` and `info@camxian.com`; no domain wildcard. |
| 2. Assigned Leads | Current tenant, mailbox owner, canonical assignedUserId, permitted Leads view, active/nondeleted/unarchived/unconverted records; present, valid, normalized exact email. Historical links cannot add old or unrelated addresses. |
| 3. Assigned Contacts | Current tenant, assigned owner, Contacts view, active/nondeleted/unarchived records with valid exact email; independently tested with both mailbox owners. After Lead conversion the current Contact controls access; old Lead-only aliases are not independently authorized. Creator, same company/tenant and Client Admin role confer no mailbox scope. |
| 4. Provider queries | Bounded chunks (at most 40 terms / approximately 3,000 characters). For assigned `lead@example.com` and `contact@example.com`: `-in:spam -in:trash {from:reymarkjpanes@12066156.brevosend.com from:info@camxian.com from:contact@example.com from:lead@example.com to:contact@example.com cc:contact@example.com to:lead@example.com cc:lead@example.com to:reymarkjpanes@12066156.brevosend.com to:info@camxian.com}`. Message reconciliation appends `-in:drafts`; draft reconciliation uses the scoped base. Continuation cannot add an address outside the current exact set. Post-query metadata checks remain authoritative. |
| 5. History | Reads From/To/Cc/Message-ID metadata first; only authorized IDs get full-body reads and ingestion. Retained draft source is checked before full content. Required assigned-customer versus unrelated-bank test proves no bank body fetch and no bank row. |
| 6. Expired History | Resets the cursor into bounded scoped reconciliation. No unbounded fallback. |
| 7. Persisted history | Current scope is applied dynamically. Historical unrelated rows remain stored but inaccessible through normal Inbox APIs; no destructive cleanup. |
| 8. Inbox list | Owner/tenant/current assignments/fixed senders plus label rules on every request. Empty assignments remain restrictive. |
| 9. Unread count | Counts authorized persisted non-draft UNREAD rows; never uses Gmail-wide totals. |
| 10. Search | Text search intersects current persisted scope. Browser Gmail query syntax cannot widen it. Bank mail with matching subject remains hidden. |
| 11. Sent | Authorized outbound correspondence only. Personal sent messages remain excluded. |
| 12. Drafts | Authorized recipients/threads and staff-authored empty CRM drafts only; retained reply/forward source must still be readable, including for empty drafts. Arbitrary personal Gmail drafts and fixed-alias personal drafts are excluded. Scheduled visibility requires an authorized saved draft, so a still-assigned destination cannot bypass revoked source access. Retained database history is preserved. |
| 13. Direct threads | Fresh owner/tenant/assignment checks independently of the list or a known thread ID. Cross-tenant and other-mailbox requests return 404 without provider calls. |
| 14. Archive/trash | Every ID is selected/validated against current scope; non-draft thread semantics; no CRM-history deletion. |
| 15. Reply/send | Current authorized source plus every recipient, valid syntax/count/length and corresponding module edit permission. Mixed authorized/unauthorized recipients are rejected before Gmail. |
| 16. Reassignment | Old owner loses read and mutation eligibility; new owner only sees qualifying correspondence in their own connected mailbox. Scheduled delivery rechecks. No token copying. |
| 17. Archived records | Archived/deleted/unassigned customer records leave active scope. Lead and Contact revocation paths are tested; historical Activity remains. Removed/invalid/changed emails also revoke former correspondence. |
| 18. Client Admin | No role-wide mailbox bypass. Only that user's connected account and current canonical assignment scope; no change to Assigned Agent eligibility rules. |
| 19. Unrelated-message tests | Exact-sender tests include other/someoneelse Brevo, sales/admin/jobs/other Camxian, LinkedIn and bank. Tests also cover historical-bank search, malicious historical CRM links, direct reads/mutations, Sent/Drafts, fixed-only empty scope, both owners and CRM modules, module View revocation, changed/invalid emails, archived/unassigned records, revoked draft sources/replaced draft message IDs, History metadata gating and provider-edited scheduled To/Cc/Bcc. |
| 20. Deployed frontend SHA | **I cannot confirm this.** |
| 21. Deployed backend SHA | Public health reports `d826e91c05ca08d507ed9915c730fc259935632c`. |
| 22. Production scope | Reported revision lacks current scope code; authenticated live scope acceptance was unavailable. **I cannot confirm this.** |

Email HTML remains untrusted. DOMPurify allows limited formatting and tables, removes executable elements, scripts, frames, objects, embeds, handlers, remote images, tracking pixels, styles and sender-controlled classes. Classes are inspected only for quote markers and removed before output. Links allow http/https/mailto with safe external-link attributes. Wide tables/preformatted text scroll inside the message body; long text/address/subject wraps.

Only clear structural quotes (`blockquote`, Gmail quote wrappers) fold behind native keyboard-accessible “Show trimmed content” controls. Original order and complete sanitized contents remain available. Unknown plain-text separators remain visible. No stored body is trimmed or mutated.

Existing reply-recency rules remain unchanged: actual reply 0–7 days Hot, 8–29 Warm, 30+ Cold; never replied with first outbound under 30 days Warm, otherwise Cold; no history preserves existing/default/manual status. Staff sends, opens, reads, clicks and sync times do not reset reply age. Cancelled and Closed remain explicit CRM/completion behaviors. Email ingestion/association does not move Deals; Workflow owns automatic stage movement. Contradictory historical documentation was corrected and old verification clearly dated.

## Checks actually executed

| Command/check | Result |
| --- | --- |
| `node backend/scripts/test-mailbox-db.mjs` | **117 passed on final follow-up run:** 25 engagement rules, 32 mailbox integration, 60 scope/read-state/scheduling/send-claim integration. Full forward migrations replayed in three isolated disposable databases. The earlier run had 98 tests; 19 additional cases cover the strict-scope follow-up. |
| `npm --prefix backend run test -- src/integrations/gmail/gmail-read.test.ts src/integrations/gmail/mailbox-ownership.test.ts src/modules/automation/workflows/__tests__/workflow-conditions.test.ts src/modules/automation/workflows/__tests__/workflow-input-security.test.ts` | **67 passed**, four files: provider cooldown/failure behavior, token/ownership/OAuth safeguards and Workflow regressions. |
| `npm --prefix frontend run test -- src/features/tenant/inbox src/shared/components/crm/__tests__/email-activity.test.tsx` | **43 passed**, six files: conversation, sanitizer, compose/schedule, navigation, list page and CRM email timeline. Includes minimize preservation, concurrent/retried send keys and rate-limit controls. |
| `node backend/scripts/verify-mailbox-header-migration.mjs` | **Passed:** old message/body/provider IDs/thread/CRM links/account preserved, empty/null new fields, unique send receipt and tenant foreign key enforced. |
| `node backend/scripts/verify-mailbox-restart.mjs` | **Passed:** three independent processes, persisted schedule, exactly one simulated send. |
| `npm --prefix shared run lint` | **Passed** (TypeScript). |
| `npm --prefix backend run lint` | **Passed** (TypeScript). |
| `npm --prefix frontend run lint` | **Passed** (TypeScript), run sequentially after the final build. |
| `npm --prefix backend run build` | **Passed again after the final scope corrections**, Prisma generation and TypeScript compilation completed before the final disposable-database suite. |
| `npm --prefix frontend run build` | **Passed**, 180 static pages generated; explicit mock=false and process-local placeholder HTTPS API_URL, no production configuration changes. |
| `git diff --check` | **Passed** after removing extra EOF blank lines; final report included in final check. |
| Local browser acceptance | **39 checks passed again with the final backend scope corrections** across all six requested widths, including retaining expanded quotes across message actions and thread refreshes; zero page/transport errors, one simulated scheduled send and zero browser Gmail sync calls. |

The browser harness uses the compiled backend, real authenticated API/proxy/SSE, disposable database, local Next dev server and simulated Gmail. It covers 1440, 1024, 768, 390, 375 and 320 px for Inbox, conversation, expanded quotes/messages, dark conversation, composer and scheduling picker. It checks no document overflow, vertical ordering, keyboard collapse, safe HTML, one persisted read write, Deal association without stage change, schedule/reload, two-tab History updates and Scheduled-to-Sent updates without loading flashes. It verifies zero browser Gmail sync calls, zero page errors and zero unexpected transport errors. Evidence is ignored under `data/outputs/mailbox-browser/` (`results.json`, PNGs, `frontend-build.log` and `frontend-lint.log`). Desktop and narrow light/dark/composer screenshots were visually inspected. Visual review caught quote expansion resetting during unrelated rerenders; stabilizing the sanitized body fixed it, and both unit and browser assertions now cover preservation of an open quote.

Sandbox temp-file restrictions initially blocked test execution; approved outside-sandbox reruns passed. A legacy integration fixture expected Client Admin to be a sales owner; it was corrected to an authorized Sales fixture without changing the production owner rules. One frontend lint overlapped a Next build regenerating `.next/types` and reported missing generated files; the final check is run sequentially after build. Existing Vite config-format and Next multiple-lockfile/root warnings are retained.

Follow-up evidence is ignored under `data/outputs/mailbox-browser/privacy-tests.log`, `privacy-build.log`, `privacy-restart.log` and `privacy-browser.log`. During the follow-up, one test correctly caught a revoked scheduled draft returning the generic provider-failure explanation; 404 scope revocation now uses the authorization/assignment explanation, and the complete final 117-test run passed. The conversion-history test was updated to enforce the user's current exact-address rule: old converted-Lead-only aliases stay excluded, current assigned Contact correspondence retains its original Deal context, and historical rows remain intact. The earlier frontend/unit/migration checks above were not all repeated for this backend-only follow-up; current backend build and the full disposable mailbox suite were rerun.

**The full repository test suite and every unrelated module's end-to-end workflow were not run. I cannot confirm this.** Production builds compile all application routes; focused checks cover Inbox/CRM email navigation and timeline, Leads/Contacts engagement, Deal association and Workflow conditions/security. These do not establish exhaustive regression acceptance for Accounts, Tasks, Campaigns, Forms, Products, Custom Fields, Team Management, Roles, Notifications or Archived Data.

## Live acceptance and limitations

**I cannot confirm live Gmail send/receive behavior.** No approved connected live-mailbox session was available for a controlled send/reply/archive/scheduled-delivery test. Simulated provider acceptance is not real Gmail delivery evidence.

Production backup, migration, paired deployment, callback verification and worker cutover remain outstanding. Do not mark the deployed Inbox fixed from these local results. Do not rotate the encryption key or stop an old service until ownership and cutover are verified.

Historical CC/Reply-To fields stay empty/null until qualifying provider data is ingested again. Historical null source IDs cannot be reconstructed reliably from provider bodies, so no source is guessed; source checks apply where a saved CRM source relationship exists. No unscoped bulk re-fetch or invented backfill is performed. Ambiguous plain-text quotes remain visible. Remote images and attachments are unsupported. Mark-unread is supported by the API but no new UI menu was added. Inbox remains message-based with existing pagination, rather than a new thread-pagination API. The existing All emails filter can include archived authorized correspondence; archive removes INBOX in Gmail without deleting history.

Interactive send deduplication is guaranteed for the same supplied request UUID, including composer retries and concurrent replicas. Legacy API clients omitting the optional UUID remain compatible but cannot deduplicate separate new requests; callers should provide a stable UUID. Unknown provider delivery remains blocked from automatic replay and needs verification in Gmail Sent. No system can infer a delivery outcome from a lost provider response alone. If a thread mutation partially succeeds, saved successful progress is broadcast; failed rows remain retryable.

## Exact changed-file inventory

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261113000000_mailbox_message_headers/migration.sql` (new)
- `backend/scripts/verify-mailbox-browser.mjs`
- `backend/scripts/verify-mailbox-header-migration.mjs` (new)
- `backend/src/api/routes/integrations.routes.ts`
- `backend/src/core/tenant/tenant-models.ts`
- `backend/src/integrations/gmail/gmail.controller.ts`
- `backend/src/integrations/gmail/gmail.service.ts`
- `backend/src/integrations/gmail/mailbox-ingestion.service.ts`
- `backend/src/integrations/gmail/mailbox-recipient-access.ts` (new)
- `backend/src/integrations/gmail/mailbox-scope.ts`
- `backend/src/integrations/gmail/mailbox-send.service.ts` (new)
- `backend/src/integrations/gmail/mailbox-store.ts`
- `backend/src/integrations/gmail/mailbox-sync.service.ts`
- `backend/src/integrations/gmail/mailbox-thread-actions.ts` (new)
- `backend/src/integrations/gmail/mailbox.integration.test.ts`
- `backend/src/integrations/gmail/scheduled-mailbox.service.ts`
- `backend/src/integrations/gmail/scoped-mailbox.integration.test.ts`
- `frontend/src/features/tenant/inbox/services/email-html.test.ts`
- `frontend/src/features/tenant/inbox/services/email-html.ts`
- `frontend/src/features/tenant/inbox/services/email-presentation.ts` (new)
- `frontend/src/features/tenant/inbox/services/gmail.service.ts`
- `frontend/src/features/tenant/inbox/ui/compose-modal.tsx`
- `frontend/src/features/tenant/inbox/ui/compose-schedule.test.tsx`
- `frontend/src/features/tenant/inbox/ui/email-conversation-view.test.tsx` (new)
- `frontend/src/features/tenant/inbox/ui/email-conversation-view.tsx`
- `frontend/src/features/tenant/inbox/ui/email-detail-view.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-email-list.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-page.tsx`
- `frontend/src/features/tenant/layout/topbar.tsx`
- `shared/src/contracts/mailbox.contract.ts`
- `docs/messages-work-email.md`
- `docs/inbox-conversation-production-report.md` (this report)
