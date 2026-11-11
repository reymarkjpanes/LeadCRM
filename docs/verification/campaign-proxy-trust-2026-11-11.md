# Campaign callback proxy trust — November 11, 2026

## Status

Implementation and local verification are complete on `codex/campaign-proxy-trust`,
based on upstream main `2b80a7a8b2a69debd3f24e6dff1e1af5187800c6`.
**Production configuration application, code deployment and the controlled
delivery/open/click acceptance checks remain pending. This is not a resolved
production incident.**

## Confirmed production cause

Both serving applications and the frontend API proxy reported that full main
SHA. The backend starts `node backend/dist/start.js`. Runtime settings are:

- `BACKGROUND_WORKERS_ENABLED=false`
- `CAMPAIGN_SUBMISSION_WORKERS_ENABLED=true`
- `CAMPAIGN_DELIVERY_RECONCILIATION_ENABLED=true`

Startup logs confirmed delivery reconciliation independently of general workers.
The registered Brevo transactional webhook uses the correct HTTPS API route,
matching bearer authentication and delivery/open/unique-open/click subscriptions.
No credential values were printed.

Docker inspection found the Traefik `coolify` address at `172.18.0.11`, dynamically
allocated, while backend trust still included the old `172.18.0.7/32`. That address
now belongs to the backend. Public HTTPS probes to both Brevo and TextBee returned
400 `HTTPS is required.` before authentication. Actual Brevo requests at about
14:02:35–36 Asia/Manila failed in the same HTTPS validation stage.

The prior address-specific repair could drift when the proxy was recreated.
Further receipt-processing or polling changes do not repair this ingress failure.

## Exact correlated recovery evidence

Campaign: `d3a0c926-7f36-4867-8edf-81c3b0868ef3` (`Email Test`).

| Recipient | Provider message ID | Delivered at (Asia/Manila) |
| --- | --- | --- |
| `tironjohn123@gmail.com` | `<202611110602.33900159861@smtp-relay.mailin.fr>` | 14:02:33 |
| `mayanntiron6@gmail.com` | `<202611110602.78978908431@smtp-relay.mailin.fr>` | 14:02:32 |

Production Brevo history returned these exact IDs/emails/times, matching persisted
CampaignContact and EmailDeliveryLog records. The campaign metrics recorded
Delivered 1 at 14:06:58.180 and Delivered 2 at 14:08:55.707. The full delivered
count therefore appeared about 6 minutes 23 seconds after the last provider
delivery. These snapshot times are not exact database commit timestamps.

At inspection, 30 records were eligible for the existing five-lookups-per-minute
scan; none lacked delivery evidence anymore. The authenticated report showed
Delivered in its header/details and for both recipients, with Delivered 2.
Database-commit-to-visible-report latency was not measured.

## Prepared production configuration diff

Validate that `.11` still belongs only to Traefik before applying. The existing
external `coolify` network has subnet `172.18.0.0/16` and gateway `172.18.0.1`.
Save the proxy change through Coolify's proxy configuration, preserving other
configuration and network attachments:

```diff
 services:
   traefik:
     networks:
-      - coolify
+      coolify:
+        ipv4_address: 172.18.0.11
```

Backend runtime variable (preserve the existing loopback, IPv4 and IPv6 entries):

```diff
-TRUSTED_PROXIES=loopback,10.0.1.0/24,fda6:ff05:7da3::/64,172.18.0.7/32
+TRUSTED_PROXIES=loopback,10.0.1.0/24,fda6:ff05:7da3::/64,172.18.0.11/32
```

Production approval must cover these exact settings, a brief shared-proxy restart
and recreation, and a normal backend restart/deployment. Keep worker flags,
provider credentials and subscriptions unchanged. Retain the previous saved
proxy configuration for rollback; do not proceed if validation or address
ownership differs from this evidence.

The proposed in-memory proxy Compose change passed the production host's
`docker compose --project-directory /data/coolify/proxy -f - config --quiet`
validation. The source file was read and piped through validation; it was not
saved, and no container was restarted.

## Code changes and verification

- Existing HTTPS rejection logs now include the actual socket peer and a bounded
  protocol category; arbitrary forwarded header contents are not logged.
- Brevo logs new/changed evidence only after transaction commit, with source,
  correlation IDs, provider time, persistence confirmation time and duration.
  Newly recovered deliveries older than three minutes emit a warning once.
- Existing recovery emits bounded sweep counts and deferral/failure outcomes.
  Selection, retry, cursor, grace period and provider request limits are unchanged.
- The existing manual deployment command and optional release coordinator require
  401 from both direct unsigned webhook probes. Failure blocks verification;
  neither check is described as authenticated callback acceptance.
- No frontend polling, schema, API, dependency or sending behavior changed.

Local results: 108 campaign integration tests and 40 SMS tests passed on separate
disposable native PostgreSQL 17.6 clusters with durability enabled and outbound
providers mocked. The new integration test forces authenticated callbacks to
fail database persistence, confirms rollback/no successful acknowledgment, then
recovers delivery/open/click history after 429/503 responses without resending.
Duplicates preserve receipt and recipient totals. Worker/proxy/status tests,
33 Campaign Report tests, backend application/test type checks and backend build
also passed. All 27 release-command regressions passed, including the manual
command rejecting the reproduced 400 response without exposing response bodies.
The focused verification totals 246 passing tests; this is not a full-suite run.

## Remaining production acceptance

1. Apply only after the exact configuration diff is approved. Recreate and
   normally restart the proxy; verify the saved static address persists. Restart
   the backend and verify flags, worker startup, serving SHAs and both 401 probes.
2. Send exactly one authorized controlled email to `tironjohn123@gmail.com` with
   a harmless tracked HTTPS link. Record its campaign/recipient/log/message IDs.
3. Verify genuine Brevo delivery, successful authenticated callback processing,
   committed deliveredAt/status and automatic report transition to Delivered.
4. Open the same message with remote images enabled, using recipient handoff if
   authenticated mailbox access is unavailable. Match its exact provider open
   evidence, EmailEvent and openedAt, then verify automatic Opened/activity
   updates while campaign status stays Delivered.
5. Click its tracked link and independently verify provider evidence, callback,
   committed click receipt/clickedAt and automatic link/activity updates.
6. Compare provider timestamps with post-transaction persistence confirmation
   logs, then compare confirmation with visible report changes. EmailEvent's
   createdAt is provider time, not receipt/commit time. Report timing precision,
   clock uncertainty and network/rendering time; expect the next 2.5-second poll.
7. Use the correlated production recovery above and the disposable missed-callback
   regression; do not disable account-wide production subscriptions for testing.
   Verify no additional submissions, duplicate receipts or inflated metrics.

Coolify log drains were unconfigured at inspection. Existing logs and failing
release checks make failures actionable; external alert delivery is not connected
and must not be claimed. Do not declare production resolved before genuine
delivery and engagement acceptance is complete.
