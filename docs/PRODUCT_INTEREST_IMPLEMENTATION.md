# Product Interest and Lead Created implementation

Implemented for the existing Camxian LeadCRM application. Existing auth, RBAC, workspace scoping, Forms cards, RowActionsMenu, SlidingDrawer, confirmation dialog, and Leads filter rail are reused. No organization-switching or new custom-field types were added.

## Behavior

- Custom Fields displays a Product Interest card with View, Edit, and Delete. The existing drawer lists database products and PHP prices, provides Edit/Delete actions, and supports adding, renaming, repricing, and removing products. Deletion requires confirmation and deactivates records while retaining CRM history.
- Add New Field opens this configuration, or recreates an empty Product Interest field after deletion. Its compact mobile version has an accessible label and tooltip.
- One API-backed catalog supplies current choices to Leads, Contacts, Accounts, Deals, and Forms. Public forms receive current IDs and labels from their existing public endpoint. No catalog is persisted in browser storage. Existing name fields remain historical snapshots.
- Manual and public Lead creation resolve active product IDs and prices inside the server transaction, then persist one linked Deal per product. Submitted amounts cannot determine these Deals. Existing assignment, stages, conversion, and idempotency remain in use. When no eligible agent exists, Deals are saved unassigned for later assignment.
- Repeated inquiries can add products to an existing Lead without replacing its historical Deals. Repricing affects future Deals only. Automatic Deal amounts are read-only in the edit form and cannot be changed through the Deal update endpoint.
- The six requested Lead Sources are removed from current choices/filter options. Historical records remain intact.
- Lead Created uses the existing filter panel with a removable active condition. Date changes refresh server results and reset pagination; clearing restores the normal query.

## Database and migration

`backend/prisma/migrations/20261014000000_product_interest_records/migration.sql` creates ProductInterest with UUID IDs, name, Decimal(14,2) dealValue, active, createdAt, and updatedAt, using the existing organization relation. It adds Lead.productInterestIds and Deal.productInterestId.

The migration imports saved product/value preferences, supplies initial records only when no configuration exists, backfills matching Lead and automatic Deal references, and removes the superseded value preference. An active-name unique index prevents case-insensitive duplicates; a database check prevents negative prices. Historical Deal amounts are not rewritten.

The migration was replayed against an isolated PostgreSQL-compatible PGlite database, including a saved-price/backfill fixture. It has **not** been applied to the developer or production database. Deploy the migration through the existing `npm --prefix backend run db:deploy` workflow before running the updated application against that database.

## Actual API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/administration/product-interests` | Shared active catalog and field enabled state |
| POST | `/api/v1/administration/product-interests` | Create product |
| PATCH | `/api/v1/administration/product-interests/:id` | Rename/reprice product |
| DELETE | `/api/v1/administration/product-interests/:id` | Deactivate product |
| DELETE | `/api/v1/administration/product-interests` | Remove field from current use and deactivate products |
| POST | `/api/v1/administration/product-interests/field` | Recreate an empty field |
| GET / POST | `/api/v1/crm/leads` | Filter Leads / manually create Lead and automatic Deals |
| PUT | `/api/v1/crm/leads/:id` | Update selected product IDs without overwriting Deal history |
| PUT | `/api/v1/crm/deals/:id` | Existing update route; rejects automatic amount overrides |
| GET | `/api/v1/public/forms/:publicId` | Published form with live product IDs and labels |
| POST | `/api/v1/public/forms/:publicId/submissions` | Validate inquiry and persist Lead, Deals, and submission atomically |

The frontend uses its existing `/api/proxy` transport. The catalog path passed to apiClient is `/administration/product-interests`. Manual Leads retain the existing request key `productInterest`, now containing UUIDs; stored names are resolved by the backend.

## Lead Created query

The existing generic filter syntax is extended:

```text
GET /api/v1/crm/leads?filter[createdAt]=lte:2026-09-25
GET /api/v1/crm/leads?filter[createdAt]=gte:2026-09-25
GET /api/v1/crm/leads?filter[createdAt]=between:2026-09-01,2026-09-25
```

The UI calls the third operator Range. Boundaries are Asia/Manila calendar dates: 00:00:00.000 through 23:59:59.999 inclusive, converted to Date objects before Prisma filtering. The same where clause drives both listing and count. Browser URL state uses createdOperator, createdFrom, and createdTo; these are translated into the existing API filter syntax.

## Validation and sanitization

- Shared client/server name validation trims whitespace, rejects empty names/control characters, and limits names to 200 characters. React renders names as text. Active names are case-insensitively unique.
- Prices accept finite JSON numbers from zero through 999,999,999,999 with at most two decimal places. The UI accepts decimal notation only and shows a peso prefix. Negative, NaN, Infinity, malformed, formatted-currency, and string API amounts are rejected. Database storage is decimal.
- Product IDs must be UUIDs and resolve to active records within the existing authorized workspace. Catalog mutations require settings.edit. Contact/Account/standalone Deal selections validate against the same catalog and store trimmed snapshots.
- Public submissions use existing server form validation plus current catalog options. Forged names, unknown/inactive IDs, and arbitrary extra amount fields are rejected. Lead creation does not trust a client amount.
- Date filters reject unknown operators, invalid calendar dates, missing range endpoints, reversed ranges, and malformed query values. All database operations use Prisma or parameterized test-fixture queries.

