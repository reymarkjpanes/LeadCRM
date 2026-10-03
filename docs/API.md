# LeadCRM — API Reference

## Status
For the implemented Campaigns, Templates, Target Audiences, and Brevo webhook endpoints, see [Campaign email delivery](campaign-email-delivery.md).

Backend is scaffolded. Contacts endpoints are wired. All other modules have stub controllers returning empty arrays, ready for implementation.

**Schema v2** — 30 entities in Prisma DB. Run `npx prisma migrate dev` in `backend/` to apply all migrations.

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

## Standard Response Envelope
```typescript
// Success
{ success: true, data: T, meta?: PaginationMeta }

// Error
{ success: false, error: "Human-readable message" }

// Paginated
{ success: true, data: T[], meta: { total, page, limit, hasMore } }
```

---

## Auth Endpoints

All paths are relative to /api/v1. See [authentication and onboarding](authentication.md).

| Method | Path | Responsibility |
| --- | --- | --- |
| POST | /auth/login | Password verification and a normal HttpOnly session cookie |
| GET | /auth/me | Current database-backed account state, including mustChangePassword and passwordChangedAt |
| PATCH | /auth/profile | Update only the authenticated user's firstName, lastName, phone, jobTitle, department; returns the canonical user |
| POST | /auth/profile/avatar | Authenticated raw JPEG/PNG/WebP body, maximum 5 MB; stores a normalized 512×512 WebP in private Supabase Storage and returns the canonical user |
| GET | /auth/profile/avatar/:avatarId | Authenticated retrieval of the current user's saved avatar; private, uncached response |
| POST | /auth/logout | Revoke session and expire cookie |
| POST | /auth/change-password | Use authenticated session, store strong password, clear first-login flag and revoke other sessions |
| POST | /auth/forgot-password | Request password recovery |
| POST | /auth/reset-password | Complete password recovery and revoke sessions |
| GET | /auth/onboarding/status | Canonical account state |
| POST | /auth/onboarding/complete | Client Admin informational acknowledgment; empty body |

Public signup, Google sign-in, OTP, verification, company setup, and step-progression routes are not registered. SaaS billing, seat, document-verification, pricing, checkout, and payment-method APIs are retired. Customer invoice/payment APIs and Team Management domain APIs are also removed. See [security API and migration report](security-cleanup-mfa.md).

