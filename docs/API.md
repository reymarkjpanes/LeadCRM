# LeadCRM — API Reference

## Status
For the implemented Campaigns, Templates, Target Audiences, and Brevo webhook endpoints, see [Campaign email delivery](campaign-email-delivery.md).

The backend includes implemented CRM, authentication, administration, campaigns, workflows, forms, imports, and mailbox modules. Module-specific references below describe their contracts.

See the [database audit](database/normalization-report.md) for relations, compatibility fields, and verified deployment notes, and [engagement and Deal creation](engagement-deal-creation.md) for the additive Deal creation receipt. Existing databases use the forward migration deployment command, `npm --prefix backend run db:deploy`.

Deal `leadId`/`contactId` and Task `leadId`/`contactId`/`dealId`/`accountId` remain
public API projections of ordered junctions. Plural association fields remain
supported; singular response IDs identify the first ordered participant. They are
not independent database columns in the final schema. Mailbox thread associations
use `MailboxThreadAssociation`; generic mailbox-thread preferences are retired.
Column retirement uses `db:relations:retire` only after exact-release verification.

## Base URL
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

---

## Auth Endpoints

All paths are relative to /api/v1. See [authentication and onboarding](authentication.md).

| Method | Path | Responsibility |
| --- | --- | --- |
| POST | /auth/login | Password verification and a normal HttpOnly session cookie |
| GET | /auth/me | Current database-backed account state, including mustChangePassword, passwordChangedAt, and read-only Group summaries |
| PATCH | /auth/profile | Update only the authenticated user's firstName, lastName, phone, jobTitle; returns the canonical user |
| POST | /auth/profile/avatar | Authenticated raw JPEG/PNG/WebP body, maximum 5 MB; stores a normalized 512×512 WebP in private Supabase Storage and returns the canonical user |
| GET | /auth/profile/avatar/:avatarId | Authenticated retrieval of the current user's saved avatar; private, uncached response |
| POST | /auth/logout | Revoke session and expire cookie |
| POST | /auth/change-password | Use authenticated session, store strong password, clear first-login flag and revoke other sessions |
| POST | /auth/forgot-password | Request password recovery |
| POST | /auth/reset-password | Complete password recovery and revoke sessions |
| GET | /auth/onboarding/status | Canonical account state |
| POST | /auth/onboarding/complete | Per-user informational acknowledgment after password setup; empty body |

`POST /auth/forgot-password` accepts only `{ email }`. The shared schema trims and lowercases the address before the authoritative case-insensitive lookup. Under the owner's approved disclosure policy, an unknown address returns HTTP 404 and `{ success: false, error: { code: "ACCOUNT_NOT_FOUND", message: "No account exists with this email address." } }`. Known restricted/ambiguous identities receive the same neutral success shape as eligible accounts, without security metadata, tokens or tenant selection.

Recovery success contains `success`, the neutral `message`, `expiresInMinutes`, and `resendAfterSeconds`; it confirms request processing, not inbox delivery. Definite email submission rejection returns HTTP 502 with `PASSWORD_RESET_EMAIL_FAILED`. Uncertain submission returns HTTP 502 with `PASSWORD_RESET_SUBMISSION_UNCONFIRMED` and `retryAt`, and suppresses additional email submission until that attempt expires. Resend uses this same route. Production recovery limits remain three requests per IP per hour, with an additional three per normalized address per hour. See the [recovery verification report](password-recovery-verification.md) for acceptance evidence and rollout requirements.

Public signup, Google sign-in, OTP, verification, company setup, and step-progression routes are not registered. SaaS billing, seat, document-verification, pricing, checkout, and payment-method APIs are retired. Customer invoice/payment APIs and Team Management domain APIs are also removed. See [security API and migration report](security-cleanup-mfa.md).

