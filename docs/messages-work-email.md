# Messages work email: implementation and verification

## Delivery status

The delivery and verification observations dated 2026-10-01 below are historical, not current deployment evidence. The latest list threading, refresh, unread-count and attachment changes are recorded in [Inbox threading and refresh report](inbox-threading-refresh-report.md). The earlier conversation detail and scope audit is retained in [Inbox conversation production report](inbox-conversation-production-report.md). The approved reply-recency rules below supersede the original semantic classification and email-driven Deal automation.

Implemented on 2026-10-01. The changes extend the existing Gmail integration, CRM status adapter, Deal transitions, activity timeline, permissions, and dialog components. The Render deployment applied `20261018000000_mailbox_engagement` successfully; the frontend and backend were deployed.

Google project `leadcrm-510308` has Gmail API enabled and an External/Testing web OAuth client. The production redirect URI is `https://leadcrm-backend-os8d.onrender.com/api/v1/integrations/gmail/callback`. Consent completed for the explicitly approved test mailbox. Real Gmail profile, Inbox, All conversations, Sent and thread reads succeeded. Initial sync had saved 320 messages at verification and was continuing through older mail. Complete initial sync, live refresh after token expiry and sending: **I cannot confirm this.** No send test was performed.

On 2026-10-01, all six Gmail-related values in local `backend/.env` were compared securely with Render and made identical, including the production callback and frontend origin. The existing encryption key was preserved. This local configuration therefore returns OAuth to the deployed frontend; use the separately registered localhost callback and local frontend origin when intentionally switching back to local development.

Intermittent Google HTTP 403/400 responses were observed in production logs; their original provider reason was not retained. Read requests now use bounded retries for rate limits and transient server errors, sanitized actionable errors, and five-message batches. All conversations correctly uses the messages endpoint when its query excludes drafts. Verification after these fixes: 91 mailbox/engagement tests passed on an isolated PostgreSQL database, backend build passed, and frontend type checking passed.

## Mailbox connection and deployment configuration

The provider is **Gmail API with Google OAuth**, including Google Workspace mailboxes. Staff connect the email address belonging to their existing LeadCRM employee account. An arbitrary personal account or another employee's mailbox is rejected. A backend-configured, temporary test exception is described below. Existing application sign-in behavior was not redesigned.

### Temporary personal-mailbox testing

`GMAIL_TEST_MAILBOX_OVERRIDE` is optional backend-only JSON with exactly `userId`, `tenantId`, `staffEmail`, `mailboxEmail`, `startsAt`, and `expiresAt`. IDs must identify one existing staff account; addresses must be exact emails; timestamps must be UTC ISO strings. The interval must be no longer than seven days. Leave this empty by default and keep real mappings in backend `.env` / Render environment variables.

The exception applies only to that staff user in that tenant during the specified interval. Google consent, session/state/PKCE validation, employee login, RBAC, encryption and existing mailbox-history restrictions still apply. The approved mailbox becomes the Google login hint. Connection audit records identify temporary test access and its expiry. Removing the variable or reaching expiry blocks new sync/send/provider access and reports disconnected; saved CRM history is retained. Staff may disconnect to clear locally stored provider tokens. Previously imported email activity remains in the CRM and Google permission can also be revoked in the user's Google account.

Backend configuration:

| Setting | Required value |
| --- | --- |
| `GMAIL_CLIENT_ID` | Google OAuth web application client ID |
| `GMAIL_CLIENT_SECRET` | Secret for that same client; backend environment only |
| `GMAIL_REDIRECT_URI` | Public backend URL ending in `/api/v1/integrations/gmail/callback` |
| `APP_URL` | Public frontend origin used to return to `/inbox` |
| `ENCRYPTION_KEY` | Existing 32-byte encryption key, encoded as 64 hexadecimal characters |
| Frontend server `API_URL` | Backend base URL including `/api/v1`, used by the existing proxy |
| `NEXT_PUBLIC_USE_MOCK_DATA` | `false` for the connected application |

Register the **exact** `GMAIL_REDIRECT_URI` on the same Google OAuth client, enable Gmail API, and configure the consent screen for the intended staff audience. The local example is `http://localhost:4000/api/v1/integrations/gmail/callback`. Production requires HTTPS. The screenshot's `redirect_uri_mismatch` requires the deployed environment and Google registration to agree, including scheme, host, port, and path. See [Google's web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

Keep the existing encryption key when deploying; changing it makes existing encrypted tokens unreadable. No raw email passwords are requested or stored. Access tokens, refresh tokens, and temporary PKCE verifiers use the existing backend AES-256-GCM encryption service. No provider credentials are returned to the frontend or kept in localStorage.

