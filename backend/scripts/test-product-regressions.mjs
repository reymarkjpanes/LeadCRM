// Isolated local PostgreSQL only. Does not load .env or connect to deployment databases.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const bin = process.env.CRM_TEST_POSTGRES_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const base = resolve(root, '../data/outputs/product-normalization-tests');
mkdirSync(base, { recursive: true });
const directory = mkdtempSync(resolve(base, 'postgres-'));
const port = '55437';
const groups = [
  ['lead-workflow', ['src/modules/automation/workflows/__tests__/workflow.integration.test.ts', 'src/modules/automation/workflows/__tests__/workflow-polish.integration.test.ts']],
  ['custom-fields', ['src/modules/crm/closing-requirements/custom-fields.integration.test.ts']],
  ['lead-regressions', ['src/modules/crm/leads/sales-automation.integration.test.ts', 'src/modules/crm/leads/product-normalization.integration.test.ts', 'src/modules/crm/imports/imports.integration.test.ts', 'src/modules/notifications/notifications.integration.test.ts']],
  ['leads', ['src/modules/crm/leads/lead-polish.integration.test.ts']],
  ['smoke', ['src/tests/single-workspace.integration.test.ts']],
  ['workflow', ['src/modules/operations/tasks/__tests__/tasks.integration.test.ts', 'src/modules/automation/workflows/__tests__/workflow.integration.test.ts', 'src/modules/automation/workflows/__tests__/workflow-polish.integration.test.ts', 'src/modules/automation/workflows/__tests__/workflow-names.integration.test.ts']],
  ['forms', ['src/modules/marketing/forms/forms.integration.test.ts']],
  ['campaign', ['src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts']],
  ['completion', ['src/modules/crm/leads/crm-completion.integration.test.ts']],
  ['mailbox', ['src/integrations/gmail/mailbox.integration.test.ts', 'src/integrations/gmail/engagement-rules.test.ts']],
  ['account', ['src/core/auth/__tests__/profile.integration.test.ts', 'src/modules/administration/users/users-import.integration.test.ts', 'src/modules/administration/organization-settings/organization-settings.integration.test.ts']],
  ['environment', ['src/core/permissions/permissions.integration.test.ts']],
];
const selected = process.argv.slice(2);
if (selected.some(group => !groups.some(([name]) => name === group))) throw new Error('Unknown test group');
const env = { ...process.env, NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  GMAIL_CLIENT_ID: 'mailbox-test-client', GMAIL_CLIENT_SECRET: 'mailbox-test-secret', GMAIL_REDIRECT_URI: 'http://localhost:4000/api/v1/integrations/gmail/callback', APP_URL: 'http://localhost:3000' };
const run = (file, args, input) => new Promise((done, reject) => {
  const child = spawn(file, args, { cwd: root, windowsHide: true, stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'], env });
  if (input) child.stdin.end(input);
  child.on('error', reject); child.on('exit', code => done(code ?? 1));
});
let started = false;
try {
  if (await run(resolve(bin, 'initdb.exe'), ['-D', directory, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--no-locale'])) throw new Error('Test initdb failed');
  if (await run(resolve(bin, 'pg_ctl.exe'), ['-D', directory, '-l', resolve(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])) throw new Error('Test server failed to start');
  started = true;
  for (const [group, suites] of groups.filter(([name]) => !selected.length || selected.includes(name))) {
    const database = ({ 'lead-regressions': 'leadcrm_forms_test_2', 'lead-workflow': 'leadcrm_workflow_test_2', 'custom-fields': 'leadcrm_custom_fields_test' })[group] ?? `leadcrm_${group}_test_1`;
    env.DATABASE_URL = env.DIRECT_URL = `postgresql://postgres@127.0.0.1:${port}/${database}?connection_limit=5`;
    const connection = ['-h', '127.0.0.1', '-p', port, '-U', 'postgres'];
    if (await run(resolve(bin, 'createdb.exe'), [...connection, database])) throw new Error('Test database creation failed');
    let sql = 'CREATE TABLE "_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz);\n';
    for (const name of readdirSync(resolve(root, 'prisma/migrations')).sort()) {
      const file = resolve(root, 'prisma/migrations', name, 'migration.sql');
      if (existsSync(file)) sql += readFileSync(file, 'utf8') + `\nINSERT INTO "_prisma_migrations" VALUES ('${name}',now(),NULL);\n`;
    }
    if (await run(resolve(bin, 'psql.exe'), [...connection, '-d', database, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], sql)) throw new Error('Test migration replay failed');
    console.log(`Testing ${group} with fresh migrated PostgreSQL.`);
    if (await run(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', ...suites, '--pool=forks', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${resolve(base, `${group}-results.json`)}`])) process.exitCode = 1;
  }
} finally {
  if (started) await run(resolve(bin, 'pg_ctl.exe'), ['-D', directory, '-m', 'fast', '-w', 'stop']);
}
