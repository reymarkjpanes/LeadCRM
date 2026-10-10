# Outbound SMS through TextBee

Campaigns and the existing Workflow `send_sms` action use the shared backend
`sendSms()` service. TextBee is the only SMS transport. The service posts one
normalized E.164 recipient per request to
`https://api.textbee.dev/api/v1/gateway/send-sms` with `x-api-key` authentication.
Its registered Android gateway sends through its SIM; API acceptance is not
proof of handset delivery.

## Configuration

Set backend-only `TEXTBEE_API_KEY`, optional `TEXTBEE_DEVICE_ID` (otherwise the
TextBee default device), and `TEXTBEE_WEBHOOK_SECRET`. Empty placeholders live in
`backend/.env.example`; actual values belong in ignored `backend/.env` and the
Render backend environment. Never put them in public frontend variables.

Keep the Android gateway enabled, online, permitted to send SMS, and equipped
with an active SIM. Provider account/plan and carrier limits still apply.
An offline gateway can leave accepted messages queued. Do not resend an
uncertain submission without checking provider history.

Configure an active webhook to the backend's HTTPS
`/api/v1/webhooks/textbee` endpoint, using the same signing secret (at least 20
characters). Subscribe only to `MESSAGE_SENT`, `MESSAGE_DELIVERED`,
`MESSAGE_FAILED`, and `UNKNOWN_STATE`. LeadCRM does not process inbound SMS.

## Message construction

`buildFinalSms()` is shared by campaign preflight, live preview and the transport.
It renders allowed campaign variables, trims outer whitespace, and appends the
fixed Camxian contact block (`+63 (28) 462-3488 or go to the official website.`)
and no-reply statement once. SMS delivery no longer depends on an organization
email address; an email variable appears only if a campaign author explicitly
adds `{{sender_email}}` to its message. Templates continue storing only editable
content. Users cannot disable the footer.

The preview includes the complete personalized sample, footer, character count,
and GSM-7/Unicode segment estimates.
TextBee's documented segmentation is 160/153 GSM septets and 70/67 UTF-16 units;
GSM extension characters consume two septets. The 50,000-character bound is a
LeadCRM safety limit, not a documented TextBee maximum. Nothing is truncated.

## Persistence and delivery tracking

The existing phone audience rules, normalized-phone deduplication, Contact over
Lead precedence, tenant isolation and campaign claim/locking remain in place.
Provider HTTP calls happen after the preparation transaction commits.
`CampaignContact.phone` stores the phone; `messageId` stores the one-recipient
`smsBatchId`. Accepted sends are submitted, not delivered. Responses without an
authoritative batch identifier and timeouts are marked unconfirmed for review;
the service never blindly retries them. Workflow submission receipts remain in
their existing execution steps.

Webhook authentication is HMAC-SHA256 of the exact raw request bytes, compared
in constant time against `X-Signature`. Delivery updates require matching batch,
recipient and configured device. The additive
`20261107000000_textbee_webhook_receipts` migration stores provider idempotency
keys with a composite tenant/recipient foreign key. Repeated events do not
inflate counts, and final delivered/failed states never regress. A callback
arriving before the submission receipt gets a retryable 503.

Reports distinguish submitted, sent, delivered, failed and pending.
`UNKNOWN_STATE` retains any confirmed sent fact internally while displaying a
neutral Pending recipient label until a later confirmation. SMS never fabricates opened/clicked activity. Webhook
metrics are recomputed from persisted recipients. Existing Email history remains
intact. Historical UniSMS callbacks are no longer processed after the switch.

## Validation and controlled release check

Run SMS service tests, disposable campaign tests, Workflow SMS integration tests,
campaign composer/report tests, Prisma validate/generate, shared/backend/frontend
typechecks, both builds, rollout tests and `git diff --check`.

Deploy the same verified commit and additive migration to Render, then verify
the serving commit through the frontend proxy. Use only an approved isolated
test recipient for one SMS. Confirm its provider batch, signed status callbacks,
persisted recipient status and actual receipt. Ask the recipient to verify the
fixed Camxian phone contact block and single no-reply footer.
Do not infer receipt or tapping behavior from API acceptance.

## Official references

- [Sending SMS](https://textbee.dev/docs/sending-sms/sending-sms)
- [API reference](https://textbee.dev/docs/api-reference)
- [Webhook authentication and retries](https://textbee.dev/docs/webhooks)
- [Outbound events](https://textbee.dev/docs/webhooks/events)
- [API keys](https://textbee.dev/docs/getting-started/api-keys)

These contracts were checked on 2026-10-07. TextBee's dashboard may omit
`UNKNOWN_STATE` in its event picker; its documented webhook PATCH API supports it.
