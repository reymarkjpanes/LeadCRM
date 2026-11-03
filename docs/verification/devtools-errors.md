# DevTools error audit and local repair — 2026-10-28

This repair covers the supplied production Inbox screenshots. It changes local source only; no PR, deployment, database operation, Gmail send, synchronization, or disconnection was performed.

## Findings and changes

| Observation | Finding and repair |
| --- | --- |
| `POST /crm/duplicate-check` returns 400 | The hook accepted any email containing `@`, while the API requires a complete email. It now uses the existing shared `CrmEmailSchema`, omits incomplete emails, and still checks other valid criteria. Normalized criteria, entity types, and excluded IDs determine request identity. |
| Duplicate checks finish after editing or closing the form | The existing abort controller was never passed to the POST transport. POST now accepts optional `{ signal }`; the hook cancels obsolete requests and rejects stale results and finalizers. |
| Event streams report transport failures | The proxy previously passed the upstream body directly to Next. It now owns stream cancellation, reader release, listener cleanup, and graceful closure after upstream failure. Backend observers stop queued work and avoid asynchronous writes after disconnect or expiry. Existing authentication, tenant/RBAC checks, heartbeats, and reconnect timing remain intact. |
| Gmail list request has no response headers | That screenshot alone cannot distinguish browser cancellation from an upstream transport failure. The local committed-handler comparison verifies that ordinary-request cancellation left upstream body reads open. Cancellation is now forwarded for ordinary requests, and the 25-second deadline remains active through body consumption. |
| Inbox can display an empty state while switching queries | The prior successful-load flag was shared across queries. Empty-state eligibility now requires a successful response for the current mailbox/query/access generation. Failed loads offer a retry; stale completions cannot finish a replacement request's loading state. |
| `DELETE /marketing/audiences/:id` returns 409 | Expected protection for an audience referenced by a Campaign, including archived Campaigns. Keep the safeguard and explanatory UI. See [Campaign delivery](../campaign-email-delivery.md). |
| `POST /auth/login` returns 401 | The user confirmed an incorrect password. Preserve the denial and normal sign-in error handling. See [authentication](../authentication.md). |
| `contentscript.js` / ObjectMultiplex / listener warnings | These originate in injected browser scripts and are outside this application's source. |
| Deferred `beforeinstallprompt` message | Expected while the app retains the browser-issued installation event for a user click. No change to installation behavior. |

The public frontend release and proxied backend health endpoints both reported commit `236042f323a01e5b73de34b65093034d1ebfd691` during the audit. This is an observation, not evidence that the local repair has been deployed.

## Verification

- Focused frontend regressions: **253 tests passed across 8 suites**, covering proxy behavior, duplicate checks, Inbox, mailbox events, API transport, Campaign audience deletion, and auth/login state.
- Backend observer regressions: **12 tests passed across 2 suites**, covering access-loss events, disconnects during asynchronous reads, queued work, per-session validation, shared mailbox observation, and 45-second expiry.
- `npm run lint`: **passed**, including shared, frontend, backend, and the backend test TypeScript project.
- `npm run qa:build`: shared, backend, and frontend production build commands each **completed successfully**. The wrapper returned **REVALIDATION REQUIRED** because concurrent CRM/form/notification test edits changed the workspace during the build. Its change inventory contains no runtime implementation file from this repair. This is not a clean final-source verdict for the combined workspace; see the build receipt (historical local evidence; artifact retired).
- [The disposable transport fixture](../../scripts/verify-proxy-streams.mjs) serves a production-mode Next build behind a certificate-verified local HTTPS/HTTP2 ingress, with a synthetic HTTPS backend. It exercises all five event endpoints for immediate event delivery, normal completion, abrupt upstream disconnect, reconnection, cancellation, passive-session headers, and preserved HTTP 401 responses. It also checks cancellation during a stalled ordinary Gmail response.
- Run `node scripts/verify-proxy-streams.mjs` after building the frontend. Add `--baseline` to build the committed proxy handler in an ignored temporary fixture and compare ordinary-request cancellation. Evidence, temporary certificates, and server logs stay under `.tmp/proxy-streams-*`.
- Both final transport runs passed: repaired-handler evidence (historical local evidence; unavailable in clean checkouts) and committed-handler comparison (historical local evidence; unavailable in clean checkouts). The comparison confirms that ordinary-request cancellation leaves the committed handler's upstream response open, while the repaired handler closes it.

### Limits

Injected upstream resets produced clean HTTP/2 EOF in the committed-handler diagnostic as well as the repaired handler. **The exact production `ERR_HTTP2_PROTOCOL_ERROR` was not reproduced, and its production cause remains unconfirmed.** The fixture verifies interrupted-stream handling and the ordinary-request cancellation regression; it does not establish that every ingress, network, extension, or deployment failure has been eliminated.

Initial sandbox runs were blocked by Vitest cache permissions, font-download DNS restrictions, and build-directory writes. Those checks were rerun with the required permissions. An intermediate build completed all three workspace commands but correctly requested revalidation because files changed during the run. Unrelated concurrent CRM, phone, Product Category, and notification changes were preserved and are not attributed to this repair. Synthetic-fixture setup failures were corrected before collecting the final transport evidence.
