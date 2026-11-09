# LeadCRM — API Reference

## Status
For the implemented Campaigns, Templates, Target Audiences, and Brevo webhook endpoints, see [Campaign email delivery](campaign-email-delivery.md).
For quotation template PDFs and authenticated Gmail attachment sending, see [Campaign quotation templates](campaign-quotation-templates.md).

The backend includes implemented CRM, authentication, administration, campaigns, workflows, forms, imports, and mailbox modules. Module-specific references below describe their contracts.

See the [database audit](database/normalization-report.md) for relations, compatibility fields, and verified deployment notes, and [engagement and Deal creation](engagement-deal-creation.md) for the additive Deal creation receipt. Existing databases use the forward migration deployment command, `npm --prefix backend run db:deploy`.

Deal `leadId`/`contactId` and Task `leadId`/`contactId`/`dealId`/`accountId` remain
public API projections of ordered junctions. Task writes accept only `dealIds`
(or compatible singular `dealId`); legacy direct Task associations remain readable.
Singular response IDs identify the first ordered participant. They are
not independent database columns in the final schema. Mailbox thread associations
use `MailboxThreadAssociation`; generic mailbox-thread preferences are retired.
Column retirement uses `db:relations:retire` only after exact-release verification.

## Base URL

The frontend public `GET /api/release` returns only `{ status, commit, env }`
from runtime `SOURCE_COMMIT` with caching disabled. Together with backend
`GET /api/v1/health` and frontend `/api/proxy/health`, it identifies the exact
serving revisions. See [coordinated releases](setup/ci-coolify-release.md).

```
http://localhost:4000/api/v1
```

## Authentication

Protected endpoints accept the HttpOnly `leadcrm_token` cookie or a persisted
session's Bearer token. Browser clients use the same-origin /api/proxy transport.
Login and password recovery do not require a session. There is no public account-creation or tenant-invitation endpoint; administrators provision tenant accounts through user management. See [Authentication and onboarding](authentication.md).

Signed identity is verified against the session store and current database
user/role. Tenant context comes from the authenticated session. CRM endpoints
also enforce employee-domain access, password-change requirements, onboarding readiness, and RBAC.

## Response envelopes
Most domain APIs use the envelopes below; auth and mailbox operations retain their established operation-specific responses.

```typescript
// Success
{ success: true, data: T, meta?: PaginationMeta }

// Error
{ success: false, error: "Human-readable message" | { code: string, message: string }, fieldErrors?: Record<string, string[]> }

// Paginated
{ success: true, data: T[], meta: { total, page, limit, hasMore } }
```

## Required operation identities

Contact creation (`POST /crm/contacts`), Inbox sending (`POST /integrations/gmail/send`)
and draft saving (`POST /integrations/gmail/drafts`) require a UUID `requestId`.
Scheduling retains its required UUID. Generate one identity for a submission and
reuse it for retries with identical content; changed content needs a new identity.
Missing or invalid identities return 400 before a write or provider call.

Contact creation accepts canonical `productInterestIds`, or compatible legacy
`productInterests` names, but rejects both together. Unique eligible Products
create separate Lead-stage Deals with current PHP prices, including zero. No
Products creates no automatic Deal. The transaction includes relationships,
custom fields, audit/activity, the actor-bound receipt and Workflow queue. The
first successful request returns 201; an authorized identical replay returns 200
with the same Contact. A different actor or normalized intent returns 409.
Contact update rejects `requestId` and never repeats creation automation.

Inbox receipts preserve existing success envelopes and `GMAIL_OUTCOME_UNKNOWN`.
A lost provider response keeps an operation unconfirmed until exactly one
metadata result matches its immutable RFC identity. Retrying that operation
performs verification, not another send. Draft edit/send/schedule/delete claims
serialize against the same draft. Receipt replays recheck current recipients,
source messages and permissions. Schedule replays remain valid after the due
time; future-time validation applies when reserving a new schedule.

Mailbox reads remain `no-store`. Every provider-visible participant can veto
access, including To/Cc/Reply-To/Bcc and independent duplicate CRM identities;
the verified connected mailbox self-address is excluded. Client Admin may contact
available same-tenant customers regardless of assignment using their own connected
mailbox. Sales retains the assignment restriction. Unavailable identities and
outside recipients still veto access. Hidden Bcc that Gmail does not expose cannot be verified.
CRM history has its own read boundary: Client Admin can read canonical stored
activities throughout the tenant without a personal Gmail connection. Designated
Group Heads can read history for records assigned to themselves or members of
Groups they head, intersected with existing CRM and Task permissions. Group
membership alone does not grant this access. Other staff retain the current
mailbox policy for email history. The existing `/crm/record-access` response
includes `activityReadScope` (`tenant`, `managed-groups`, or `mailbox`); absent
values mean `mailbox`. Internal team identities are not exposed.
Activity and relationship history reads use `no-store`. A list whose mailbox,
role, Group, or record authorization changes while loading returns 409
`MAILBOX_SCOPE_CHANGED`; retry without reusing the previous count or cursor.
These CRM read rules do not grant access to another employee's Inbox or change
Gmail sending, synchronization, or assignment permissions.
Exact compose/reply/reply-all/forward draft context is server-owned;
legacy drafts with unverified source evidence require explicit source selection.

Forward is employee-only: every recipient must be an active, provisioned staff
account in the authenticated tenant. Client Admin and explicitly approved staff
email addresses qualify; Lead/Contact addresses, inactive accounts, retired Guests,
unknown addresses and other tenants' accounts do not. Invalid recipients return
403 `MAILBOX_RECIPIENT_REJECTED` with an editable-draft error. The existing
`GET /integrations/gmail/status?includeForwardRecipients=true` response optionally
includes `forwardRecipientEmails` for frontend validation; sends, drafts, schedules
and recovery independently recheck current server data.

Forward intent discards CRM record/Deal context. Forward copies retain Gmail
delivery, supported attachments and Sent history, and appear in the sender's
LeadCRM Sent view and eligible recipients' Inbox using same-tenant receipt/provider
identity evidence. They have no CRM associations, activities or engagement effects
and cannot be manually linked to a Deal. Original message history and normal
Compose/Reply authorization remain preserved. See [employee forwarding
verification](verification/inbox-forwarding.md).

This is an intentional writer compatibility change. Deploy matching frontend and
backend revisions together. Old writers must supply stable UUIDs before upgrading;
they must not silently generate a fresh UUID on each retry. See
[local acceptance and release gates](verification/system-qa.md).

---

## Auth Endpoints

All paths are relative to /api/v1. See [authentication and onboarding](authentication.md).

| Method | Path | Responsibility |
| --- | --- | --- |
| POST | /auth/login | Password verification and a normal HttpOnly session cookie |
| POST | /auth/login-lockout | Restore active cooldown only with a signed HttpOnly proof from a denied login; optional normalized email verifies the proof's identity |
| GET | /auth/me | Current database-backed account state, including mustChangePassword, passwordChangedAt, and read-only Group summaries |
| PATCH | /auth/profile | Update only the authenticated user's firstName, lastName, and phone. Returns the canonical user |
| POST | /auth/profile/email/request | Client Administrator only. Validates the current password and sends a verification code to the new address |
| POST | /auth/profile/email/confirm | Client Administrator only. Consumes the code in the requesting session, updates the verified address, and revokes old sessions and recovery tokens |
| POST | /auth/profile/avatar | Authenticated raw JPEG/PNG/WebP body, maximum 5 MB; stores a normalized 512×512 WebP in private persistent storage and returns the canonical user |
| GET | /auth/profile/avatar/:avatarId | Authenticated retrieval of the current user's saved avatar; private, uncached response |
| POST | /auth/logout | Revoke session and expire cookie |
| POST | /auth/activity | Record authenticated foreground activity with `lastActiveAt`; cannot revive an idle-expired session |
| POST | /auth/change-password | Store strong `password`, clear first-login flag and revoke other sessions; require and verify `currentPassword` except for server-verified mandatory temporary/expired-password changes |
| POST | /auth/forgot-password | Request password recovery |
| POST | /auth/reset-password | Complete password recovery and revoke sessions |
| GET | /auth/onboarding/status | Canonical account state |
| POST | /auth/onboarding/complete | Per-user informational acknowledgment after password setup; empty body |

