// Read-only catalog and integrity evidence. Never prints credentials or row payloads.
// Usage: node backend/scripts/audit-database.mjs [output.json]
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

dotenv.config({ path: resolve(import.meta.dirname, '../.env') });
const output = resolve(process.argv[2] || 'data/outputs/database-audit/live-current.json');
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL or DIRECT_URL is required');
const db = new PrismaClient({ datasources: { db: { url } } });
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const report = { capturedAt: new Date().toISOString(), environment: 'configured PostgreSQL database; application release evidence is recorded separately', readOnly: true };
try {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    const query = sql => tx.$queryRawUnsafe(sql);
    report.version = await query('SELECT version() AS version, current_schema() AS schema');
    report.tables = await query("SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename");
    report.columns = await query(`SELECT table_name AS "table", column_name AS name, data_type AS type, udt_name AS "nativeType", is_nullable AS nullable, column_default AS "default"
      FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`);
    report.constraints = await query(`SELECT c.conname AS name, t.relname AS "table", c.contype::text AS type, c.convalidated AS validated,
      pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema() ORDER BY t.relname, c.conname`);
    report.indexes = await query(`SELECT tablename AS "table", indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = current_schema() ORDER BY tablename, indexname`);
    report.triggers = await query(`SELECT c.relname AS "table", t.tgname AS name, pg_get_triggerdef(t.oid) AS definition, p.proname AS function,
      pg_get_functiondef(p.oid) AS "functionDefinition" FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname=current_schema() AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
    report.enums = await query(`SELECT t.typname AS name, e.enumlabel AS value FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
      JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema() ORDER BY t.typname,e.enumsortorder`);
    report.foreignKeys = await query(`SELECT c.conname AS name, child.relname AS "table", parent.relname AS "parent",
      array_agg(ca.attname::text ORDER BY k.ord) AS columns, array_agg(pa.attname::text ORDER BY k.ord) AS "parentColumns"
      FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
      JOIN pg_namespace n ON n.oid=child.relnamespace
      JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(cid,pid,ord) ON true
      JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.cid
      JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.pid
      WHERE c.contype='f' AND n.nspname=current_schema() GROUP BY c.conname,child.relname,parent.relname ORDER BY child.relname,c.conname`);
    const hasColumn = (table, field) => report.columns.some(c => c.table === table && c.name === field);
    report.migrations = report.tables.some(t => t.name === '_prisma_migrations')
      ? await query('SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, checksum FROM "_prisma_migrations" ORDER BY started_at') : [];
    report.integrity = [];
    for (const table of report.tables) {
      const timestamps = report.columns.filter(c => c.table === table.name && c.type.startsWith('timestamp')).map(c => c.name);
      const maxima = timestamps.map(c => `max(${quote(c)}) AS ${quote(c)}`);
      const [counts] = await query(`SELECT count(*)::text AS rows${maxima.length ? ', ' + maxima.join(', ') : ''} FROM ${quote(table.name)}`);
      table.rows = counts.rows;
      table.latestTimestamps = Object.fromEntries(Object.entries(counts).filter(([key]) => key !== 'rows'));
      const columns = report.columns.filter(c => c.table === table.name);
      const [nulls] = await query(`SELECT ${columns.map(c => `count(*) FILTER (WHERE ${quote(c.name)} IS NULL)::text AS ${quote(c.name)}`).join(', ')} FROM ${quote(table.name)}`);
      table.nullCounts = nulls;
    }
    for (const fk of report.foreignKeys) {
      const present = fk.columns.map(c => `c.${quote(c)} IS NOT NULL`).join(' AND ');
      const join = fk.columns.map((c, i) => `c.${quote(c)} = p.${quote(fk.parentColumns[i])}`).join(' AND ');
      const [orphan] = await query(`SELECT count(*)::text AS count FROM ${quote(fk.table)} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${quote(fk.parent)} p WHERE ${join})`);
      const check = { name: fk.name, table: fk.table, parent: fk.parent, orphans: orphan.count };
      if (hasColumn(fk.table, 'tenantId') && hasColumn(fk.parent, 'tenantId')) {
        const [mismatch] = await query(`SELECT count(*)::text AS count FROM ${quote(fk.table)} c JOIN ${quote(fk.parent)} p ON ${join} WHERE c."tenantId" IS DISTINCT FROM p."tenantId"`);
        check.tenantMismatches = mismatch.count;
      }
      report.integrity.push(check);
    }
    // Logical links that are not declared FKs still need coverage, including retention references.
    const logical = [
      ['Tenant','ownerUserId','User'], ['PasswordResetToken','userId','User'],
      ['EmailAccount','userId','User'], ['EmailAccount','tenantId','Tenant'],
      ['MailboxOAuthState','userId','User'], ['MailboxOAuthState','tenantId','Tenant'],
      ['MailboxMessage','leadId','Lead'], ['MailboxMessage','contactId','Contact'], ['MailboxMessage','dealId','Deal'],
      ['Task','accountId','Account'], ['Campaign','createdById','User'], ['Workflow','activatedById','User'],
      ['WorkflowExecutionRun','workflowId','Workflow'], ['Deal','wonConfirmedById','User'],
    ];
    report.logicalLinks = [];
    for (const [table, column, parent] of logical) {
      if (!hasColumn(table,column) || !hasColumn(parent,'id')) continue;
      const [row] = await query(`SELECT count(*) FILTER (WHERE p.id IS NULL)::text AS orphans${hasColumn(table,'tenantId') && hasColumn(parent,'tenantId') ? ', count(*) FILTER (WHERE p.id IS NOT NULL AND c."tenantId" IS DISTINCT FROM p."tenantId")::text AS "tenantMismatches"' : ''}
        FROM ${quote(table)} c LEFT JOIN ${quote(parent)} p ON p.id=c.${quote(column)} WHERE c.${quote(column)} IS NOT NULL`);
      report.logicalLinks.push({ table, column, parent, ...row });
    }
    report.statusValues = [];
    for (const c of report.columns.filter(c => ['status','priority','notificationStatus','lifecycleStage'].includes(c.name))) {
      report.statusValues.push({table:c.table, column:c.name, values:await query(`SELECT ${quote(c.name)}::text AS value,count(*)::text AS count FROM ${quote(c.table)} GROUP BY ${quote(c.name)} ORDER BY 1`)});
    }
    report.relationshipCoverage = [];
    for (const [parent, junction, source, target] of [['Deal','LeadDeal','dealId','leadId'],['Deal','ContactDeal','dealId','contactId'],['Task','TaskLead','taskId','leadId'],['Task','TaskContact','taskId','contactId'],['Task','TaskDeal','taskId','dealId'],['Task','TaskAccount','taskId','accountId']]) {
      if (!hasColumn(parent,target) || !hasColumn(junction,target)) continue;
      const [row] = await query(`SELECT count(*)::text AS "missingJunction" FROM ${quote(parent)} p WHERE p.${quote(target)} IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM ${quote(junction)} j WHERE j.${quote(source)}=p.id AND j.${quote(target)}=p.${quote(target)} AND j."tenantId"=p."tenantId")`);
      report.relationshipCoverage.push({parent,junction,target,...row});
    }
    report.archiveConsistency = [];
    for (const {name} of report.tables.filter(t => hasColumn(t.name,'isArchived') && hasColumn(t.name,'deletedAt'))) {
      report.archiveConsistency.push({table:name,...(await query(`SELECT count(*) FILTER (WHERE NOT "isArchived" AND "deletedAt" IS NOT NULL)::text AS "activeWithDeletedAt",count(*) FILTER (WHERE "isArchived" AND "deletedAt" IS NULL)::text AS "archivedWithoutTimestamp" FROM ${quote(name)}`))[0]});
    }
    report.businessIntegrity = {};
    report.preferenceKeys = await query('SELECT key, count(*)::text AS rows FROM "TenantPreference" GROUP BY key ORDER BY key');
    const cleanupPath = resolve(import.meta.dirname,'../../data/outputs/database-audit/cleanup-result.json');
    if (existsSync(cleanupPath)) {
      const cleanup = JSON.parse(readFileSync(cleanupPath,'utf8'));
      const backup = JSON.parse(readFileSync(cleanup.backupPath,'utf8'));
      const saved = backup.rows.User.find(user=>user.email.toLowerCase()===cleanup.preservedEmail);
      const current = await tx.$queryRawUnsafe('SELECT to_jsonb(u) AS row FROM "User" u WHERE id=$1',saved.id);
      report.preservedAccount = { email:cleanup.preservedEmail, exists:current.length===1,
        exactlyMatchesPreCleanup:current.length===1 && JSON.stringify(current[0].row)===JSON.stringify(saved) };
    }
    const checks = {
      dealPipelineMismatch:'SELECT count(*)::text AS count FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId" WHERE d."pipelineId" <> s."pipelineId"',
      workflowTriggerMismatch:'SELECT count(*)::text AS count FROM "WorkflowExecutionRun" r JOIN "WorkflowTriggerRecord" t ON t.id=r."triggerId" WHERE r."workflowId" <> t."workflowId"',
      convertedLeadMissingContact:'SELECT count(*)::text AS count FROM "Lead" WHERE "convertedAt" IS NOT NULL AND "contactId" IS NULL',
      userRoleWithoutPrimaryMatch:'SELECT count(*)::text AS count FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "UserRole" r JOIN "RoleDefinition" d ON d.id=r."roleId" WHERE r."userId"=u.id AND r."tenantId"=u."tenantId" AND d.name=u.role)',
      duplicateUserEmailCase:'SELECT count(*)::text AS count FROM (SELECT "tenantId",lower(trim(email)) FROM "User" GROUP BY "tenantId",lower(trim(email)) HAVING count(*)>1) d',
      duplicateGroupMembers:'SELECT count(*)::text AS count FROM (SELECT "groupId","userId" FROM "TenantGroupMember" GROUP BY "groupId","userId" HAVING count(*)>1) d',
      duplicateImportRows:'SELECT count(*)::text AS count FROM (SELECT "importJobId","rowNumber" FROM "CrmImportRowResult" GROUP BY "importJobId","rowNumber" HAVING count(*)>1) d',
      invalidRecordFileParents:'SELECT count(*)::text AS count FROM "RecordFile" WHERE num_nonnulls("leadId","contactId","accountId","dealId") <> 1',
      workflowStateMismatch:`SELECT count(*)::text AS count FROM "Workflow" WHERE "isActive" IS DISTINCT FROM (status='ACTIVE')`,
    };
    for(const [name,sql] of Object.entries(checks)) report.businessIntegrity[name]=(await query(sql))[0].count;
    report.foreignKeyCount=report.foreignKeys.length;
    report.uniqueConstraintCount=report.indexes.filter(i=>i.definition.includes('UNIQUE')).length;
  }, { maxWait: 10000, timeout: 300000 });
  const schema = readFileSync(resolve(import.meta.dirname, '../prisma/schema.prisma'),'utf8');
  report.prismaModels = [...schema.matchAll(/^model (\w+) \{/gm)].map(m => m[1]);
  report.physicalTableCount = report.tables.length;
  report.applicationTableCount = report.tables.filter(t => t.name !== '_prisma_migrations').length;
  mkdirSync(dirname(output), {recursive:true});
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({output, physicalTables:report.physicalTableCount, applicationTables:report.applicationTableCount, prismaModels:report.prismaModels.length, migrations:report.migrations.length,
    nonzeroIntegrity:report.integrity.filter(c=>c.orphans!=='0'||(c.tenantMismatches && c.tenantMismatches!=='0')), logicalLinkIssues:report.logicalLinks.filter(c=>c.orphans!=='0'||(c.tenantMismatches && c.tenantMismatches!=='0'))},null,2));
} catch (error) {
  // Prisma connection errors can embed database coordinates. Keep diagnostics bounded.
  console.error(JSON.stringify({status:'failed',code:error.code || error.errorCode || error.name,detail:'Read-only audit failed; no database changes were attempted.'}));
  process.exitCode=1;
} finally { await db.$disconnect(); }