OAuth uses an opaque, random, one-use state with a ten-minute expiry, a hashed session binding, and PKCE. The callback verifies the still-active staff session, workspace access, permissions, and Google email identity. Provider errors are sanitized; provider tokens and email bodies are not added to application logs.

After deployment configuration, apply the additive migration with the existing deployment command:

```sh
npm --prefix backend run db:deploy
```

Then build/start the frontend and backend using the existing [architecture](ARCHITECTURE.md). The persistent backend starts the mailbox scheduler at startup, checks its queue every ten seconds, and honors `GMAIL_SYNC_INTERVAL_SECONDS` for each mailbox. Database leases prevent duplicate work. The browser consumes authenticated SSE and persisted data; it does not poll Gmail. **Sync now** requests backend work.

The existing Gmail scopes are retained: `gmail.readonly`, `gmail.send`, `gmail.modify`, and `userinfo.email`. Consent must include `gmail.modify` and offline access. Google consent-screen approval and Workspace administrator policies remain external configuration requirements.

## Conversation sync, ownership, and CRM matching

Normal Inbox, Unread and Sent views return one row per authorized Gmail conversation, grouped by the connected account's provider thread ID. Search matches any eligible message and returns the conversation's latest eligible activity. Subject/sender similarity never merges threads. Header and navigation badges count **conversations containing at least one unread incoming message addressed to the connected mailbox**. Drafts and scheduled delivery entries remain separate editable/queued items, excluded from conversation and unread counts.

Conversation pages use opaque cursors ordered by latest activity and thread ID (unread first when selected). Refresh reads persisted application data with the existing list-area spinner and preserves cached rows on transient failure. Sync now invokes the existing provider worker path. Authenticated SSE and existing fallback reads update conversations without starting another provider sync. Attachments download only after current source-message authorization, with another check after the provider read. Remote images and executable HTML remain blocked.

- Initial sync uses bounded queries for exact fixed senders and current assigned Lead/Contact addresses. Drafts, spam, and trash are excluded from automation.
- Incremental sync checks History message metadata against current scope before fetching full content. Expired History returns to bounded scoped reconciliation, never an unscoped mailbox rescan. Saved history is retained.
- Database leases prevent simultaneous workers from advancing the same mailbox cursor. A page is acknowledged only after ingestion succeeds; unfinished pages resume later.
- Original Gmail timestamps and inbound/outbound direction are preserved. The connected staff mailbox is the sender for compose/reply. Replies use the original thread and RFC message references.
- **Outbound:** sender equals the connected mailbox. **Inbound:** external sender addresses that mailbox in To/Cc. Other staff/internal or uncertain direction is excluded from customer automation.
- Addresses are trimmed, lowercased, and extracted from display-name wrappers. Matching requires normalized equality within the tenant. Names and guessed Gmail aliases are never used.
- Multiple matching Leads/Contacts or multiple external participants leave the message unlinked. A converted Lead pointing to the same matching Contact resolves to that Contact instead of becoming a false duplicate.
- Linked messages create an email activity with original time, direction, provider message/thread IDs, and mailbox owner. The Messages thread links to the authorized CRM record and Deal.
- Inbox, thread view, search, category navigation, Sent/All views, reply, archive, trash, and drafts use the existing UI patterns. Draft IDs are handled separately from message IDs.

## Exact customer-status rules

Public contracts, UI labels, and history use exactly **Hot, Warm, Cold, Closed, Cancelled**. The existing uppercase Contact database enum is retained behind its adapter; no new uppercase public status values or duplicate database statuses were introduced.

Engagement runs entirely on the backend using actual customer reply recency. It does not infer sentiment, intent, purchase readiness, cancellation, or Deal stages from message text. Automated messages and staff sends are not customer replies.

| Status | Implemented rule |
| --- | --- |
| **Hot** | Actual customer reply 0–7 days ago. |
| **Warm** | Actual reply 8–29 days ago, or never replied and first outbound less than 30 days ago. |
| **Cold** | Actual reply 30+ days ago, or never replied and first outbound 30+ days ago. |
| **Cancelled** | Explicit CRM/business action; not inferred from email. |
| **Closed** | Existing CRM completion / confirmed Closed Won behavior only. |

Without email history, preserve the existing/default/manual status. A genuine new customer reply can immediately change Cold or Warm to Hot. Existing Closed/Cancelled and manual-change safeguards remain.

### Cold calculation and safeguards

Legacy engagement field names remain for historical compatibility. Current evaluation uses actual customer reply and first-outbound dates under the versioned recency rules. Staff follow-ups never reset the customer reply timer.

