# CRM conversion, automation authority, sorting and notifications

Implemented in the local workspace. Production deployment and migration were not performed.

## Lead conversion

`convertClosedLead` runs inside the existing serializable sales transaction. Successful Closed Won completion persists the Deal transition and Lead `Closed` status, resolves customer records, establishes relationships, and records conversion together. The normal Lead update and legacy conversion endpoint use the same conversion service. An ambiguous, archived, foreign, or conflicting identity returns an error and rolls back the transaction. Serialization/unique conflicts use the existing retry helper.

- **Contact identity:** use the explicit Lead-to-Contact relation first; otherwise compare email after trimming and lowercasing. Never match only by name. Reuse the Contact and retain its prior notes, ownership and history. Multiple matching Contacts require staff resolution.
- **Account identity:** prefer explicit Lead/Contact Account relations, then an unambiguous existing Deal Account. Otherwise compare the company name after trimming, collapsing whitespace and lowercasing. Reuse an existing Account or create one. Missing company data leaves the Contact intact without an invented Account.
- **Active Lead removal:** retain the original Lead row and set its existing `convertedAt`, `convertedById`, `contactId` and `accountId`. Normal Lead queries exclude converted rows. Conversion does not hard-delete or repurpose the archive flag. Direct historical access remains available.
- **Contact status:** the public API uses canonical `Closed`. Storage reuses the existing `ContactStatus.CLOSED` enum adapter and customer lifecycle; no new uppercase public status is introduced.
- **Deals/history:** upsert Contact-to-Deal junctions for every original Deal, including historical/archived Deals. Fill missing singular Contact/Account links without recreating Deals or changing their IDs, interests, values, assignees, evidence or pipeline history. Original Lead links remain. Contact activity/relationship reads include source Lead activity. Mailbox matching recognizes converted Lead email aliases and preserves original thread context.
- **Audit:** conversion activities and `lead.converted` audit data contain the source Lead, resulting Contact/Account IDs, reason and timestamp. Repeated conversion does not duplicate the conversion history.
- Returning website inquiries reuse historical customer relationships through this service. Existing confirmed sales remain intact.

Existing Closed rows are not mass-converted by the migration; conversion occurs through the backend transition/conversion paths.

## Deal Stage Automation

The existing Custom Fields card layout now includes **Deal Stage Automation**, with an **Automatic Deal Stage Changes** switch. The configuration is tenant-specific `TenantPreference` data (`module=deal-stage-automation`, `key=default`, `{ enabled: boolean }`). Existing `settings.view` / `settings.edit` permissions control access and changes are audited.

- **Enabled:** existing engagement rules can progress the clearly associated Deal to Contacted/Qualified. Existing cancellation handling remains limited to that Deal. Email never marks a Deal Closed Won; requirements validation still governs that transition.
- **Disabled:** persist messages, activities and detected intent/customer status, but return before engagement-driven Deal stage mutations, including cancellation-driven movement. Manual Deal changes remain available.
- **Defaults:** new tenants without configuration are disabled. Migration preserves existing tenants' previously enabled behavior and does not overwrite an explicit setting.
- **Deal selection:** explicit thread/message association, unique Product Interest context, unique reference-number context, then a single open Deal. Ambiguous matches abstain. A terminal explicit association does not fall through to another opportunity.

## New Field and Edit Field

New Field mounts with no ID, an empty name/options/help text and `required=false`. Closing discards unsaved state. Edit mounts for its selected field ID and current values. Switching from Edit to New does not carry over state. Both reuse existing drawers, validation, cards and toasts.

Create inserts a new `ClosingFieldDefinition` row and returns that field. Edit updates the same tenant/ID row and increments its version. IDs and field types remain stable; saved Deal closing values and historical evidence snapshots are preserved. Success refreshes the card/list and closes the form.

## Table defaults

