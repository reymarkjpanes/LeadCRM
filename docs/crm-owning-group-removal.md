# Customer Owning Group removal

Customer forms and Details views no longer expose Owning Group for Leads, Contacts, Accounts or Deals. Create/update mappings omit it, and public schemas reject supplied values (including null). Deal batch creation and the companies compatibility alias follow the same rule. New standalone records have no Group default. Employee Groups, memberships, roles, protected Sales routing and tenant isolation retain their existing implementation.

## Why the nullable columns remain

On main, ownerGroupId is persisted on all four CRM tables by migration 20261224000000_crm_group_status. It is also an authorization predicate, rather than only a form field:

- Backend crm-record-access.service.ts combines module grants with matching Group grants for Prisma reads, mutations, archive and reporting queries.
- Shared crm-record-access.ts and the frontend access hook use the read value to authorize record actions.
- Assigned-agent eligibility and Workflow assignment use the historical scope to validate eligible employees.
- Lead conversion, automatic Product Deals, and linked Account creation from existing scoped customers carry that scope forward so related records keep their security boundary.

Removing or nulling existing values would change record visibility. These nullable columns, response metadata, foreign keys, historical propagation and access checks remain. Response types mark the value read-only. Historical edits omit the value and preserve it. Trusted linked Account creation passes historical scope separately from the public DTO; the retry hash still includes it.

New standalone records require the existing module-level Create grant (or Client Admin). A Group-only Create grant cannot authorize an unscoped record: those requests continue to fail closed with 403. No Group is selected automatically, and no employee receives broader workspace access. Existing scoped records remain accessible according to their current Group and assignment grants.

## Rollout

No database migration, backfill, column drop or historical data rewrite is needed. Deploy matching frontend, shared and backend builds together: old customer writers that send ownerGroupId now receive a validation error. A future removal of the stored access scope requires a separately reviewed permission model and data-preserving migration.

## Verification

Regression coverage includes all four customer form submissions, customer write adapters, create/update and Deal batch schemas, profile/page/panel reopen behavior, real HTTP create/update/reload, historical scoped edits, cross-tenant Group injection rejection, Group-only grant containment, membership revocation, existing Groups management and assignment authorization suites. The Details badge continues to derive from the configured visible fields and relationships; the removed row contributes no count or placeholder.

Executed checks on the isolated main-based branch:

- All three workspace TypeScript checks and production builds passed (the build used an explicit non-live API_URL).
- Seven focused frontend suites passed: 332 tests covering forms, adapters, Details reopening, badges and assignment controls.
- Backend write-schema, role authorization, assignment eligibility and historical Group migration suites passed: 28 tests.
- Disposable native PostgreSQL suites passed: 58 CRM access/HTTP tests, 25 CRM completion/conversion tests and 24 Group management tests.
- The employee User/Group synchronization suite passed all 4 tests in its matching PGlite fixture. Suites were run with the database names required by their safety guards; skipped copies are not counted.
- Chrome against the production build and disposable PostgreSQL passed 8 checks: all four historical profile edits/reloads preserved access metadata and Details counts, and all four creation screens omitted the field. No browser runtime errors were recorded. Temporary browser evidence is retained under .tmp/owning-group-browser/.
