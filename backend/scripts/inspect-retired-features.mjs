// Read-only inventory. Never prints credentials, password hashes, or email tokens.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const db = new PrismaClient();
try {
  const result = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const tables = await tx.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename IN ('SystemAdmin','TenantDocument','RegistrationOtpToken','OAuthAccount','VerificationToken') ORDER BY tablename`);
    const counts = {};
    for (const { tablename } of tables) counts[tablename] = Number((await tx.$queryRawUnsafe(`SELECT count(*) AS count FROM "${tablename}"`))[0].count);
    const roles = await tx.$queryRawUnsafe(`SELECT u.id, u."tenantId", u.role, u.status, (lower(u.email) LIKE '%@camxian.com') AS employee, (u."passwordHash" IS NOT NULL) AS "hasPassword", t.slug, (t."ownerUserId" = u.id) AS owner FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId" WHERE regexp_replace(lower(u.role), '[ _-]', '', 'g') = 'systemadmin'`);
    const definitions = await tx.$queryRawUnsafe(`SELECT r.id, r."tenantId", r.name, count(ur.id)::int AS assignments FROM "RoleDefinition" r LEFT JOIN "UserRole" ur ON ur."roleId"=r.id WHERE regexp_replace(lower(r.name), '[ _-]', '', 'g')='systemadmin' GROUP BY r.id`);
    const constraints = await tx.$queryRawUnsafe(`SELECT conname, conrelid::regclass::text AS source, confrelid::regclass::text AS target, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND (conrelid::regclass::text ~ '(SystemAdmin|TenantDocument|RegistrationOtpToken|OAuthAccount|VerificationToken)' OR confrelid::regclass::text ~ '(SystemAdmin|TenantDocument|RegistrationOtpToken|OAuthAccount|VerificationToken)')`);
    const migrations = await tx.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name');
    const retained = await tx.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "Activity") AS activities, (SELECT count(*)::int FROM "AuditLog") AS audits, (SELECT count(*)::int FROM "EmailAccount") AS "emailAccounts", (SELECT count(*)::int FROM "RecordFile") AS "recordFiles"`);
    const indexes = await tx.$queryRawUnsafe(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename IN ('SystemAdmin','TenantDocument','RegistrationOtpToken','OAuthAccount','VerificationToken') ORDER BY tablename,indexname`);
    const columns = await tx.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Tenant' AND column_name IN ('approvedById','approvedAt','verificationStatus','businessType','verificationRejectionReason') ORDER BY column_name`);
    const fingerprints = {};
    for (const table of ['Activity','AuditLog','EmailAccount','MailboxMessage','MailboxOAuthState','RecordFile','DealStageHistory','Task','Lead','Contact','Account','Deal','PasswordResetToken','EmailVerificationToken','Workflow','WorkflowExecutionRun','WorkflowExecutionStep']) {
      fingerprints[table] = (await tx.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) AS digest FROM "${table}" t`))[0];
    }
    const users = await tx.user.findMany({ select: { id: true, tenantId: true, role: true, status: true, mustChangePassword: true } });
    const emailConnections = await tx.$queryRawUnsafe(`SELECT provider, "isActive", "connectedAt", "lastSyncAt", "updatedAt", "tokenExpiresAt", (length("accessToken") > 0) AS "hasAccessToken", (length("refreshToken") > 0) AS "hasRefreshToken", ("syncLeaseId" IS NOT NULL) AS "syncInProgress", ("syncError" IS NOT NULL) AS "hasSyncError" FROM "EmailAccount" ORDER BY "connectedAt"`);
    const roleIntegrity = await tx.$queryRawUnsafe(`SELECT count(*)::int AS "invalidAssignments" FROM "UserRole" ur LEFT JOIN "User" u ON u.id=ur."userId" LEFT JOIN "RoleDefinition" r ON r.id=ur."roleId" WHERE u.id IS NULL OR r.id IS NULL OR u."tenantId" <> ur."tenantId" OR r."tenantId" <> ur."tenantId"`);
    return { counts, roles, definitions, constraints, indexes, columns, migrations, retained, fingerprints, users, emailConnections, roleIntegrity };
  }, { timeout: 20000 });
  const phase = process.argv[2];
  if (phase === 'before' || phase === 'after') {
    const directory = resolve(import.meta.dirname, '../../data/outputs'); mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `retired-features-${phase}.json`), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ ...result, migrations: result.migrations.slice(-5), users: { count: result.users.length } }, null, 2));
} catch (error) {
  console.error('Read-only database inspection failed:', error.code ?? error.name, String(error.message).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL]'));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