Login, `/auth/me`, and `/auth/activity` return session metadata including
`sessionId`, `lastActiveAt`, `idleExpiresAt`, `expiresAt`, and `serverNow`.
`POST /auth/logout` accepts `{ sessionId?: UUID }`; `/auth/activity` accepts
`{ lastActiveAt: ISO datetime, sessionId?: UUID }`. A supplied ID that differs
from the authenticated cookie session returns `409 SESSION_CHANGED` without
revoking that replacement session or clearing its cookie. Clients then revalidate
their current account. IDs are correlation metadata, never authentication tokens.
Empty logout payloads remain supported and revocation is idempotent.

Idle sessions return `401 SESSION_IDLE_EXPIRED` before activity renewal. The
authorization access-change stream preserves that reason for the Login notice;
passive API polling and SSE do not extend the 30-minute inactivity deadline.

`POST /auth/forgot-password` accepts only `{ email }`. The shared schema trims and lowercases the address before the authoritative case-insensitive lookup. Under the owner's approved disclosure policy, an unknown address returns HTTP 404 and `{ success: false, error: { code: "ACCOUNT_NOT_FOUND", message: "No account exists with this email address." } }`. Known restricted/ambiguous identities receive the same neutral success shape as eligible accounts, without security metadata, tokens or tenant selection.

Recovery success contains `success`, the neutral `message`, `expiresInMinutes`, and `resendAfterSeconds`; it confirms request processing, not inbox delivery. Definite email submission rejection returns HTTP 502 with `PASSWORD_RESET_EMAIL_FAILED`. Uncertain submission returns HTTP 502 with `PASSWORD_RESET_SUBMISSION_UNCONFIRMED` and `retryAt`, and suppresses additional email submission until that attempt expires. Resend uses this same route. Production recovery limits remain three requests per IP per hour, with an additional three per normalized address per hour. See the [recovery verification report](password-recovery-verification.md) for acceptance evidence and rollout requirements.

Public signup, Google sign-in, OTP, verification, company setup, and step-progression routes are not registered. SaaS billing, seat, document-verification, pricing, checkout, and payment-method APIs are retired. Customer invoice/payment APIs and Team Management domain APIs are also removed. See [security API and migration report](security-cleanup-mfa.md).

Profile updates use a strict shared Zod whitelist and derive both user and tenant identity
from the session. Email and privilege fields are not editable. Avatar references are only
written by the upload service; JSON profile patches cannot supply arbitrary avatar URLs.
Group membership is administrator-managed; self-profile patches reject `groupIds` and the retired `department` field. Both updates are audited. Existing `GET /auth/me` restores saved profile values after reload.
Storage requires server-only `STORAGE_ROOT`, pointing to an existing private persistent
directory, and optional `AVATAR_STORAGE_BUCKET` (default `avatars`). Files are served only
through authenticated routes. See [Coolify private storage](setup/coolify-private-storage.md).
The browser crops before upload; the server decodes, validates and re-encodes the image,
generates a UUID key under the authenticated tenant/user, and saves a durable authenticated
avatar reference in `User.avatarUrl`. The storage directory must not be publicly served.


---

## CRM Endpoints (`/api/v1/crm/`)

Lead and Contact create/update requests accept optional `newAccount` for atomic
company creation and linking, including Account custom fields and a retry identity.
It is mutually exclusive with a nonempty `accountId` and requires Accounts View and
Create permissions. Nested Account details are returned only with Accounts View.
Account `internalNotes` input is retired; legacy notes are preserved in Activity.
See [CRM polish contracts and rollout](crm-polish.md).

All require an authenticated session and completed per-user onboarding. Deal account filtering uses canonical `accountId`; the compatibility `organizationId` alias must agree when both are supplied.

For Lead, Contact, and Account archive/restore endpoints, permissions, archived
queries, and migration requirements, see [CRM archive verification](crm-archive-verification.md).

### Record history and synchronization

Contextual `GET /crm/activities` reads accept `leadId`, `contactId`, `accountId`, `dealId` or `taskId` and require the matching view permissions. Target records must be active and belong to the session tenant. The existing `type` filter accepts a comma-separated list; `search` matches title, description and author names. `limit` bounds each page and `cursor` is the opaque `nextCursor` returned by the previous page. Rows have stable `createdAt DESC, id DESC` ordering and author projections; the response includes `total`, `nextCursor` and compatibility `meta`. Invalid cursors return 400. Contact reads include converted source-Lead history without copying rows. Unscoped reads retain the existing requirement for all activity-linked module view permissions.

`POST /crm/activities` preserves the existing note input contract and requires the target record's edit permission. Notes are trimmed/nonempty, saved as `type: "note"`, and retain the authenticated author. Existing scalar record notes are separate historical values.

`GET /crm/{leads|contacts|accounts}/:id/relationships?page=1&limit=50` includes `hasMoreDeals`. Contact Deals include direct and converted-source associations once per original Deal ID. Each related collection remains filtered by its module view permission. Contextual Contact Task lists/counts include direct and converted-source associations; mutation/merge predicates retain direct-link semantics.

`GET /crm/record-events` is an authenticated SSE stream for users with at least one CRM/Task view permission. It emits only the tenant CRM `content` revision counter and periodically rechecks access. Committed CRM, Activity, Task, file, field and relationship changes increment the counter; rolled-back writes do not. The browser proxy permits this path as SSE.

For field catalog/layout/group APIs and dependency-checked custom retirement, see [Customize Fields](custom-fields.md). Task responses expose nullable immutable `createdById`/`createdBy`; writes derive the creator from the session and reject client ownership edits. `assignedUserId` and `assignedById` retain their existing meanings. See [Task assignment](workflows/task-assignment.md).

### Contacts

| Method | Path | Description | Permission |
|---|---|---|---|
| `GET` | `/crm/contacts` | List contacts (paginated, filterable) | `contacts.view` |
| `GET` | `/crm/contacts/:id` | Get contact by ID | `contacts.view` |
| `POST` | `/crm/contacts` | Create contact | `contacts.create` |
| `PUT` | `/crm/contacts/:id` | Update contact | `contacts.edit` |
| `PATCH` | `/crm/contacts/:id/archive` | Archive contact | `contacts.archive` |
| `PATCH` | `/crm/contacts/:id/restore` | Restore contact | `archived_data.restore` + `contacts.view` |

**Query params for GET /contacts:**
- `?page=1&limit=20` — pagination
- `?status=Hot` — canonical CRM status values are `Hot`, `Warm`, `Cold`, `Cancelled`, `Closed`
- `?search=john` — search by name, email, or company
- Archived visibility and record access remain permission-controlled; see the archive reference above.

### Accounts

`POST /crm/accounts` and `PUT /crm/accounts/:id` no longer accept Account/Customer
Type, Customer Since, or Tax ID as account input fields. The account schemas strip
unknown keys before persistence. The retired fields are absent from Prisma,
database columns, and Account responses after the forward cleanup migration.
Accounts no longer expose Assigned Agent, Product Interest, Active Products, or their ID/legacy-name aliases. Supplying these retired fields to create/update or Account import mapping returns 400. Accounts use tenant-scoped module permissions; ownership restrictions continue for Leads, Contacts and Deals. Account linked records, notes and full-address behavior remain supported. See [Account retirement](accounts-field-retirement.md).

### Deals / Pipeline

Manual `POST /crm/deals` requires exactly one active, tenant-owned Product UUID,
in `productInterestIds` or the existing singular `productInterestId`. If both are
provided they must agree. The server copies that Product's current `dealValue`,
sets PHP currency, and stores a historical price snapshot. Imports and duplicated
Deals use the same current-price rule. Later catalog edits never reprice old Deals.
`PUT /crm/deals/:id` preserves Product, value and currency. Existing clients may
resubmit unchanged Product IDs and their preview amount; the preview is ignored.
Changing the Product or overriding its stored snapshot is rejected. Other fields
remain editable, including on unresolved or multi-product historical Deals.
Workflow update actions cannot change these snapshot fields; existing steps are
preserved for review but cannot be activated or executed. Price/Product conditions
remain available.

Lead and Contact Product display arrays keep their existing response
shape but are derived from normalized ProductInterest junctions. The internal
normalization marker is not exposed by ordinary record responses. Unresolved
legacy rows retain their original arrays until reconciled. Renames are reflected
in normalized displays; retained inactive Product relationships remain valid.
Returning Contact form inquiries add Product links and new priced Deals. Retrying
the same `requestId` does not duplicate the submission or Deals.