Opens, clicks, delivery, read state, viewing, and synchronization timestamps do not count as customer replies. Evaluation preserves the existing authorization and manual-status safeguards.

Cold never changes a Deal to Closed Lost. Email engagement changes only the customer status.

## Deal progression and multiple opportunities

Inbox ingestion, reading, sending, replies, archive/trash, and thread association do not change Deal stage, value, status, or Closed Won state. Automatic Deal-stage movement belongs to the Workflow module and its existing authorization and required-field checks.

Context selection prefers explicit thread association, then prior linkage, then a unique customer-owned open Deal. Multiple open Deals require staff selection. Backend validation requires current customer scope plus Deal view/edit permissions and an open Deal belonging to that customer. Repeating the same association does not duplicate its Activity. Historical terminal linkage remains intact.
## Closed Won confirmation

The existing shared Dialog is used when staff selects a Won stage. It requires:

- **Confirmation Type:** Approved Quotation, Signed/Approved Contract, Purchase Order Received, Order Confirmed, or Other.
- **Closed Won Date:** a valid date; the UI prevents future dates. Backend validation allows timezone-boundary tolerance of one day.
- **Note/reference:** optional, up to 2,000 characters; mandatory for Other.

Email content does not create purchase-readiness prompts or confirm a win. The backend independently validates the existing CRM confirmation flow; Inbox association does not invoke it.

Confirmation stores `closedAt` (the selected date), `wonConfirmationType`, `wonConfirmationNote`, `wonConfirmedById`, and `wonConfirmedAt`. The transition and related Lead/Contact → Closed updates run transactionally with Deal stage history and activity records. Deal value, product interests, and assignment are preserved. No payment confirmation is required.

## History, manual changes, and idempotency

Status changes, stage changes, win confirmation, cancellation, and manual thread association record concise business reasons using the existing Activity/DealStageHistory patterns. There is no hidden model reasoning.

Each mailbox has a unique `(accountId, providerMessageId)` key. Message ingestion and resulting CRM/history writes share a serializable transaction with retry handling. Email activity has a deterministic key from tenant, matched customer, RFC message ID, and direction, with a provider-ID fallback. This prevents repeated ingestion from duplicating history, including mail shared across staff mailboxes.

New activity must be newer than the connection/record creation, last manual status change, last evaluated customer event, and relevant stage/association change. The migration initializes barriers for existing records. Old mail is visible as history but does not immediately undo manual edits. Reprocessing an unchanged status/stage or confirming an already-won stage does not add a duplicate transition.

Disconnect clears encrypted provider credentials and sync leases while preserving saved messages, CRM records, and history. Sending remains successful if Gmail accepted the message but immediate CRM sync failed; the response marks sync pending so the UI does not invite a duplicate send.

## Actual API endpoints

Backend prefix: **`/api/v1`**. The frontend uses the existing **`/api/proxy`** forwarding layer.

| Method/path after prefix | Purpose |
| --- | --- |
| `GET /integrations/gmail/authorize` | Begin staff OAuth connection |
| `GET /integrations/gmail/callback` | Consume state/PKCE and connect mailbox |
| `GET /integrations/gmail/status` | Safe connection status and owner email |
| `GET /integrations/gmail/emails` | Mail listing/search/pagination |
| `POST /integrations/gmail/sync` | Resume a sync page and evaluate engagement |
| `GET /integrations/gmail/threads/:threadId` | Read current authorized persisted conversation; no provider resync |
| `PATCH /integrations/gmail/threads/:threadId/deal` | Save authorized manual Deal association |
| `POST /integrations/gmail/send` | Compose/reply with connected owner identity |
| `POST /integrations/gmail/disconnect` | Disconnect while preserving history |
| `POST /integrations/gmail/archive` | Archive selected messages |
| `POST /integrations/gmail/trash` | Move selected messages to Gmail trash |
| `POST /integrations/gmail/drafts` | Create/update a Gmail draft |
| `DELETE /integrations/gmail/drafts/:draftId` | Delete selected Gmail draft |
| `PATCH /crm/deals/:id/stage` | Existing stage action, now with structured confirmation |
| `PUT /crm/leads/:id`, `PUT /crm/contacts/:id` | Existing manual status edits and history |

Google endpoints used: `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `www.googleapis.com/oauth2/v2/userinfo`, and Gmail `https://gmail.googleapis.com/gmail/v1/users/me/` paths `profile`, `messages`, `messages/:id`, `threads/:id`, `history`, `messages/send`, `messages/:id/modify`, `messages/:id/trash`, `drafts`, and `drafts/:id`.

## Schema and security changes

