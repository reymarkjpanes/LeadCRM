# Inbox threading and refresh implementation report

Implemented and verified locally on 2026-10-09 (Asia/Manila). This report supersedes the message-list limitations in the earlier [conversation detail audit](inbox-conversation-production-report.md). Production deployment, production migration and real Gmail acceptance were not performed. **I cannot confirm production readiness.**

## 1. Existing Inbox audit findings

Gmail already supplied `threadId`, and `MailboxMessage` already stored it alongside the stable `(accountId, providerMessageId)` unique key. The detail endpoint already selected authorized messages from a thread. The list endpoint instead counted, sorted and paginated individual messages; the frontend rendered each returned message as a row. Incoming and outgoing replies therefore appeared separately even with the correct saved thread ID. Frontend-only grouping of a page would have left counts, search and pagination incorrect.

Refresh already reread persisted application data and preserved transient-failure cache, but only animated its toolbar icon. Its initial loader replaced the list component, including the toolbar. Unread endpoints counted individual rows, including outgoing UNREAD labels. Bulk selection sent latest message IDs, rather than all applicable conversation messages. Reply All and attachment downloads were absent in this checkout.

## 2. Threading implementation

Normal All, Unread and Sent lists now aggregate authorized, non-draft messages by the connected Gmail account's provider thread ID. No sender, recipient or subject heuristic is used. Two matching subjects or senders with different provider threads remain separate. Current tenant, account ownership, exact approved senders, assignments and excluded labels are applied **before** grouping, search, counts or pagination. A known thread ID never grants access to another message.

Each row carries its latest eligible message identity, subject, preview and timestamp; unique sender names (with the connected mailbox shown as You); authorized message count; and conversation read state. An outbound-only conversation also includes its recipient names. The existing row structure, classes and layout are retained, with a compact count after participants.

Chronological detail reads retain original bodies, From/To/Cc, timestamps, CRM context and sanitizer behavior, with provider message ID breaking timestamp ties. Reply and Reply All use the existing composer and every-recipient backend checks. Reply All removes the connected mailbox and duplicate addresses, and places recipients in the existing To field; it does not introduce a CC composer. Replies/drafts preserve provider thread ID, In-Reply-To and the retained References chain. Legacy missing reply headers can be recovered from that authorized message's provider metadata; unavailable/unverified headers produce an actionable error. Subject changes on a reply are rejected before sending because Gmail requires matching subjects for threading. New Compose supplies no thread ID or reply headers.

