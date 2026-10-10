# Forms and General settings update

## Forms behavior and API

The list menu now contains Edit, Duplicate, Delete. Published forms show a disabled
Delete action and “Unpublish this form before deleting it.” The approved Unpublish
button appears on published cards for users with edit permission. The existing
Badge component uses its blue default variant for Published and gray secondary
variant for Draft, based on current status.

The existing Forms router, service, repository and browser API client are reused:

- `DELETE /api/v1/marketing/forms/:id` permanently deletes an unpublished form.
- `PATCH /api/v1/marketing/forms/:id/unpublish` returns it to draft.
- The former `PATCH /api/v1/marketing/forms/:id/archive` route is removed.

Authentication, workspace readiness, tenant/environment scope and the existing
`campaigns.delete`/`campaigns.edit` permissions remain enforced. Ownership is taken
from authenticated server context. Missing or out-of-scope forms return 404;
published deletion returns 409 with the existing error response format and message:
“Published forms must be unpublished before they can be deleted.”

A transaction uses a conditional revision update before deleting submission
history and the form. This respects the schema's restrictive relations and guards
against a concurrent publish. Linked Leads and Contacts remain in the database.
No Prisma schema change or migration was introduced.

The existing `ConfirmActionDialog` asks “Delete form?” with Cancel and the red
Delete Form button. It explicitly explains permanent deletion and removal of
submission history. A synchronous request lock and disabled controls prevent
duplicate requests. The card disappears only after API success. On failure, the
card and dialog remain, and the existing toast displays the API error.

## Organization phone and layout

Phone has a fixed +63 prefix and a separate telephone input. The shared Zod contract
is used by both frontend and backend. It rejects letters, malformed punctuation,
invalid lengths and mobile numbers; it accepts the requested `(28) 123-3488`
format, national digits and domestic trunk-prefix forms. A lightweight blur
formatter displays `(28) 123-3488`; persistence uses `+63281233488`. Empty optional
values remain clearable. Validation messages appear directly below the field.
The existing schema trims all organization text fields and the existing service
saves through Prisma using authenticated tenant context.

The Organization Details card now fills its content pane. Desktop uses two columns;
tablet/mobile use one. Office Address spans the card's usable width, the prefix
stays attached to Phone, and Save/Cancel can wrap on narrow screens. Settings
navigation and the Forms builder were not changed.

## Verification actually run

| Check | Result |
| --- | --- |
| `npm --prefix frontend run test -- src/features/tenant/marketing/forms/ui/forms.test.tsx src/features/tenant/settings/ui/__tests__/organization-settings-form.test.tsx` | 16 tests passed |
| `node scripts/test-forms-db.mjs` | 31 Forms tests passed; existing migration fixture also passed |
| `node scripts/test-forms-db.mjs --organization` | 5 authenticated settings integration tests passed |
| `npm --prefix frontend run lint` | Passed (`tsc --noEmit`) |
| `npm --prefix backend run lint` | Passed (`tsc --noEmit`) |
| `npm --prefix shared run lint` | Passed (`tsc --noEmit`) |
| `npm --prefix backend run build` | Passed |
| `npm --prefix frontend run build` | Passed after retry outside the sandbox |
| `node frontend/scripts/check-forms-general.cjs` | Browser checks passed at 320, 375, 768 and 1440px |
| `git diff --check` | Passed |

Backend integration tests used disposable PGlite databases. Browser tests used
intercepted API fixtures and covered bounds/overflow, column layout, full-width
address, validation, normalized saves, status badges, disabled published Delete,
Cancel, Unpublish, confirmation, duplicate requests and successful deletion.
Screenshots were visually inspected. No production records were modified.

Initial checks exposed a stale checked-in JavaScript copy of the shared contract;
it was regenerated from the TypeScript source and the tests then passed. A frontend
type check briefly raced development-server regeneration of `.next-dev/types`;
the rerun passed. One browser rerun hit a development-server recompilation error;
the final complete run passed. The sandbox initially blocked the frontend build
with EPERM on the inferred workspace root; the permitted retry completed. Existing
Next.js warnings about multiple lockfiles and a localhost backend configuration
remain. No deployment was performed.

## Files changed

### Application code

- `backend/src/api/routes/marketing.routes.ts`
- `backend/src/modules/marketing/forms/forms.controller.ts`
- `backend/src/modules/marketing/forms/forms.service.ts`
- `backend/src/modules/marketing/forms/forms.repository.ts`
- `frontend/src/shared/services/forms.api.ts`
- `frontend/src/shared/components/data-grid/row-actions-menu.tsx`
- `frontend/src/features/tenant/marketing/forms/services/forms.service.ts`
- `frontend/src/features/tenant/marketing/forms/ui/forms-page.tsx`
- `frontend/src/features/tenant/settings/ui/organization-settings-form.tsx`
- `shared/src/contracts/organization-settings.contract.ts`
- `shared/src/contracts/organization-settings.contract.js` (tracked generated copy)

### Tests and verification

- `backend/src/modules/marketing/forms/forms.integration.test.ts`
- `backend/src/modules/administration/organization-settings/organization-settings.integration.test.ts`
- `frontend/src/features/tenant/marketing/forms/ui/forms.test.tsx`
- `frontend/src/features/tenant/settings/ui/__tests__/organization-settings-form.test.tsx`
- `frontend/scripts/check-forms-general.cjs`
- `scripts/test-forms-db.mjs`

### Documentation

- `docs/API.md`
- `docs/forms-production-report.md`
- `docs/forms-general-update-report.md`
