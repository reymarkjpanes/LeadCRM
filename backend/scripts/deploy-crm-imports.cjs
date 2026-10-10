// Two-phase Prisma rollout. All schema/data mutations are versioned migrations.
// --deploy is the normal hosting entry point; retirement is a separate release step.
// --expand copies history and retains frozen old tables. --verify is read-only.
// --retire verifies deployed APIs before enabling the guarded retirement migration.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, copyFileSync, mkdirSync, readdirSync, cpSync, rmSync, realpathSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join, sep } = require('node:path');
const { createHash } = require('node:crypto');
const { verifyImportRollout } = require('./verify-crm-import-rollout.cjs');
const { verifyBrowserImportRollout } = require('./verify-crm-import-browser.cjs');
const root = resolve(__dirname, '../prisma');
const expansion = '20261027000000_crm_import_integrity';
const retirement = '20261028000000_retire_legacy_crm_imports';
const relationshipExpansion = '20261101000000_expand_canonical_relationships';
const leadRetirement = '20261112000000_retire_lead_nonform_columns';
const crmRetirement = '20261110000000_retire_unused_crm_columns';
const relationshipRetirement = '20261102000000_retire_relationship_compatibility';
const legacyTables = ['Lead', 'Contact', 'Account', 'Deal'].flatMap(module => [`${module}Import`, `${module}ImportResult`]);

const fail = code => { throw Object.assign(new Error(code), { code }); };
const finished = row => row.finished_at && !row.rolled_back_at;
function checksumMatches(source, expected) {
  // Git checks out CRLF on Windows and LF on Render. Accept only that transport
  // difference; any SQL/content change must still stop recovery.
  const lf = source.replace(/\r\n/g, '\n');
  return [source, lf, lf.replace(/\n/g, '\r\n')].some(text => createHash('sha256').update(text).digest('hex') === expected);
}
async function migrationRecords(db) {
  const [{ present }] = await db.$queryRawUnsafe(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`);
  return present ? db.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at, checksum FROM "_prisma_migrations"') : [];
}

function verifyAppliedHistory(records, localNames) {
  for (const row of records.filter(finished)) {
    if (!localNames.includes(row.migration_name)) fail('APPLIED_MIGRATION_MISSING_FROM_RELEASE');
    const source = readFileSync(join(root, 'migrations', row.migration_name, 'migration.sql'), 'utf8');
    if (!checksumMatches(source, row.checksum)) fail('APPLIED_MIGRATION_CHECKSUM_MISMATCH');
  }
}

function deploymentTarget(records, localNames) {
  if (records.some(row => !row.finished_at && !row.rolled_back_at)) fail('FAILED_MIGRATION_REQUIRES_RECOVERY');
  if (records.some(row => row.migration_name === retirement && finished(row))) {
    return records.some(row => row.migration_name === relationshipRetirement && finished(row)) ? '\uffff' : relationshipExpansion;
  }
  // Never silently skip a future release's migrations while this rollout is pending.
  if (localNames.some(name => /^\d+_/.test(name) && name > retirement)) fail('RETIRE_IMPORT_TABLES_BEFORE_LATER_MIGRATIONS');
  return expansion;
}

// These reviewed migrations do not depend on dropping compatibility columns.
// Keep the separate authenticated retirement gate while deploying current auth.
function deploymentPlan(records, localNames) {
  const target = deploymentTarget(records, localNames);
  // CRM column retirement retains its separate verification gate. Other reviewed
  // transitions below can require a coordinated application release.
  const deferred = [crmRetirement, leadRetirement].filter(name => localNames.includes(name)
    && !records.some(row => row.migration_name === name && finished(row)));
  if (target !== relationshipExpansion) return { through: target, exclude: deferred };
  const independent = [
    '20261103000000_reply_engagement_deal_batches',
    '20261104000000_user_first_login_onboarding',
    '20261105000000_module_custom_fields',
    '20261106000000_campaign_sms_snapshots',
    '20261106000000_scoped_mailbox_delivery',
    '20261107000000_textbee_webhook_receipts',
    '20261108000000_campaign_delivered_status',
    '20261109000000_campaign_final_statuses',
    '20261110000000_preserve_retired_lead_fields',
    crmRetirement,
    '20261111000000_crm_ownership_safety',
    leadRetirement,
    '20261113000000_mailbox_message_headers',
    '20261114000000_mailbox_thread_metadata',
    '20261114000000_notification_delivery',
    '20261115000000_dashboard_revisions',
    '20261115000000_workflow_assignment_history',
    // The preserving Groups conversion is a reviewed release transition. Stop
    // old application binaries before applying it, as documented in the rollout.
    '20261116000000_user_groups',
    '20261117000000_campaign_submission_recovery',
    '20261118000000_group_revisions',
    '20261119000000_notification_utc_timestamps',
    // Preserves existing recovery links by hashing stored secrets. Coordinate
    // with the auth release; old binaries must stop before token storage changes.
    '20261120000000_password_recovery_security',
    // Nullable provider metadata only; no compatibility columns or mail changed.
    '20261121000000_mailbox_reply_header',
  ];
  const later = localNames.filter(name => /^\d+_/.test(name) && name > relationshipExpansion && name !== relationshipRetirement);
  if (later.some(name => !independent.includes(name))) fail('REVIEW_MIGRATIONS_AFTER_DEFERRED_RELATIONSHIP_RETIREMENT');
  return { through: later.sort().at(-1) || target, exclude: [relationshipRetirement, ...deferred] };
}

async function recoverRetirement(db) {
  const records = await migrationRecords(db);
  const failed = records.filter(row => !row.finished_at && !row.rolled_back_at);
  if (!failed.length) { console.log('No failed import retirement to recover.'); return; }
  if (failed.length !== 1 || failed[0].migration_name !== retirement || records.some(row => row.migration_name === retirement && finished(row))) fail('UNEXPECTED_FAILED_MIGRATION');
  for (const name of [expansion, retirement]) {
    const record = name === retirement ? failed[0] : records.find(row => row.migration_name === name && finished(row));
    const source = readFileSync(join(root, 'migrations', name, 'migration.sql'), 'utf8');
    if (!record || !checksumMatches(source, record.checksum)) fail('IMPORT_MIGRATION_CHECKSUM_MISMATCH');
  }
  const tables = await db.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  if (!legacyTables.every(name => tables.some(table => table.table_name === name))) fail('LEGACY_IMPORT_TABLE_MISSING');
  // The transaction must have rolled back completely. The copy verifier must still
  // exist and prove exact source/job/result preservation before repairing history.
  const counts = await db.$queryRawUnsafe('SELECT * FROM crm_verify_import_normalization()');
  const [{ guards }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS guards FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname='crm_legacy_import_readonly' AND t.tgenabled='O'`);
  if (guards !== 8) fail('LEGACY_IMPORT_GUARDS_MISSING');
  // This changes only Prisma's failed-attempt bookkeeping. Never mark unapplied
  // SQL as applied and never bypass the separate API-verification retirement gate.
  runPrisma(['migrate', 'resolve', '--rolled-back', retirement, '--schema', join(root, 'schema.prisma')]);
  console.log(JSON.stringify({ recovered: retirement, historical: counts.map(row => ({ module: row.module, jobs: Number(row.jobs), results: Number(row.results) })) }));
}

