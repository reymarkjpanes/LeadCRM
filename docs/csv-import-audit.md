# CSV import audit and verification

This records the earlier CSV feature audit. The later [import infrastructure
normalization report](csv-import-normalization.md) supersedes its persistence,
file-removal, cleanup and migration sections. Use that report's two-phase rollout
instead of the deployment command recorded below.

Scope: Leads, Contacts, Accounts and Deals. Verified locally on 2026-10-04 against the actual backend and a disposable PostgreSQL-compatible PGlite database. Production data was not changed. The existing three-step wizard and CRM visual language are retained.

## 1. Problems found

- Separate import implementations accepted already-mapped rows, leaving file structure and size checks dependent on the browser.
- People/account duplicate checks were inconsistent with normalized identity and did not consistently prevent cross-Lead/Contact duplicates.
- Product Interests were absent or incomplete in import contracts, templates and record creation. The Deal template exposed an independent Value field.
- Imports lacked durable request idempotency and atomic record/row-result commits. Retries could repeat work or leave misleading history.
- A single large JSON request conflicted with application/proxy limits. Processing a whole import in one request could exceed hosting timeouts.
- History did not distinguish skipped duplicates, and its filters operated on incomplete data. New Import and legacy drawer paths did not consistently use the canonical flow.
- Conversion into an existing Account did not union the Lead's Product Interests into that Account.
- Review Product columns, required mapping checks, narrow-screen wrapping and results-error recovery needed correction.
- Older regression tests referenced a retired import resolver or skipped the current Qualified/closing-requirements lifecycle.

## 2. Problems fixed

One shared CSV contract and one backend import engine now serve the four existing module histories. Both preview and execution parse raw CSV, validate mappings, check normalized identities, resolve current tenant relationships and resolve active Products. Execution commits each record, its automatic Deals, its row result and progress in one serializable transaction. The browser submits bounded batches with a stable key, supports interruption recovery, and shows distinct valid/invalid/duplicate results.

No Campaign, Workflow, Task, Notification, Inbox, Dashboard or Settings runtime behavior was redesigned. The mailbox test file changed only to exercise the current import validator.

## 3. Frontend files changed

Paths are relative to the repository root.

| Files | Purpose |
|---|---|
| `frontend/src/features/tenant/crm/shared/import/configs/lead-import.config.ts` | Product field, supported status choices |
| `frontend/src/features/tenant/crm/shared/import/configs/contact-import.config.ts` | Product field |
| `frontend/src/features/tenant/crm/shared/import/configs/account-import.config.ts` | Product field |
| `frontend/src/features/tenant/crm/shared/import/configs/deal-import.config.ts` | Required Product, friendly relationships, removed Value, corrected back route |
| `frontend/src/features/tenant/crm/shared/import/ui/import-page.tsx` | Upload/map/review/execute flow, chunks, request key, server validation, price preview, review pagination, responsive layout |
| `frontend/src/features/tenant/crm/shared/import/ui/import-history-list.tsx` | Server filtering, duplicate counts, reset callback, stale response protection |
| `frontend/src/features/tenant/crm/shared/import/ui/import-details-page.tsx` | Product/value snapshots, duplicate filtering, result retry, resumable history link |
| `frontend/src/features/tenant/crm/shared/import/types/import.types.ts` | Duplicate counts and durable request metadata |
| `frontend/src/features/tenant/crm/shared/import/utils/csv-parser.ts` | Shared parser |
| `frontend/src/features/tenant/crm/shared/import/utils/row-validator.ts` | Shared row schemas |
| `frontend/src/features/tenant/crm/shared/import/utils/import-validation.test.ts` | Updated parsing and Deal contract assertions |
| `frontend/src/features/tenant/crm/accounts/ui/import-accounts-drawer.tsx` | Compatibility entry point to the canonical import page |
| `frontend/src/features/tenant/crm/leads/ui/import-leads-drawer.tsx` | Compatibility entry point to the canonical import page |
| `frontend/src/shared/services/account-imports.api.ts` | Raw CSV execution contract and counts |
| `frontend/src/shared/services/contact-imports.api.ts` | Raw CSV execution contract and counts |
| `frontend/src/shared/services/lead-imports.api.ts` | Raw CSV execution contract and counts |

## 4. Backend, shared and supporting files changed