This follows [Gmail's authoritative threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads). Stored provider IDs remain authoritative on send and ingestion. Repeated ingestion updates metadata and labels without rewriting original bodies or duplicating message/history records. Reconnection reuses the existing account association; it does not create new conversation identities.

## 3. Refresh loading changes

Manual Refresh renders the existing `Loader2`, at its existing `h-5 w-5 animate-spin` size/style, centered in the list content **below the visible toolbar**. Inbox heading, connected mailbox card, search, Filter, Sort and pagination remain present. A synchronous request guard plus existing list-request deduplication prevents duplicate clicks. Busy controls cannot overlap refresh, synchronization or disconnect operations.

Loaded conversations stay in state during refresh. On transient failure, loading ends, the error appears in the existing alert area and cached rows return. An initial failure is not presented as “No emails found.” Authorization failures revoke the cached content. Automatic SSE refreshes remain quiet and retain existing rows while fetching. Sync now invokes the existing provider synchronization/lease path, with independent progress/errors and provider retry time; Refresh never starts a duplicate Gmail sync. Disconnect remains a separate guarded operation.

## 4. Backend queries and APIs

- `GET /integrations/gmail/emails`: database conversation aggregation for All/Unread/Sent; latest eligible message and participant/count metadata; literal message-level search; opaque conversation cursors. Drafts and scheduled jobs retain their existing separate item semantics.
- `GET /integrations/gmail/unread-count`: unread **conversation** count, explicitly labeled `unreadCountUnit: conversations`. All list responses use that same unit. A conversation is unread when an eligible non-draft incoming message addressed to the connected mailbox has UNREAD. Outgoing labels do not create unread conversations. Existing header-to-navigation unread events carry the same count.
- `POST /integrations/gmail/archive` and `/trash`: accept the shared strict `{ threadIds }` contract and resolve all current applicable message IDs on the server. Existing `{ messageIds }` clients remain compatible. Every selected conversation is validated before a provider mutation; drafts and unauthorized same-thread messages are excluded. Partial successful provider writes still update the saved revision.
- `GET /integrations/gmail/messages/:messageId/attachments/:attachmentId`: requires an authorized source message and a matching retained attachment ID, then rechecks access after Gmail returns. Downloads use attachment disposition, generic binary content type, no-store and a 35 MiB bound. The existing proxy preserves binary bytes and disposition.

Aggregation follows the repository's existing explicitly scoped dashboard-query pattern without weakening the normal tenant raw-query guard. The list query selects metadata; CRM decoration selects only link/direction fields, never bodies. Search may inspect bodies within the database, but bodies are not fetched to render list rows. There is no query per conversation. Existing tenant/account/thread/date and recipient indexes are reused.

Sorting uses latest eligible activity, then thread ID. Unread-first adds unread state before latest activity. Cursors carry the ordering anchor and bind to account, assignment scope, filter, sort and query. New conversations above an anchor do not shift subsequent pages as offset pagination would. Invalid assignment cursors reset to the first authorized page. A scope change between selection and decoration rejects the response. Existing SSE, visibility refresh and fallback infrastructure is reused; no additional polling or subscriptions were introduced.

## 5. Database impact

New additive migration: `backend/prisma/migrations/20261114000000_mailbox_thread_metadata/migration.sql`.

It adds only `MailboxMessage.rfcReferences` (empty text array) and `MailboxMessage.attachments` (empty JSON array). It does not delete, merge, rename or recreate any messages, account IDs, provider/thread identifiers, bodies, attachments in Gmail, CRM links, activities or sales history. Existing thread relationships require no guessed backfill. Header/attachment metadata is populated only from later authorized provider ingestion; historical absence is not invented. Attachment bytes remain with Gmail and are fetched only on download.

Prisma generation completed. Full forward migrations were replayed in disposable databases. The migration preservation check confirmed all original message/body/identifier/link/account values, empty metadata defaults, send-receipt uniqueness and tenant foreign keys. Production must use the existing backup/verified-forward-migration deployment process before starting the backend that expects these fields. No production database was changed.

## 6. Security verification

Executed integration coverage verifies exact fixed senders, current Lead/Contact assignment and view permissions, staff-owned connected accounts, Client Admin without mailbox-wide bypass, tenant and other-mailbox isolation, archived/reassigned/deleted/converted/invalid-email revocation, unauthorized search matches, direct thread access and mutations, saved/scheduled source authorization and provider metadata gating. Matching unauthorized messages in a visible thread cannot contribute subject, body, preview, participants, count or unread state.

Attachment tests verify retained metadata, byte-accurate authorized download, unknown attachment rejection, revocation before a provider call, and reassignment during an in-flight provider read. Provider writes are never used to mutate a whole Gmail thread containing potentially ineligible correspondence. OAuth, encrypted tokens, session binding, tenant middleware, permission keys and exact sender rules remain intact. HTML remains sanitized; scripts, remote images and tracking content remain blocked.

## 7. Files modified

Backend and shared source:

- `shared/src/contracts/mailbox.contract.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261114000000_mailbox_thread_metadata/migration.sql` (new)
- `backend/src/api/routes/integrations.routes.ts`
- `backend/src/integrations/gmail/gmail.controller.ts`
- `backend/src/integrations/gmail/gmail.service.ts`
- `backend/src/integrations/gmail/gmail.types.ts`
- `backend/src/integrations/gmail/mailbox-attachments.ts` (new)
- `backend/src/integrations/gmail/mailbox-conversations.ts` (new)
- `backend/src/integrations/gmail/mailbox-ingestion.service.ts`
- `backend/src/integrations/gmail/mailbox-scope.ts`
- `backend/src/integrations/gmail/mailbox-store.ts`
- `backend/src/integrations/gmail/mailbox-sync.service.ts`
- `backend/src/integrations/gmail/mailbox-thread-actions.ts`

Frontend source:

- `frontend/src/features/tenant/inbox/services/email-presentation.ts`
- `frontend/src/features/tenant/inbox/services/gmail.service.ts`
- `frontend/src/features/tenant/inbox/ui/email-conversation-view.tsx`
- `frontend/src/features/tenant/inbox/ui/email-detail-view.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-email-list.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-page.tsx`

Verification and documentation:

- `backend/scripts/test-mailbox-db.mjs`
- `backend/scripts/verify-mailbox-browser.mjs`
- `backend/scripts/verify-mailbox-header-migration.mjs`
- `backend/src/integrations/gmail/mailbox.integration.test.ts`
- `backend/src/integrations/gmail/scoped-mailbox.integration.test.ts`
- `frontend/src/features/tenant/inbox/ui/email-conversation-view.test.tsx`
- `frontend/src/features/tenant/inbox/ui/inbox-email-list.test.tsx` (new)
- `frontend/src/features/tenant/inbox/ui/inbox-page.test.tsx`
- `docs/messages-work-email.md`
- `docs/inbox-threading-refresh-report.md` (new)

Three existing mailbox sales-test assertions were updated to compare against initial Deal history rather than assuming zero rows, and reply fixtures now retain the source subject. No CRM implementation or global navigation source was changed. Generated logs/screenshots remain ignored.

## 8. Tests actually executed

| Check | Result |
| --- | --- |
| `node backend/scripts/test-mailbox-db.mjs` | 131 passed: 25 engagement, 32 mailbox/HTTP, 74 scoped mailbox/threading/attachment/send/schedule tests; three disposable databases and full migration replay. |
| Backend Gmail read/ownership and Workflow condition/input-security regression tests | 67 passed in four files. |
| Frontend Inbox, CRM email timeline and API proxy tests | 85 passed in eight files, including spinner success/failure, duplicate clicks, cached recovery, page chrome, cursor recovery, participant/count display, conversation selection, Reply All and attachment links. |
| `node backend/scripts/verify-mailbox-header-migration.mjs` | Passed; original data and safe defaults preserved. |
| `npm run lint` | All three workspaces passed TypeScript checks. |
| `npm run build -- --env-mode=loose` | Full three-workspace build passed with a temporary build-only HTTPS API_URL; environment files were not changed. |
| `git diff --check` | Passed. |
| Local headless browser acceptance | 40 checks passed at 1440, 1024, 768, 390, 375 and 320 px: list/detail/composer layout, refresh spinner placement and cached recovery, two-session same-thread SSE updates and scheduled-send regression. Zero page or transport errors; simulated Gmail, no real email sent. |

Windows sandbox temp-file/cache restrictions prevented initial Vitest, Prisma and Turborepo runs. Authorized retries outside the sandbox executed the checks. An initial build also rejected the local HTTP API_URL; the successful build used the reserved `https://build-verification.example.invalid/api/v1` solely for configuration verification, without production requests. Earlier browser runs exposed a duplicate alert locator, which was scoped to the actual Inbox error.

## 9. Remaining limitations and release gates

- Production migration, paired frontend/backend deployment, authenticated production mailbox acceptance, Gmail OAuth/reconnect acceptance and real Reply/Reply All delivery remain unverified. **I cannot confirm this.** Local simulated-provider tests do not establish production readiness.
- Historical attachment/References metadata stays empty until qualifying authorized sync obtains it. Legacy reply Message-ID metadata can be recovered on demand; no broad mailbox backfill or guessed thread merge occurs.
- Attachment downloads cover provider parts with attachment IDs. Compose file uploads and automatic reattachment on Forward were absent and remain unsupported; no selected upload is silently omitted. Remote inline images remain blocked by the established renderer.
- The All emails view continues to include authorized archived correspondence. Archive removes INBOX rather than deleting stored history; this preserves the existing filter semantics.
- Pagination is a live activity cursor, not a frozen mailbox snapshot. Conversations receiving replies move toward the front. Sorting/filtering restarts pagination; assignment changes invalidate old scope cursors.
- This local acceptance report was recorded before the subsequent commit/push request. Publishing results are reported separately; production deployment remains unverified. Full unrelated monorepo test suites and a production-scale mailbox benchmark were not run.