Profile updates use a strict shared Zod whitelist and derive both user and tenant identity
from the session. Email and privilege fields are not editable. Avatar references are only
written by the upload service; JSON profile patches cannot supply arbitrary avatar URLs.
Group membership is administrator-managed; self-profile patches reject `groupIds` and the retired `department` field. Both updates are audited. Existing `GET /auth/me` restores saved profile values after reload.
Storage requires server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_AVATAR_BUCKET`. Use a private bucket accepting `image/webp`, with a 5 MB limit.
The browser crops before upload; the server decodes, validates and re-encodes the image,
generates a UUID key under the authenticated tenant/user, and saves a durable authenticated
avatar reference in `User.avatarUrl`. Do not expose the service key as a `NEXT_PUBLIC_*` value.


---

## CRM Endpoints (`/api/v1/crm/`)

All require an authenticated session and completed per-user onboarding. Deal account filtering uses canonical `accountId`; the compatibility `organizationId` alias must agree when both are supplied.

For Lead, Contact, and Account archive/restore endpoints, permissions, archived
queries, and migration requirements, see [CRM archive verification](crm-archive-verification.md).

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
The account create/edit UI always submits `country: "Philippines"`; unrelated API
and import country behavior is unchanged.

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

Lead, Contact and Account Product display arrays keep their existing response
shape but are derived from normalized ProductInterest junctions. The internal
normalization marker is not exposed by ordinary record responses. Unresolved
legacy rows retain their original arrays until reconciled. Renames are reflected
in normalized displays; retained inactive Product relationships remain valid.
Returning Contact form inquiries add Product links and new priced Deals. Retrying
the same `requestId` does not duplicate the submission or Deals.

Product configuration uses `GET /administration/product-interests` and
`PATCH /administration/product-interests/:id` (under `/api/v1`). The update requires
`products.edit`, a valid product UUID, and a non-empty patch containing a trimmed
name and/or a non-negative numeric
amount with at most two decimal places. It returns the updated catalog after the
transaction commits. `ProductInterest.dealValue` remains the existing decimal
database field; currency formatting is presentation only.
The editor accepts `₱25,000.00` and sends `dealValue: 25000`; formatted strings are
not accepted by the API. See [the normalization report](product-normalization-report.md)
for migration verification and deployment requirements.

| Method | Path | Description |
|---|---|---|
| `GET` | `/crm/deals` | List deals |
| `POST` | `/crm/deals` | Create deal |
| `POST` | `/crm/deals/batch` | Atomically create one Lead-stage Deal per selected canonical Product; requires `deals.create` |
| `PUT` | `/crm/deals/:id` | Update deal |
| `PATCH` | `/crm/deals/:id/stage` | Move deal to new stage |
| `GET` | `/crm/pipelines` | List pipelines |
| `GET` | `/crm/pipelines/:id` | Read pipeline including ordered stages |
| `POST` | `/crm/stages` | Add a stage to the existing pipeline |
| `PUT` | `/crm/stages/:id` | Rename/update a stage |
| `DELETE` | `/crm/stages/:id` | Remove an unused, unprotected stage |
| `PATCH` | `/crm/pipelines/:id/stages/reorder` | Reorder all stages in that pipeline |

Stage removal rejects default/won/lost stages and stages referenced by any Deal
(including archived Deals) or stage history. It does not reassign or orphan Deals.

`POST /crm/deals/batch` accepts `idempotencyKey` (UUID), unique `productInterestIds`,
`pipelineId`, the pipeline's `Lead` `stageId`, and common `title`, `priority`,
`expectedCloseDate`, `accountId`, `assignedUserId`, `contactIds`, `leadIds`,
`leadSource`, `industry` (from `COMPANY_INDUSTRIES`), `address`, `billingFrequency`,
and `productInterestOther`. Prices and currency are server-owned Product snapshots
in PHP. The response is `{ success: true, data: { deals: Deal[], replayed: boolean } }`,
with 201 for creation, 200 for identical replay, and 409 for an actor/payload conflict
on a previously used key. Multi-Deal titles are `Entered title — Product name`, with
the entered portion shortened to fit 255 characters. A single title is preserved.
All relationships, audit records, Deals and the tenant-scoped receipt commit together.
The existing single-Deal endpoint and response remain supported.

Mailbox reply timing, related-Deal Workflow options, Custom Fields and migration
instructions are documented in [engagement and Deal creation](engagement-deal-creation.md).

Module-scoped field definitions, record values, uploads, permissions and the
preserving migration are documented in [Custom Fields](custom-fields.md).

Lead and Contact create requests require a trimmed, valid email of at most 254
characters. Updates may omit email, but cannot submit an empty or invalid email.
Accounts retain their existing email rules.

Record file history uses `GET`/`POST /crm/{module}/:id/files` and
`GET /crm/{module}/:id/files/:fileId/download` for `leads`, `contacts`, `accounts`,
and `deals`. These reuse the existing scoped file service and storage provider.

### CRM CSV imports

Paths below are relative to `/api/v1`. Replace `{module}` with `leads`, `contacts`,
`accounts`, or `deals`. The browser preserves Upload → Map Columns → Review & Validate;
both preview and execution parse the source CSV and validate relationships on the server.

| Method | Path | Description | Permission |
|---|---|---|---|
| `POST` | `/crm/{module}/imports/upload` | Optional durable source chunks, each at most 65,536 characters | Import permission |
| `POST` | `/crm/{module}/imports/preview?offset=0` | Review up to 25 rows, or return existing execution metadata | Import permission |
| `POST` | `/crm/{module}/imports` | Commit up to 25 remaining rows; HTTP 202 while importing, 201 when complete | Import permission |
| `GET` | `/crm/{module}/imports` | Paginated history; optional job status filter | `{module}.view` |
| `GET` | `/crm/{module}/imports/:importId` | Saved summary | `{module}.view` |
| `GET` | `/crm/{module}/imports/:importId/results` | Paginated results; optional `status=imported\|failed\|duplicate` | `{module}.view` |

Import permissions are `leads.import`, `contacts.import`, `accounts.import`, and
the existing `deals.create`. Preview and execution accept `{ fileName, csvText,
mappings, idempotencyKey }`; mappings associate field keys with zero-based CSV
column indices. Alternatively replace `csvText` with `uploadId` after uploading
`{ uploadId, chunkIndex, totalChunks, content }`. Limits: 10 MiB UTF-8, 5,000 rows,
100 columns. Chunk sources are scoped to tenant/user/module and expire after 24 hours.
Completed imports delete raw chunks immediately; startup/hourly cleanup removes
expired upload parents and remaining chunks without deleting job history.

Repeat the identical execution request until its status is no longer `importing`.
Reuse the UUID idempotency key across retries; different input with the same key
returns 409. Committed rows and automatically created Deals are transactional.
All four routes use `CrmImportJob` and `CrmImportRowResult`, filtered by tenant
and the `CrmImportModule` enum. Idempotency is unique per tenant/module/key.
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

Duplicate uses `POST /automation/workflows/:id/duplicate` to create an inactive draft copy. Removal uses archive; there is no workflow DELETE endpoint.

Validation accepts the shared workflow draft plus an optional `workflowId`. The
server resolves that ID within the current tenant to preserve unchanged literal
empty-string conditions from previously active workflows. New blank conditions
must be completed or use `is_empty` / `is_not_empty` before activation. Saving an
inactive draft retains the existing validation rules.
The server recalculates `incompleteValue` metadata on saved condition rules so a
new missing value cannot become a historical-literal exception after a paused
draft save. This metadata does not change the condition's value or execution
operator.

Assignment configuration and versioned execution history are documented in
[Workflow assignment and history](workflows/workflow-assignment-history.md).
Role/Group assignment methods include round-robin, least workload, random,
availability-based, capacity-based and sticky assignment. Availability schedules,
capacity limits and member overrides are saved in `config.assignmentTarget`.
The shared contract validates these settings; workflow options include eligible
pool members for configuring overrides. Dry tests return the selection reason
and applicable workload/limit without reserving work or changing assignment state.

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
metadata and does not change the fixed employee-email policy.

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
| PATCH | `/administration/users/:id/archive` | Archive user | `users.archive` |
| PATCH | `/administration/users/:id/restore` | Restore user | `archived_data.restore` + `users.view` |
| POST | `/administration/users/:id/password-reset` | Recovery request; no token returned to administrator | `users.edit` |
| GET | `/administration/groups` | Group/member reference | `groups.view` |
| POST / PUT | `/administration/groups` / `/administration/groups/:id` | Create/update Group | `groups.create` / `groups.edit` |
| DELETE | `/administration/groups/:id` | Remove Group | `groups.delete` |
| POST | `/administration/groups/:id/members` | Add same-tenant member | Client Admin + `groups.edit` |
| DELETE | `/administration/groups/:id/members/:userId` | Remove membership | Client Admin + `groups.edit` |

User create requires first/last name, normalized employee email, PH mobile phone, and an active custom role's exact name. Group writes accept `groupIds: string[]` (unique UUIDs, at most 100); omitted means no membership change, and `[]` clears memberships. Only Client Admin with `groups.edit` can submit membership changes. Group IDs must belong to the current tenant. Membership writes require the target user to be active; activation and membership changes can commit together. User/auth responses expose `groups: [{id,name}]`; self-profile cannot modify them. The retired Department field is rejected.

Membership, role, audit, and scalar user writes are transactional. Unfinished, nonarchived Tasks participate in deactivation reassignment; completed/cancelled historical Tasks keep their original assignee. Replacement eligibility includes Task view access when unfinished Tasks exist. There is no registered Users export, permanent-delete, invite, or standalone status endpoint.

### Roles, archive, and audit

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/administration/roles`, `/administration/roles/:id` | Role definitions and permission rows | `roles.view` |
| POST | `/administration/roles` | Create custom role | `roles.create` |
| PUT | `/administration/roles/:id` | Save name/description and optional permission replacement atomically | `roles.edit` |
| PATCH | `/administration/roles/:id/archive` | Archive custom role | `roles.archive` |
| POST / DELETE | `/administration/roles/assign` / `/administration/roles/unassign` | Assign/remove role | `roles.assign` |
| GET | `/administration/permissions` | Permission-builder reference | `roles.view` |
| GET | `/administration/audit` | Paginated team activity history | `users.view` |
| GET | `/administration/archived-data` | Supported archived records, including roles | `archived_data.view` plus per-type service checks |
| PATCH | `/administration/archived-data/:type/:id/restore` | Restore supported record type | `archived_data.restore` plus per-type service checks |