- `backend/src/modules/crm/imports/imports.service.ts`: preview, durable execution, batched resume, history.
- `backend/src/modules/crm/imports/imports.repository.ts`: typed adapters to the four existing import/result tables.
- `backend/src/modules/crm/imports/import-rows.service.ts`: duplicate detection, catalog/customer/pipeline/owner resolution and domain record creation.
- `backend/src/modules/crm/imports/import-upload.service.ts`: durable, scoped, retryable upload chunks.
- `backend/src/modules/crm/imports/imports.integration.test.ts`: shared contract and authenticated database/HTTP tests.
- Under `backend/src/modules/crm/lead-imports/`, `contact-imports/`, and `account-imports/`: each module's `.controller.ts`, `.dto.ts`, and `.service.ts` now use the common engine/contract.
- `backend/src/modules/crm/deal-imports/deal-imports.controller.ts` and `deal-imports.service.ts`: common engine and preview/upload handlers.
- `backend/src/api/routes/crm.routes.ts`: protected preview/upload routes.
- `backend/src/app.ts`: import-specific JSON limit; unrelated request limits remain intact.
- `backend/src/core/tenant/tenant-models.ts`: upload-chunk tenant scoping.
- `backend/src/modules/crm/leads/lead-conversion.service.ts`: preserve Product Interests on an existing Account.
- `backend/src/modules/crm/leads/sales-automation.integration.test.ts`: conversion fixtures follow Qualified and saved closing requirements; explicit Contact links preserve phone-only historical records without inventing phone identity matching.
- `backend/src/integrations/gmail/mailbox.integration.test.ts`: closing-bypass import tests use the current validator with a real Product.
- `shared/src/validation/crm-import.schema.ts` and tracked `.js`: CSV parser, limits, fields, mappings, source/chunk payloads and review contract.
- `shared/src/validation/deal-import.schema.ts` and tracked `.js`: aliases to the new contract.
- `shared/src/index.ts` and tracked `.js`: public exports. The tracked JavaScript counterparts are kept synchronized because some existing runtime/test resolution uses them.
- `scripts/verify-csv-imports.cjs`: reproducible local browser checks.
- `.gitignore`: local browser screenshots/report exclusions.
- `docs/API.md` and this report: actual contracts, migration and verification.

## 5. Prisma/schema/migration changes

`backend/prisma/schema.prisma` and `backend/prisma/migrations/20261027000000_crm_import_integrity/migration.sql` add:

- Nullable `idempotencyKey` and `requestHash`, plus `duplicateRecords`, to each existing import table.
- Unique `(tenantId, idempotencyKey)` for new executions.
- JSON row snapshots and unique `(importId, rowNumber)` for Lead/Contact/Account results. Deal results already had a row uniqueness constraint and JSON data.
- `CrmImportChunk` with tenant/user foreign keys, module/upload/index uniqueness and expiry index.

Historical import rows and Deals are retained. No global customer/Product/Deal uniqueness constraint is added. Migration numbering follows the repository's existing sequence, which already extends beyond the local audit date.

All migrations were replayed successfully in the disposable test database. Before releasing this code, apply the migration to the target database with `npm --prefix backend run db:deploy` and deploy matching frontend/backend/shared contracts together. That deployment command was **not** executed against a target environment.

## 6. Actual import API endpoints

For each of `leads`, `contacts`, `accounts`, `deals`, the backend prefix is `/api/v1/crm/{module}/imports`:

| Method/suffix | Behavior |
|---|---|
| `POST /upload` | Persist a source chunk, at most 65,536 characters |
| `POST /preview?offset=0` | Return up to 25 reviewed rows or metadata for an existing execution |
| `POST` | Commit up to 25 remaining rows; 202 while incomplete, 201 once complete |
| `GET` | Paginated history, with server-side status filter |
| `GET /:importId` | Import summary |
| `GET /:importId/results` | Paginated row results, with imported/failed/duplicate filter |

