-- Migration: hash_invitation_tokens
-- Renames TenantInvitation.token (raw plaintext) to tokenHash (SHA-256 hashed value).
--
-- IMPORTANT: This migration intentionally invalidates all existing invitation links.
-- Any pending invitations issued before this migration must be re-sent.
-- Tokens are 7-day TTL — the blast radius is small.
--
-- After this migration:
--   - invitations.service.ts stores SHA-256(raw_token) in tokenHash
--   - auth.service.ts and invitations.service.ts look up by SHA-256(raw_token)
--   - The raw token only exists in the invitation email link — never in the DB

-- 1. Drop the old unique index on token
DROP INDEX IF EXISTS "TenantInvitation_token_key";

-- 2. Rename column token → tokenHash
ALTER TABLE "TenantInvitation" RENAME COLUMN "token" TO "tokenHash";

-- 3. Recreate the unique index on tokenHash
CREATE UNIQUE INDEX "TenantInvitation_tokenHash_key" ON "TenantInvitation"("tokenHash");

-- 4. Update the non-unique index (was @@index([token]), now @@index([tokenHash]))
DROP INDEX IF EXISTS "TenantInvitation_token_idx";
CREATE INDEX "TenantInvitation_tokenHash_idx" ON "TenantInvitation"("tokenHash");