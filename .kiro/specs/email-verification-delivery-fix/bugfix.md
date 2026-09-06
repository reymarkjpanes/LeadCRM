# Bugfix Requirements Document

## Introduction

Registration OTP/verification emails are never delivered to users in the production Render deployment.
The email service (`email.service.ts`) walks a three-transport fallback chain (Gmail OAuth2 → SMTP → Resend).
All three transports are currently misconfigured:

1. **Gmail OAuth2** — the stored refresh token has expired/been revoked, causing every token-refresh
   attempt to fail with `401 Invalid Credentials`. `getSystemAccessToken()` returns `null` and
   execution falls through.
2. **SMTP (Nodemailer)** — Render free tier blocks outbound SMTP ports (25, 465, 587).
   The 5-second connection timeout fires and execution falls through.
3. **Resend** — the API call succeeds and Resend returns HTTP 200, but `RESEND_FROM` is set to
   `onboarding@resend.dev` (Resend sandbox sender). Resend silently drops all messages sent from the
   sandbox domain to any address that is not a verified Resend contact.

The cumulative effect: every registration OTP send completes without a thrown error on the backend
(Resend swallows the message silently), yet the user never receives an email.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user registers and the system attempts to send a verification OTP via Gmail OAuth2 THEN
the system fails with `401 Invalid Credentials` because the stored OAuth2 refresh token is expired
or revoked, and falls through to the next transport without delivering the email.

1.2 WHEN the system falls through to the SMTP transport on Render free tier THEN the system times
out after 5 seconds because Render blocks all outbound SMTP ports (25, 465, 587), and falls through
to the next transport without delivering the email.

1.3 WHEN the system falls through to the Resend transport and `RESEND_FROM` is
`onboarding@resend.dev` THEN the system records a successful send (`✓ Sent via Resend`) in the
backend logs but Resend silently drops the message, so the recipient never receives the email.

1.4 WHEN `dark70angeluz@gmail.com` (or any non-verified-Resend-contact email address) registers
THEN the system logs success while the OTP email is silently discarded, leaving the user unable to
complete email verification.

### Expected Behavior (Correct)

2.1 WHEN the Gmail OAuth2 system sender account has a valid, non-expired refresh token stored in
the database THEN the system SHALL obtain a fresh access token and send the OTP email successfully
via the Gmail API without a `401` error.

2.2 WHEN Resend is the active transport and `RESEND_FROM` is set to a verified custom sender domain
(e.g., `noreply@yourdomain.com`) THEN the system SHALL deliver the OTP email to any recipient
address, not just verified Resend contacts.

2.3 WHEN either Gmail OAuth2 or Resend is correctly configured as described in 2.1 or 2.2 THEN the
system SHALL deliver the registration OTP email to the registering user's inbox so they can
complete verification.

2.4 WHEN `dark70angeluz@gmail.com` registers after the fix is applied THEN the system SHALL deliver
the OTP email to that address.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a valid Gmail OAuth2 system sender account is configured and the access token has not
expired THEN the system SHALL CONTINUE TO use Gmail OAuth2 as the first-priority transport without
falling through to Resend.

3.2 WHEN Gmail OAuth2 returns `null` (unconfigured or inactive account) THEN the system SHALL
CONTINUE TO fall through to the next transport in the chain (SMTP → Resend) as designed.

3.3 WHEN SMTP credentials are configured in a non-Render environment THEN the system SHALL CONTINUE
TO send via SMTP without requiring a Resend configuration.

3.4 WHEN an email is sent successfully via any transport THEN the system SHALL CONTINUE TO log
`✓ Sent via [Transport] to [recipient]` and return without throwing an error.

3.5 WHEN all transports fail in production THEN the system SHALL CONTINUE TO throw an `AppError`
with status 502/503 rather than silently swallowing the failure.

3.6 WHEN campaign emails are sent to existing tenants via the marketing module THEN the system
SHALL CONTINUE TO use the same transport chain without disruption.
