# Inbox correspondent grouping implementation and verification

Date: 2026-10-10. Repository: LeadCRM, local `main`, based on `a3378cda52d21170a2f78872fd85c4071718538a`.

The local implementation consolidates authorized one-to-one mail across original Gmail threads by exact correspondent address. Existing message records and provider identities remain intact. Local automated and browser evidence is described below. **I cannot confirm production readiness:** the new changes have not been published or deployed, and real Gmail acceptance has not been performed.

## 1. Root cause

The previous persisted Inbox query aggregated eligible records by Gmail `threadId`. The frontend correctly displayed those summaries, so separate topics from Doris or repeated Welcome/Reset messages produced separate rows even when the exact external address matched. Consolidating only a frontend page would have produced incorrect pagination, search, and unread totals.

## 2. Existing Gmail thread grouping

Gmail thread IDs remain authoritative for provider conversations. Existing thread reads, thread associations, reply source lookup, and message IDs remain supported. The change adds an independent correspondent identity above that provider layer. It does not rewrite thread IDs, merge provider threads, concatenate bodies, recreate records, or delete historical CRM activities.

## 3. Correspondent identity

Authorization runs before identities are derived. The implementation reuses ingestion's validated, trimmed, lowercase `fromAddress` and `recipientAddresses`, including Cc, and excludes the connected mailbox's exact address.

For an authorized original thread containing one distinct external address, the identity is the exact address. Inbound sender and outbound external recipient resolve to that same address. Its stable `c_…` identifier includes tenant ID, connected account ID, identity kind, and address. Display names remain presentation metadata. Different addresses with the same name, addresses from the same domain, and unverified aliases remain separate.

Threads with several external participants, or without a usable external address, receive a separate account-scoped group identity based on their original provider thread. Later replies addressed to fewer participants remain in that topic's group. Group identities do not depend on display names or subject lines. The compact hash is an identifier, not an authorization credential; every endpoint recomputes scope.

## 4. Backend aggregation

`GET /api/v1/integrations/gmail/emails` returns correspondent summaries for All, Unread, and Sent. A database CTE first restricts messages to the authenticated tenant/account and current assigned Lead/Contact or approved fixed-sender scope, excluding drafts and unsupported labels according to existing policy. It then resolves identities, counts all eligible messages, calculates incoming unread status, finds latest activity, and paginates groups.

The page's latest subjects, previews, authors, recipients, and timestamps are resolved in the same SQL query. List aggregation projects metadata rather than loading every message body into application memory. No additional query is issued for each list row. Existing drafts, scheduled jobs, sync leases, provider reconciliation, and idempotent persistence remain in place.

## 5. Frontend list

Rows and selections use `conversationId`; the latest message still carries its real `id` and `threadId`. Existing list styling, toolbar, search, filters, sort controls, checkboxes, hover states, refresh feedback, pagination, and compose control are preserved. Participant names and `You` use authorized message metadata, and the count is the complete authorized history count. Counts remain visible when a long name is truncated, including a one-message history.

Existing legacy thread consumers and notification deep links remain compatible. A thread deep link opens that original topic; normal Inbox rows open consolidated history.

## 6. Consolidated detail

The new authenticated `GET /api/v1/integrations/gmail/conversations/:conversationId` returns up to 50 messages per page, a complete authorized count, a scope-bound continuation cursor, and batched per-topic Deal options. Additional history is available through Load more messages.

Original topics are ordered by their first authorized activity, then provider thread ID. Within each topic, messages are oldest first by original timestamp, with provider message ID as the tie breaker. Pagination may split a topic, but the frontend appends its messages without duplicating the topic heading.

Compact subject headings distinguish the original Gmail conversations. Each expanded message retains its own subject, sender, To/Cc, time, body, attachments, read state, provider IDs, RFC metadata, and authorized CRM associations. Existing message presentation is reused. Valid per-message Deal links remain distinct; stale or ambiguous links are not replaced with an invented group-wide Deal. Per-topic association uses the canonical Lead/Contact–Deal relations.

