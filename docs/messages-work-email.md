# Messages work email: implementation and verification

## Delivery status

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

Then build/start the frontend and backend using the existing [architecture](ARCHITECTURE.md). The backend's persistent Node process starts mailbox sync at startup and every five minutes. Messages also requests sync while open, every minute, and exposes **Sync now**. A serverless deployment that does not run this Node process would need an equivalent scheduled worker; that hosting arrangement was not verified here.

The existing Gmail scopes are retained: `gmail.readonly`, `gmail.send`, `gmail.modify`, and `userinfo.email`. Consent must include `gmail.modify` and offline access. Google consent-screen approval and Workspace administrator policies remain external configuration requirements.

## Conversation sync, ownership, and CRM matching

- Initial sync scans mail in bounded pages and expands threads so earlier outbound context is available before replies are classified. Drafts, spam, and trash are excluded from automation.
- Incremental sync uses Gmail history IDs. An expired history cursor triggers a full rescan without deleting saved messages or CRM history. This follows [Google's synchronization guidance](https://developers.google.com/workspace/gmail/api/guides/sync).
- Database leases prevent simultaneous workers from advancing the same mailbox cursor. A page is acknowledged only after ingestion succeeds; unfinished pages resume later.
- Original Gmail timestamps and inbound/outbound direction are preserved. The connected staff mailbox is the sender for compose/reply. Replies use the original thread and RFC message references.
- **Outbound:** sender equals the connected mailbox. **Inbound:** external sender addresses that mailbox in To/Cc. Other staff/internal or uncertain direction is excluded from customer automation.
- Addresses are trimmed, lowercased, and extracted from display-name wrappers. Matching requires normalized equality within the tenant. Names and guessed Gmail aliases are never used.
- Multiple matching Leads/Contacts or multiple external participants leave the message unlinked. A converted Lead pointing to the same matching Contact resolves to that Contact instead of becoming a false duplicate.
- Linked messages create an email activity with original time, direction, provider message/thread IDs, and mailbox owner. The Messages thread links to the authorized CRM record and Deal.
- Inbox, thread view, search, category navigation, Sent/All views, reply, archive, trash, and drafts use the existing UI patterns. Draft IDs are handled separately from message IDs.

## Exact customer-status rules

Public contracts, UI labels, and history use exactly **Hot, Warm, Cold, Closed, Cancelled**. The existing uppercase Contact database enum is retained behind its adapter; no new uppercase public status values or duplicate database statuses were introduced.

Classification runs entirely on the backend. It uses conservative English rules, not an AI model. It strips quoted/forwarded text and signatures, ignores automated responses, and abstains on ambiguous, conditional, reported, or negated purchase language. Unsupported wording or languages remain unchanged for manual review. This is intentionally not a claim of universal natural-language accuracy.

| Status | Implemented rule |
| --- | --- |
| **Hot** | Explicit purchase/proceed/approval statement with business context, such as “We approve the quotation and will proceed.” Questions, tentative language, and generic positivity do not qualify. |
| **Warm** | Meaningful product questions, requests for information or formal quotes, discussion of requirements, comparison of options, or explicitly still deciding. A quote request can remain Warm. |
| **Cold** | Current Warm/Hot record, at least 60 days since meaningful inbound customer activity, plus a product-related outbound message after that activity that has remained unanswered for at least 30 days. |
| **Cancelled** | Explicit customer rejection/cancellation, such as declining a proposal or asking to stop an order. Elapsed time never produces Cancelled. |
| **Closed** | Staff completes the structured Closed Won action for a related Deal. Email classification cannot produce Closed. |

“Thanks,” “Noted,” “I'll check,” “Maybe,” and “Let me ask my manager” do not produce strong automatic changes. An interested reply does not downgrade Hot. Closed and Cancelled are protected from ordinary later mail; Cold can become Warm or Hot from a meaningful new response.

### Cold calculation and safeguards

`lastMeaningfulInboundAt` records a recognized, meaningful customer response. `firstUnansweredOutboundAt` records the first subsequent product-related staff email. Repeated follow-ups do not reset either timestamp. A new meaningful inbound response clears the unanswered timestamp.

Cold requires both the 60-day inbound interval and the 30-day unanswered outbound interval. This avoids marking someone Cold merely because staff stopped writing. It also requires completed incremental sync and fresh coverage from the linked mailboxes: disconnected, failed, paginating, or more-than-24-hour-stale coverage prevents the change. A newer manual status change blocks this automated inactivity change.

Cold never changes a Deal to Closed Lost. It remains Cold until a meaningful re-engagement, explicit cancellation, manual edit, or confirmed win changes the status.

## Deal progression and multiple opportunities

- New automatically created and manually created Deals start in **Lead**. Duplicating a Deal creates a new Lead-stage opportunity and preserves the old record.
- Meaningful inbound response with prior product-related outbound mail in the thread advances Lead to **Contacted**. Sending alone does not qualify.
- Explicit quotation, proposal, contract/agreement, final/formal pricing, purchase terms, or scope-of-work requests advance an open Deal to **Qualified**. Clear proceed intent also qualifies an open Deal and may set CRM status Hot.
- Generic product questions do not produce Qualified.
- Automatic updates only progress Lead → Contacted → Qualified. Target-stage required fields still apply. Unrecognized/custom or ambiguous stage configurations are left unchanged.
- Existing terminal stage flags/IDs are reused, including legacy Won/Lost names. New default pipelines use Lead, Contacted, Qualified, Closed Won, Closed Lost. No duplicate Won/Closed Won or Lost/Closed Lost stages are inserted.
- Closed Won and Closed Lost remain terminal. A new opportunity requires a new Deal. Old messages cannot reopen a historical Deal or regress Qualified to Contacted.

Deal selection prefers an explicit thread association, then prior thread linkage, then exactly one open Deal. Historical terminal linkage never falls through to a new unrelated opportunity. With multiple open Deals and no clear association, stages remain unchanged and Messages offers a staff Deal selector. The selector only permits an open Deal belonging to the matched customer, requires Deal edit permission, records an activity, and applies to future messages. Product names are not guessed from free text.

An explicit cancellation email sets the matched customer's status to Cancelled and closes only its resolved open Deal as Closed Lost. If the Deal is ambiguous, its stage stays unchanged. A deliberate manual customer cancellation synchronizes related open Deals through the shared cancellation function. Terminal Deals remain untouched. Closed Lost includes a business reason and stage/activity history; Cold never invokes this function.

## Closed Won confirmation

The existing shared Dialog is used when staff selects a Won stage. It requires:

- **Confirmation Type:** Approved Quotation, Signed/Approved Contract, Purchase Order Received, Order Confirmed, or Other.
- **Closed Won Date:** a valid date; the UI prevents future dates. Backend validation allows timezone-boundary tolerance of one day.
- **Note/reference:** optional, up to 2,000 characters; mandatory for Other.

Positive email intent can display “This deal may be ready to close.” It leaves the Deal Qualified and never calls the win transition itself. The backend independently validates confirmation; bypassing the dialog, bulk updates, imports, and direct creation cannot silently create a confirmed win.

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
| `GET /integrations/gmail/threads/:threadId` | Read and ingest a conversation |
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

Mailbox endpoints enforce existing authentication, tenant readiness, employee access, active-account checks, and `contacts.view`. Mailbox identity comes from the authenticated user, never a caller-selected owner. Automation requires `contacts.edit`; Deal automation also requires Deal permissions. Manual thread association requires `deals.edit`. Scheduled runs recheck access instead of retaining stale privileges.

Token refresh cannot reactivate a concurrently disconnected mailbox. Shared schemas validate send headers and confirmation values. Received HTML uses DOMPurify with an allowlist; scripts, remote images, tracking pixels, and unsafe markup are removed. API responses containing mailbox data use `Cache-Control: no-store`.

Existing attachment/image upload and scheduled-send controls had no completed delivery implementation. They are disabled with explanatory labels instead of pretending to send those features. Ordinary message compose, reply, and drafts remain available.

## Verification actually performed

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