| Module | Default | Data ordering |
| --- | --- | --- |
| Tasks | `createdAt DESC` | Backend orders before pagination; Due Date stays manually sortable. |
| Leads | `createdAt DESC` | Backend order before pagination; converted Leads excluded. |
| Contacts | `createdAt DESC` | Backend default; existing client collection is loaded completely before client pagination/sorting. |
| Accounts | `createdAt DESC` | Existing backend default retained; frontend default aligned. |
| Campaigns | `createdAt DESC` | Backend order before pagination. |
| Workflows | `createdAt DESC` | Backend order before pagination; no extra visible Created column. |
| Team Management users | `createdAt DESC` | Backend default; all user pages loaded before existing client pagination/sorting. |
| Archived Data | `archivedAt DESC` | Backend merges permitted record types and orders before global pagination. |

Archive dates use `deletedAt` where present, otherwise the latest applicable archive/inactivation audit timestamp. Unknown dates sort last. Existing shared sorting utilities and DataGrid interactions are reused. Manual sorting remains active until the table's normal reset; stored user sort preferences remain honored. Groups retain their separate existing behavior.

Manual server sorts use the existing globally sorted identity/page helper, not browser sorting of one server page. Archive merging and manual identity sorting can inspect the entire matching collection on the backend; production-scale performance was not benchmarked.

## Notifications

The existing `Notification` table now backs the bell, dropdown and existing Notifications page. Fields used are `id`, `tenantId`, `userId`, `type`, `title`, `body`, `entityType`, `entityId`, `createdAt`, `isRead`, `readAt`, plus new nullable `eventKey`. Related-record destinations are mapped to trusted application routes; Tasks open the existing Task drawer.

| Recipient | Events |
| --- | --- |
| Active Client Admins | Website/form Lead creation; Hot or Cancelled Lead/Contact; Qualified, Closed Won and Closed Lost Deals; completed Closed Won requirements; workflow/campaign/form-processing failures; disconnected Gmail and persistent sync failures; user creation/status/archive/restore; important CRM/workflow/campaign archive/restore events. |
| Assigned sales owner | New/reassigned Lead or Contact; customer replies; Hot, Cold and Cancelled statuses; Contacted/Qualified/Won/Lost Deals; requirements needing completion; assigned/reassigned Tasks and due/overdue reminders. |
| Affected owner | Campaign failures also reach the campaign creator; mailbox problems also reach that mailbox's owner. |

Recipients come from real tenant-scoped ownership IDs and the existing Client Admin role or role-definition assignments. Inactive/foreign recipients are rejected. An owner who is also an Admin receives one notification per event. No employee email is hard-coded.

Delivery projects committed Activity, DealStageHistory, AuditLog, CRM and mailbox data. The existing backend process starts a 60-second delivery scheduler. A persisted cursor advances only after event delivery succeeds; a five-minute overlap and deterministic event keys allow safe retries. Database uniqueness on `(tenantId, userId, eventKey)` prevents repeated events per recipient. Tasks have separate due-soon/overdue keys per due date and assignee. Due soon means within 24 hours; persistent Gmail failures require at least 15 minutes of observed failure.

Delivery failures are logged with safe context and retried independently of CRM transactions. They cannot undo a committed business operation. Existing tenants receive a migration-time cursor to avoid a historical notification flood. Running the normal long-lived backend process is required for scheduled delivery/reminders.

Unread count is calculated across the entire recipient feed, independently of the recent page size. Read/read-all updates persist to the database. The UI polls every 30 seconds and refreshes on focus/read changes; the badge caps at `99+`. Loading, error, empty, unread, timestamps, wrapping and dropdown overflow are handled within the existing UI. Every read/update query uses authenticated tenant and user IDs; client-supplied recipient IDs cannot retrieve or modify another feed.

## Actual API endpoints

All backend paths below have prefix `/api/v1`; the browser uses the existing `/api/proxy` transport.

