# Workflow condition consistency

This change aligns condition editing, validation, record checks, queued stage
continuations and live execution. It also verifies the earlier trigger cleanup
and multi-condition changes. It does not add triggers, nested condition groups,
database columns or external provider integrations.

## Defined behavior

AND requires every rule; OR requires at least one. One event runs a matching
workflow's action sequence once, even when several alternatives match. No rules
means the trigger has no additional condition filter. New gates default to OR;
saved match modes remain unchanged.

| Field type | Offered comparisons | Value behavior |
| --- | --- | --- |
| Text / Long Text | Equals, Not equals, Contains, Does not contain, Starts with, Ends with, Is empty, Is not empty | Text comparisons ignore case; whitespace and punctuation remain literal |
| Number | Equals, Not equals, Greater than, Greater than or equal, Less than, Less than or equal | Finite numbers only; zero is a value |
| Date | On, Not on, Before, After, Is empty, Is not empty | Valid calendar dates; Before/After exclude the same day |
| Boolean | Equals, Not equals | Yes/No are explicit choices; false is a value |
| Dropdown / record reference | Equals, Not equals, Is empty, Is not empty | Exact configured option or selected record ID |
| Product / relationship / Changed fields list | Contains, Does not contain, Is empty, Is not empty | Exact membership, using canonical IDs or field keys |

Null, missing record values, whitespace-only text and empty lists are empty.
They do not satisfy negative comparisons. Existing explicit blank text equality
remains supported through the saved-definition compatibility path; new missing
operands cannot activate. Missing event evidence does not establish either a
positive or negative event condition. Malformed types do not match.

Date inputs use the existing CRM calendar-date convention. Stored Date values and
valid ISO timestamps resolve to the repository's UTC date projection; custom
date-only values retain their date. The evaluator does not depend on the host
timezone or compare time of day.

Updated events expose a Changed fields picker. Its labels use current field
names; values use unprefixed canonical keys such as `address` and
`customFieldValues.<id>`. Supported saved aliases remain readable. Invented field
keys are rejected instead of producing a rule that can never match.

## Stage movement and compatibility

Deal Updated → Move Deal Stage accepts field-only conditions. For example,
Priority Equals High can qualify without Stage Equals. To constrain movement to
Contacted, combine Stage Equals Contacted with the other requirements using AND.
A stage rule in OR is an alternative, not a restriction on other alternatives.

Tenant isolation, current permissions, same-pipeline movement, stage requirements,
terminal-stage rules, action admission, freshness checks and event idempotency
remain enforced. Assignment handoffs retain their separate mandatory target
status/stage policy.

Deal Closed/Won and Cancelled/Lost remain absent from new trigger choices.
Outcome starters use Stage Changed with explicit destination-stage conditions.
Saved legacy triggers remain readable and editable using their current metadata;
history is preserved and completed runs are not replayed. Explicit template
customization and undo/redo must preserve the selected condition mode.

## References and verification

[HubSpot's filter criteria](https://knowledge.hubspot.com/segments/determine-filter-criteria)
documents all/any logic and type-dependent operators.
[Pipedrive's automation conditions](https://support.pipedrive.com/en/article/workflow-automation-conditions)
distinguishes event evidence from record state. Products differ on case and
empty-value handling; the rules above are LeadCRM's explicit chosen contract.

Verification covers operator boundaries and types, all four CRM source modules,
custom fields, preview/live agreement, real CRM updates, stage-only and field-only
movement, linked Tasks, Activity/Run evidence, authorization, stale work and
duplicate delivery. Browser checks use the real draft API for OR/AND, three rules,
Changed fields selection, save/reload, deletion and renumbering.

Run the existing [isolated QA commands](../verification/system-qa.md) and the
Workflow native harness. Providers are mocked or disabled; passing tests do not
establish live Gmail/SMS delivery. Local QA must not use the configured application
database or customer records.

The workflow regression run recorded 210 backend unit/security tests, 346 frontend
tests and 384 native database tests across all 14 Workflow integration suites.
The latter count includes passing reruns after fixing historical-action repair.
Repair coverage exercises both direct updates and draft/publication, preserving
unchanged historical description text while validating newly edited text.
Native aggregate evidence is generated from each suite's latest JSON report;
parallel fixture invocations must not rely on the harness's shared summary file.

The final browser acceptance run passed 346 checks with no page or transport
errors. It covers the condition flows above, assignment and run history, and
responsive layouts across four themes and eight viewport widths. Workspace lint
and the isolated shared/backend/frontend production build also passed.
