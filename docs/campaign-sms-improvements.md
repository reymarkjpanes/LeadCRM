# Campaigns implementation and verification — 2026-10-07

The existing Campaigns architecture now supports typed audiences, caret-aware campaign variables, and UniSMS sending. Six requested templates were created in the configured database for the existing **Camxian Technologies** workspace. A second seed run created zero records and preserved all six.

This report records implementation and release preparation. Publication and live deployment verification are reported separately after release. No real SMS or Email was sent during this work.

Release preparation on 2026-10-07: the existing LeadCRM UniSMS API key and existing webhook secret were saved as backend-only Render variables, with the account-provided `Unisoft` sender. The callback URL below was saved in UniSMS, and Render's health check was set to `/health`. UniSMS currently has six credits and a testing sender with limited Smart-network delivery. An approved production Sender ID and sufficient credits remain account-level prerequisites for unrestricted sending. No credits were purchased and no account credentials were created or rotated.

## Required implementation report

| # | Requested item | Result |
| --- | --- | --- |
| 1 | Current architecture | Thin Next route, existing CampaignsPage / CampaignBuilder / AudiencePanel, shared API clients and contracts, authorized Express marketing routes, tenant-scoped Prisma services. Sending claims a draft in a transaction, commits recipient snapshots, submits outside the transaction with concurrency five, and persists outcomes. Brevo already owns Email delivery and webhook tracking. |
| 2 | Files changed | The complete source manifest is below. |
| 3 | Existing components reused | CampaignsPage cards and Preview / Use Template flow; CampaignBuilder, AudiencePanel, AudienceCounts, FieldError; SideSheet and panel styles; CatalogProductInterestSelect; EntityCombobox with getAssignableAgents; PaginationControls; DataLoadingSkeleton; existing report DataGrid, toolbar, badges, buttons, date formatter and toast system. |
| 4 | New React component files | **None.** Existing components were extended in place. No new drag/drop dependency. |
| 5 | Three Email templates | **Lead Inquiry Acknowledgment**, **Proposal Follow-Up**, **Thank You and Next Steps**. Category Sales; exact requested subjects and bodies; canonical variables only. Persisted Template records, not frontend fixtures. |
| 6 | Three SMS templates | **Inquiry Received**, **Inquiry Follow-Up**, **Proposal Ready**. Category Sales; exact requested bodies. No footer stored in template content. |
| 7 | Idempotent seeding | Focused backend seed validates with MarketingTemplateSchema, locks the tenant row, and skips existing same-tenant name/type records, including archived samples. It never overwrites edits. Existing broad demo/repair seeders were unsuitable for this targeted write. First configured-database run: 6 created. Second: 0 created, 6 preserved. Disposable test additionally verifies edited/archived preservation. |
| 8 | Subject insertion | Tracks the last focused editable field; replaces the selected text or inserts at selectionStart; restores focus and caret after the inserted canonical token. |
| 9 | Body insertion | Uses the same insertion function. Body is the initial default and always the SMS target. Click and keyboard activation remain available. |
| 10 | Variable drag/drop | Existing Quick fields chips use native draggable text/plain transfer. Browser caret hit-testing inserts into the actual input/textarea drop position and React onChange stores it. Installed dnd-kit sorting/kanban helpers do not provide native text-caret placement. Chrome tests verified middle-of-text drops in Email Subject, Email Body and SMS Body. |
| 11 | Status source | Shared CRM_STATUSES: Hot, Warm, Cold, Closed, Cancelled. Dropdown uses equals/not equals. Lead comparisons use public values; Contact comparisons use the existing uppercase storage representation. |
| 12 | Lead Source source | Moved the existing nine LEAD_SOURCES values from frontend constants to the shared contract; frontend re-exports the same source. Backend schema and both CRM record filters use it. |
| 13 | Company | Trimmed, bounded text with case-insensitive equals, not equals and contains; maps to Lead.companyName and Contact.company through Prisma filters. |
| 14 | Product Interest | Reuses CatalogProductInterestSelect and active Settings catalog records. Stores selected ProductInterest IDs as JSON in the existing condition value string. Matches ANY selected product within a condition through normalized productLinks; different conditions use AND. Contact links require interested=true. Server rejects invalid/foreign/inactive catalog references. |
| 15 | Assigned Agent | Reuses EntityCombobox users and getAssignableAgents. Shared eligibility predicate excludes Client Admin and inactive users; server validates tenant membership and eligibility. UI displays names; saved condition uses assignedUserId. |
| 16 | Created Date | Existing LeadCreatedFilterSchema and leadCreatedBounds handle Any date, ≤, ≥ and Range for both Leads and Contacts. Calendar bounds use Asia/Manila, inclusive through 23:59:59.999. Reversed/invalid ranges are rejected. |
| 17 | Delete icon | Existing Trash2 icon with accessible name, title tooltip and keyboard focus styling. Stable row keys ensure only the selected condition is removed. |
| 18 | Eligible recipient list | Compact inline scrollable list inside AudiencePanel shows actual API recipients: name, Lead/Contact, company and channel-appropriate email/phone. Includes loading, error and zero-match states. Footer actions stay outside the scrollable body. |
| 19 | Pagination and bounds | Preview defaults to 25 rows, maximum 50, with shared PaginationControls and a showing-N-of-total label. Source/condition/channel changes reset/cancel stale preview state; requests debounce 400 ms. Candidate and suppression queries read stable batches of at most 250 rows; preview retains only its requested eligible page. Exact counts still require scanning matching records and maintaining normalized deduplication keys. |
| 20 | SMS eligibility | Requires valid normalized E.164 phone and active record; excludes do-not-contact numbers across matching Contact/Lead duplicates. Contacts win over eligible duplicate Leads. Missing email does not exclude SMS. Email retains its independent address, staff, unsubscribe, block and sandbox rules. |
| 21 | CampaignContact schema | Adds nullable phone, submittedAt and providerUpdatedAt. Existing nullable email, personalization, unique messageId and all Email history remain intact. SMS uses its own status values without fabricating Email engagement. |
| 22 | Migration | `20261106000000_campaign_sms_snapshots/migration.sql`: three additive nullable columns only. All migrations replayed successfully in a fresh disposable PGlite database. No reset, db push, or production migration was performed. |
| 23 | UniSMS service | Existing shared sendSms function now normalizes phone, validates configuration/footer/final length, submits once with a 15-second timeout and parses only the documented receipt. Workflow callers keep the existing two-argument call shape and also receive the footer. Uncertain outcomes remain pending/paused for review; no automatic resend. |
| 24 | Official endpoint | POST `https://unismsapi.com/api/sms`, per recipient with the existing concurrency limit of five. Bulk was not used because the immediate bulk receipt identifies a batch, while current persistence correlates each recipient individually. |
| 25 | Authentication | Backend builds HTTP Basic authorization from the API secret as username and an empty password. No secret is returned to the browser or written to logs. |
| 26 | Sender ID | Backend-only UNISMS_SENDER_ID. Browser cannot choose it. Missing secret or sender blocks sending. Configure an approved sender for production. |
| 27 | Final length | Shared maximum 670. Server renders every eligible recipient and appends the footer before any external request. Any overlong result rolls the campaign preparation back, with an affected-recipient count. No truncation. Service independently rechecks final content. |
| 28 | Organization footer | Reads persisted Tenant.email, the existing Settings → General email. Shared appendSmsFooter appends the requested Camxian contact-email/no-reply text once. Campaigns pass the server-read email snapshot from complete preflight; other SMS callers read the tenant setting. Preview renders sample recipient values with the same helper and includes footer/line breaks in its count. |
| 29 | Missing organization email | Client and server block sending with: “Configure the organization email in Settings → General before sending SMS campaigns.” No personal mailbox or hardcoded contact email fallback. |
| 30 | Webhook route | POST `/api/v1/webhooks/unisms`, under the existing public webhook namespace, with payload validation, rate limiting and HTTPS enforcement in production. It does not require CRM user authentication. |
| 31 | Webhook authentication | Compares webhook-secret-key against UNISMS_WEBHOOK_SECRET_KEY with a timing-safe hash comparison. Missing/wrong header rejects with 401; unconfigured server rejects with 503. |
| 32 | Idempotency | Correlates persisted messageId/reference_id and phone, derives tenant/campaign from the database, then uses a campaign-first transaction lock and conditional status update. Duplicate and regressive events do not create another metric snapshot or increment totals. Metadata cannot select a tenant. |
| 33 | message.sent | Marks submitted/retrying/failed recipient sent and timestamps that event. A later retrying/failed event cannot regress success. “Sent” does not claim carrier delivery. |
| 34 | message.failed | Marks submitted/retrying recipient failed and stores a safe UNISMS_FAILED reason. Aggregated failed count is recomputed; raw provider content is not logged or stored. |
| 35 | message.retrying | Moves submitted to retrying, preserving submission total. Repeated retrying is a no-op; terminal states do not regress to retrying. |
| 36 | Email/Brevo regression | Existing Email transport and Brevo webhook implementation remain unchanged. Integration tests pass for personalization, quota and locking, provider IDs, authenticated delivery/open/click/bounce/unsubscribe callbacks, idempotency, aggregation and report data. Total Submitted still includes both channels; Avg Open Rate uses Email submissions only. SMS report uses Phone, Submitted, Sent, Retrying and Failed without Email open/click columns. |
| 37 | Tests executed | 35 disposable-database integration tests; 17 backend unit tests; 34 frontend tests; 7 deployment rollout tests; 44 local Chrome browser checks. Commands and scope are below. |
| 38 | Prisma validation/generation | Prisma validate passed from backend with its configured environment. Prisma Client 5.22.0 generation passed. Initial validation from repository root lacked DIRECT_URL; corrected working directory resolved it. |
| 39 | Backend typecheck/build | Backend lint/typecheck and production build passed. Prisma generation required an approved retry outside the Windows sandbox. |
| 40 | Frontend typecheck/build | Frontend lint/typecheck and production build passed. Shared typecheck passed. Windows compiler file-access denial required an approved outside-sandbox retry. Existing Next workspace-root/multiple-lockfile and local backend-URL warnings remain. |
| 41 | Diff validation | `git diff --check` passed. Git reports normal local LF/CRLF conversion notices. |
| 42 | Render configuration | Saved backend-only **UNISMS_API_SECRET_KEY**, **UNISMS_SENDER_ID**, **UNISMS_WEBHOOK_SECRET_KEY** on the existing leadcrm-backend service. Blank placeholders are in the root .env.example. Actual secrets were not printed or committed. |
| 43 | Dashboard webhook URL | `https://leadcrm-backend-os8d.onrender.com/api/v1/webhooks/unisms`. The documented backend host was confirmed by a 200 /health response at 2026-10-07T09:02:23.156Z. This confirms the host only, not availability of the new route on the deployed revision. |
| 44 | Remaining limitations | Production deployment/migration, real-number SMS acceptance, live carrier behavior and authenticated UniSMS callbacks reaching the deployed backend: **I cannot confirm this.** No real-number test was performed. Browser checks used local controlled API fixtures; database/HTTP behavior was tested separately against a disposable database. Touch-device drag gestures and non-Chrome browsers were not tested; click/keyboard insertion remains available. Multi-Channel remains draft-only. |

