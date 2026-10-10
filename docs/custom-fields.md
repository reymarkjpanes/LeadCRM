# Module custom fields

Implementation and verification report, 7 October 2026. The existing Settings gallery, side panels, field definitions and Closed Won workflow are extended across Leads, Contacts, Accounts and Deals.

## Implementation report

1. **Existing architecture.** `ClosingFieldDefinition` already stored tenant-scoped JSON definitions with stable IDs and versions. The administration API and Settings cards managed six field types. Deal evidence used `closingValues`, secure `RecordFile` IDs and immutable `closingSnapshot` evidence. This implementation extends those definitions and validators.
2. **Schema/model changes.** Definition JSON gains `module`, `group`, `visibleInForm` and `order`. `CustomFieldValue` separates values from configuration, with a composite tenant/definition foreign key, tenant/record foreign keys, per-field/per-record uniqueness, a scalar JSON constraint and exactly one module-matching record reference. Definition and value timestamps remain persisted. `RecordFile.pendingModule` supports uploads before a new record exists.
3. **Supported modules.** Leads, Contacts, Accounts and Deals. Tasks are not advertised: the current record-file and relationship architecture supports these four CRM record types, not Tasks.
4. **Module selector.** New Field selects one of the four modules. Edit Field displays the original module read-only; the server rejects changes. The Settings filter is separate from global search and offers All Modules plus these four modules.
5. **Group/Section.** Suggestions come from the selected module's actual built-in form sections and saved groups. Group is required, trimmed and limited to 100 characters. Fields appear after standard inputs inside the matching section.
6. **Custom groups.** Entering a new name creates its context within the definition; no second group-storage system is introduced. Case-insensitive, trimmed matches reuse an existing module-specific name. Visible custom groups become numbered sections after built-in sections. Creation order is persisted and stable; there is no new drag-and-drop ordering UI.
7. **Visible in Form.** A persisted boolean defaults to true. Ordinary form rendering and server-required validation both use `active && visibleInForm`. Configuration changes invalidate the affected cached forms and details.
8. **Hide/Show.** The card menu patches that same boolean. It neither archives nor deletes the definition or any values. Show restores the existing value when the form reloads. Disabled fields remain separately identified.
9. **Required.** The shared renderer blocks empty required values and shows inline errors. The backend repeats validation within the record transaction, so invalid values roll back record creation/update. Hidden or disabled ordinary fields do not block submission. Active required Closed Won fields remain enforced within the closing workflow regardless of ordinary-form visibility.
10. **Types.** Text: string, maximum 1,000 characters. Long Text: string, maximum 10,000. Number: finite numeric JSON value; ordinary inputs reject nonnumeric characters while typing. Date: an actual calendar date in `YYYY-MM-DD`. Dropdown: one configured choice, with trimmed, case-insensitive duplicate-choice rejection. File Upload: a persisted, tenant/record-owned secure file ID, maximum 10 MB, using existing MIME/signature checks. Module and type are immutable. Removing a dropdown choice does not rewrite unchanged optional historical values; a submitted change must match current choices.
11. **Leads.** New/Edit Lead uses the shared renderer in Basic Information, Status & Interest, Organization and Additional Information, followed by custom sections. The existing adapter passes record-specific values. Creation, updates and values share a transaction; idempotent Lead creation does not overwrite values on replay. Converted Leads retain their existing edit restriction.
12. **Contacts.** New/Edit Contact renders Basic Information, Status & Classification, Relationships and Additional Information plus custom sections. Contact values use the Contact record reference and cannot be submitted as Lead values. The create/update service forwards the actor for file claims and audit history.
13. **Accounts.** New/Edit Account renders Basic Information, Address, Relationships, Products & Interests and Notes plus custom sections. Values persist with Account create/update. Archiving preserves the value rows; the historical reader remains tenant-scoped.
14. **Deals.** The shared create/edit form and related-record quick create render ordinary Deal fields separately from closing evidence. Batch creation validates and stores values for each Deal atomically. An uploaded file may be shared within that explicit batch using separate record-owned metadata IDs. The current Deal Details editing pattern is preserved: Edit deal opens Details, where Edit custom fields saves grouped values inline. The same custom-value editor is available in other record Details panels with edit permission.
15. **Closed Won compatibility.** Existing definition IDs, versions, types, options and requirements are preserved. Legacy definitions receive Deals / Closed Won Requirements metadata. Known stored closing values are backfilled into normalized rows; `closingValues` remains dual-written, and `closingSnapshot` is never rewritten. Unknown legacy keys remain in the legacy JSON. Server stage validation, Qualified-to-Won behavior and locked evidence remain intact.
16. **Persistence.** Definition mutations use the existing administration endpoints. Record create/update DTOs accept `customFieldValues`, keyed by field ID. The backend rejects foreign-module, unknown, hidden or disabled submitted fields and merges accepted patches with saved values. Edit forms submit changed values only. No localStorage or mock-only persistence is introduced.
17. **History.** Hide, disable, definition rename, choice edits and group changes do not delete stored values. Details show saved hidden/disabled fields with their status, grouped by their current definition. Audit logs retain definition/value changes. Frozen closing evidence uses its original snapshot metadata. Ordinary fields do not introduce a second frozen-snapshot system.
18. **Permissions.** Existing `custom_fields.view/create/edit/disable` checks remain. Changing active status additionally requires disable permission. Ordinary field filling uses the record module's create/edit permission, and reading saved values requires module view. Pending uploads require module create and may be claimed only by their uploader in the same tenant/module within 24 hours. Record-scoped uploads/downloads retain existing permissions and tenant checks.
19. **Migration.** `20261105000000_module_custom_fields` performs transactional EXPAND → BACKFILL → VERIFY. Application code switches ordinary values to normalized storage while dual-writing closing compatibility JSON. RETIRE is intentionally deferred. The deployment allowlist includes this independent migration while continuing to exclude the guarded relationship-retirement migration.
20. **Tests.** See the executed-check ledger below. Integration verification uses disposable PGlite databases and real authenticated HTTP requests; external file storage responses are mocked. Browser verification uses the production-built application with a disposable database.
21. **Build/typecheck.** The repository's `lint` scripts are TypeScript `tsc --noEmit` checks. All three workspaces and both production builds passed. Prisma generate and schema validation passed. The frontend build warns that its local fallback API URL is localhost; the browser harness explicitly points the proxy to its disposable local backend.
22. **Limitations.** Production migration, deployment, production data volumes/locking, and live Supabase upload/download have not been exercised. I cannot confirm this. The complete repository test suite was not run; the checks below describe the actual coverage. Browser coverage is Chrome at the listed widths, not every browser/device. Existing import, conversion and automation behavior is not extended to map custom values between modules. Historical files on archived records retain the existing file endpoint's access restrictions. Abandoned pending uploads are cleaned on the uploader's next upload after expiration, not by a new scheduled job.

