# Engagement, Custom Fields and Deal creation

## Behavior

Mailbox engagement uses provider timestamps and technical metadata, never subject
or body classification. Both Leads and Contacts use the same evaluator. A genuine
reply is Hot for fewer than eight complete 24-hour days, Warm from day 8 until day
30, and Cold from day 30. A never-replied customer is Warm until 30 days after the
first relevant outbound message, then Cold. Follow-ups do not reset either clock.
No history preserves the existing status; Closed and Cancelled are preserved.
Campaign delivery, opens and clicks remain separate reporting events.

Prisma exposes the existing `lastMeaningfulInboundAt` columns as
`lastCustomerReplyAt` using `@map`; there is no second mutable reply clock.
Rule version 2 replays bounded provider-verified history, including outbound and
converted-Lead history. Evaluation uses the current time. Serial transactions
update timestamps, status and Activity together. Status events are emitted
after commit with the transition Activity ID for Workflow deduplication.

The existing five-minute scheduler evaluates after successful history coverage.
Incomplete cursors, disconnected accounts, sync errors, sync older than 24 hours,
and unverified relevant history pause aging. A newly observed genuine recent reply
can immediately prove Hot. Recovery catches up to the actual elapsed age. Missing
provider messages are marked unverifiable and reported by account/message ID;
they pause the affected customer's aging without blocking other replay batches.

Mailbox engagement never moves Deals, cancels them, or writes stage history. The
retired Deal Stage Automation card, endpoints, service and shared configuration
are removed. Manual stage moves, explicit CRM cancellation and authorized Closed
Won completion retain the existing Deal business rules.

## Related-Deal Workflow actions

`move_deal_stage` supports Deal, Lead and Contact triggers. Lead/Contact targets
come from tenant-scoped relationship junctions and open Deals in the destination
stage's pipeline. Optional `productInterestId` and `currentStageId` filters narrow
the matches. `targetMode` defaults to `single_match`: zero is a logged no-op and
multiple matches fail with instructions to narrow the filters. Explicit
`all_matching` moves every match through the authorized Deal-stage service.
Required fields, lost reasons, lifecycle rules and Closed Won evidence still apply.

The triggering record stays separate from target Deals. Execution output records
matched and moved IDs and a failed target when a move fails. Related moves require
Deal view/edit permissions. The builder exposes the filters, and read-only testing
reports target IDs or validation failures without moving Deals or initializing
closing-field definitions. Existing Deal triggers remain supported. No Workflow
definitions are automatically created.

## Custom Fields and New Deal

Custom Fields has one card per saved definition, an Edit Field menu, and a page
Add New Field action. Create uses POST; edit uses PATCH by saved ID. Applies To is
server-defaulted to the existing Closed Won purpose. Editing cannot change type;
requiredness, active state, description and dropdown options remain editable under
their existing permissions. Each drawer opening resets identity, values and errors.
Historical Deal evidence and closing snapshots remain intact.

New Deal uses Product checkboxes and displays each configured price and the number
of Deals to create. Lead is the fixed starting stage even when another Kanban column
opens creation. Industry uses the shared catalog, and Industry and Address pass
through the existing adapter. Deal editing retains historical Product/value snapshots.

The API contract is documented in [API.md](API.md). A tenant-scoped receipt stores
the idempotency key, actor, normalized payload hash and created IDs. Serializable
transactions commit the complete set or roll everything back. Identical retries
return the same Deals, and conflicting payloads return 409. Creation events and
assignment notifications have stable keys. The drawer prevents simultaneous
submission and preserves the request key and serialized payload in session storage
through uncertain failures. API and mock mode both use the batch contract and
deduplicate client state by Deal ID.

## Migration and verification

Deploy the forward migration `20261103000000_reply_engagement_deal_batches` through
the existing `npm --prefix backend run db:deploy` process. It adds
`DealCreationReceipt` and deletes only `TenantPreference` entries with module
`deal-stage-automation` and key `default`. Generic preferences, mailbox history,
field definitions and evidence remain intact. Its name follows all existing
migrations so the retired defaults cannot be recreated by older migration SQL.
Do not reset deployment databases. Rule replay runs through the existing scheduler.

Verification results and limitations are recorded in
[the implementation report](engagement-implementation-report.md).
