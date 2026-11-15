# Phone availability verification

Verified locally on 2026-11-15. Branch: `codex/phone-availability`, based on
upstream `main` commit `8c561442242fda9f6e4e035f5e92c68e56670543`.

## Root cause and behavior

The authenticated phone endpoint and record validators checked staff phones only.
The existing duplicate-warning search cannot enforce uniqueness because it limits
candidate results and filters historical records. Public submissions also skipped
staff-phone validation when matching an existing customer.

Internal forms and CSV imports now block exact normalized customer-phone conflicts.
Unchanged historical customer numbers and persisted conversion/merge relationships
remain valid. Staff conflicts retain the existing stricter policy. Public Forms
use staff-only checks and retain repeat submissions, customer matching and Product
Deals. The existing serializable transaction retry policy now also recognizes
PostgreSQL SQLSTATE 40001/40P01 wrapped in Prisma unknown connector errors.

## Changed files

- Shared contract: `shared/src/contracts/phone-availability.ts` and generated `.js`.
- Backend validation/API: `backend/src/modules/crm/record-validation.ts`,
  `phone-availability.controller.ts`, `backend/src/api/routes/crm.routes.ts`.
- Manual saves: `backend/src/modules/crm/contacts/contacts.repository.ts` (Leads)
  and `backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts` (Contacts).
- Imports: `backend/src/modules/crm/imports/import-rows.service.ts`.
- Existing retry classification: `backend/src/modules/crm/access/crm-record-access.service.ts`.
- Public inquiries: `backend/src/modules/marketing/forms/public-forms.service.ts`.
- Frontend: `frontend/src/shared/hooks/use-phone-availability.ts`,
  `frontend/src/shared/components/philippine-phone-input.tsx`, shared CRM
  `phone-inline-editor.tsx` and `crm-record-view.tsx`, and both Lead/Contact forms.
- Regression suites: phone availability, phone/category restrictions, Forms,
  imports, transaction retries, phone hook, inline editor and CRM form drafts;
  `backend/tsconfig.tests.json` includes the new integration suite.
- API documentation: [API reference](../API.md).

## Results

| Verification | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Frontend: hook, phone input/editor, record view, form drafts, email availability, Public Form page | 127 | 0 | 0 |
| Backend: transaction retry and Contact merge unit suites | 24 | 0 | 0 |
| Native PostgreSQL: internal phone availability and concurrent writes | 33 | 0 | 0 |
| Native PostgreSQL: existing phone/category, staff, merge and conversion restrictions | 18 | 0 | 0 |
| Native PostgreSQL: public Forms and repeat inquiries | 58 | 0 | 0 |
| Native PostgreSQL: conversion access | 20 | 0 | 0 |
| Native PostgreSQL: CSV imports and populated historical import rehearsal | 25 | 0 | 0 |
| **Total** | **305** | **0** | **0** |

`npm run lint`, including workspace TypeScript checks and backend test typechecks,
passed. `npm --prefix shared run build` synchronized generated JavaScript.
`git diff --check` passed.

Native tests used fresh PostgreSQL 17.6 clusters with fsync, synchronous_commit and
full_page_writes enabled, using the repository's disposable database fixtures and
QA environment/network guard. The import-history gate ran with
`node backend/scripts/test-import-history-rehearsal.mjs --native`.
Local JSON evidence is under `data/outputs/system-audit/phone-availability` and
`data/outputs/system-audit/import-history` (ignored generated artifacts).

No schema migration, dependency addition, production submission, deployment or
production customer edit was performed. UI verification used component tests;
a full browser run and full monorepo production build were not performed.
