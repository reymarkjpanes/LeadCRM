-- Per-user completion reuses the existing auth/onboarding API. New users start incomplete.
ALTER TABLE "User" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- Preserve established users' access and credentials; only unfinished password setup gets the tour.
UPDATE "User" AS u
SET "onboardingCompletedAt" = COALESCE(t."onboardingCompletedAt", u."passwordChangedAt", u."createdAt")
FROM "Tenant" AS t
WHERE t.id = u."tenantId" AND u."mustChangePassword" = false;