Role create/update bodies use `permissions` rows from the shared module/action catalog. There are no separate registered role permission-update endpoints. Protected system roles keep their safeguards. Group membership does not replace module permission grants.

### Inbox integration

Gmail routes are under `/integrations/gmail`. The OAuth callback is state-validated; other routes require an authenticated ready workspace, either `leads.view` or `contacts.view`, and mailbox ownership/current CRM scope checks. Staff Inbox uses the employee's own connected account. Recipient access is rechecked before delivery, including Workflow and scheduled sends.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/integrations/gmail/authorize`, `/integrations/gmail/status` | OAuth URL/connection status |
| GET | `/integrations/gmail/callback` | State-validated provider callback |
| POST | `/integrations/gmail/sync`, `/integrations/gmail/disconnect` | Request sync/disconnect |
| GET | `/integrations/gmail/emails`, `/integrations/gmail/unread-count`, `/integrations/gmail/events` | Persisted mailbox reads/counts/events |
| GET | `/integrations/gmail/threads/:threadId` | Scoped thread |
| GET | `/integrations/gmail/conversations/:conversationId` | Scoped correspondent history, bounded message pages |
| PATCH | `/integrations/gmail/messages/:messageId/read-state` | Read/unread one currently authorized message |
| POST | `/integrations/gmail/send`, `/integrations/gmail/drafts` | Send/save draft |
| DELETE | `/integrations/gmail/drafts/:draftId` | Remove draft |
| POST | `/integrations/gmail/scheduled` | Queue Gmail-backed scheduled message |
| GET | `/integrations/gmail/scheduled/:id` | Read own scheduled message status/body/cancel capability |
| POST | `/integrations/gmail/scheduled/:id/cancel` | Cancel pending/claimed message; retain Gmail draft |

