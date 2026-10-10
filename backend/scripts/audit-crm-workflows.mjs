// Read-only CRM column evidence. No customer values, credentials, or saved message bodies are emitted.
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'docs/database/crm-workflow-audit');
mkdirSync(output, { recursive: true });
const schema = readFileSync(resolve(root, 'backend/prisma/schema.prisma'), 'utf8');
const types = new Set(['String', 'Int', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', ...[...schema.matchAll(/^enum (\w+)/gm)].map(m => m[1])]);
const modules = { Lead: ['leads', 'contacts'], Contact: ['contacts', 'contacts-v2'], Account: ['accounts', 'companies'], Deal: ['deals', 'pipeline'] };
const files = execFileSync('rg', ['--files', 'backend/src', 'frontend/src', 'shared/src', 'backend/scripts', 'backend/prisma'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(p => /\.(ts|tsx|sql|mjs|cjs)$/.test(p) && !p.endsWith('audit-crm-workflows.mjs')).map(path => ({ path: path.replaceAll('\\', '/'), text: readFileSync(resolve(root, path), 'utf8') }));
const categories = {
  'Create form': p => /frontend.*\/ui\/.*-form\.tsx$/.test(p),
  'Edit form': p => /frontend.*\/ui\/.*-form\.tsx$/.test(p),
  'Details UI': p => /frontend.*(detail|drawer)/.test(p),
  'Table UI': p => /frontend.*(table|columns|page)/.test(p),
  'Filter/search': p => /(filter|search|repository)/.test(p),
  'Create DTO': p => /(dto|contract|schema)\.ts$/.test(p),
  'Update DTO': p => /(dto|contract|schema)\.ts$/.test(p),
  'Repository read': p => /backend.*repository\.ts$/.test(p),
  'Repository write': p => /backend.*(repository|service)\.ts$/.test(p),
  'Workflow condition': p => /(workflow-catalog|workflow-conditions|workflows.repository)/.test(p),
  'Workflow update action': p => /(action-fields|action-dispatcher|workflow-catalog)/.test(p),
  Import: p => /import/.test(p), Conversion: p => /conversion|convert|won-/.test(p),
  Campaign: p => /campaign|audience/.test(p), 'Inbox/email': p => /mailbox|email|engagement/.test(p),
  Reporting: p => /report|dashboard|forecast/.test(p), 'Activity/audit': p => /activity|activities|audit/.test(p),
  'Tests/seeds/scripts': p => /test|seed|scripts/.test(p),
};
const suspicious = new Set(['productInterest', 'productInterestIds', 'productInterests', 'productsNormalized', 'activeProducts', 'productInterestOther', 'internalNotes', 'tags', 'website', 'description', 'jobTitle', 'notes', 'linkedinUrl', 'score', 'ownerId', 'lastContactedAt', 'customerSince', 'customerType', 'lifecycleStage', 'recordType', 'qualifiedAt', 'disqualifiedReason', 'billingFrequency']);
// Preserve the original audit inventory after removing fields from Prisma.
const retired = {
  Contact: '  lastContactedAt DateTime?\n  qualifiedAt DateTime?\n  disqualifiedReason String?',
  Deal: '  billingFrequency String?',
};
function classify(name) {
  if (['productInterest', 'productInterestIds', 'productInterests', 'productsNormalized', 'activeProducts'].includes(name)) return ['KEEP — TRANSITIONAL, STILL REQUIRED', 'Product relation compatibility and unresolved historical selections require reconciliation before retirement.'];
  if (/closing|won|converted|contactId|closedAt|lostReason|archive|deleted|createdBy|updatedBy|stageChangedAt/i.test(name) || name === 'value') return ['KEEP — HISTORY/AUDIT', 'Preserve conversion, archive, attribution, stage/closing history, and immutable Deal price snapshots.'];
  if (/Reply|Inbound|Outbound|engagement|lastStatus/.test(name)) return ['KEEP — DERIVED/AUTOMATION', 'Reply recency and automation bookkeeping remain business-critical.'];
  if (name === 'doNotContact') return ['KEEP — INTEGRATION', 'Customer contact suppression is required by messaging.'];
  if (name.endsWith('Id')) return ['KEEP — RELATIONSHIP', 'Tenant-scoped canonical relationship or historical ownership.'];
  if (['id', 'createdAt', 'updatedAt', 'creationKey', 'automationKey', 'order'].includes(name)) return ['KEEP — SYSTEM FIELD', 'Identity, ordering, timestamps or idempotency.'];
  return ['KEEP — USER FIELD', 'Supported CRM/API or retained legacy data; absence from Create is not evidence of obsolescence.'];
}
const matrix = [];
for (const [module, paths] of Object.entries(modules)) {
  const body = schema.match(new RegExp(`model ${module} \\{([\\s\\S]*?)^}`, 'm'))[1] + '\n' + (retired[module] ?? '');
  for (const line of body.split('\n')) {
    const match = line.match(/^\s+(\w+)\s+(\w+)(\[\]|\?)?/);
    if (!match || !types.has(match[2])) continue;
    const [, field, type, suffix = ''] = match;
    const token = new RegExp(`\\b${field}\\b`);
    const hits = files.filter(f => token.test(f.text));
    const evidence = Object.fromEntries(Object.entries(categories).map(([category, accepts]) => [category, hits.filter(f => accepts(f.path) && (!/form|DTO|UI|Repository/.test(category) || paths.some(p => f.path.includes(`/${p}/`)) || /shared\//.test(f.path))).map(f => `${f.path}:${f.text.slice(0, f.text.search(token)).split('\n').length}`)]));
    const drop = new RegExp(`\\b${field}\\b`).test(retired[module] ?? '');
    const [classification, reason] = drop
      ? ['DROP — PROVEN UNUSED', 'No current UI or business consumer; removed vestigial contracts. Captured live values are all NULL. Migration 20261110000000 rechecks every row under lock and aborts on data or active Workflow references. See README for semantic audit and deployment gates.']
      : classify(field);
    matrix.push({ module, column: line.match(/@map\("([^"]+)"\)/)?.[1] ?? field, field, type: type + suffix, classification, candidate: suspicious.has(field), action: drop ? 'GUARDED DROP' : 'KEEP', reason, historicalRequirement: /HISTORY|TRANSITIONAL/.test(classification), productionUsage: 'I cannot confirm this.', evidence });
  }
}
const migrationFiles = readdirSync(resolve(root, 'backend/prisma/migrations'), { withFileTypes: true }).filter(f => f.isDirectory()).map(f => {
  const path = `backend/prisma/migrations/${f.name}/migration.sql`;
  const sql = readFileSync(resolve(root, path), 'utf8');
  return { name: f.name, sha256: createHash('sha256').update(sql).digest('hex'), lfSha256: createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex'), crlfSha256: createHash('sha256').update(sql.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')).digest('hex'), crmStatements: sql.split(';').filter(s => /"(Lead|Contact|Account|Deal|Workflow|WorkflowExecutionRun|WorkflowExecutionStep|WorkflowTriggerRecord)"/.test(s)).map(s => s.trim()) };
});
const report = { capturedAt: new Date().toISOString(), readOnly: true, schemaSha256: createHash('sha256').update(schema).digest('hex'), matrix, migrations: migrationFiles };
if (process.argv.includes('--live')) {
  const env = dotenv.parse(readFileSync(resolve(root, 'backend/.env')));
  const url = env.DIRECT_URL || env.DATABASE_URL;
  report.target = { provider: new URL(url).hostname.includes('supabase') ? 'Supabase' : 'PostgreSQL', source: 'Configured backend environment; production resource identity requires separate deployment verification.' };
  const db = new PrismaClient({ datasources: { db: { url } } });
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
      const query = sql => tx.$queryRawUnsafe(sql);
      report.columns = await query(`SELECT table_name AS "table", column_name AS name, data_type AS type, udt_name AS "nativeType", is_nullable AS nullable, column_default AS "default" FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name, ordinal_position`);
      report.constraints = await query(`SELECT t.relname AS "table", c.conname AS name, c.contype::text AS type, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() ORDER BY 1,2`);
      report.indexes = await query(`SELECT tablename AS "table",indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname=current_schema() ORDER BY 1,2`);
      report.enums = await query(`SELECT t.typname AS name,e.enumlabel AS value FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=current_schema() ORDER BY t.typname,e.enumsortorder`);
      report.dependencies = await query(`SELECT c.relname AS "table",a.attname AS "column",pg_describe_object(d.classid,d.objid,d.objsubid) AS dependency FROM pg_depend d JOIN pg_class c ON c.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.refobjsubid WHERE c.relname IN ('Lead','Contact','Account','Deal') ORDER BY 1,2,3`);
      report.ledger = await query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name');
      report.ledgerComparison = { pending: migrationFiles.filter(f => !report.ledger.some(m => m.migration_name === f.name && m.finished_at && !m.rolled_back_at)).map(f => f.name), checksumMismatch: migrationFiles.filter(f => report.ledger.some(m => m.migration_name === f.name && m.checksum !== f.sha256)).map(f => f.name) };
      for (const row of matrix) {
        if (!report.columns.some(c => c.table === row.module && c.name === row.column)) { row.productionUsage = { missing: true }; continue; }
        const c = quote(row.column), isArray = row.type.endsWith('[]');
        const empty = isArray ? `cardinality(${c})=0` : row.type.startsWith('String') ? `${c}=''` : 'false';
        const nonempty = `${c} IS NOT NULL AND NOT (${empty})`;
        row.productionUsage = (await query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE ${c} IS NULL)::int AS "null",count(*) FILTER (WHERE ${c} IS NOT NULL)::int AS "nonNull",count(*) FILTER (WHERE ${empty})::int AS "${isArray ? 'emptyArray' : 'emptyString'}",count(*) FILTER (WHERE ${nonempty})::int AS "nonEmpty",count(*) FILTER (WHERE "isArchived" AND ${nonempty})::int AS "archivedNonEmpty" FROM ${quote(row.module)}`))[0];
      }
      report.rowCounts = {};
      for (const table of ['Lead','Contact','Account','Deal','LeadProductInterest','ContactProductInterest','AccountProductInterest','LeadDeal','ContactDeal','CustomFieldValue','Workflow','WorkflowExecutionRun','WorkflowExecutionStep','WorkflowTriggerRecord']) report.rowCounts[table] = (await query(`SELECT count(*)::int AS n FROM ${quote(table)}`))[0].n;
      report.products = [];
      for (const module of ['Lead','Contact','Account']) {
        const field = module === 'Lead' ? 'productInterest' : 'productInterests', link = `${module}ProductInterest`, fk = `${module.toLowerCase()}Id`;
        report.products.push({ module, ...(await query(`SELECT count(*) FILTER (WHERE NOT "productsNormalized")::int AS unresolved,count(*) FILTER (WHERE "productsNormalized" AND cardinality(${quote(field)})>0)::int AS "normalizedWithLegacyValues",count(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest(r.${quote(field)}) v WHERE NOT EXISTS (SELECT 1 FROM ${quote(link)} l JOIN "ProductInterest" p ON p.id=l."productInterestId" AND p."tenantId"=l."tenantId" WHERE l.${quote(fk)}=r.id AND l."tenantId"=r."tenantId" AND lower(trim(p.name))=lower(trim(v)) ${module === 'Lead' ? '' : 'AND l.interested'})))::int AS "legacyNamesWithoutMatchingLink" FROM ${quote(module)} r`))[0] });
      }
      report.products.push({ module: 'Deal', ...(await query(`SELECT count(*) FILTER (WHERE "productInterestId" IS NULL)::int AS "withoutProduct",count(*) FILTER (WHERE NOT "productsNormalized")::int AS unresolved FROM "Deal"`))[0] });
      // Only aggregate field keys/action types leave the transaction; no names, IDs or customer values.
      const workflows = await tx.workflow.findMany({ select: { trigger: true, conditions: true, actions: true, status: true, isActive: true, isArchived: true } });
      const counts = values => Object.fromEntries([...new Set(values)].sort().map(v => [v, values.filter(x => x === v).length]));
      report.workflows = { count: workflows.length, triggers: counts(workflows.map(w => w.trigger)), statuses: counts(workflows.map(w => w.status)), stateMismatches: workflows.filter(w => w.isActive !== (w.status === 'ACTIVE')).length,
        conditions: counts(workflows.flatMap(w => w.conditions?.conditions ?? []).map(c => c.field)), actions: counts(workflows.flatMap(w => Array.isArray(w.actions) ? w.actions : []).map(a => a.type)), updateFields: counts(workflows.flatMap(w => Array.isArray(w.actions) ? w.actions : []).filter(a => a.type === 'update_field').map(a => String(a.config?.field ?? ''))) };
    }, { timeout: 120000, maxWait: 15000 });
  } catch (error) { report.liveError = { class: error.constructor.name, code: error.code ?? null, message: 'Read-only database audit could not complete. I cannot confirm this.' }; process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
if (process.argv.includes('--refresh-source') && existsSync(resolve(output, 'evidence.json'))) {
  const previous = JSON.parse(readFileSync(resolve(output, 'evidence.json'), 'utf8'));
  for (const row of matrix) row.productionUsage = previous.matrix.find(old => old.module === row.module && old.field === row.field)?.productionUsage ?? 'I cannot confirm this.';
  Object.assign(report, { ...previous, sourceRefreshedAt: report.capturedAt, schemaSha256: report.schemaSha256, matrix, migrations: migrationFiles });
}
if (report.ledger) {
  const matches = (migration, entry) => [migration.sha256, migration.lfSha256, migration.crlfSha256].includes(entry.checksum);
  report.ledgerComparison = {
    pending: migrationFiles.filter(f => !report.ledger.some(m => m.migration_name === f.name && m.finished_at && !m.rolled_back_at)).map(f => f.name),
    checksumMismatch: migrationFiles.filter(f => report.ledger.some(m => m.migration_name === f.name && !m.rolled_back_at && !matches(f, m))).map(f => f.name),
    lineEndingOnly: migrationFiles.filter(f => report.ledger.some(m => m.migration_name === f.name && m.checksum !== f.sha256 && matches(f, m))).map(f => f.name),
  };
}
writeFileSync(resolve(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
const columns = ['Module','Column','Prisma field','Classification',...Object.keys(categories),'Historical requirement','Current production data usage','Candidate for removal?','Action','Reason'];
const cell = v => String(v).replaceAll('|','/').replaceAll('\n',' ');
const md = ['# CRM scalar column usage matrix', '', `Captured ${report.capturedAt}. ${matrix.length} original scalar fields; ${matrix.filter(r => r.action === 'GUARDED DROP').length} guarded drops approved. Live evidence predates migration deployment.`, '', 'Evidence cells are source-token locations to review, not proof of execution or absence. Create/edit and read/write share evidence where the same contract serves both. JSON contains every matching location. No column is classified unused from a search alone. See README for the semantic retirement review.', '', '| '+columns.join(' | ')+' |', '| '+columns.map(()=> '---').join(' | ')+' |', ...matrix.map(r => '| '+[r.module,r.column,r.field,r.classification,...Object.keys(categories).map(k => r.evidence[k].slice(0,2).join('; ') || 'No explicit token hit; dynamic access not excluded'),r.historicalRequirement,JSON.stringify(r.productionUsage),r.candidate ? `Audited target; ${r.action}` : 'No',r.action,r.reason].map(cell).join(' | ')+' |')].join('\n');
writeFileSync(resolve(output, 'column-matrix.md'), md+'\n');
console.log(JSON.stringify({ output: relative(root, output), columns: matrix.length, migrations: migrationFiles.length, live: !report.liveError && !!report.columns, liveError: report.liveError, rowCounts: report.rowCounts, ledger: report.ledgerComparison, products: report.products, workflows: report.workflows }, null, 2));