| Operation | Endpoint |
| --- | --- |
| Persist Lead changes / Closed | `PUT /crm/leads/:id` |
| Existing conversion entry point | `POST /crm/leads/:id/convert` |
| Deal stage transition | `PATCH /crm/deals/:id/stage` |
| Read/save Closed Won values | `GET`, `PATCH /crm/deals/:id/closing-requirements` |
| List custom fields | `GET /administration/closing-requirements` |
| **Create custom field** | **`POST /administration/closing-requirements`** |
| **Update selected custom field** | **`PATCH /administration/closing-requirements/:id`** |
| Automation configuration | `GET`, `PATCH /administration/deal-stage-automation` |
| Lead / Contact / Account tables | `GET /crm/leads`, `/crm/contacts`, `/crm/accounts` |
| Tasks | `GET /operations/tasks` (`sortBy=createdAt&sortOrder=desc`) |
| Campaigns / Workflows | `GET /marketing/campaigns`, `/automation/workflows` |
| Users | `GET /administration/users` |
| Archived Data | `GET /administration/archived-data` (`sortBy=archivedAt&sortOrder=desc`) |
| Other table sort syntax | `sort=createdAt:desc` or the existing permitted manual field/direction |
| Feed and unread count | `GET /notifications` with existing page/limit/read filters |
| Mark one / all read | `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` |

Custom-field create/update return HTTP 200 with the saved field, preserving the existing controller convention.

## Database changes and deployment

Migration: `backend/prisma/migrations/20261020000000_conversion_fields_notifications/migration.sql` (ordered after the repository's existing migrations).

- Add `Notification.eventKey` and composite unique index.
- Add tenant-scoped `ClosingFieldDefinition` with composite primary key, JSON definition and timestamps. Copy existing configured fields in order with IDs and versions preserved; retain the old preference data.
- Seed automation preferences for existing tenants without overwriting existing settings.
- Seed notification delivery cursors for existing tenants.
- Index existing Lead conversion/archive fields; reuse their existing columns.
- Update Prisma model relations, tenant scoping and shared configuration/notification/sort contracts.

Apply `npm --prefix backend run db:deploy` to the intended database before running the new backend; regenerate/build the Prisma client as part of the existing backend build. No application/production database was changed during this work.

## Executed verification

| Check | Result |
| --- | --- |
| `npm run lint` | Passed all three workspaces (TypeScript checks). |
| `npm --prefix backend run build` | Passed Prisma generation and TypeScript build. |
| `npm --prefix frontend run build` | Passed production build; 188 pages generated. |
| `node backend/scripts/test-crm-completion.mjs` | Migration preservation assertions and 14 database/HTTP integration tests passed. |
| `node backend/scripts/test-mailbox-db.mjs` | 78 tests passed, including the added converted-email/thread regression. |
| `node backend/scripts/test-single-workspace.mjs forms` | 18 form integration tests passed. |
| Focused frontend tests | 17 tests passed across `closing-fields-settings.test.tsx`, `use-notifications.test.tsx` and `api-invalidation.test.ts`. |
| `git diff --check` | Passed. |

The database checks use disposable PGlite databases and replay actual migrations. Coverage includes transaction rollback, normalized deduplication, preserved Deal data/history, Closed guards, real field rows/RBAC, enabled/disabled and ambiguous engagement behavior, role/owner recipients, retry deduplication, unread totals, feed isolation, reminders/failures and global ordering across pagination.

Headless Chrome tested the production frontend against the disposable authenticated backend at **320, 375, 390, 768 and 1440 pixels**. New/Edit/configuration panels and notification dropdown fit at each width. All eight requested tables passed default-order and manual ascending/descending interactions at each width. Browser create used POST, edit used PATCH with the same field ID, and notification navigation/read count persistence passed. No browser runtime errors were recorded.

Evidence is in `data/outputs/crm-completion/`: `ui-results.json`, `table-ui-results.json`, `admin-table-ui-results.json`, repeatable browser scripts and screenshots. Local preview processes were stopped and the temporary authenticated session file was removed.

Production migration/deployment, live Gmail provider delivery, every role on the live tenant, multi-process PostgreSQL concurrency and production-volume performance: **I cannot confirm this.** These were not tested against production. The complete repository test suite was not run.