Preview/execution accept `{ fileName, csvText, mappings, idempotencyKey }`. An uploaded `uploadId` can replace `csvText`. Mappings associate supported field keys with zero-based source-column indices. The previous `{ fileName, rows }` contract is replaced, so external clients must update too. See [API reference](API.md#crm-csv-imports).

## 7. Lead duplicate rule

Create-only. Trim and lowercase email. Reject an existing Lead or Contact in the tenant, including an archived/deleted identity. Within a CSV, later occurrences of the same email are duplicates. Product differences never define a new person.

## 8. Contact duplicate rule

Create-only, using the same normalized email rule. Existing Contacts are duplicates. An existing Lead is also rejected so import cannot bypass its normal conversion lifecycle.

## 9. Account duplicate rule

Create-only. Account Name is the available identity: trim, collapse whitespace and compare case-insensitively within the tenant, including archived/deleted records. Different Products do not produce another Account.

## 10. Deal duplicate rule

Skip identical normalized mapped rows within a CSV. A durable execution key and a unique row result prevent repeated execution. A **new** import can intentionally create another opportunity for the same customer and Product, including an otherwise identical opportunity. There is no global customer-plus-Product uniqueness rule.

## 11. Lead Product Interest handling

Resolve active canonical `ProductInterest` records. Save their IDs in `Lead.productInterestIds` and canonical name snapshots in `Lead.productInterest`. Call existing `createAssignedLead`, including assignment and `createProductDeals`. A Lead with CCTV and Biometrics creates two separate Deals at the respective Product values, atomically with the Lead.

## 12. Contact Product Interest handling

Resolve and validate canonical Products before saving canonical names to the existing `Contact.productInterests` snapshot array. The current Contact schema does not contain a Product junction table or Product-ID array. This preserves that architecture; it does not introduce arbitrary names or a competing catalog. Contact import does not add new automatic Deal creation rules.

## 13. Account Product Interest handling

Resolve and validate canonical Products before saving to the existing `Account.productInterests` snapshot array. Deal imports union the applicable Product into the related Account. Lead conversion now also unions interests into an existing Account. No second Product catalog or new Account automation was introduced.

## 14. Deal Product relationship

Each imported Deal resolves exactly one Product and writes the existing `productInterestId` foreign key, the corresponding one-element `productInterestIds` array and canonical name snapshot. Existing Deal/Lead and Deal/Contact junctions, singular references and applicable Account are retained. Closed stages must go through the normal sales closing action.

## 15. Parsing multiple Product Interests

Split on semicolons; trim each item; remove blanks; deduplicate case-insensitive names; resolve records; deduplicate again by actual Product ID. A name plus the same Product's ID therefore produces one relationship. Lead/Contact/Account cells support multiple Products. A Deal cell requires exactly one.

## 16. Product name resolution

Look up `ProductInterest` in the authenticated tenant; compare normalized names case-insensitively or match an ID. Unknown, ambiguous and inactive Products get explicit row errors. Products are never created by import.

## 17. Deal Value resolution

The server reads `ProductInterest.dealValue` for each row. Review displays the resolved PHP value. Final creation resolves Product data again inside the transaction using the existing Deal creation behavior. CSV/hidden/browser values are not authoritative; `value` is not a supported mapping or row field.

## 18. Future versus existing prices

`Deal.value` is a creation-time snapshot. A changed Product price applies to subsequent Deals. Neither imports nor conversion recalculate existing Deal values. Tests cover 25,000 → 30,000 and a Product changed after preview; earlier Deals retain their original amounts.

## 19. Multiple Deals for one customer

Each valid Deal row creates one Deal. Relationship lookup resolves the existing Lead/Contact/Account; it does not recreate the customer. Subsequent opportunities for the same Product remain allowed. Converted Lead plus its linked Contact resolves to the canonical Contact rather than an ambiguous duplicate person.

## 20. Duplicate Product relationships

Deduplicate resolved Product IDs before creation; union snapshot arrays when linking a Deal or converting a Lead. Automatic Lead Deals continue using the existing automation key. Explicit imported Deals use separate opportunity creation and do not impose automatic-Deal uniqueness on future opportunities.

## 21. Retry and double-submission protection

The browser prevents concurrent clicks and holds one immutable submission during execution. A UUID key survives refresh in the URL. The database binds that key to the tenant and a hash of actor, filename and mapped source rows. Changed input with an existing key returns 409.

Each record, automatic Deals, result and counts commit together using the existing serializable transaction/retry helper. Committed rows are skipped on repeat calls. Unexpected request/database failures leave truthful committed progress and can be resumed. History provides a Resume link; the original importer reselects the same file and mapping. New Import explicitly starts a new key. No localStorage is used for persistence.

Large browser payloads use durable chunks. Chunks are readable for 24 hours; expired chunks for that tenant/user are removed when the user next uploads. They are not a background execution queue. An interrupted job needs the original importer to resume; it does not continue unattended.

## 22. CSV templates

All four downloadable templates include Product Interest. Deal templates remove Value and offer Customer Email, Product Interest, Pipeline, Stage, Priority, Expected Close Date, Account, Lead/Contact alternatives and Assigned Agent Email. Existing supported person/account fields are retained. Wizard guidance explains semicolon-separated Products, create-only identity rules, friendly relationship identifiers and server-derived prices.

## 23. Import History

Each module retains its own history table. New results persist filename, creator, timestamps, total, imported, failed and duplicate counts, status, physical CSV row numbers, mapped data, specific errors and resolved Deal prices. Filters and pagination run on the backend. Failed results requests show a retry action and cannot leave stale successful data displayed as the requested filter. Older history remains intact with its original classification; duplicates are not guessed retroactively.

## 24. Permissions and security

- Existing authentication and tenant middleware remain active. Upload/preview/execute require `leads.import`, `contacts.import`, `accounts.import`, or existing `deals.create`. History requires the respective module's view permission.
- All catalog, customer, account, owner, pipeline and stage lookups are tenant-scoped. Active/available relationships and eligible sales owners are enforced. Foreign histories return 404; foreign upload sources are unavailable.
- Server validation enforces `.csv`, 10 MiB UTF-8, at most 5,000 rows/100 columns, valid rectangular CSV, unique nonempty normalized headers, supported mapping keys, non-reused source columns and required mappings.
- BOM, quoted commas, escaped quotes, multiline cells and CRLF are supported; blank records are skipped. Malformed quoting, empty data, invalid emails/dates, excessive lengths and unsupported controls are rejected.
- Plain-text record fields use the existing HTML sanitizer. Arbitrary Deal values and direct closed-stage imports are rejected.

## 25. Tests actually executed

| Command/check | Final result |
|---|---|
| `node scripts/test-sales-db.mjs src/modules/crm/imports/imports.integration.test.ts` | 10 passed; rerun after the final conversion assertions |
| `node scripts/test-sales-db.mjs src/modules/crm/imports/imports.integration.test.ts src/modules/crm/leads/sales-automation.integration.test.ts` | 38 passed |
| `node backend/scripts/test-mailbox-db.mjs` | 79 passed across integration and engagement suites |
| `npm --prefix frontend test -- src/features/tenant/crm/shared/import/utils/import-validation.test.ts` | 12 passed |
| `node scripts/verify-csv-imports.cjs` with the installed Playwright package | All four real frontend/backend flows passed; 120 viewport checks/screenshots |

The browser used disposable preview credentials, local API port 4101 and frontend port 3100. `PLAYWRIGHT_MODULE` pointed at the already-installed bundled Playwright package. No package installation was needed. Widths: 1440, 768, 390, 375 and 320 pixels. Upload, mapping, review, result, detail and history views were checked at each width, with no document overflow or page errors. Tables retain internal horizontal scrolling. Representative desktop/mobile screenshots were visually inspected.

Browser behavior covered templates, Browse, drag/drop, required manual remapping, automatic mapping, Product column alignment, server review, derived prices, double click, completed-job refresh recovery, New Import reset and results-error retry. A separate 801,135-byte / 40-row CSV used 26 chunk requests including reupload after interruption. The second execution request was deliberately aborted; History resumed the original execution and completed exactly 40 records.

Database/HTTP tests cover one/multiple Product Leads and automatic Deals, cross-person duplicates, normalized Accounts, concurrent same-key and separate-key imports, changed-payload conflicts, unknown/inactive Products, friendly and ID references, separate per-row prices, future opportunities, price changes after preview, conversion preserving Deal IDs/values/ownership/email/interests, upload isolation, batches, history counts, malformed files, authentication and RBAC.

Earlier verification exposed three obsolete sales regression fixtures. They now follow the actual closing flow and explicit historical relationships; the rerun passes. Import-closing checks in mailbox tests were updated to the new validator. No sales closing guards were relaxed to make the tests pass.

Local evidence: `data/outputs/csv-import-qa/browser-results.json`, template files and screenshots (ignored generated artifacts); `data-import-final-tests.log`, `data-import-regression-tests.log`, `data-import-mailbox-regression.log`, `data-import-frontend-tests.log`, `data-import-browser.log`.

## 26. Build/typecheck/lint commands actually executed

- `npm --prefix backend run db:generate`: passed; regenerated Prisma Client for the migration.
- `npm --prefix backend run lint` and `npm --prefix frontend run lint`: passed during implementation.
- `npm run lint`: passed all three workspaces. These scripts are TypeScript `tsc --noEmit`, not a separate ESLint suite.
- `npm run build`: passed backend and frontend production builds. Initial sandbox execution hit Windows `EPERM readlink`; the approved retry outside the sandbox succeeded.
- `npm --prefix frontend run build`: passed again after the final review-table changes; includes Next.js type validation.
- `git diff --check`: passed.

Build logs are `data-import-build.log` and `data-import-frontend-build.log`. The local build warns that its default proxy backend is localhost; target deployment must set the existing `API_URL`/`NEXT_PUBLIC_API_URL` configuration. Next.js also reports an existing workspace-root/lockfile warning. Vite reports an existing native-config-loader compatibility warning; tests pass.

## 27. Remaining issues and verification limits

No known failing scoped test remains. Deployment is still required: the new migration and synchronized frontend/backend contract have not been applied to production. Live Vercel/production import behavior: **I cannot confirm this.**

The database suite uses real migrations, Prisma, authenticated HTTP and PostgreSQL-compatible PGlite with one connection. Native production PostgreSQL under multi-connection load, a full 5,000-row execution, the hosting provider's deployed timeouts and production migration on existing customer data: **I cannot confirm this.** Limits and batch recovery were tested locally, but this is not a production load-test result.

Contact/Account Product Interests remain the application's existing validated name snapshots rather than new foreign keys. Historical snapshots can retain earlier Product names by design. Completed and interrupted imports do not rewrite legacy customer identities or historical Deal prices. Expired chunk cleanup is lazy on subsequent uploads, not a scheduled retention job.