Product configuration uses `GET /administration/product-interests` and
`PATCH /administration/product-interests/:id` (under `/api/v1`). The update requires
`products.edit`, a valid product UUID, and a non-empty patch containing a trimmed
name, category, description and/or a non-negative numeric
amount with at most two decimal places. It returns the updated catalog after the
transaction commits. `ProductInterest.dealValue` remains the existing decimal
database field; currency formatting is presentation only.
The editor accepts `₱25,000.00` and sends `dealValue: 25000`; formatted strings are
not accepted by the API. See [the normalization report](product-normalization-report.md)
for migration verification and deployment requirements.

Product create requires `name`, `category` and `dealValue`; `description` defaults
to empty and is limited to 1,000 characters. Category uses the existing 200-character
name limit. Creating or editing a Product requires an available, nonblank category;
an edit that omits category validates the existing assignment. Existing Uncategorized
Products remain readable and must be classified when edited.
Catalog responses include `meta.categories` from the tenant's `product-interests`
`categories` preference, initialized once from existing nonblank assignments,
including archived Products. No schema migration is required.

`PATCH /administration/product-interests/categories` accepts `{ action: 'add', name }`,
`{ action: 'rename', name, newName }`, or `{ action: 'delete', name }` and requires
`products.create`, `products.edit`, or `products.archive`, respectively. Names are
trimmed, required, limited to 200 characters and unique without regard to case.
Renaming updates same-tenant active and archived Product category text in the same
serializable transaction. Deleting a category assigned to any Product returns 409.
Mutations return the updated catalog and category options; the existing Product
change event refreshes open views. The editor's inline Add category flow uses the
same add mutation before saving the Product. A failed Product save can leave its
new category available for retry.
Existing names/IDs/prices and historical Deal values are preserved by the additive
metadata migration. See [implementation and verification](security-export-products-verification.md).

`GET /crm/{leads,contacts,accounts,deals}/export` requires the corresponding existing
View permission and accepts the list's filters/search/sort/scope while ignoring
pagination. Deals additionally accepts `view`, a JSON-encoded shared board-filter
contract. Export uses bounded reads of the same authorized list queries in one
snapshot and returns UTF-8 CSV with business columns, escaping/formula protection,
and a Manila-date filename. No tenant/security/database identifiers are exported.

| Method | Path | Description |
|---|---|---|
| `GET` | `/crm/deals` | List deals |
| `POST` | `/crm/deals` | Create deal |
| `POST` | `/crm/deals/batch` | Atomically create one Lead-stage Deal per selected canonical Product; requires `deals.create` |
| `PUT` | `/crm/deals/:id` | Update deal |
| `PATCH` | `/crm/deals/:id/stage` | Move deal to new stage |
| `PATCH` | `/crm/deals/:id/pipeline` | Atomically transfer an active open Deal to another pipeline; requires `deals.edit` |
| `GET` | `/crm/pipelines` | List pipelines |
| `GET` | `/crm/pipelines/:id` | Read pipeline including ordered stages |
| `POST` | `/crm/stages` | Add a stage to the existing pipeline |
| `PUT` | `/crm/stages/:id` | Rename/update a stage |
| `DELETE` | `/crm/stages/:id` | Remove an unused, unprotected stage |
| `PATCH` | `/crm/pipelines/:id/stages/reorder` | Reorder all stages in that pipeline |

The legacy pipeline/stage configuration APIs are Client Admin-only. The retired
`deals.manage_stages` flag cannot be assigned through RBAC and grants no custom-role
access, even if an old stored row still contains it. Moving a Deal between its
existing stages continues to require `deals.edit`.

Pipeline transfer accepts only `{ pipelineId, stageId }`. Both targets must belong to the authenticated tenant; the pipeline must be active and the stage nonterminal, with its entry requirements satisfied. Archived, deleted, Won and Lost Deals cannot transfer. Pipeline and stage commit together with history, activity and audit; Product/value snapshots, assignment, closing evidence and child relationships are preserved. A replay at the same destination succeeds without duplicate history or workflow triggers. Ordinary stage changes remain within the Deal's current pipeline.

Stage removal rejects default/won/lost stages and stages referenced by any Deal
(including archived Deals) or stage history. It does not reassign or orphan Deals.

`POST /crm/deals/batch` accepts `idempotencyKey` (UUID), unique `productInterestIds`,
`pipelineId`, the pipeline's `Lead` `stageId`, and common `title`, `priority`,
`expectedCloseDate`, `accountId`, `assignedUserId`, `contactIds`, `leadIds`,
`leadSource`, `address`, `billingFrequency`,
and `productInterestOther`. Prices and currency are server-owned Product snapshots
in PHP. The response is `{ success: true, data: { deals: Deal[], replayed: boolean } }`,
with 201 for creation, 200 for identical replay, and 409 for an actor/payload conflict
on a previously used key. Multi-Deal titles are `Entered title — Product name`, with
the entered portion shortened to fit 255 characters. A single title is preserved.
All relationships, audit records, Deals and the tenant-scoped receipt commit together.
The existing single-Deal endpoint and response remain supported.

Deal `industry` is retired and strict create/update contracts reject it. Account
Industry remains unchanged. See the [coordinated retirement and preflight](deal-industry-retirement.md).

Deal `address` remains an optional project/service location override. Create, batch-create and update accept optional `addressSource: { type: "lead" | "contact" | "account", id: string } | null`. The source must be an authorized active record linked through the Deal's existing relationships. Clearing it returns to automatic selection; omitting it preserves an existing choice. Deal responses include read-only `addressContext` (effective address, customer address/status, source and authorized options). One available source resolves automatically; several remain unresolved until chosen. Values are read live, never copied into Deal overrides. Source address changes do not update Deal rows or trigger Deal workflows. Existing quotation recipient/Account address roles and finalized document snapshots are unchanged.

New manual single and batch Deals require exactly one `leadIds` or `contactIds`
entry, referencing an active same-tenant record the actor can view. The server
inherits its eligible assigned agent and valid linked Account. Unassigned sources
use the existing authorized assignment fallback; unresolved ownership fails
validation. Conflicting explicit initial agents or Accounts are rejected.
Committed legacy batch receipts remain replayable without rewriting their Deals.
Internal automatic Product creation retains its existing contract.

`PUT /crm/deals/:id` additionally accepts
`primaryAssociation: { type: "lead" | "contact", id, previous?: { type, id } }`.
This is a targeted operation on the existing ordered junctions, not a stored
primary field. It removes only the explicitly identified previous link, prepends
the chosen link, and preserves other current relationships. A missing previous
link returns 409. Do not combine this operation with `leadIds`/`contactIds` array
replacement in one request. Omit it for unrelated legacy edits. Association
changes do not implicitly reassign the Deal or replace its Account. Existing
authorized additional relationship and reassignment operations remain available.
See [Deal association verification](deal-association-verification.md).


Mailbox reply timing, related-Deal Workflow options, Custom Fields and migration
instructions are documented in [engagement and Deal creation](engagement-deal-creation.md).

Module-scoped field definitions, record values, uploads, permissions and the
preserving migration are documented in [Custom Fields](custom-fields.md).
The same guide specifies immutable readable aliases, canonical UUID compatibility,
complete revision-checked reorder commands, and separate group deletion permission.

Lead and Contact create requests require a trimmed, valid email of at most 254
characters. Updates may omit email, but cannot submit an empty or invalid email.
Accounts retain their existing email rules.

Record file history uses `GET`/`POST /crm/{module}/:id/files` and
`GET /crm/{module}/:id/files/:fileId/download` for `leads`, `contacts`, `accounts`,
and `deals`. These reuse the existing scoped file service and storage provider.

Lead, Contact and Deal Files also read `GET /crm/{module}/:id/email-attachments`
with an optional `cursor`. The response's `data` contains `attachments`, optional
`nextCursor`, and an optional recovery `error`. Each page examines at most 20
stored, authorized, record-linked messages. References contain the original
mailbox/message/attachment identity, filename, MIME type, optional size, and
sent/received timestamp. Contact history includes converted source Leads.
Deal reads require a validated stored message or thread association and the
existing customer relationship. Viewing a CRM record never grants access to
another employee's Gmail account.

Gmail references remain read-only and use the existing
`GET /integrations/gmail/messages/:messageId/attachments/:attachmentId` endpoint.
CRM actions supply `recordModule`, `recordId`, and `accountId` query parameters;
record, association and mailbox access are rechecked before and after provider
I/O. Existing Inbox callers may omit this context. No uploaded-file row or
attachment bytes are persisted by this feature.

