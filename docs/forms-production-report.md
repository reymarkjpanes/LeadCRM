# Forms implementation and verification

## Implementation

Forms remain under **Settings → Connect → Forms**. Both existing Forms entry points
use one implementation. Creating a form persists a separate seven-field Contact Us
template, with the requested twelve Product Interest options. CRM product columns
are existing free-text arrays; submissions retain the exact selected label without
rewriting historical CRM product labels.

The builder supports labels, placeholders, required fields, options, CRM mappings,
widths, tap-to-add, drag reorder, move up/down, and basic styling. Save draft is
explicit; failures keep edits visible. Revision checks reject stale saves. Publish
validates and snapshots the saved configuration. Draft edits never change the public
form until published. The Share panel includes paginated submission history.

The mobile list uses a compact New Form button and the existing portal menu with
Edit, Duplicate, Delete. Published cards offer Unpublish; their Delete action stays
disabled with an explanation until unpublished. Permanent deletion requires the
existing destructive confirmation dialog. Published badges are blue; drafts gray.
The mobile builder uses a scrollable bottom drawer with
Fields/Design, Escape, focus containment and focus return. The desktop uses a right
panel. File Upload is disabled and rejected by the server pending secure storage.

## Database and migration

- `MarketingForm`: unique anonymous `publicId`, `revision`, `publishedRevision`,
  `publishedVersion`, `publishedConfig`, and submission relation.
- New `FormSubmission`: tenant/environment, form/version snapshot, Lead or Contact
  foreign key, timestamp, normalized email/phone, original validated values, bounded
  UTM values and notification outcome. The snapshot excludes notification settings.
- `Lead` and `Contact`: reverse submission relations only.
- Migration: `backend/prisma/migrations/20261010000000_public_forms/migration.sql`.
  It backfills public IDs without altering existing draft contents, adds indexes,
  restrictive foreign keys, and a constraint requiring exactly one person link.
  Existing forms require explicit publication of a valid snapshot before anonymous
  access. Unpublishing retains history. Confirmed permanent deletion removes the
  form and its submission history in one transaction, preserving linked Leads and
  Contacts. No schema change is required for deletion.

Before deploying the backend, use the intended database environment and run:

```powershell
npm --prefix backend run db:deploy
npm --prefix backend run db:generate
```

The existing Render startup command already runs `db:deploy`. Deploy frontend and
backend together; old frontend writes do not include the new required revision.

## Actual API endpoints

All paths below include the backend's `/api/v1` prefix. Browser requests use the
existing same-origin `/api/proxy` transport.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/marketing/forms` | Paginated active forms |
| POST | `/api/v1/marketing/forms` | Create persisted Contact Us draft |
| GET | `/api/v1/marketing/forms/:id` | Read saved draft and publication metadata |
| PUT | `/api/v1/marketing/forms/:id` | Save validated draft with required `revision` |
| POST | `/api/v1/marketing/forms/:id/duplicate` | Independent unpublished copy |
| PATCH | `/api/v1/marketing/forms/:id/publish` | Publish saved snapshot |
| PATCH | `/api/v1/marketing/forms/:id/unpublish` | Return to draft, retaining publication snapshots and history |
| DELETE | `/api/v1/marketing/forms/:id` | Permanently delete an unpublished form and its submission history |
| GET | `/api/v1/marketing/forms/:id/submissions` | Paginated history, including archived forms |
| GET | `/api/v1/public/forms/:publicId` | Anonymous published definition |
| POST | `/api/v1/public/forms/:publicId/submissions` | Validate and record anonymous inquiry |

Management retains the existing `campaigns.view/create/edit/delete` permission
scope plus authentication, workspace and tenant/environment middleware. DELETE
requires `campaigns.delete`; unpublish requires `campaigns.edit`. The server returns
409 for published-form deletion and uses a conditional revision update to prevent
a concurrent publish from bypassing that rule. The former archive route is removed.
Public responses omit tenant IDs, owners, CRM person IDs and
notification addresses. Submission responses only confirm acceptance.

Public URL format: `https://lead-crm-frontend-pi.vercel.app/forms/<publicId>`.
Embed code uses this same page in a responsive iframe.

## Person matching and history

Within the published form's tenant and environment, normalize email and PH mobile
phone, then look for Leads and Contacts, including archived candidates. Names and
company names never determine identity. Existing conversion links are respected.
Ambiguous matches, conflicting email/phone people, or archived matches return a safe
409 instead of silently merging, reviving or duplicating records.

An existing Contact receives the new inquiry. An existing unconverted Lead is reused.
For a Lead associated with a currently or historically won deal (including junction
relations), reuse its linked customer where unambiguous, or create a Contact from the
historical Lead and repair the conversion link. Preserve the Lead and Deal. A person
without a match becomes a new Lead. Existing person's current details are not
overwritten by anonymous submissions. Each accepted inquiry gets its own immutable
payload and published snapshot; product/address history remains separate.

