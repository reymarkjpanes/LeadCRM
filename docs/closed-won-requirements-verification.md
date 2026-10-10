# Engagement and Closed Won requirements — implementation report

Verified locally on October 1, 2026. Changes are in the working tree; no production deployment or production migration was performed. Existing unrelated work was retained.

## Root cause and engagement rules

The stored live exchange was associated with the correct Lead and CCTV Deal. The classifier missed quotation requests containing polite wording such as “Could you please send…”. Its uncertainty check also treated a later condition about purchasing as a reason to ignore an explicit request for a formal quotation. Previously ingested provider messages were skipped, preventing a corrected classifier from repairing those classifications.

The backend now recognizes explicit quotation, proposal, contract, formal pricing, purchase terms and scope requests. A request advances the associated open Deal to Qualified without making the customer Hot. Explicit approval, acceptance, proceeding with an order, scheduling installation, or agreeing to continue with a package makes the customer Hot and the associated Deal Qualified. Staff sending a quotation does not create buying intent. Ambiguous, negated, conditional, quoted and automated messages remain guarded. Email processing never closes a Deal as won.

Mailbox rule versioning enables bounded re-evaluation of 20 older inbound messages per sync. Original message and thread associations, tenant permissions, terminal-state guards, manual-change timestamps, and provider/activity idempotency remain enforced. Older quotation requests can repair stage progression without moving the customer's engagement clock backward.

In the inspected live example, the explicit quotation requests should qualify the Deal. The later wording “I'm interested in proceeding” remains interest under the conservative rules; it is not treated as the explicit decision examples in the request. Its production outcome after migration, deployment and sync: **I cannot confirm this.** No customer email was sent or live status manually changed during this work.

## UI and activity changes

- Email activities resolve the stored mailbox message on the backend and show Sent/Received, From, To, Subject, provider timestamp and body. The Emails filter groups messages by mailbox/thread, orders each conversation oldest first and suppresses repeated message IDs. HTML reuses the inbox sanitizer; scripts, tracking images and unsafe content are removed. Bodies have a collapsed preview and View more. Existing activity paging limits remain unchanged.
- Lead Details shows required first/last names, rejects empty/whitespace-only edits, trims valid saves and displays inline errors. Create Lead now trims both names before required validation. Existing backend create/update validators already required sanitized, trimmed names; authenticated HTTP tests verify rejection and trimming. Email remains required on create.
- Deals retains its existing board skeleton for initial fetch and refresh, with its header and controls visible and no duplicate Loading Sales Pipeline text.
- Team Management uses the Leads table-loading component inside the data area; tabs, search, filter and New User remain visible.

## Closing requirements and persistence

Custom Fields retains Product Interest and adds the Closed Won Requirements card and Add New Field action. The existing SlidingDrawer provides the New Field/list/edit views, matching the New Lead structure. Definitions support Text, Long Text, Number, Date, Dropdown and File Upload; required/optional, active/inactive, help text, and add/remove dropdown options. IDs and field types remain stable; edits increment a version. No destructive definition deletion or payment logic was added.

Definitions use the existing tenant-scoped `TenantPreference` row (`module: closing-requirements`, `key: fields`). Defaults are required Confirmation Type and Confirmation Date, with optional Reference Number, Required Document and Closing Notes. Shared Zod schemas validate definitions and values.

Each Deal has JSON `closingValues`. On closing, JSON `closingSnapshot` stores the exact active definitions, submitted values, document metadata/object keys, actor and time. Later definition changes do not rewrite that snapshot. Duplicating a Deal clears closing values/evidence.

The existing Deal drawer and full-page Details use the same inline requirements component. A save validates the submitted field, persists it, checks active required fields, and closes an already Qualified Deal when they are complete. Values, stage history, CRM history, linked Lead/Contact closure and snapshot commit in the existing serializable transaction. Optional fields do not gate closing. Closed evidence is read-only, including editors already open when another field finishes closing.

Manual Won transitions use the same backend validator. Rejection focuses the existing requirements section or opens the existing Deal drawer. Bulk Won remains rejected; the import row resolver rejects Won; normal Deal updates cannot change stage directly. Existing workflow stage moves use the governed stage service.