## Executed verification

- `npm run lint`: all three workspace TypeScript checks passed.
- `npm --prefix backend run db:generate`: passed; also executed by the backend build.
- `node scripts/test-sales-db.mjs`: 47 tests passed across three backend suites. Includes migration replay, persisted CRUD, invalid input/RBAC, authoritative automatic pricing, multiple products, retries, rollback, public tampering, conversion/history preservation, inclusive date boundaries, filtered counts, and field deletion/recreation.
- Focused frontend Vitest runs: 25 tests passed across settings, Lead Created, existing RowActionsMenu, and Forms suites (16 + 9 tests in the final runs).
- Browser checks against the isolated local API/database: product creation and refresh persistence; desktop card and panel; menus; mobile stacked product inputs; date operators, active chip, range, clear, and result counts. Viewports checked: 1366×768, 768×1024, and 375×812. Saved screenshots are under `artifacts/product-interest-checks/`.
- `git diff --check`: passed.
- `npm run build`: backend and frontend production builds passed (189 frontend pages generated). The first sandboxed attempt failed on a Windows readlink permission; the authorized retry succeeded. Existing multiple-lockfile and local API_URL warnings were emitted.

These checks do not claim production deployment, a production-database migration, or an exhaustive regression test of every unrelated module. The temporary preview servers were stopped after browser verification.

## Files changed

The complete file inventory follows.


- `artifacts/product-interest-checks/desktop-card.png`
- `artifacts/product-interest-checks/desktop-panel.png`
- `artifacts/product-interest-checks/mobile-created-range.png`
- `backend/prisma/migrations/20261014000000_product_interest_records/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/api/routes/administration.routes.ts`
- `backend/src/modules/administration/product-interests/product-interests.controller.ts`
- `backend/src/modules/crm/companies/companies.repository.ts`
- `backend/src/modules/crm/contacts-v2/contacts-v2.repository.ts`
- `backend/src/modules/crm/contacts/contacts.dto.ts`
- `backend/src/modules/crm/contacts/contacts.repository.ts`
- `backend/src/modules/crm/deals/deals.repository.ts`
- `backend/src/modules/crm/leads/lead-automation.service.ts`
- `backend/src/modules/crm/leads/lead-created-filter.ts`
- `backend/src/modules/crm/leads/product-snapshots.ts`
- `backend/src/modules/crm/leads/sales-automation.integration.test.ts`
- `backend/src/modules/crm/leads/sales-automation.preview.ts`
- `backend/src/modules/marketing/forms/forms.integration.test.ts`
- `backend/src/modules/marketing/forms/forms.validation.test.ts`
- `backend/src/modules/marketing/forms/public-forms.service.ts`
- `docs/PRODUCT_INTEREST_IMPLEMENTATION.md`
- `frontend/src/features/tenant/crm/accounts/ui/account-form.tsx`
- `frontend/src/features/tenant/crm/contacts/ui/contact-form.tsx`
- `frontend/src/features/tenant/crm/deals/ui/deal-form.tsx`
- `frontend/src/features/tenant/crm/leads/leads.config.ts`
- `frontend/src/features/tenant/crm/leads/ui/lead-created-filter.test.tsx`
- `frontend/src/features/tenant/crm/leads/ui/lead-created-filter.tsx`
- `frontend/src/features/tenant/crm/leads/ui/lead-form.tsx`
- `frontend/src/features/tenant/crm/leads/ui/leads-page.tsx`
- `frontend/src/features/tenant/marketing/forms/ui/form-builder-page.tsx`
- `frontend/src/features/tenant/marketing/forms/ui/form-canvas.tsx`
- `frontend/src/features/tenant/marketing/forms/ui/form-input.tsx`
- `frontend/src/features/tenant/marketing/forms/ui/forms.test.tsx`
- `frontend/src/features/tenant/settings/ui/product-interests-settings.test.tsx`
- `frontend/src/features/tenant/settings/ui/product-interests-settings.tsx`
- `frontend/src/lib/api/adapters/contact.adapter.ts`
- `frontend/src/lib/api/adapters/deal.adapter.ts`
- `frontend/src/lib/constants.ts`
- `frontend/src/shared/components/crm/crm-record-view.tsx`
- `frontend/src/shared/components/crm/module-filter-rail.tsx`
- `frontend/src/shared/components/crm/module-workspace.tsx`
- `frontend/src/shared/hooks/use-product-interests.ts`
- `frontend/src/store/types/lead.types.ts`
- `scripts/test-sales-db.mjs`
- `shared/src/contracts/forms.contract.ts`
- `shared/src/contracts/lead-created.contract.ts`
- `shared/src/contracts/product-interests.contract.ts`
- `shared/src/index.ts`
- `shared/src/types/deal.types.ts`