Migration: **`backend/prisma/migrations/20261018000000_mailbox_engagement/migration.sql`**.

- New `MailboxOAuthState` and `MailboxMessage` tables with indexes, message uniqueness, direction constraint, and mailbox foreign key.
- Lead/Contact engagement timestamps; Contact manual-status timestamp.
- Deal stage-change and win-confirmation fields.
- EmailAccount lease, pagination, baseline-history, and error fields; existing cursor/token fields reused.
- Existing business records and stage IDs are retained. Migration replay succeeded on disposable databases; production data was not migrated during this work.

Mailbox endpoints enforce authentication, tenant readiness, active staff/mailbox ownership and existing Leads/Contacts view permissions. Current assignments define scope even for Client Admin. Send, draft and schedule require the matching Lead/Contact edit permission for every recipient; thread association requires Deal view/edit. Scheduled delivery rechecks current authorization. No new permission key is introduced.

Token refresh cannot reactivate a concurrently disconnected mailbox. Shared schemas validate send headers and confirmation values. Received HTML uses DOMPurify with an allowlist; scripts, remote images, tracking pixels, and unsafe markup are removed. API responses containing mailbox data use `Cache-Control: no-store`.

Unsupported attachment/image selection has been removed. Schedule Send is implemented with persistent server/Gmail drafts and the shared Manila picker. Ordinary compose, reply, forward, and drafts use the existing composer.

## Historical verification on 2026-10-01 (not current acceptance)

| Check | Result |
| --- | --- |
| `node backend/scripts/test-mailbox-db.mjs` | **54 passed**, two files; unit rules plus authenticated HTTP/database integration against simulated Gmail |
| `node backend/scripts/test-single-workspace.mjs sales` | **28 passed** |
| `CRM_TEST_POSTGRES_PORT=55448 node backend/scripts/test-single-workspace.mjs account` | **14 passed**, three files, isolated PostgreSQL 17 database |
| Three focused Contact conversion test files | **13 passed** |
| Closed Won dialog, email HTML sanitizer, panel migrations, CRM status forms | **40 passed**, four frontend files, executed in two runs |
| `npm run lint` | **Passed**, all three workspaces; these scripts run TypeScript checks |
| `npm --prefix backend run build` | **Passed**, including Prisma generation |
| `npm --prefix frontend run build` with mock data disabled | **Passed**, 188 pages generated |
| `git diff --check` | **Passed** |

Total passing tests in the focused suites above: **149**. The full repository test suite was not run.

The account suite initially produced 13 passes and one import timeout using PGlite's single connection. The existing tenant validation requests a second connection inside that import transaction. The same suite passed all 14 tests on disposable native PostgreSQL; unrelated tenant/auth middleware was left intact. Initial build attempts also encountered Windows sandbox/file-lock issues; the successful builds above completed after those were resolved. Next.js reported existing multiple-lockfile/environment warnings.

Browser verification used the production frontend build and real authenticated backend against a disposable fixture. It checked connected identity, inbox/thread direction, CRM links, Qualified/Hot engagement, structured win validation, successful win history, preserved value/product/agent, and disconnect/history preservation. No real email was sent.

Responsive checks covered **1440, 768, 320, 375, and 390 px** for connection, inbox, conversation, compose, and Closed Won UI. No page-level horizontal overflow was observed. The compose toolbar and link/emoji popups were additionally checked at 320 px. Evidence is saved under `data/outputs/messages-verification/`.

Live Google connection/delivery, production configuration/migration, all possible customer language, and a full production data migration rehearsal: **I cannot confirm this.**

## Files changed

The complete file inventory is in [messages-work-email-files.txt](messages-work-email-files.txt). Main groups:

- `shared/src/contracts/mailbox.contract.ts`, `shared/src/index.ts`: shared confirmation/email contracts.
- `backend/.env.example`, Prisma schema/migration: configuration and additive persistence.
- `backend/src/integrations/gmail/`: OAuth, sync, ingestion, classification, provider operations, and tests.
- `backend/src/api/routes/integrations.routes.ts`, `core/tenant/tenant-models.ts`, `server.ts`: permissions, tenant model registration, and worker startup.
- CRM engagement helper, Leads/Contacts repositories/services, Deal repository/service/DTO, bulk/import guards, and pipeline repository: canonical transitions and history.
- Inbox domain components/services, shared Closed Won dialog, DataContext, and Deal API/pipeline service: connection, conversations, responsive UI, and confirmed stage changes.
- Focused test files and disposable preview/test runners; verification screenshots and measurements.

No unrelated module redesign, new provider dependency, or application sign-in redesign was introduced.