Profile updates use a strict shared Zod whitelist and derive both user and tenant identity
from the session. Email and privilege fields are not editable. Avatar references are only
written by the upload service; JSON profile patches cannot supply arbitrary avatar URLs.
Both updates are audited. Existing `GET /auth/me` restores saved profile values after reload.
Storage requires server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_AVATAR_BUCKET`. Use a private bucket accepting `image/webp`, with a 5 MB limit.
The browser crops before upload; the server decodes, validates and re-encodes the image,
generates a UUID key under the authenticated tenant/user, and saves a durable authenticated
avatar reference in `User.avatarUrl`. Do not expose the service key as a `NEXT_PUBLIC_*` value.


---

## CRM Endpoints (`/api/v1/crm/`)

All require an authenticated session and completed workspace onboarding.

For Lead, Contact, and Account archive/restore endpoints, permissions, archived
queries, and migration requirements, see [CRM archive verification](crm-archive-verification.md).

### Contacts

| Method | Path | Description | Permission |
|---|---|---|---|
| `GET` | `/crm/contacts` | List contacts (paginated, filterable) | `contacts.view` |
| `GET` | `/crm/contacts/:id` | Get contact by ID | `contacts.view` |
| `POST` | `/crm/contacts` | Create contact | `contacts.create` |
| `PUT` | `/crm/contacts/:id` | Update contact | `contacts.edit` |
| `PATCH` | `/crm/contacts/:id/archive` | Archive contact | `contacts.delete` |

**Query params for GET /contacts:**
- `?page=1&limit=20` — pagination
- `?status=HOT` — filter by status (HOT, WARM, COLD, CANCELLED, CLOSED)
- `?search=john` — search by name, email, or company
- `?archived=true` — show archived contacts

### Accounts

`POST /crm/accounts` and `PUT /crm/accounts/:id` no longer accept Account/Customer
Type, Customer Since, or Tax ID as account input fields. The account schemas strip
unknown keys before persistence. The retired fields are absent from Prisma,
database columns, and Account responses after the forward cleanup migration.
The account create/edit UI always submits `country: "Philippines"`; unrelated API
and import country behavior is unchanged.

### Deals / Pipeline

Manual `POST /crm/deals` accepts active, tenant-owned `productInterestIds` (one or
more unique UUIDs); the existing singular `productInterestId` remains supported.
The server resolves catalog names and sums their numeric `dealValue` in the
creation transaction, sets the currency to PHP, and stores a price snapshot.
`PUT /crm/deals/:id` accepts the same ID array when changing products and derives
the new price on the server. Unchanged selections retain their snapshots, and
manual amounts cannot override product-linked prices. Later catalog price changes
do not rewrite existing Deals.
Trusted import flows keep their existing historical-value contract.

Product configuration uses `GET /administration/product-interests` and
`PATCH /administration/product-interests/:id` (under `/api/v1`). The update requires
`settings.edit`, a valid product UUID, a trimmed name, and a non-negative numeric
amount with at most two decimal places. It returns the updated catalog after the
transaction commits. `ProductInterest.dealValue` remains the existing decimal
database field; currency formatting is presentation only.

| Method | Path | Description |
|---|---|---|
| `GET` | `/crm/deals` | List deals |
| `POST` | `/crm/deals` | Create deal |
| `PUT` | `/crm/deals/:id` | Update deal |
| `PATCH` | `/crm/deals/:id/stage` | Move deal to new stage |
| `GET` | `/crm/deals/:id/actions` | List DealActions for a deal |
| `POST` | `/crm/deals/:id/actions` | Perform a DealAction (ASSIGN_AGENT, SEND_EMAIL, ADD_NOTE, etc.) |
| `GET` | `/crm/deals/:id/stage-history` | List DealStageHistory entries |
| `GET` | `/crm/pipelines` | List pipelines |
| `GET` | `/crm/pipelines/:id` | Read pipeline including ordered stages |
| `POST` | `/crm/stages` | Add a stage to the existing pipeline |
| `PUT` | `/crm/stages/:id` | Rename/update a stage |
| `DELETE` | `/crm/stages/:id` | Remove an unused, unprotected stage |
| `PATCH` | `/crm/pipelines/:id/stages/reorder` | Reorder all stages in that pipeline |

Stage removal rejects default/won/lost stages and stages referenced by any Deal
(including archived Deals) or stage history. It does not reassign or orphan Deals.

Lead and Contact create requests require a trimmed, valid email of at most 254
characters. Updates may omit email, but cannot submit an empty or invalid email.
Accounts retain their existing email rules.

Record file history uses `GET`/`POST /crm/{module}/:id/files` and
`GET /crm/{module}/:id/files/:fileId/download` for `leads`, `contacts`, `accounts`,
and `deals`. These reuse the existing scoped file service and storage provider.

### Deal imports

Paths below are relative to `/api/v1`. CSV parsing, column mapping, and preliminary
validation run in the browser at `/crm/deals/import`; execution revalidates every
row on the server. There is no separate upload or preview endpoint.

| Method | Path | Description | Permission |
|---|---|---|---|
| `POST` | `/crm/deals/imports` | Execute import; return HTTP 201 with saved summary | `deals.create` |
| `GET` | `/crm/deals/imports` | Paginated import history | `deals.view` |
| `GET` | `/crm/deals/imports/:importId` | Saved import summary | `deals.view` |
| `GET` | `/crm/deals/imports/:importId/results` | Paginated results; optional `status=imported\|failed` | `deals.view` |

Execution accepts `{ fileName, rows }`, with 1–5000 rows, each containing a unique
`rowNumber` and string fields. Required fields: `title`, `pipeline`, `stage`.
Optional fields: `value`, `priority`, `expectedCloseDate`, `account`, `contact`,
`assignedUser`. Pipelines/stages/accounts resolve by exact name or
ID; contacts/assignees resolve by email or ID. Ambiguous matches fail the row.
Relationships must belong to the authenticated tenant.
Valid rows write `Deal` and optional `ContactDeal`; all rows receive a saved
`DealImportResult` under `DealImport`. See [verification report](settings-team-deal-import-verification.md).

---

## Marketing Endpoints (`/api/v1/marketing/`) — Stub

For the database-backed Forms management, anonymous public routes, and submission
history, see [Forms implementation and verification](forms-production-report.md#actual-api-endpoints).

| Method | Path | Description |
|---|---|---|
| `GET` | `/marketing/campaigns` | List campaigns |
| `POST` | `/marketing/campaigns` | Create campaign |
| `PUT` | `/marketing/campaigns/:id` | Update campaign |
| `POST` | `/marketing/campaigns/:id/send` | Send campaign |
| `DELETE` | `/marketing/campaigns/:id` | Delete campaign |
| `GET` | `/marketing/campaigns/:id/metrics` | CampaignMetrics snapshots |
| `GET` | `/marketing/target-audiences` | List TargetAudiences |
| `POST` | `/marketing/target-audiences` | Create TargetAudience + conditions |
| `GET` | `/marketing/target-audiences/:id/preview` | Preview resolved contacts (dynamic query) |
| `GET` | `/marketing/templates` | List templates (Email + SMS) |
| `POST` | `/marketing/templates` | Create template |

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
| `GET` | `/automation/workflows/:id/executions` | Paginated execution history |
| `GET` | `/automation/workflows/:id/executions/:executionId` | Execution detail |
| `POST` | `/automation/workflows/:id/test` | Read-only sample validation |
| `GET` | `/automation/workflow-options` | Scoped users, pipelines, stages, templates and campaigns |
| `GET` | `/automation/triggers` | Supported event and condition metadata |
| `GET` | `/automation/actions` | Supported action metadata |

Duplicate uses `POST /automation/workflows` with an inactive copy. Removal uses archive; there is no workflow DELETE endpoint.

---

## Operations Endpoints (`/api/v1/operations/`) — Stub

| Method | Path | Description |
|---|---|---|
| `GET` | `/operations/service-orders` | List service orders |
| `POST` | `/operations/service-orders` | Create service order |
| `GET` | `/operations/tasks` | List tasks |
| `POST` | `/operations/tasks` | Create task |

---

## Administration Endpoints (`/api/v1/administration/`)

### Organization Settings

| Method | Path | Description | Permission |
|---|---|---|---|
| `GET` | `/administration/organization-settings` | Read the authenticated tenant's saved organization settings | `settings.view` |
| `PATCH` | `/administration/organization-settings` | Persist organization settings and audit the change | `settings.edit` |

Both endpoints require an authenticated, ready tenant workspace. PATCH accepts
only `name`, `industry`, `email`, `phone`, `domain`, and `address`. Name cannot be
blank; nonempty email must be valid. Phone accepts a Philippine landline such as
`+63 (28) 123-3488` and stores `+63281233488`. The shared Zod schema rejects letters,
malformed punctuation, mobile numbers and invalid lengths. All text is trimmed.
Cleared optional fields become `null`. The
response contains `id` and all six canonical saved values. Tenant identity comes
from the session, never the request body. `domain` is descriptive organization
metadata and does not change the fixed employee-email policy.

### Users
| Method | Path | Description | RolePermission flag |
|---|---|---|---|
| `GET` | `/administration/users` | List users | `users.canView` |
| `GET` | `/administration/users/:id` | Read a tenant user | `users.canView` |
| `GET` | `/administration/users/:id/avatar/:avatarId` | Read that tenant user's saved private profile image; verifies the persisted reference and returns an uncached image | `users.canView` |
| `POST` | `/administration/users` | Create user + send password setup email | `users.canEdit` (`users.manage`) |
| `PUT` | `/administration/users/:id` | Update user profile / role | `users.canEdit` |
| `DELETE` | `/administration/users/:id` | Delete user | `users.canEdit` (`users.manage`) |
| `PATCH` | `/administration/users/:id/archive` | Deactivate user and revoke sessions | `users.canEdit` (`users.manage`) |
| `PATCH` | `/administration/users/:id/restore` | Activate user | `users.canEdit` (`users.manage`) |
| `POST` | `/administration/users/:id/password-reset` | Send recovery email to the selected database user; HTTP 202 | `users.canEdit` (`users.manage`) |

There is no registered `/administration/users/:id/status` or
`/administration/users/invite` route. Status can also be changed through the
existing PUT endpoint using `ACTIVE` or `INACTIVE`. Create requires first name,
last name, email, PH mobile phone and an active tenant custom role's exact name.
Phone is stored as `+639xxxxxxxxx`; email is trimmed and lowercased. The existing
employee-domain policy still applies. Credentials and avatar URLs are not accepted.
Recovery reuses `PasswordResetToken` and the existing recovery service; tokens are
bound to the selected user ID. No reset token is returned to the administrator.

### Roles & Permissions
| Method | Path | Description | RolePermission flag |
|---|---|---|---|
| `GET` | `/administration/roles` | List RoleDefinitions | `roles.canEdit` (`roles.manage`) |
| `POST` | `/administration/roles` | Create RoleDefinition | `users.canCreate` |
| `PUT` | `/administration/roles/:id` | Update role name/description | `users.canEdit` |
| `DELETE` | `/administration/roles/:id` | Archive role | `users.canDelete` |
| `GET` | `/administration/roles/:id/permissions` | List RolePermission rows for a role | `users.canView` |
| `PUT` | `/administration/roles/:id/permissions` | Bulk upsert RolePermission rows | `users.canEdit` |
| `PATCH` | `/administration/roles/:id/permissions/:module` | Update single module flags | `users.canEdit` |

**RolePermission upsert body:**
```json
{
  "permissions": [
    { "module": "contacts",  "canView": true,  "canCreate": true,  "canEdit": true,  "canDelete": false },
    { "module": "deals",     "canView": true,  "canCreate": true,  "canEdit": true,  "canDelete": false },
    { "module": "campaigns", "canView": true,  "canCreate": false, "canEdit": false, "canDelete": false }
  ]
}
```

### Team Management activity history
| Method | Path | Description | RolePermission flag |
|---|---|---|---|
| `GET` | `/administration/audit` | Retained user-history log — paginated, filterable | `audit.view` |

**Query params for GET /audit:**
- `?category=crm` — filter by category (auth/crm/billing/workflow/admin/system)
- `?severity=WARNING` — filter by severity (INFO/WARNING/CRITICAL)
- `?userId=xxx` — filter by user
- `?entityType=Deal` — filter by entity type
- `?from=2026-01-01&to=2026-06-27` — date range
- `?page=1&limit=50`

---

## Reporting Endpoints (`/api/v1/reporting/`) — Stub

| Method | Path | Description |
|---|---|---|
| `GET` | `/reporting/dashboard` | Dashboard metrics |
| `GET` | `/reporting/contacts` | Contacts report |
| `GET` | `/reporting/pipeline` | Pipeline report |

---


## Webhook Endpoints (No Auth)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/webhooks/gmail` | Gmail push notifications |



---

## Tenancy Rule

Every query must include `WHERE tenantId = :tenantId`. The `tenantId` is always read from the JWT — never from the request body.

---

## RBAC

Permissions are stored in the `RolePermission` table — one row per module per role with
`canView`, `canCreate`, `canEdit`, `canDelete` boolean flags.

`Client Admin` bypasses all checks for their own tenant.

```typescript
// Middleware usage — reads from RolePermission table
router.post('/contacts',    rbac('contacts', 'canCreate'), controller.create);
router.put('/contacts/:id', rbac('contacts', 'canEdit'),   controller.update);
router.delete('/contacts/:id', rbac('contacts', 'canDelete'), controller.remove);

// rbac() resolves: prisma.rolePermission.findUnique({ where: { roleId_module: { roleId, module } } })
// Returns 403 if flag is false or row doesn't exist
```

Permission modules: `contacts` · `deals` · `organizations` · `campaigns` · `workflows` ·
`tasks` · `service_orders` · `reports` · `users` · `settings` · `audit`