## API contract

All paths below are relative to `/api/v1`. Authentication, tenant scoping and workspace readiness are unchanged.

| Method and path | Behavior | Permission |
| --- | --- | --- |
| `GET /administration/closing-requirements` | All saved definitions, including disabled and hidden | `custom_fields.view` |
| `POST /administration/closing-requirements` | Create a definition | `custom_fields.create` |
| `PATCH /administration/closing-requirements/:id` | Patch configuration or visibility | `custom_fields.edit`; active changes also require `custom_fields.disable` |
| `PATCH /administration/closing-requirements/:id` with only `{ "active": false }` | Disable without deletion | `custom_fields.disable` |
| `GET /crm/{module}/custom-fields` | Module definitions for ordinary forms; excludes closing context | Any of module view/create/edit |
| `GET /crm/{module}/:id/custom-fields` | Definitions, saved values and record-file metadata | Module view |
| Existing record `POST`/`PUT` endpoints | Accept optional `customFieldValues` alongside standard fields | Existing module create/edit |
| `POST /crm/deals/batch` | Applies values to every new Deal within the same transaction | `deals.create` |
| `POST /crm/{module}/custom-field-uploads?name=...&type=...` | Raw file bytes; creates a temporary uploader-owned file | Module create |

`module` is `leads`, `contacts`, `accounts` or `deals`. Definitions retain their existing ID and version contract. The old optional `appliesTo` literal remains accepted for legacy clients; new UI uses Module and Group/Section. Old definition clients that omit context retain the legacy Deals / Closed Won Requirements default.