The current [official UniSMS documentation](https://unismsapi.com/docs/sms) was opened and checked before implementation and again before completion. The documented base URL, Basic authentication, single-message response/reference ID, 670-character maximum, webhook event names and secret header match the implemented contract. One clarification: new accounts receive a testing sender ID; the documentation asks users to apply for a sender ID after testing. No incompatible documentation change was found. No bulk rate limit was incorrectly applied to the single-message endpoint.

## Validation commands and evidence

```powershell
npm --prefix backend test -- src/shared/services/__tests__/sms.service.test.ts src/modules/marketing/campaigns/__tests__/campaign-content.test.ts src/modules/marketing/campaigns/__tests__/campaign-pagination.test.ts --maxWorkers=1
node backend/scripts/test-campaign-groups.mjs src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts
npm --prefix frontend test -- src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx src/features/tenant/marketing/campaigns/ui/__tests__/campaign-report-view.test.tsx src/features/tenant/marketing/campaigns/ui/__tests__/campaigns-page.test.tsx src/shared/utils/assigned-agents.test.ts --maxWorkers=1
npm --prefix backend run lint
npm --prefix frontend run lint
npm --prefix shared run lint
npm --prefix backend run test:rollout
npm --prefix backend run db:generate
# Run from backend:
npx prisma validate
# Run from repository root:
npm --prefix backend run build
npm --prefix frontend run build
git diff --check
```

The database test harness starts a disposable PostgreSQL-compatible PGlite server and replays the repository migrations. It does not use the configured workspace database for these tests. Provider transports are mocked; authenticated webhook requests reach the local Express application. Tests cover invalid/missing webhook credentials, wrong recipient, unsupported events, duplicate callbacks, all three SMS states, concurrent sends, cross-tenant references, missing organization email and full personalized-length preflight.

Browser reproduction uses a local Next dev server with server-only API_URL=`http://127.0.0.1:4108/api/v1`, NEXT_PUBLIC_USE_MOCK_DATA=false and port 3108, then `node scripts/verify-campaign-sms.cjs`. That script serves controlled API fixtures on port 4108 and uses headless Chrome. It never calls a campaign send route. It verifies Preview and Use Template for all six samples, subject/body values, caret selection, actual native drops, canonical audience controls, product multiselect, date validation, pagination, removal of only the selected row, and layouts at **1440, 768, 390, 375 and 320px**. Forty-four checks passed with zero page errors and zero provider calls.

Local evidence is under `data/outputs/campaign-sms/` (results.json and responsive screenshots). Build/integration logs are `data/outputs/campaign-sms-frontend-build.log`, `campaign-sms-backend-build.log`, and `campaign-sms-integration.log`. Generated screenshots are ignored by Git; the reproducible script is source-controlled work.

Configured workspace seed, executed twice:

```powershell
npm --prefix backend run db:seed:campaigns -- cc0da62c-61b3-45d0-8fb4-d0775b662059
```

The default command without an ID requires exactly one workspace named Camxian Technologies. Passing the explicit verified tenant ID avoids ambiguity. Existing normal template APIs retain Preview, Use Template, editing and archiving.

## Changed source manifest

Paths are relative to the repository root.

- `.env.example`, `.gitignore`
- `backend/package.json`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261106000000_campaign_sms_snapshots/migration.sql`
- `backend/scripts/test-campaign-groups.mjs`
- `backend/scripts/deploy-crm-imports.cjs`, `backend/scripts/verify-canonical-rollout.test.cjs`
- `docs/setup/deployment.md`
- `backend/src/api/routes/index.ts`, `backend/src/api/routes/marketing.routes.ts`
- `backend/src/modules/marketing/campaigns/audiences.controller.ts`, `audiences.service.ts`, `campaigns.controller.ts`, `campaigns.service.ts`, `unisms-webhook.ts`
- `backend/src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts`
- `backend/src/modules/marketing/templates/default-templates.ts`
- `backend/src/scripts/seed-campaign-templates.ts`
- `backend/src/shared/services/sms.service.ts`, `backend/src/shared/services/__tests__/sms.service.test.ts`
- `frontend/src/features/tenant/marketing/campaigns/hooks/use-campaigns-data.ts`
- `frontend/src/features/tenant/marketing/campaigns/ui/audience-panel.tsx`, `campaign-builder.tsx`, `campaign-report-view.tsx`, `campaigns-page.tsx`
- `frontend/src/features/tenant/marketing/campaigns/ui/__tests__/campaign-builder.test.tsx`, `campaign-report-view.test.tsx`, `campaigns-page.test.tsx`
- `frontend/src/lib/constants.ts`
- `frontend/src/shared/services/audiences.api.ts`, `campaigns.api.ts`
- `frontend/src/shared/utils/assigned-agents.ts`
- `shared/src/contracts/campaign-email.ts`, `campaign-email.js`, `campaign.contract.ts`, `record-experience.ts`, `record-experience.js`, `lead-created.contract.js`
- `scripts/verify-campaign-sms.cjs`
- `docs/campaign-sms-improvements.md`

The checked-in CommonJS contract companions were regenerated where required because existing runtime resolution uses them. Canonical values remain defined in the TypeScript contracts.

## Deployment sequence

Apply the additive migration through the existing deployment migration process, then deploy matching backend and frontend revisions. Configure the three Render variables above, confirm the persisted General Settings email, and register the HTTPS webhook URL in UniSMS. Confirm the deployed route rejects unauthenticated callbacks, then perform an explicitly approved controlled callback/real-number test before claiming production SMS verification. The six configured-workspace templates have already been seeded; rerunning their focused seed preserves them.

Exact preview totals require examining all matching candidates in bounded database batches. This avoids unlimited database result sets and unlimited browser responses, but it does not make total-count calculation constant-time for very large audiences. Invalid legacy audience conditions are rejected by the canonical schema; recreate a stale audience with the supported controls if its stored values are no longer valid.
