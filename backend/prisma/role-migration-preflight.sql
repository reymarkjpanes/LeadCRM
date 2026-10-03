-- Read-only deployment preflight. Review counts before applying the role migration.
SELECT count(*) AS retired_accounts_to_disable FROM "User" u
WHERE lower(trim(u."role")) = 'guest' OR EXISTS (
  SELECT 1 FROM "UserRole" ur JOIN "RoleDefinition" rd ON rd."id" = ur."roleId"
  WHERE ur."userId" = u."id" AND lower(trim(rd."name")) = 'guest'
);
SELECT count(*) AS retired_role_definitions FROM "RoleDefinition" WHERE lower(trim("name")) = 'guest';
SELECT count(*) AS existing_user_roles_becoming_custom FROM "RoleDefinition" WHERE "name" = 'User';
SELECT count(*) AS client_admin_email_exceptions FROM "User"
WHERE "role" = 'Client Admin' AND trim("email") !~* '^[^@[:space:]]+@camxian[.]com$';
SELECT count(*) AS inconsistent_tenant_assignments FROM "UserRole" ur
JOIN "User" u ON u."id" = ur."userId" JOIN "RoleDefinition" rd ON rd."id" = ur."roleId"
WHERE ur."tenantId" <> u."tenantId" OR ur."tenantId" <> rd."tenantId";
SELECT count(*) AS missing_primary_assignments FROM "User" u
WHERE u."status" = 'ACTIVE' AND u."role" NOT IN ('Client Admin')
AND lower(trim(u."role")) <> 'guest' AND NOT EXISTS (
  SELECT 1 FROM "UserRole" ur JOIN "RoleDefinition" rd ON rd."id" = ur."roleId"
  WHERE ur."userId" = u."id" AND ur."tenantId" = u."tenantId"
    AND rd."tenantId" = u."tenantId" AND rd."name" = u."role" AND NOT rd."isArchived"
);