```json
{
  "module": "leads",
  "group": "Additional Information",
  "name": "Project Budget",
  "type": "Number",
  "required": true,
  "visibleInForm": true,
  "active": true,
  "description": "Budget in PHP",
  "options": []
}
```

A record submission contains `"customFieldValues": { "<definition-id>": 25000 }`. Values may be strings, finite numbers or null. Null clears an optional visible field. Omitted values are preserved. Field count and value payloads are capped at 100 per module/submission. Names are unique within the same module and normalized group; the same label in different modules or groups is allowed.

## Executed-check ledger

| Check | Actual result |
| --- | --- |
| Prisma generate | Passed |
| Prisma validate | Passed using local placeholder connection URLs; validation does not connect to a live database |
| All-workspace `npm run lint` | Passed: backend, frontend, shared TypeScript checks |
| `npm run build` | Passed: backend and frontend production builds |
| `node backend/scripts/test-custom-fields.mjs` | Passed: 7 integration scenarios, migration preservation, tenant/record SQL constraints, plus migration replay with compatibility retirement deferred |
| `node backend/scripts/test-crm-completion.mjs` | Passed: 14 existing CRM/closing integration tests and migration preservation checks |
| Focused Deal backend unit/property tests | Passed: 26 tests across lifecycle, lifecycle migration, junction synchronization and error classification |
| Focused frontend form/renderer/settings/adapter/cache tests | Passed: 72 tests across 11 files; the final renderer suite then passed with two additional inline-editor tests |
| Existing record-panel regressions and final custom-field editor tests | Passed: 53 tests across 2 files (44 panel tests, 9 renderer/editor tests); 118 distinct frontend tests across the combined runs. An initial five-second panel timeout passed on rerun with a 15-second limit and one worker |
| Deployment guard tests (`npm --prefix backend run test:rollout`) | Passed: 7 tests |
| Chrome responsive/persistence acceptance | Passed: 61 checks (55 responsive, 4 create/edit persistence, 2 Hide/Show preservation), zero page errors. Results and screenshots: `data/outputs/custom-fields-browser/`; generated by `backend/scripts/verify-custom-fields-browser.mjs` |
| `git diff --check` | Passed |

The browser harness covers Settings, New Field, Edit Field, and create/edit flows for all four modules at 1440, 768, 390, 375 and 320 pixels. It submits real API saves, reloads values, checks missing-required behavior, inspects horizontal overflow, and records page errors. It also tests persisted Hide/Show and restores the previously saved Lead value. Run after building, with `PLAYWRIGHT_MODULE` pointing to an installed Playwright package and Chrome available. It starts only a disposable database and localhost servers; it does not use deployment credentials.

Desktop and 320px screenshots were also visually inspected, including New Field, grouped Lead/Account forms, Settings cards and inline Deal custom-field editing. Captured pages use the existing LeadCRM typography, buttons, panels and section headings.

## Deployment sequence

1. Back up the target database and verify the normal release migration history. Keep the existing retirement gates; do not reset the database or use destructive `db push`.
2. Apply the repository's normal `npm --prefix backend run db:deploy` release path with the target's configured credentials. The new migration is transactional and independently verified with relationship retirement deferred. No target database has been migrated by this task.
3. Deploy matching backend/shared and frontend changes together. Verify definition IDs/counts, known backfilled values, unchanged closing JSON/snapshots, and tenant/RBAC access before enabling normal use.
4. Perform authenticated create, reload, edit, hide/show and Closed Won checks on the deployment. Verify live secure storage separately. Preserve `closingValues` and `closingSnapshot`; no retirement is part of this release.

Use [the architecture guide](ARCHITECTURE.md), [API guide](API.md) and [existing engagement/closing documentation](engagement-deal-creation.md) for surrounding behavior.