### CRM CSV imports

Paths below are relative to `/api/v1`. Replace `{module}` with `leads`, `contacts`,
or `accounts`. Deal CSV import is retired; no Deal import API routes are registered.
The browser preserves Upload → Map Columns → Review & Validate;
both preview and execution parse the source CSV and validate relationships on the server.

| Method | Path | Description | Permission |
|---|---|---|---|
| `POST` | `/crm/{module}/imports/upload` | Optional durable source chunks, each at most 65,536 characters | Import permission |
| `POST` | `/crm/{module}/imports/preview?offset=0` | Review up to 25 rows, or return existing execution metadata | Import permission |
| `POST` | `/crm/{module}/imports` | Commit up to 25 remaining rows; HTTP 202 while importing, 201 when complete | Import permission |
| `GET` | `/crm/{module}/imports` | Paginated history; optional job status filter | `{module}.view` |
| `GET` | `/crm/{module}/imports/:importId` | Saved summary | `{module}.view` |
| `GET` | `/crm/{module}/imports/:importId/results` | Paginated results; optional `status=imported\|failed\|duplicate` | `{module}.view` |

Import permissions are `leads.import`, `contacts.import`, and `accounts.import`.
Preview and execution accept `{ fileName, csvText,
mappings, idempotencyKey }`; mappings associate field keys with zero-based CSV
column indices. Alternatively replace `csvText` with `uploadId` after uploading
`{ uploadId, chunkIndex, totalChunks, content }`. Limits: 10 MiB UTF-8, 5,000 rows,
100 columns. Chunk sources are scoped to tenant/user/module and expire after 24 hours.
Completed imports delete raw chunks immediately; startup/hourly cleanup removes
expired upload parents and remaining chunks without deleting job history.

Repeat the identical execution request until its status is no longer `importing`.
Reuse the UUID idempotency key across retries; different input with the same key
returns 409. Committed rows and automatically created Deals are transactional.
The three active import modules use `CrmImportJob` and `CrmImportRowResult`, filtered
by tenant and module. The application contract accepts only Leads, Contacts and
Accounts. The persisted Prisma enum also retains `DEAL` for historical records;
retiring the feature does not delete import jobs, results or audit evidence.
Idempotency is unique per tenant/module/key.
Responses retain the existing summary fields and result aliases while also
exposing `module`, `importJobId` and `recordId`. See the
[normalization report and two-phase rollout](csv-import-normalization.md)
before deploying the import migrations to an existing database.

Deal fields require `title`, `productInterest`, `pipeline`, `stage`, plus a
customer relationship (`customer`, `lead`, `contact`, or `account`). Optional:
`priority`, `expectedCloseDate`, `assignedUser`. A Deal resolves exactly one active
Product and snapshots its current configured price on the server. `value` is not
an import field. Names/email addresses or IDs resolve within the current tenant;
ambiguous, foreign, unavailable, and closed-stage relationships fail validation.
People/accounts support semicolon-separated Product Interests and are create-only.
See the [CSV import audit and verification report](csv-import-audit.md) for all
identity rules and the earlier CSV feature verification. Its migration design
is superseded by the normalization report linked above.

---

## Marketing endpoints

All paths are relative to `/api/v1`. Protected operations require a ready workspace and the indicated permission.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET / POST | `/marketing/campaigns` | List/create Campaigns | `campaigns.view` / `campaigns.create` |
| GET / PUT | `/marketing/campaigns/:id` | Read/update Campaign | `campaigns.view` / `campaigns.edit` |
| PATCH | `/marketing/campaigns/:id/send` | Submit Campaign to configured provider | `campaigns.send` |
| PATCH | `/marketing/campaigns/:id/archive` | Archive Campaign | `campaigns.archive` |
| POST | `/marketing/campaigns/:id/duplicate` | Create draft copy | `campaigns.duplicate` |
| GET | `/marketing/campaigns/:id/report`, `/marketing/campaigns/metrics` | Delivery reports | `campaigns.view_reports` |
| GET | `/marketing/campaigns/variable-fields` | Tenant-scoped field catalogs for Leads, Contacts, Accounts and Deals | `campaigns.view` |
| GET | `/marketing/campaigns/email-settings`, `/marketing/campaigns/sms-settings` | Public configured sender/contact identity | `campaigns.view` |
| GET / POST | `/marketing/audiences` | Read/save audiences | `campaigns.view` / `campaigns.create` |
| POST | `/marketing/audiences/preview` | Resolve audience preview | `campaigns.view` |
| GET | `/marketing/audiences/companies` | Audience company options | `campaigns.view` |
| GET / POST | `/marketing/templates` | List/create templates | `campaigns.view` / `campaigns.create` |
| GET / PUT | `/marketing/templates/:id` | Read/update template | `campaigns.view` / `campaigns.edit` |
| PATCH | `/marketing/templates/:id/archive` | Archive template | `campaigns.archive` |
| GET / POST | `/marketing/forms` | List/create Forms | `forms.view` / `forms.create` |
| GET / PUT | `/marketing/forms/:id` | Read/edit Form definition | `forms.view` / `forms.edit` |
| PATCH | `/marketing/forms/:id/publish`, `/marketing/forms/:id/unpublish` | Change publication state | `forms.publish` |
| POST | `/marketing/forms/:id/duplicate` | Copy Form | `forms.duplicate` |
| DELETE | `/marketing/forms/:id` | Delete eligible Form | `forms.delete` |
| GET | `/marketing/forms/:id/submissions` | Submission history | `forms.view_submissions` |
| GET | `/public/forms/:publicId` | Read published public Form | Guest |
| POST | `/public/forms/:publicId/submissions` | Validated public submission | Guest; rate-limited |

Campaign sends use Brevo email or TextBee SMS, not the removed placeholder scheduler. Durable leases/recipient attempt markers let recovery finalize expired submissions as `INTERRUPTED`. Known unsent recipients are failed; uncertain provider outcomes remain reviewable without an automatic resend. No new recovery endpoint is exposed.

Audience previews and sends also require the selected Lead/Contact source's current CRM View permission and record scope. Counts and personalization exclude inaccessible records and related CRM values. Scheduled dispatch rechecks the scheduling user's current access; tenant-wide suppression and unsubscribe checks remain internal and authoritative.

The variable catalog returns existing `CrmFieldCatalogEntry` metadata; field presence does not authorize recipient values or provide related Account/Deal binding. Send and schedule validate variables against the effective Lead/Contact source. Email settings return configured Brevo `senderName` and `senderEmail`; SMS settings return tenant `organizationName` and validated `organizationEmail`. These public identities contain no provider credentials. Template tokens remain `sender_name` and `sender_email`. See the [variable consistency report](campaign-workflow-variable-consistency-report.md) for availability and verification details.

The SMS footer is editable text in the existing `body` field. The composer seeds
new blank SMS campaigns and offers explicit default insertion; create/update,
copy, schedule and send operations preserve authored text without inserting or
restoring a footer. See the [SMS footer lifecycle](sms-footer-lifecycle.md).

Forms editing and publishing are distinct permissions. Company Website is explicitly submission-only; it is retained in submission history and is not advertised as a saved Lead field.

