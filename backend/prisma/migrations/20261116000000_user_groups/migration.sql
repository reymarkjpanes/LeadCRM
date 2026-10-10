-- Preserve legacy profile departments as same-tenant Group memberships.
-- Reuse an existing case-insensitive Group name; preserve all existing memberships.
INSERT INTO "TenantGroup" ("id", "tenantId", "name", "createdAt", "updatedAt")
SELECT md5('leadcrm-department-group:' || u."tenantId" || ':' || lower(btrim(u."department")))::uuid::text,
       u."tenantId", min(btrim(u."department")), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE nullif(btrim(u."department"), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "TenantGroup" g WHERE g."tenantId" = u."tenantId" AND lower(btrim(g."name")) = lower(btrim(u."department")))
GROUP BY u."tenantId", lower(btrim(u."department"))
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TenantGroupMember" ("id", "groupId", "userId", "tenantId")
SELECT md5('leadcrm-department-member:' || u."id" || ':' || g."id")::uuid::text,
       g."id", u."id", u."tenantId"
FROM "User" u
JOIN LATERAL (
  SELECT "id" FROM "TenantGroup"
  WHERE "tenantId" = u."tenantId" AND lower(btrim("name")) = lower(btrim(u."department"))
  ORDER BY "id" LIMIT 1
) g ON true
WHERE nullif(btrim(u."department"), '') IS NOT NULL
ON CONFLICT ("groupId", "userId") DO NOTHING;

ALTER TABLE "User" DROP COLUMN "department";