Person resolution and submission creation use a serializable transaction with
bounded serialization retries. Notification happens after commit through the
existing Brevo service; notification failure is recorded without deleting the inquiry.

## Security

Shared strict Zod schemas whitelist management and submission inputs. The server
derives scope, mappings, field rules and options from the published database record.
PH phones use the existing validator and `+639XXXXXXXXX` canonical form. Text is
trimmed, bounded, checked for control characters and rendered as escaped plain text;
apostrophes/hyphens are retained. Colors accept only supported hex values. Unknown
fields, arbitrary UTM keys, unsafe URLs and uploads are rejected. Public submissions
are limited to 64 KB and 20 per IP per 15 minutes using existing rate-limit middleware,
plus a honeypot. Disabled tenants and archived/unpublished forms are unavailable.

Rate limiting uses the existing process-local store. A multi-instance deployment
would need the repository's rate-limit infrastructure configured for shared limits.

## Files changed

- `shared/src/contracts/forms.contract.ts`, `shared/src/index.ts`: shared definitions,
  default template, validation, contracts.
- `backend/prisma/schema.prisma`, migration above: durable form snapshots and history.
- `backend/src/modules/marketing/forms/`: management, public processing, HTTP adapters,
  validation/database tests and disposable browser-preview fixture.
- `backend/src/api/routes/{marketing,public-forms,index}.routes.ts` (index is `index.ts`),
  `backend/src/app.ts`, error middleware: route wiring, rate/body limits and status codes.
- `backend/src/core/environment/environment-models.ts`: submission environment scoping.
- CRM duplicate-detection service: exports existing phone normalization for reuse.
- `frontend/src/features/tenant/marketing/forms/`: list, builder, canvas, shared field
  rendering, public page, settings, share/history, API service and UI tests.
- `frontend/src/features/tenant/settings/ui/{forms-tab,settings-page}.tsx`: shared Forms
  implementation and single page header.
- `frontend/src/shared/services/forms.api.ts`, `frontend/app/forms/[publicId]/page.tsx`:
  API calls and thin public route.
- Removed unused `form-published-modal.tsx`; Share supplies the publication result.
- `scripts/test-forms-db.mjs`: isolated migration/integration runner; never uses the
  configured production database.

## Verification

- `node scripts/test-forms-db.mjs`: **29 tests passed**. Actual migration applied over
  the preceding schema with a saved legacy form; data and generated public ID verified.
  Tests use disposable PGlite PostgreSQL-compatible storage plus real Prisma and HTTP,
  not mocked business persistence. Email transport alone is mocked for failure tests.
- Covers template persistence, duplicate isolation, draft/public separation, stale
  revisions, required fields, phone/email/options, Lead/Contact reuse, historical won
  stages, legacy identity formatting, archived people, atomic rollback, payload limits,
  tenant/environment isolation, archive retention, notifications, auth/RBAC, and 429.
- Frontend Forms and existing portal-menu tests: **15 passed**, including loading/error/retry, portal menu,
  drawer/Escape, save-before-publish, failed-save retention and public submission.
- Browser: public form, Forms list, Builder, Settings and Share checked at 320, 375,
  768, 1024 and 1440 pixels. Measured page width does not exceed viewport width. At
  320 pixels the portal menu stays within the viewport, drawer/design scroll correctly,
  and required errors appear once below their fields. Desktop right panel verified.
- A real local browser submission reached the isolated backend and displayed Thank you.
- `npm run lint`: all three workspaces passed.
- `npm run build`: backend and frontend production builds passed. Initial attempts
  encountered sandbox/font-fetch and Windows Prisma file-lock errors; the final run
  passed after font recovery and stopping the disposable preview API.
- `prisma validate` from `backend`: passed.
- Serialization retries are implemented; PGlite verification does not establish
  multi-connection production concurrency performance.

## Configuration and release

Existing `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, backend `APP_URL`/`ALLOWED_ORIGINS`,
and frontend server-only `API_URL` remain required. Email uses existing
`BREVO_API_KEY`, `BREVO_FROM_EMAIL`, optional `BREVO_FROM_NAME` and sandbox allowlist.
Optional `NEXT_PUBLIC_FORM_ORIGIN` overrides the share-link origin; otherwise the
current frontend origin is used. No new secret is sent to Portfolio or the browser.

The temporary Portfolio integration must use the actual public ID returned after
publishing Contact Us in the Camxian Technologies **PRODUCTION** workspace. Its
existing Contact section receives only a Send Inquiry link. Deployment and final
public URL are recorded after verification; no guessed identifier is used.