For All, Unread, and Sent, `/emails` returns correspondent summaries with a tenant/account-scoped `conversationId`, `conversationKind`, exact normalized `correspondentAddresses`, authorized `messageCount`, and latest-message metadata. One-to-one histories consolidate distinct Gmail threads sharing the same exact external address. Threads containing several external participants retain a separate group identity. Drafts and Scheduled remain individual items. Search matches authorized messages before returning each complete group once; unread counts count groups containing incoming unread messages.

Correspondent history accepts `maxResults` (1–50, default 50) and `pageToken`. Original Gmail topics are ordered by their first authorized activity, then provider thread ID; messages within each topic are ordered by timestamp, then provider message ID. Cursor changes caused by mailbox revisions or assignment changes require a reload. Original `/threads/:threadId` consumers remain supported. Reply uses the selected provider message ID and its stored original Gmail thread and RFC headers, never `conversationId`.

Existing bulk Archive/Trash routes accept `{ conversationIds }`, `{ threadIds }`, or `{ messageIds }`. Correspondent toolbar/list actions cover all currently authorized non-draft messages across the selected histories; topic controls target one original Gmail thread. Each message is reauthorized before its provider mutation. Group selections exceeding 1,000 messages are rejected before writing; use topic controls for larger histories. See the [implementation and verification report](inbox-correspondent-grouping-report.md).

Scheduled detail/cancel require the same tenant, owned account, and original creating user. Cancellation is idempotent for an already cancelled item and returns 409 after delivery starts or if its outcome needs verification. The worker never blindly resends an uncertain Gmail submission. See [engagement](engagement-deal-creation.md).

### Notifications and preferences

`/notifications` includes list/counts/operations, destination validation, read/read-all, deletion, and personal preferences. Access is session-scoped; destinations retain module checks. Saved columns/table preferences use `/preferences/columns` and `/preferences/table`. These are existing authenticated services, not tenant IDs supplied by clients.

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

## Current rollout additions

Stop old backend processes, then apply `20261116000000_user_groups`, `20261117000000_campaign_submission_recovery`, `20261118000000_group_revisions` and `20261119000000_notification_utc_timestamps` after the existing migration history and before starting the updated backend. These preserve legacy Department values as same-tenant Group memberships, add durable interrupted submission handling, reuse the access-revision stream for Group synchronization and make new notification timestamps explicitly UTC. See [rollout](../README.md#forward-rollout) and the [polish plan](plans/system-polish.md).
