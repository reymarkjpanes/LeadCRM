BEGIN;

-- Remove only the dedicated challenge/recovery tables. Their foreign keys and
-- indexes belong to these tables and are dropped with them. No CASCADE is used.
DROP TABLE "MfaChallenge";
DROP TABLE "MfaRecoveryCode";

-- passwordChangedAt, sessions, verification/reset tokens and audit history stay.
ALTER TABLE "User"
  DROP COLUMN "mfaEnabled",
  DROP COLUMN "mfaEnabledAt",
  DROP COLUMN "mfaLastCounter",
  DROP COLUMN "mfaPendingExpiresAt",
  DROP COLUMN "mfaPendingSecretEncrypted",
  DROP COLUMN "mfaSecretEncrypted";

-- These fields are retired only on Account; Contact lifecycle fields stay.
ALTER TABLE "Account"
  DROP COLUMN "taxId",
  DROP COLUMN "customerType",
  DROP COLUMN "customerSince";

COMMIT;