## 7. Reply and Reply All

Reply, Reply All, and Forward from an expanded message pass that message's actual provider ID. Backend reply validation loads its original thread ID, RFC Message-ID, and References, checks the reply subject and recipient scope, and sends through the connected mailbox. A correspondent ID is never passed as a Gmail thread ID. Compose without a reply source creates a new provider thread, then joins the eligible correspondent history after storage.

Automated tests verify replying to an older topic, outgoing request thread ID, RFC headers, Reply All recipients, stored reply identity, and independent Compose behavior using simulated Gmail responses. Browser checks verify the selected source and compose flows. Real Gmail's resulting threading and delivered recipients remain unverified. Gmail's documented threading requirements are described in the [official thread guide](https://developers.google.com/workspace/gmail/api/guides/threads).

## 8. Unread, search, sorting, and pagination

Unread status and topbar totals use the same backend correspondent identity. A group contributes one unread count if any eligible incoming message is unread; outgoing messages do not contribute incoming unread counts.

Opening consolidated history expands the latest loaded message. Only expanded unread messages are marked read through the new authenticated message read-state endpoint. Older collapsed unread messages retain their own state. Legacy thread views retain their established read behavior.

Search evaluates authorized sender/name/address, recipients, subject, snippet, and body. A matching message selects the complete authorized group once. Search never increases access or reduces the row's count to only matching messages. All, Unread, and Sent share the same grouping model; Drafts and Scheduled remain separate editable/queued items.

Newest, Oldest, and Unread first use actual timestamps and stable identity tie breakers. List cursors bind tenant, account, mailbox revision, assignment scope, search, filter, and sort. Detail cursors also bind the selected history. Activity or read-state changes invalidate stale cursors and trigger a reload instead of duplicating a group across pages.

## 9. Multiple participants and action scope

An original thread with multiple distinct authorized external participants is isolated as a group conversation. It is not duplicated into each person's private history, and it cannot merge unrelated one-to-one customer histories. Presentation includes original participant names and exact addresses, including participants absent from a later reply.

The action scopes are documented in the interface and [API reference](API.md):

| Control | Scope |
| --- | --- |
| Inbox selected-row Archive/Trash | All currently authorized non-draft messages across each selected correspondent history |
| Consolidated history toolbar Archive/Trash | All currently authorized non-draft messages across that history |
| Topic Archive/Trash icons | Currently authorized non-draft messages in that original Gmail thread |
| Expanded-message read update | That single authorized message |

Groups are resolved server-side, every selected group is validated before writes, and every individual message is reauthorized immediately before its provider mutation. Group selections above 1,000 messages are rejected before writing; topic controls remain available. Provider thread-wide mutation is not used. Successful partial progress updates mailbox revisions even if a later provider call fails. Archiving removes the INBOX label; the existing All history policy can retain archived messages. Trash excludes them from eligible reads. Neither action deletes CRM activities or mailbox history records.

## 10. Security, ownership, and real-time verification

Tenant and connected-account predicates remain explicit in raw aggregation. Bodies are fetched only for a bounded authorized detail page, rechecked through ORM scope, and decorated under current permissions. The endpoint checks account and assignment scope again before returning detail. Group keys and historical CRM links do not grant access.

Tests cover ownership loss, changed Lead/Contact assignment, duplicate CRM email identities, missing View permissions, tenant/account isolation, inaccessible historical threads, stale Deal membership, and permission revocation during bulk mutation. Frontend checks discard stale history responses and clear messages, topic metadata, and an open composer after authoritative access failures.

The existing incremental Gmail worker and authenticated database-revision events remain authoritative. New stored messages produce fresh summaries using the same identity; a new topic for the same person updates one row. Refresh reads persisted grouped data and preserves cached list data on transient errors. Sync now retains its distinct guarded operation. Two independent browser sessions received updates in local verification with simulated Gmail; no browser-triggered duplicate sync was observed.

## 11. Files modified

| Area | Files |
| --- | --- |
| Shared contract | `shared/src/contracts/mailbox.contract.ts`, generated `mailbox.contract.js` |
| Aggregation/detail/actions | `backend/src/integrations/gmail/mailbox-conversations.ts`, new `mailbox-correspondents.service.ts`, `mailbox-thread-actions.ts` |
| API transport | `backend/src/api/routes/integrations.routes.ts`, `backend/src/integrations/gmail/gmail.controller.ts`, `frontend/src/features/tenant/inbox/services/gmail.service.ts` |
| Provider/header preservation | `backend/src/integrations/gmail/gmail.service.ts`, `mailbox-ingestion.service.ts`, `mailbox-store.ts`, typed return in `mailbox-sync.service.ts` |
| UI | `frontend/src/features/tenant/inbox/ui/inbox-page.tsx`, `inbox-email-list.tsx`, `email-conversation-view.tsx`, `email-detail-view.tsx` |
| Database/guard | `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261121000000_mailbox_reply_header/migration.sql`, `backend/scripts/deploy-crm-imports.cjs` |
| Backend verification | `backend/src/integrations/gmail/scoped-mailbox.integration.test.ts`, `backend/scripts/verify-canonical-rollout.test.cjs`, `verify-mailbox-header-migration.mjs`, `verify-mailbox-browser.mjs` |
| Frontend verification | `frontend/src/features/tenant/inbox/ui/email-conversation-view.test.tsx`, `inbox-email-list.test.tsx` |
| Documentation | `docs/API.md`, this report |

## 12. Database changes

Correspondent grouping is derived from existing records and requires no stored grouping table or identity backfill.

The audit found that original RFC In-Reply-To was not persisted. One additive nullable `MailboxMessage.rfcInReplyTo TEXT` column preserves that provider header on ingestion and idempotent metadata replay. Existing records remain null until their original metadata is received through an authorized synchronization; historical reply headers are not guessed.

The migration adds one column and performs no drops, deletes, timestamp rewrites, body changes, or provider-ID changes. The guarded deployment runner explicitly allowlists this migration while retaining the independent relationship-retirement guard. Disposable database tests verify preservation. It has not been applied to the configured production database.

## 13. Tests executed and results

| Command/evidence | Result |
| --- | --- |
| `node backend/scripts/test-mailbox-db.mjs` | 148 passed: 25 engagement, 32 mailbox integration, 91 scoped mailbox tests, using disposable databases |
| Frontend Inbox Vitest suite | 69 passed, including 19 conversation-view tests |
| Selected Gmail ownership/read/auth and automation Vitest suite | 109 passed; 99 guarded integration cases skipped and not counted as verification |
| `npm --prefix backend run test:rollout` | 9 passed, including guarded migration planning and preservation checks |
| `npm run lint` | All three workspace TypeScript checks passed |
| `API_URL=https://api.lead-crm.tech/api/v1 npm run build` | All three workspace production builds passed; final backend/frontend builds ran and shared reused a successful cache entry |
| `node backend/scripts/verify-mailbox-browser.mjs` | Final run passed 40 checks at 1440, 1024, 768, 390, 375, and 320px with simulated Gmail; zero page/transport errors; zero browser sync calls |
| `git diff --check` | Passed, including API/report documentation |

The build requires the deployment-shaped HTTPS API URL override because the existing frontend production guard rejects the local HTTP development URL. No environment files were changed. Prisma's Windows engine lock occurred when a build overlapped database tests; the build passed after those tests exited. Existing Next.js workspace-lockfile and Vitest configuration warnings were not expanded into unrelated changes.

Browser evidence is saved outside the repository in `C:\Users\Julie Ann Tiron\.codex\visualizations\2026\10\10\01a1263a-d2ba-71e3-ab27-c2f04645d6e8\inbox-correspondents`, including `results.json`, desktop/mobile list and conversation screenshots, dark mode, compose, refresh, and scheduled-send screenshots. The local browser harness uses the compiled backend, a local frontend development server, disposable database fixtures, and simulated provider responses. Production build validation was run separately.

User acceptance scenarios A–L have local coverage:

| Scenario | Local evidence | Real provider/deployment status |
| --- | --- | --- |
| A: Four messages in one thread | Authorized count, chronology, unchanged thread IDs | Controlled Gmail exchange pending |
| B: Separate topics, same address | One group; separate subject blocks; topic reply targeting | Controlled multi-topic exchange pending |
| C: Same name, different addresses | Separate groups | Production acceptance pending |
| D: Duplicate CRM email records | No invented ambiguous association; assignment checks | Production acceptance pending |
| E: Different addresses | Separate histories | Production acceptance pending |
| F: Multiple external participants | Separate group and private histories; retained participants | Controlled group email pending |
| G: Repeated Welcome/Reset | One exact-address group; unchanged subjects/IDs | Actual authorized sender identities must be checked |
| H: Reply to older topic | Actual source message, original thread and RFC send headers | Real Gmail thread placement/delivery pending |
| I: Unread groups | Incoming-only group totals; isolated message read state | Deployed topbar reconciliation pending |
| J: Pagination | Group pages and 55-message bounded history | Production volume acceptance pending |
| K: Revocation | Current scope, counts, previews, detail and mutation denial; stale UI clearing | Controlled deployed reassignment pending |
| L: Refresh/reconnection | Idempotent storage, browser refresh, two-session revision updates | Real provider/worker reconnection acceptance pending |

These suites cover changed Inbox boundaries and existing related regressions. They do not establish full production regression acceptance for every CRM, Notifications, Roles, OAuth, or external provider workflow.

## 14. Coolify production verification and rollout

Read-only checks during this task returned HTTP 200 with `status: ok` from the direct backend health route and frontend proxy health route. The proxy reported backend revision `a3378cda52d21170a2f78872fd85c4071718538a`, matching the starting local revision. The direct health response did not expose a commit. This proves routing to the previously deployed backend, not the new implementation, frontend revision, worker health, or authenticated Inbox behavior.

No Git publication, Coolify deployment, production migration, real Gmail send, production record mutation, or full-mailbox resync was performed. Publishing/deployment and controlled provider test identities require authorization under the request's production-data constraint.

After approval, rollout must publish compatible frontend/backend revisions, apply the additive column through the guarded `db:deploy` path, and verify matching service revisions and healthy incremental/scheduled workers. Do not bypass the relationship-retirement guard or run destructive database cleanup. Controlled authenticated Gmail tests must then verify the A–L behavior, delivered Reply/Reply All thread placement, counts, events, scope revocation, and frontend/backend errors. Health alone is insufficient acceptance evidence.

## 15. Remaining limitations

- Exact addresses determine personal identity; distinct aliases and different fixed sender addresses remain separate until an explicit verified canonical-identity rule exists.
- Group conversations remain isolated by original provider thread, even if a different group thread has the same participant set. This avoids mixing independent private topics or losing provider boundaries.
- Detail is bounded to 50 messages per page; group action selection is capped at 1,000 messages. Original thread-detail API compatibility remains intact.
- New activity/read changes invalidate history cursors; the view reloads before continuing rather than traversing a moving snapshot.
- Existing historical In-Reply-To values remain unknown until original authorized provider metadata is received. They are never inferred.
- Large-production-mailbox query performance has not been measured on production data.
- Real Gmail OAuth/reconnect, delivered messages, real thread placement, deployed worker behavior, and authenticated multi-user production acceptance remain pending. **I cannot confirm production readiness.**