Files reuse `RecordFile` and Supabase object storage. The upload service validates supported MIME/content signatures and the existing 10 MB limit, persists a backend file record only after successful storage, and returns an authenticated download URL. A closing file value must be a persistent file ID owned by the same tenant and Deal. Local selections, blob URLs, failed uploads, missing files and another Deal's files do not satisfy required evidence.

## API and migration

All backend paths below have the `/api/v1` prefix. The frontend calls them through `/api/proxy`.

| Method/path | Purpose |
| --- | --- |
| GET/POST `/administration/closing-requirements` | Read/create tenant field definitions (`settings.view` / `settings.edit`) |
| PATCH `/administration/closing-requirements/:id` | Edit a definition (`settings.edit`) |
| GET/PATCH `/crm/deals/:id/closing-requirements` | Read/save Deal values (`deals.view` / `deals.edit`) |
| PATCH `/crm/deals/:id/stage` | Existing governed manual stage transition |
| GET `/crm/activities?leadId=:id` | Existing activity reader, now hydrated with email content |
| GET `/crm/contacts/:id/relationships` | Existing Contact activity reader with email hydration |
| POST `/integrations/gmail/sync` | Existing authorized mailbox sync with bounded rule re-evaluation |
| POST `/crm/leads`, PUT `/crm/leads/:id` | Existing Lead create/edit validation |
| GET/POST `/crm/deals/:id/files` | Existing file list/upload (upload uses name/type query metadata and binary body) |
| GET `/crm/deals/:id/files/:fileId/download` | Existing authenticated file download |
| POST `/crm/deals/bulk/stage`, POST `/crm/deals/imports` | Existing bulk/import Won bypass prevention |

Migration: `backend/prisma/migrations/20261019000000_deal_closing_requirements/migration.sql`. Adds `Deal.closingValues`, `Deal.closingSnapshot` and `MailboxMessage.engagementRuleVersion`, and snapshots legacy confirmed closing evidence. No new tables are introduced. Its timestamp follows the repository's existing migration sequence. Deploy the migration before code that reads these fields, then deploy the backend/frontend and run normal authorized mailbox sync.

## Checks actually run

| Check | Result |
| --- | --- |
| `npm run lint` | All three workspaces passed |
| `npm --prefix backend run build` | Passed, including Prisma generation |
| `npm --prefix frontend run build` | Passed, 188 pages generated |
| `node backend/scripts/test-mailbox-db.mjs` | 77 tests passed across two files; disposable PostgreSQL-compatible database with migration replay and authenticated HTTP |
| Focused frontend Vitest run | 33 tests passed across five files: panel migrations/names, email activity, closing requirements, inbox sanitizer, form errors |
| `git diff --check` | No whitespace errors |

Backend tests cover intent examples, quotation replay/idempotency, unrelated Deals, tenant/RBAC restrictions, name validation, configured required fields, direct/bulk Won rejection, import row rejection, invalid dates/options, failed/successful upload service behavior, wrong-Deal files, closure and immutable snapshots. Frontend tests cover sanitization/grouping, required names, persistent upload before save, and locking open editors after closing.

Browser verification used real APIs against a disposable database. Created an optional dropdown with add/remove options; verified blank inline name rejection; inspected chronological email bodies; rejected manual Won and focused requirements; saved the two default required values; observed Won, locked evidence, related Lead Closed and CRM history. Inspected both Deal drawer and full page. Measured affected settings/forms, email cards, Deal requirements/upload controls and Team controls at 320, 375, 390, 768 and 1440px with no horizontal content overflow. Verified Team refresh kept its controls and pipeline refresh rendered only the existing skeleton. Temporary viewport overrides were reset and preview servers stopped.

Limitations: Gmail responses and Supabase storage responses were mocked in automated tests. A real production file upload/download and production post-deployment sync were not performed: **I cannot confirm this.** The full import HTTP experiment hit an existing transaction timeout in the disposable single-connection environment; the import resolver's Won rejection was then directly exercised against that database and passed. Full import completion: **I cannot confirm this.** Browser upload layout and frontend/backend upload tests passed, but a native file chooser upload against real storage was not performed.

The frontend build needed sandbox escalation for Next.js tracing of the parent directory. It reports existing multiple-lockfile and local API URL warnings; production environment variables must target the deployed API. An initial backend rebuild encountered the running preview's Windows Prisma file lock; stopping that preview allowed the final build to pass.
