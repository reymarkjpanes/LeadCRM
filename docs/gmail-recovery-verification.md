# Gmail request recovery and Custom Fields cards

## Request traffic

- The header previously listed up to 30 unread messages and fetched every message body for its badge. It now reads `labels/INBOX?fields=messagesUnread` once, returning the exact count through the authenticated `/integrations/gmail/unread-count` endpoint.
- Search is debounced for 400 ms. Filter changes and manual sync each cause one inbox reload. Background sync refreshes the list only when it processes messages, without a second reload through its status timestamp.
- Browser background sync begins after 15 seconds and runs every five minutes while the document is visible. The existing backend scheduler remains in place.
- Gmail GET calls share two concurrent slots per access-token hash in each backend process. Simultaneous identical reads share one promise. Queued reads stop immediately when Gmail reports throttling.

## Recovery

- Gmail 429 and recognized 403 rate limits start a shared cooldown of at least 60 seconds, increasing on repeated throttling up to 15 minutes. A longer provider `Retry-After` is honored, in both seconds and HTTP-date formats.
- The error response supplies an ISO `retryAt` and a standard `Retry-After` header. The browser keeps loaded emails visible, shows a neutral countdown, disables refresh/sync/pagination, and automatically retries the current view after that time.
- With no loaded emails, the page explicitly says it is waiting for Gmail. It does not claim the inbox is empty. Changing the filter does not show old emails as results for the new query.
- Permission and authentication failures remain actionable errors. Send operations are never automatically retried by the read coordinator.
- These controls reduce avoidable requests; Google can still enforce provider limits. Coordination is local to a backend process and token lifetime, not a distributed quota service. A restart or token refresh starts a fresh coordinator; the next provider limit establishes a new cooldown. No provider payload or token is exposed to the browser.

Reference: [Google's Gmail error and retry guidance](https://developers.google.com/workspace/gmail/api/guides/handle-errors).

## Custom Fields

Custom Fields now shows one card per saved `ClosingFieldDefinition`, with an **Edit Field** menu bound to that field's ID. **Add New Field** opens a blank drawer. The fixed Closed Won purpose is supplied by the server; the form does not expose Applies To, and field type is immutable on edit. Product management remains separate. See [current behavior and verification](engagement-deal-creation.md); the verification below records the earlier gallery release.

## Verification

- Backend Gmail read tests cover concurrency across callers, in-flight deduplication, queued cancellation, account isolation, increasing cooldowns, both Retry-After formats, API retry metadata, lightweight unread counts, and existing error mapping.
- Inbox UI tests cover debounce, one reload per filter/sync, visible cached rows during cooldown, automatic recovery, first-load waiting, query isolation, permission errors, Strict Mode, and cleanup on unmount.
- The disposable mailbox integration suite exercises CRM behavior and verifies that the new count endpoint obeys mailbox ownership restrictions.
- `PREVIEW_GMAIL_THROTTLE_ONCE=true node backend/scripts/mailbox-preview.mjs` reproduces a single provider limit on the second inbox list call. This local preview uses simulated Gmail responses and does not read or send real email.
- Browser verification observed the initial message, a 60-second neutral pause with the message still visible, disabled refresh controls, and successful automatic recovery without a click. Custom Fields was checked at 1440 px and 375 px, with no mobile horizontal overflow; its requirements menu opened the existing configuration drawer.
- Passed: 23 Gmail read tests, 77 mailbox/sales integration tests, 42 frontend tests across six files (including nine Inbox recovery tests), and all three workspace type checks. Backend and frontend production builds passed (188 frontend pages).
- The frontend build required the established Windows sandbox exception for Next.js directory resolution. An intermediate build conflicted with the running development server's generated type files; the final successful build ran with that server stopped. Existing multiple-lockfile and local API configuration warnings remain.
- Screenshot: `data/outputs/gmail-recovery/custom-fields-desktop.jpg`.

No production deployment, live mailbox mutation, or additional database migration is performed by this follow-up.