See [Campaign email delivery](campaign-email-delivery.md), [Forms implementation](forms-production-report.md#actual-api-endpoints), and the [polish plan](plans/system-polish.md).

---

## Automation Endpoints (`/api/v1/automation/`)

See the [workflow production report](workflows/workflow-production-report.md#c-api-endpoints) for the exact controller, service, permission and database mapping. All paths below use the `/api/v1` public prefix; browser clients use the existing API proxy.

| Method | Path | Description |
|---|---|---|
| `GET` | `/automation/workflows` | List workflows |
| `GET` | `/automation/workflows/:id` | Get saved definition |
| `POST` | `/automation/workflows` | Create workflow |
| `POST` | `/automation/workflows/validate` | Validate without side effects |
| `PUT` | `/automation/workflows/:id` | Update workflow |
| `PATCH` | `/automation/workflows/:id/toggle` | Set active state with `{isActive: boolean}` |
| `PATCH` | `/automation/workflows/:id/archive` | Archive and preserve history |
| `GET` | `/automation/workflows/:id/executions` | Execution history with `page` (default 1), `limit` (default 25, max 100), and shared `meta: {total, page, limit, hasMore}` |
| `GET` | `/automation/workflows/:id/executions/:executionId` | Execution detail |
| `POST` | `/automation/workflows/:id/test` | Read-only sample validation |
| `GET` | `/automation/workflow-options` | Permission-scoped CRM owners, task assignees, assignment roles/groups, pipelines, stages and templates |
| `GET` | `/automation/triggers` | Supported event and condition metadata |
| `GET` | `/automation/actions` | Supported action metadata |

Duplicate uses `POST /automation/workflows/:id/duplicate` to create an inactive draft copy. Removal uses archive with `workflows.delete`; there is no workflow DELETE endpoint.

Workflow grants are independent: `view`, `create`, `edit`, `activate`, `pause`,
`execute`, `view_runs`, `delete`, and the existing `duplicate`. View remains a
prerequisite. Initial activation and publishing require Activate; pausing and
resuming the unchanged published definition require Pause / Resume. Updating a
definition also requires Edit, including through the legacy PUT endpoint.
Validate and Test require Execute and retain their existing action/record checks;
they are dry runs and never execute actions. Automatic event processing continues
to recheck the approved publisher's current permissions. Resume preserves that
publisher. Non-archived workflows are shared within the tenant according to these grants;
archive recovery retains its existing creator/archiver restrictions.

Apply `20261230000000_workflow_capabilities` before starting the matching backend.
It adds persisted Pause/Execute flags, maps prior Workflow activation/archive grants
to the separated capabilities, and sets Workflow-only defaults on existing active
Sales Admin/Sales Associate custom roles. New role templates expose those defaults;
subsequent saved RBAC changes remain authoritative, including after role renames.

Validation accepts the shared workflow draft plus an optional `workflowId`. The
server resolves that ID within the current tenant to preserve unchanged literal
empty-string conditions from previously active workflows. New blank conditions
must be completed or use `is_empty` / `is_not_empty` before activation. Saving an
inactive draft retains the existing validation rules.
The server recalculates `incompleteValue` metadata on saved condition rules so a
new missing value cannot become a historical-literal exception after a paused
draft save. This metadata does not change the condition's value or execution
operator.

Create Task is limited to Deal triggers. Account Updated supports Update Fields
only. Lead, Contact and Deal triggers support both Send Email and Send SMS.
Assign Agent supports Created events plus explicit Lead/Contact status and Deal
stage handoffs; every matching handoff must bind a target status/stage Equals
condition. Ordinary Updated triggers cannot reassign records, and Update Fields
cannot write `assignedUserId`. Unsupported saved definitions retain their history
and must be repaired; execution pauses an incompatible definition before acting.

Assignment configuration and versioned execution history are documented in
[Workflow assignment and history](workflows/workflow-assignment-history.md).
Role/Group assignment supports only round-robin among active, permission-eligible
users. Retired methods in saved definitions are adapted to round-robin on read;
new API input rejects them. Optional availability schedules,
capacity limits and member overrides are saved in `config.assignmentTarget`.
The shared contract validates these settings; workflow options include eligible
pool members for configuring overrides. Dry tests return the selection reason
and applicable workload/limit without reserving work or changing assignment state.

The test endpoint accepts `{ entityId, stageHistoryId? }`. For Deal stage/outcome
triggers, an optional real, same-tenant Deal history ID supplies previous/new
stage metadata. The server checks the recorded event against the current entry;
superseded entries return a skipped reason. This is a read-only historical-event
check against current state, not a future transition. Create Task previews render
and validate the same payload used at execution and return resolved title, notes,
priority, status, assignee, named Deals, association count and due instant without creating a Task.
Email checks return the authorized sender, recipient, rendered subject/message and
missing-value warnings. Checks neither send messages nor write delivery records.
SMS checks validate only the entered personalized content, returning
character/segment counts without sending or advancing assignment rotation.

Move Deal Stage accepts optional `includeLossReason` and `lostReason` settings.
When the option is enabled, a nonblank reason of at most 2,000 characters is
required at activation. When disabled or omitted without a saved reason, automated
Lost transitions need no reason. Existing saved reasons remain effective unless
explicitly disabled. Manual Deal endpoints retain their required-reason rule;
the internal automation policy cannot be supplied through the HTTP body.
Updated triggers expose `event.changedFields` as a list condition. The Deal
Assignment Follow-up starter matches `assignedUserId` changes and creates a
linked task using the new record owner. Task creation uses existing notifications.
Timers and Task/Campaign workflow triggers remain unavailable.

Send Email automatically uses the triggering Lead/Contact/Deal's assigned agent's
authorized Gmail connection, including an earlier owner assignment. The deprecated
`senderUserId` setting is accepted and discarded; it is never required or used to
select another mailbox. Missing assignment, Gmail connection or sender access
fails with a corrective message at the record check/execution. Empty or whitespace
overrides fall back independently to the template subject/message. New picker
choices come only from the recipient's person module; supported saved tokens and
templates retain their existing rendering and permission checks. Optional missing
values render blank with warnings; invalid/empty effective content blocks sending.
Deal email requires `config.recipient` to be `primary_contact` or `primary_lead`.
The actual related recipient must remain available and authorized in the sender's
mailbox scope. A Deal assignment never projects ownership onto its related person.
Lead/Contact email may omit `recipient` or use `record`.

Workflow options include stage order/default and terminal flags. The chooser
generates templates bound to current tenant pipeline/stage IDs and opens inactive
drafts; existing numeric template URLs remain stable and saved definitions remain
readable for explicit repair when their actions no longer match the trigger policy.
Stage automation uses the internal `Deal.currentStageHistoryId` to distinguish
rapid leave/re-entry. Each genuine current entry can create a new Task; retries
reuse the same event result and superseded queued entries record skipped reasons.
See [Task and Workflow integrity verification](workflows/task-workflow-integrity-report.md).

---

## Task endpoints

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/operations/tasks`, `/operations/tasks/:id` | List/read Tasks | `tasks.view` |
| GET | `/operations/tasks/summary`, `/operations/tasks/options` | Scoped counts and relationship options | `tasks.view`; options also require the related module view grant |
| POST | `/operations/tasks` | Create Task | `tasks.create`; additional assignment/completion grants when applicable |
| PUT | `/operations/tasks/:id` | Edit Task or action-only assignment/completion | `tasks.view` plus the applicable edit/assign/complete grant |
| PATCH | `/operations/tasks/:id/complete` | Complete Task | `tasks.complete` |
| PATCH | `/operations/tasks/:id/archive` | Archive Task | `tasks.archive` |
| POST | `/operations/tasks/bulk` | Edit/assign/complete/archive selected Tasks | Corresponding action grant |

Task due dates use the shared Manila conversion for local calendar/date-time inputs; explicit ISO instants are preserved. There is no registered service-order API.

New Tasks require at least one eligible same-tenant Deal. Direct `leadId(s)`,
`contactId(s)`, and `accountId(s)` writes are rejected. Conflicting singular/plural
Deal inputs and explicit empty Deal updates are rejected; omitted associations
remain unchanged, including legacy Tasks without Deals. Sales association changes
require direct assignment to every added or removed Deal. `requestId` is an
optional creation UUID: same actor/tenant/payload retries return the original Task;
different values return 409. Concurrent mutations may return 409 and can be retried.

Task updates accept optional offset-ISO `expectedUpdatedAt`. A mismatched saved
version returns 409 before any mutation, Activity, AuditLog or notification write.
The version is metadata and does not require edit permission for otherwise
authorized assignment/completion-only updates. The editor sends changed fields
and its saved version; clean detail panels refresh from canonical reads while
dirty drafts require an explicit reload after a conflicting update.

CRM Task lists derive participants through Deal relationships and retain legacy
direct links. Lead, Contact, and Account panels open Task details read-only; Deal
panels and the standalone module retain authorized management. Lifecycle Activity
and AuditLog events commit with Task mutations and preserve event-time context.
Task history requires `tasks.view`, including after archive. Workflow Create Task
uses `targetMode: triggering_deal` for Deal triggers, and `single_match` (default)
or explicitly selected `all_matching` for Lead/Contact triggers. Optional
`pipelineId`, `currentStageId`, and `productInterestId` narrow related matches.
`all_matching` creates one Task with all matching Deal associations, up to 50;
missing, ambiguous single-match, changed, or over-limit relationships fail visibly
without truncation. Legacy exact `dealId` remains supported and must be related to
the triggering record. Account triggers retain their unique-related-Deal behavior.
The write transaction rechecks relationships and current author permissions.
Terminal/interrupted workflow runs are not replayed automatically and there is no
failed-step retry endpoint. Original step IDs and canonical Task inputs preserve
duplicate protection; successful/uncertain email evidence remains preserved.
See [Tasks implementation and verification](tasks-deal-only-implementation.md).

---

## Administration Endpoints (`/api/v1/administration/`)

### Organization Settings

| Method | Path | Description | Permission |
|---|---|---|---|
| `GET` | `/administration/organization-settings` | Read the authenticated tenant's saved organization settings | `settings.view` |
| `PATCH` | `/administration/organization-settings` | Persist organization settings and audit the change | `settings.edit` |

Both endpoints require an authenticated, ready tenant workspace. PATCH accepts
only `name`, `industry`, `email`, `phone`, `domain`, and `address`. Name and email
are required in the persisted record, including after a partial update. Email must
be valid and is normalized to lowercase. Industry uses the shared company-industry
options. Domain accepts hostnames, lowercases them, and removes an HTTP(S) prefix
and trailing slash; paths and malformed hostnames are rejected. Phone accepts a Philippine landline such as
`+63 (28) 123-3488` and stores `+63281233488`. The shared Zod schema rejects letters,
malformed punctuation, unsupported area codes, mobile numbers and invalid lengths.
All text is trimmed. Limits are name 150, industry 32, email 254, phone 24,
domain 253 and office address 500 characters. Address punctuation and line breaks
are preserved; whitespace-only addresses and markup/control characters fail validation.
Cleared optional fields become `null`. The
response contains `id` and all six canonical saved values. Tenant identity comes
from the session, never the request body. `domain` is descriptive organization
metadata and does not change the registered staff eligibility policy.

### Users and Groups

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/administration/users`, `/administration/users/:id` | List/read tenant users and Group summaries | `users.view` |
| GET | `/administration/users/:id/avatar/:avatarId` | Read persisted private avatar reference | `users.view` |
| POST | `/administration/users` | Create user, assign role/memberships, request setup email | `users.create`; role/group changes also require their grants |
| PUT | `/administration/users/:id` | Update profile, role, status, or memberships | `users.edit`, `roles.assign`, `users.activate` according to submitted fields |
| POST | `/administration/users/bulk-update` | Existing profile/role/status bulk changes; membership changes are individual only | Applicable field grants |
| GET | `/administration/users/:id/deactivation-impact` | Preview unfinished work and eligible replacement | Client Admin + `users.activate` + `users.view` |
| POST | `/administration/users/:id/deactivate` | Transactional reassignment and deactivation/session revocation | Client Admin + `users.activate` + `users.view` |
| POST | `/administration/users/:id/unlock` | Reset login security lock/failures/cooldown/cycles while preserving normal activation status | Client Admin + `users.activate` + `users.view` |
| PATCH | `/administration/users/:id/archive` | Archive user | `users.archive` |
| PATCH | `/administration/users/:id/restore` | Restore user | `archived_data.restore` + `users.view` |
| POST | `/administration/users/:id/password-reset` | Recovery request; no token returned to administrator | `users.edit` |
| POST | `/administration/users/:id/approve-email` | Approve the exact registered address of existing active staff; empty body | Active ready Client Admin + `users.edit` |
| GET | `/administration/groups` | Group/member reference | `groups.view` |
| POST / PUT | `/administration/groups` / `/administration/groups/:id` | Create/update Group | `groups.create` / `groups.edit` |
| DELETE | `/administration/groups/:id` | Remove Group | `groups.delete` |
| POST | `/administration/groups/:id/members` | Add same-tenant member(s) atomically | Client Admin + `groups.edit` |
| DELETE | `/administration/groups/:id/members/:userId` | Remove membership | Client Admin + `groups.edit` |
| PATCH | `/administration/groups/:id/head` | Assign/change/clear Group Head | Client Admin + `groups.edit` |

User create requires first/last name, a normalized valid staff email, PH mobile phone, and an active custom role's exact name. Client Admin provisioning records exact-email approval for external addresses; delegated provisioners retain the company-domain restriction. Historical unaudited external accounts require explicit same-tenant Client Admin approval before login. Approval does not bypass account status, password change, onboarding or permissions. See [authentication](authentication.md).

The Group membership POST accepts either legacy `{ userId: UUID }` or `{ userIds: UUID[] }`, never both. Batches must be nonempty and unique; an existing member, missing/inactive user, or foreign-tenant user rejects the entire batch. Legacy single-member retries remain successful no-ops. All membership additions, their audit entries, and access-revision trigger updates commit in one serializable transaction. Success returns `{ success: true, data: TenantGroup }` with complete members; unresolved concurrent changes return 409. Group membership has no separate expected-version field.

Group Head PATCH accepts `{ userId: UUID | null }`; `null` clears the designation. The target must be an active same-tenant member with the primary role Sales Manager or Head of Sales and its active role assignment. Success returns the complete Group, including member `isHead`/`canBeHead` and user `status`/`avatarUrl`. The picker uses server-computed `canBeHead` eligibility; role junctions are not exposed. A partial unique index enforces one head per Group. Assignment and its before/after audit commit serializably; concurrent changes return 409. Removing the membership or changing the user to a non-active status or ineligible primary role clears the designation. Restoring the user does not restore it. The designation grants no permissions and does not alter memberships or Task access. Apply `20261222000000_group_head_assignment` through `db:deploy` before starting the updated backend.

User Group writes accept `groupIds: string[]` (unique UUIDs, at most 100); omitted means no membership change, and `[]` clears memberships. Only Client Admin with `groups.edit` can submit membership changes. Group IDs must belong to the current tenant. Membership writes require the target user to be active; activation and membership changes can commit together. User/auth responses expose `groups: [{id,name}]`; self-profile cannot modify them. The retired Department field is rejected.

Membership, role, audit, and scalar user writes are transactional. Unfinished, nonarchived Tasks participate in deactivation reassignment; completed/cancelled historical Tasks keep their original assignee. Replacement eligibility includes Task view access when unfinished Tasks exist. There is no registered Users export, permanent-delete, invite, or standalone status endpoint.

### Roles, archive, and audit

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/administration/roles`, `/administration/roles/:id` | Role definitions and permission rows | `roles.view` |
| POST | `/administration/roles` | Create custom role | `roles.create` |
| PUT | `/administration/roles/:id` | Save name/description and optional permission replacement atomically | `roles.edit` |
| PATCH | `/administration/roles/:id/archive` | Delete custom role from active use (soft delete) | `roles.archive` |
| POST / DELETE | `/administration/roles/assign` / `/administration/roles/unassign` | Assign/remove role | `roles.assign` |
| GET | `/administration/permissions` | Permission-builder reference | `roles.view` |
| GET | `/administration/audit` | Paginated team activity history | `users.view` |
| GET | `/administration/archived-data` | Supported archived records, excluding roles | `archived_data.view` plus per-type service checks |
| PATCH | `/administration/archived-data/:type/:id/restore` | Restore supported record type | `archived_data.restore` plus per-type service checks |

Archived Data includes `Product` records from the authenticated tenant's inactive `ProductInterest` catalog. Product rows use PHP-formatted default Deal values and `updatedAt` as the archive timestamp. Viewing requires `archived_data.view` plus `products.view`; `PATCH /administration/archived-data/Product/:id/restore` requires `archived_data.restore` plus `products.view`. Restore activates the original catalog record without changing relationships or historical Deal prices. An active case-insensitive name conflict or disabled Product Interest field returns 409; the shared 100-active-product limit returns 400.

Role create/update bodies use `permissions` rows from the shared module/action catalog. There are no separate registered role permission-update endpoints. Protected system roles keep their safeguards. Group membership does not replace module permission grants.

Delete Role sets `RoleDefinition.isArchived = true` and records `role.deleted`; the role, permission rows, and historical audits remain stored. Any assigned `UserRole` relationship blocks deletion with 409 until users are reassigned. Deleted roles are excluded from active lists and assignment and cannot be listed or restored through Archived Data. Role archive filters and restore parameters are unsupported and return 400. The internal archive endpoint and permission key remain unchanged.

### Inbox integration

Gmail routes are under `/integrations/gmail`. The OAuth callback is state-validated; other routes require an authenticated ready workspace, either `leads.view` or `contacts.view`, and mailbox ownership/current CRM scope checks. Customer mail and Gmail actions use the employee's own connected account. Confirmed internal forwards can be read without a Gmail connection. Recipient access is rechecked before delivery, including Workflow and scheduled sends.

New consent requests use `gmail.modify` and `userinfo.email`. The backend derives `login_hint` from the persisted registered email, verifies Google's verified account email and Gmail profile identity, and rechecks current sessions/eligibility/permissions before encrypted credential storage. Production mailbox overrides are ignored. `GMAIL_RECONNECT_REQUIRED` means Google revoked or expired the refresh grant; credentials are cleared while synchronized CRM history remains. Disconnect also cancels pending OAuth requests.

Forward recipients must all be active, provisioned employees in the authenticated tenant; Lead/Contact identities, external addresses and other tenants are rejected with `MAILBOX_RECIPIENT_REJECTED`. The existing status endpoint accepts `includeForwardRecipients=true` and returns optional `forwardRecipientEmails`. Its optional `canReadMailbox` and `mailboxEmail` fields describe internal read availability separately from `isConnected`, which continues to mean Gmail authorization.

Before forwarding, a server-owned operation receipt stages the accepted content and supported attachment bytes in the existing private storage. Gmail confirmation persists sender Sent and recipient Inbox records without requiring Gmail read-back. A recipient without an account gets an inactive, credential-free account container; later OAuth reuses it. Such recipients can read, download, mark read/unread, archive, restore archived messages and trash only receipt-proven internal copies, with historical customer mail excluded. Backend-derived `isInternal` identifies these copies. `gmailActionsAvailable` describes provider readiness, independently of local management. Existing action endpoints persist account-owned label changes and versioned intent on the delivery receipt; the Gmail worker applies pending changes after reconnect/provider identity reconciliation using the owner's grant. Metadata ingestion overlays pending intent, and acknowledgement requires matching provider labels and version. Normal synchronization replaces local identities with verified recipient provider IDs on the same database record.

Reply to a proven internal message uses the same employee allowlist and internal delivery persistence as Forward. The existing composer defaults to the sender, preserves Reply headers, and requires Gmail for sending, provider draft saves and scheduling. Receipt-backed local source references remain valid after reconciliation; unavailable provider thread IDs are omitted. Internal copies have no CRM associations, Activities, engagement or workflow effects. Ordinary customer Compose/Reply retains existing authorization. Attachment storage requires the existing [private storage mount](setup/coolify-private-storage.md); internal cache keys are never returned to clients. See [recipient action verification](verification/inbox-internal-actions.md).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/integrations/gmail/authorize`, `/integrations/gmail/status` | OAuth URL/connection status |
| GET | `/integrations/gmail/callback` | State-validated provider callback |
| POST | `/integrations/gmail/sync`, `/integrations/gmail/disconnect` | Request sync/disconnect |
| GET | `/integrations/gmail/emails`, `/integrations/gmail/unread-count`, `/integrations/gmail/events` | Persisted mailbox reads/counts/events |
| GET | `/integrations/gmail/threads/:threadId` | Scoped thread |
| GET | `/integrations/gmail/messages/:messageId/content` | Refresh an expanded authorized message's original body and attachment metadata |
| GET | `/integrations/gmail/messages/:messageId/attachments/:attachmentId` | Download authorized Gmail or cached internal-forward attachment bytes |
| GET | `/integrations/gmail/conversations/:conversationId` | Scoped Gmail thread and Deal history, bounded message pages |
| PATCH | `/integrations/gmail/messages/:messageId/read-state` | Read/unread one currently authorized message |
| POST | `/integrations/gmail/send`, `/integrations/gmail/drafts` | Send/save draft |
| DELETE | `/integrations/gmail/drafts/:draftId` | Remove draft |
| POST | `/integrations/gmail/scheduled` | Queue Gmail-backed scheduled message |
| GET | `/integrations/gmail/scheduled/:id` | Read own scheduled message status/body/cancel capability |
| POST | `/integrations/gmail/scheduled/:id/cancel` | Cancel pending/claimed message; retain Gmail draft |

For All, Unread, and Sent, `/emails` returns one-to-one conversation summaries identified by tenant, connected mailbox, normalized external email address, and validated Deal context. Separate Gmail threads with the same correspondent and Deal share one row; messages without a Deal share a separate no-Deal row for that correspondent. Multi-participant conversations retain their original Gmail thread and Deal boundaries. Customer and agent replies update that group's `messageCount`, preview, date, and unread state. Valid saved message-to-Deal links take precedence; thread context applies only when unambiguous and consistent. Original provider IDs remain unchanged. Drafts and Scheduled remain individual items. Authorization precedes aggregation, search, counts, sorting, and pagination.

Conversation history accepts `maxResults` (1–50, default 50) and `pageToken`. It opens the latest page of the selected group in chronological order, with a continuation for older messages. Mailbox revisions or assignment changes invalidate old cursors. Original `/threads/:threadId` consumers remain supported. Reply uses the selected provider message ID and its stored original Gmail thread and RFC headers, never `conversationId`.

The shared list contract accepts `view: 'inbox' | 'archived'`, defaulting to Inbox. A mixed group stays in Inbox while any eligible received message retains `INBOX`; once all received messages are archived, its complete history appears in Archived Messages. Sent-only groups never appear in Archived Messages. Drafts, Scheduled, Spam, Trash, and Deleted messages are excluded from archived groups. Archived Messages supports All and Unread filters.

Existing bulk Archive/Trash routes and `POST /integrations/gmail/restore` accept `{ conversationIds }`, `{ threadIds }`, or `{ messageIds }`. Inbox list and viewer actions target the selected group only. The server resolves messages and rechecks authorization and group membership before writes. Group selections exceeding 1,000 messages are rejected before writing. Restore adds `INBOX` only to eligible received messages. Delete Permanently moves messages through Gmail's message `/trash` endpoint, allowing recovery in Gmail Trash. Responses report confirmed message/group completions and provider partial failures; persisted labels change only after provider success.

`PATCH /integrations/gmail/threads/:threadId/deal` accepts `dealId` and mutually exclusive optional `conversationId` or `messageId` targets. Confirmed-send retries target the sent message; conflicting saved message links reject a broader write. Inbox, Deal Files, and Deal email Activity share validated Deal precedence. Persisted Activity may display Trash history through existing mailbox authorization; Gmail attachment references remain unavailable while their source is in Trash. See the [implementation and verification report](inbox-deal-conversations-report.md).

Scheduled detail/cancel require the same tenant, owned account, and original creating user. Cancellation is idempotent for an already cancelled item and returns 409 after delivery starts or if its outcome needs verification. The worker never blindly resends an uncertain Gmail submission. See [engagement](engagement-deal-creation.md).

### Notifications and preferences

`/notifications` includes list/counts/operations, destination validation, read/read-all, deletion, and personal preferences. Access is session-scoped; destinations retain module checks. Saved columns/table preferences use `/preferences/columns` and `/preferences/table`. These are existing authenticated services, not tenant IDs supplied by clients.

Notification counts and mutation responses include `unreadRecords` entries (`entityType`, `entityId`, `count`) for accessible Lead, Contact, Account, Deal, Task, Campaign, Workflow, Form, User and RoleDefinition destinations. Each entry represents one record; the bell's `unreadCount` counts individual visible notifications. Client Admin feeds, counts, indicators and mutations apply the [administrative notification policy](notifications-final-policy.md); excluded historical rows remain stored with their original read state. `PATCH /notifications/read-all` accepts an optional `record: { entityType, entityId }` alongside the existing `before` cutoff to read only that record's notifications for the current recipient. Omit `record` for the existing mark-all behavior. Converted Leads follow their authorized Contact destination. Record reads return `readRecord` and `readBefore`; the shared notification watcher updates dots and bell state after success, using its existing background interval for other sessions' changes. Opening an existing User panel or a successfully loaded Role Details drawer reads only that record's notifications. Settings Forms reuse their existing builder read flow; navigating Settings sections does not mark records read.

The same counts and mutation responses include `unreadBySettingsTab`: optional totals keyed by `users` (user creation, status and role assignment), `roles` (role creation, archival and permission changes), or `profile` (password expiry). A supported event contributes only when its current authorized destination matches that tab. Settings submenu dots share the existing watcher; navigating between Settings sections does not mark notifications read. Unmapped events retain the existing `unreadByModule` behavior.

Notification worker due/lease checks and new outbox timestamps use explicit UTC, including when the database session uses Asia/Manila. The forward migration preserves historical timestamps rather than guessing their original timezone.

---

## Reporting Endpoints (`/api/v1/reporting/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/reporting/dashboard` | Authorized snapshot of KPIs, charts, conversion, leaderboard and actions |
| `GET` | `/reporting/dashboard/export` | CSV of the same reporting definitions and scope |
| `GET` | `/reporting/dashboard/events` | Cookie/Bearer-authorized SSE of committed tenant revisions |
| `GET` | `/reporting/pipeline-summary` | Compatibility response using current open counts and this-month terminal counts |
| `GET` | `/reporting/deal-velocity` | Compatibility response using this-month won duration; lost duration unavailable |
| `GET` | `/reporting/contact-status` | Eligible organization Leads by status |
| `GET` | `/reporting/task-completion` | Authorized task totals, pending and overdue counts |
| `GET` | `/reporting/campaign-summary` | Existing campaign report |

Dashboard queries accept `range=today|last7|last30|thisMonth|lastMonth|last3|last6|thisYear|custom`.
Default: `thisMonth`. Custom requires inclusive `start` and `end` calendar dates (`YYYY-MM-DD`), ordered and at most 732 days apart.
`revenueInterval=week|month|year` defaults to month and changes calendar grouping inside that global period.
`funnelRange=week|month|year|custom` defaults to month and defines an independent creation cohort.
Custom funnel requests require `funnelStart` and `funnelEnd` (`YYYY-MM-DD`), ordered, historical through Manila today and at most 732 days. Milestones stop at the earlier of generation time and the end of the funnel To day. CSV accepts these same filters and includes the observation cutoff.
Unknown query fields, including tenant IDs, are rejected. See [Dashboard definitions](dashboard-kpis.md) for Manila boundaries and metric populations.

All Dashboard APIs require `dashboard.view`, the existing organization reporting grant. Module `canView` grants gate dependent data. Client Admin and explicitly authorized staff/custom roles receive tenant-wide analytics. Action Center retains organization scope for Client Admin and permitted assigned action details for others. No role permissions are automatically granted.
Responses use `Cache-Control: no-store`. The frontend forwards through `/api/proxy` with the existing session cookie.
SSE emits `dashboard-change` with string counters (`analytics`, `leads`, `actions`, `access`), `dashboard-heartbeat`, `dashboard-unavailable`, or `dashboard-access-changed`.
Counters contain no CRM record data. The stream checks current session and reporting permissions every three seconds, ends after 45 seconds and advertises a three-second reconnect delay.

`GET /api/v1/auth/events` provides the same persisted access-revision stream independently of Dashboard permission.
It emits `authorization-change` (access counter only), `authorization-heartbeat`, `authorization-unavailable`, and `authorization-access-changed`.
This lets existing frontend permission guards remove revoked modules and restore later grants without a page reload.

`GET /api/v1/crm/pipelines/events` requires `deals.view` and current workspace readiness. It emits `pipeline-change` with a hash of committed tenant stage metadata, `pipeline-heartbeat`, `pipeline-unavailable`, and `pipeline-access-changed`, using the same three-second observation and bounded reconnect lifecycle. The shared Deals provider refreshes stage selectors only when metadata changes, after reconnection or on focus. Stage writes retain `deals.manage_stages` and validate six-digit hexadecimal colors in the existing `color` field. Official Sales Pipeline names/order/outcomes cannot be replaced or removed through stage management.
The Next proxy forwards both streams without buffering. No additional WebSocket service or browser token storage is required.

---


## Provider webhooks

- `POST /api/v1/webhooks/brevo`: Campaign email status with configured webhook authentication.
- `POST /api/v1/webhooks/textbee`: SMS delivery status with configured signed-webhook validation.

Mailbox synchronization uses its existing server-side incremental Gmail job; there is no registered Gmail push webhook. See the provider reports and server environment examples for current configuration.

---

## Tenancy Rule

Protected domain requests derive tenant identity from the verified session. Record lookups and relationship writes must retain that tenant scope; clients cannot choose a tenant through the request body. Public Forms resolve the tenant from the published Form on the server. Authentication and provider callbacks retain their dedicated identity-validation paths.

---

## RBAC

Permission keys come from the shared module/action catalog. Middleware uses `authorize`, `authorizeAll`, or `authorizeAny`; the permission service resolves current role grants from `RolePermission` rows, including module-specific action fields. Missing grants deny access. Client Admin retains the protected tenant-admin model, while some administrative operations explicitly require that role.

Frontend permission guards improve the user flow; server checks enforce it. Groups choose assignment pools and do not grant permissions. Access revisions refresh current authorization across open views. Workspace status fails closed unless it is `ACTIVE` or the compatibility `SANDBOX` status.

Customer Group ownership is retired. Lead, Contact, Account and Deal create/update
requests reject `ownerGroupId`, including `null`, with HTTP 400. Customer responses
omit that field; `/crm/record-access` omits `groupGrants`, and employee eligibility
responses omit `assignableGroupModules`. Access and assignment use current employee
roles and Assigned Agent, with Accounts retaining tenant-scoped module access.
`PATCH /administration/groups/:id/members/:userId` for a membership CRM role is
removed (HTTP 404). Employee memberships, Group Heads and workflow Group pools
remain supported in Team Management; Group responses omit `crmRoleId`.

Apply `20261227000000_retire_crm_group_ownership` with old APIs/workers stopped,
then regenerate Prisma and release matching clients. Legacy ownership/role values
remain private ignored metadata; the migration does not rewrite customer records,
employee memberships, assigned roles, permissions or status history. Old clients
must reload before submitting customer forms.

## Current rollout additions

The [retired relationship rollout](retired-relationships.md) removes TaskAccount and SmsCampaignLink through a preserving expansion and separate guarded retirement. Current Account task context derives from associated Deals. Task responses retain compatible direct Account fields as `accountId: null`, `account: null`, `accountIds: []`, and `accounts: []`; private `retiredAccountLinks` is never serialized. Existing TaskLead/TaskContact reads and historical Activity/AuditLog events remain available.

New SMS sends original personalized URLs, records `smsTrackingVersion: 0` and returns unavailable click totals/rates as `null`. Historical SMS reports retain frozen counts and destinations. Existing public `/public/sms-links/:token` and frontend `/s/:token` redirects remain supported without click writes. The private `smsLinkHistory` snapshot and opaque tokens are not included in report recipients. Sender settings return `trackingOrigin: null`. Provider delivery tracking and email engagement remain independent.

Stop old backend processes, then apply `20261116000000_user_groups`, `20261117000000_campaign_submission_recovery`, `20261118000000_group_revisions` and `20261119000000_notification_utc_timestamps` after the existing migration history and before starting the updated backend. These preserve legacy Department values as same-tenant Group memberships, add durable interrupted submission handling, reuse the access-revision stream for Group synchronization and make new notification timestamps explicitly UTC. See [rollout](../README.md#forward-rollout) and the [polish plan](plans/system-polish.md).

## Creator, membership, and archive visibility

Campaign and interactive Workflow requests require original creator ownership for
staff and remain tenant-wide for Client Admin. Workflow creation/duplication
records server-owned `createdById`; unknown historical creators remain admin-only.
Campaign audiences intersect existing CRM access with current Lead/Contact
Assigned Agent for staff, including preview and scheduled dispatch. Saved audience
definitions remain shared within the tenant; no client-supplied creator or
recipient IDs establish authorization.

Team Management and Workflow builder Group lookups return only actual member Groups to staff. Creation does not
add membership. Membership/Head administration retains its existing Client Admin
checks; Groups do not grant customer ownership or CRM permissions.

Archived Data additionally requires the archiver plus existing source-module and
record permissions for staff, including Campaign/Workflow creator access, source archived queries and direct restore
or reactivation paths. Existing `deletedBy` metadata is authoritative where
available. Other types use per-record archive lifecycle audits; new
`archive.archived`/`archive.restored` transitions commit with the record mutation
and take precedence over legacy best-effort logs. Historical records with no
unambiguous ownership remain visible only to authorized Client Admins. A repeated
archive call does not transfer ownership.

Apply `20261228000000_role_based_visibility` after the existing migrations before
running matching API/workers. It adds immutable nullable Workflow creator metadata,
backfills only proven same-tenant creation/duplication audits, and indexes creator
queries. It does not infer creators from activators or assignees.