function runPrisma(args) {
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], { cwd: resolve(__dirname, '..'), env: process.env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) fail('PRISMA_ROLLOUT_FAILED');
}

function migrate(through, exclude = []) {
  // Prisma has no deploy-to-version option. A temporary copy of the exact checked-in
  // history lets phase 1 stop before retirement without altering migration checksums.
  const parent = realpathSync(tmpdir()), stage = mkdtempSync(join(parent, 'leadcrm-import-migrations-'));
  try {
    copyFileSync(join(root, 'schema.prisma'), join(stage, 'schema.prisma'));
    mkdirSync(join(stage, 'migrations'));
    copyFileSync(join(root, 'migrations/migration_lock.toml'), join(stage, 'migrations/migration_lock.toml'));
    for (const name of readdirSync(join(root, 'migrations'))) {
      if (/^\d+_/.test(name) && name <= through && !exclude.includes(name)) cpSync(join(root, 'migrations', name), join(stage, 'migrations', name), { recursive: true });
    }
    runPrisma(['migrate', 'deploy', '--schema', join(stage, 'schema.prisma')]);
  } finally {
    const target = realpathSync(stage);
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith('leadcrm-import-migrations-')) throw new Error('Unsafe temporary cleanup path');
    rmSync(target, { recursive: true });
  }
}

async function main() {
  const mode = process.argv[2];
  if (!['--deploy', '--plan', '--expand', '--recover', '--verify', '--retire'].includes(mode)) fail('INVALID_ROLLOUT_MODE');
  if (mode === '--expand') { migrate(expansion); return; }
  const db = new PrismaClient({ log: [], datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
  try {
    if (mode === '--recover') { await recoverRetirement(db); return; }
    if (mode === '--deploy' || mode === '--plan') {
      const records = await migrationRecords(db), names = readdirSync(join(root, 'migrations'));
      verifyAppliedHistory(records, names);
      const plan = deploymentPlan(records, names);
      if (mode === '--plan') {
        const pending = names.filter(name => /^\d+_/.test(name) && name <= plan.through && !plan.exclude.includes(name)
          && !records.some(row => row.migration_name === name && finished(row))).sort();
        console.log(JSON.stringify({ ...plan, pending, applied: records.filter(finished).length, checksums: 'verified' }));
        return;
      }
      await db.$disconnect();
      migrate(plan.through, plan.exclude);
      if (plan.through === expansion) console.log('CRM import expansion ready. Legacy-table retirement is deferred until deployed API verification.');
      if (plan.exclude.length) console.log('Independent application migrations applied. Guarded column retirements remain deferred until authenticated API verification.');
      return;
    }
    const report = process.env.CRM_IMPORT_VERIFY_BROWSER_EVIDENCE
      ? await verifyBrowserImportRollout(db, process.env.CRM_IMPORT_VERIFY_API, JSON.parse(readFileSync(process.env.CRM_IMPORT_VERIFY_BROWSER_EVIDENCE, 'utf8')))
      : await verifyImportRollout(db, process.env.CRM_IMPORT_VERIFY_API, JSON.parse(process.env.CRM_IMPORT_VERIFY_TOKENS || '[]'));
    console.log(JSON.stringify(report, null, 2));
    if (mode === '--retire') {
      await db.$executeRawUnsafe(`COMMENT ON TABLE "CrmImportJob" IS 'crm-import-normalization-api-verified-v1'`);
      try { migrate(retirement); }
      finally {
        // The marker is single-use. Failed retirement always requires verification again.
        await db.$executeRawUnsafe('COMMENT ON TABLE "CrmImportJob" IS NULL');
      }
    }
  } finally { await db.$disconnect(); }
}
module.exports = { deploymentTarget, deploymentPlan, migrate, recoverRetirement, checksumMatches, verifyAppliedHistory };
if (require.main === module) main().catch(error => {
  // Assertion/Prisma payloads can contain historical PII. Report codes only.
  console.error('[crm-import-rollout]', error.code || error.errorCode || error.name, 'Rollout stopped; legacy data has not been discarded by the verifier.');
  process.exitCode = 1;
});
