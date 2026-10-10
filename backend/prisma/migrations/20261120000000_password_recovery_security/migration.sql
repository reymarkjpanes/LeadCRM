-- Stop old backend processes before applying this forward migration.
-- Preserve existing links, account binding and expiry while removing bearer secrets at rest.
BEGIN;
ALTER TABLE "PasswordResetToken" ADD COLUMN "submissionStatus" TEXT NOT NULL DEFAULT 'LEGACY';
UPDATE "PasswordResetToken"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");
COMMIT;
