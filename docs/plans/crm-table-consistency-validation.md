# CRM table and relationship polish

Implementation and verification: 2026-10-05. Local working-tree changes; not committed or deployed. Continues the [side-panel polish](side-panel-ui-polish-plan.md).

## Scope and preserved behavior

Contacts, Accounts, Deals, and Tasks use the Leads name treatment: 13px, weight 500, blue `#1a73e8`, with consistent compact avatars. Deal cards wrap long names, omit empty relationship separators, use quieter amount/priority styling, and show zero amounts and zero stage totals.

Only the Deal Stage Automation card was removed from Custom Fields. Automatic stage transitions, workflow triggers/actions, saved Task associations, field definitions, validation rules, upload persistence, and closing-evidence locks remain in place. No schema migration is required.

## Data fixes

| Area | Cause | Correction |
| --- | --- | --- |
| Tasks | Empty plural response collections hid older singular links. | Merge and deduplicate both response shapes for display; hydrate Accounts on list and single-record responses. |
| Workflow-created Tasks | The Task was associated with the source Deal, so its connected Lead/Contact/Account did not appear in the Task table. | Return explicit CRM connections as separate `relatedRecords`, display them in the relevant columns, and explain their source in Task details. Do not add them to the Task's saved association IDs. |
| Task refresh | CRM updates did not immediately invalidate the Task display. | Refresh Task data after Lead, Contact, Account, and Deal cache invalidation. |
| Deals | The adapter depended on a nested organization to retain the Account ID, and discarded the embedded owner. The per-stage query omitted some relationship data. | Retain canonical Account IDs, embedded owners, and legacy person links; include relationship labels consistently in list queries. |
| Accounts | The response adapter dropped populated contact/details fields and its embedded owner. | Preserve email, phone, notes, product lists, updated date, and owner. |
| Contacts | Company and owner names could depend on an unloaded lookup page or an empty company string. | Prefer populated relationship names from the response before lookups. |
| Leads | Description, website, audit users, and status-change date were dropped; Product Interest could reach the table as a legacy string. | Preserve the populated fields and render the full product list safely. Prefer the embedded owner. |

Task context uses tenant-scoped batched queries, deduplicates relationships by ID, and excludes foreign-tenant records. Additional context returned by HTTP also requires the target module's View permission. A Task linked only to an Account does not acquire all of that Account's child records. Unassociated records remain empty; no relationships are inferred from matching names.

## Closed Won Requirements

- Show required-field completion, a labeled progress bar, per-field completion state, and explicit Required/Optional labels.
- Explain that saving the final required value on a Qualified Deal automatically closes it as won and locks the evidence; optional details should be entered first.
- Show missing values and unavailable files truthfully. A stored file ID without returned file metadata does not count as completed.
- Preserve existing edit/save/upload behavior and show accessible field errors. Reset row editing when switching Deals.

## Verification

- Live application inspected read-only; Leads typography measured before matching the other modules.
- Actual frontend components rendered locally with isolated sample records, without production writes. Verified desktop tables/cards, all four Task relationship columns, Task details, Custom Fields card removal, and Closed Won editing/validation.
- Mobile checks at 390px: Task panel scroll/footer and related-record wrapping, Closed Won settings, and dark-mode requirements. No page-level horizontal overflow in the requirements view.
- Focused frontend regression suite: 54 passed; two additional Lead adapter/table regression tests passed (56 total).
- Task HTTP/database integration: 18 passed, including partial module permissions, tenant boundaries, legacy links, and display context that does not change saved associations.
- Workflow database integration: 10 passed, including a real Deal update creating a Task with the correct source Deal and CRM context.
- Earlier focused backend unit/property checks: 25 passed across Task context/service and Deal pagination.
- Frontend, backend, and shared TypeScript checks passed. The final frontend production build passed with all 180 pages generated, including the final Lead display fixes.

Integration tests use the repository's disposable local database runner. Preview and test logs live under ignored `frontend/build/panel-qa/`. Screenshots are saved in the task's `crm-consistency` artifact directory.

## Remaining mismatches and limits

- **“Required Document” is configured as optional.** Its Optional label now makes the actual rule visible. The stored configuration and historical evidence were not changed.
- Some optional Lead communication/analytics columns are placeholders without computed values in the current API (for example email counts, opportunity totals, and next-task summaries). This pass fixes dropped existing fields and relationship display; it does not fabricate those aggregates or implement new reporting features.
- The old `COLUMN-FIELD-MAPPING-AUDIT.md` is historical and contains obsolete claims, including that populated Lead description/website/audit fields are unavailable. Use this report and current source for the corrected mappings.
- Screenshots show local component previews, not a deployed release. The deployed site will retain its current UI until these frontend/backend/shared changes are shipped together.
- The local frontend build reports its existing localhost backend proxy configuration. Production environment settings were not changed or validated by this local build.

## Final validation results

56 frontend regression tests passed, 18 Task API integration tests passed, and 10 Workflow integration tests passed. The final frontend production build exited successfully. `git diff --check` passed. Remaining limits are listed above; no production records were changed.
