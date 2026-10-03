// Replay all committed migrations and exercise real authenticated HTTP on disposable PostgreSQL.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const groups = [
  ['smoke', ['src/tests/single-workspace.integration.test.ts']],
  ['workflow', ['src/modules/operations/tasks/__tests__/tasks.integration.test.ts', 'src/modules/automation/workflows/__tests__/workflow.integration.test.ts']],
  ['forms', ['src/modules/marketing/forms/forms.integration.test.ts']],
  ['campaign', ['src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts']],
  ['sales', ['src/modules/crm/leads/sales-automation.integration.test.ts']],
  ['account', ['src/core/auth/__tests__/profile.integration.test.ts', 'src/modules/administration/users/users-import.integration.test.ts', 'src/modules/administration/organization-settings/organization-settings.integration.test.ts']],
];
// Concurrent workflow transactions require a normal PostgreSQL server. The
// portable default exercises the smoke suite with PGlite's single connection.
const selected = process.argv[2] || (process.env.CRM_TEST_POSTGRES_PORT ? undefined : 'smoke');
if (selected && !groups.some(([name]) => name === selected)) throw new Error(`Unknown test group: ${selected}`);
if (selected === 'workflow' && !process.env.CRM_TEST_POSTGRES_PORT) throw new Error('Set CRM_TEST_POSTGRES_PORT to an isolated local PostgreSQL cluster for workflow concurrency tests.');
for (const [group, suites] of groups.filter(([name]) => !selected || name === selected)) {
  if (process.env.CRM_TEST_POSTGRES_PORT) {
    const port = process.env.CRM_TEST_POSTGRES_PORT;
    if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid local test port');
    const database = `leadcrm_${group}_test_${Date.now()}`;
    const bin = process.env.CRM_TEST_POSTGRES_BIN || 'C:/Program Files/PostgreSQL/17/bin';
    const run = (file, args, input) => new Promise((done, reject) => {
      const child = spawn(file, args, { cwd: root, windowsHide: true, stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'], env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${database}?connection_limit=5`, DIRECT_URL: `postgresql://postgres@127.0.0.1:${port}/${database}`, JWT_SECRET: 'single-workspace-disposable-test-secret' } });
      if (input) child.stdin.end(input);
      child.on('error', reject); child.on('exit', code => done(code));
    });
    if (await run(resolve(bin, 'createdb.exe'), ['-h','127.0.0.1','-p',port,'-U','postgres',database])) throw new Error('Unable to create disposable database');
    let sql = 'CREATE TABLE "_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz);\n';
    for (const name of readdirSync(resolve(root, 'prisma/migrations')).sort()) {
      const file = resolve(root, 'prisma/migrations', name, 'migration.sql');
      if (existsSync(file)) sql += readFileSync(file, 'utf8') + `\nINSERT INTO "_prisma_migrations" VALUES ('${name}',now(),NULL);\n`;
    }
    if (await run(resolve(bin, 'psql.exe'), ['-h','127.0.0.1','-p',port,'-U','postgres','-d',database,'-X','-q','-v','ON_ERROR_STOP=1'], sql)) throw new Error('Migration replay failed');
    console.log(`Testing ${group} on isolated PostgreSQL database ${database}.`);
    if (await run(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', ...suites, '--pool=threads','--maxWorkers=1'])) process.exitCode = 1;
    continue;
  }
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 10 });
  try {
    await db.exec('CREATE TABLE "_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)');
    for (const name of readdirSync(resolve(root, 'prisma/migrations')).sort()) {
      const file = resolve(root, 'prisma/migrations', name, 'migration.sql');
      if (!existsSync(file)) continue;
      await db.exec(readFileSync(file, 'utf8'));
      await db.query('INSERT INTO "_prisma_migrations" VALUES ($1, now(), NULL)', [name]);
    }
    await server.start();
    const url = `postgresql://postgres:postgres@${server.getServerConn()}/leadcrm_${group}_test_${Date.now()}?connection_limit=1&statement_cache_size=0`;
    console.log(`Testing ${group} with migrated disposable PostgreSQL; no application database is used.`);
    const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', ...suites, '--pool=threads', '--maxWorkers=1'], {
      cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: 'single-workspace-disposable-test-secret' },
    });
    const code = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
    if (code) process.exitCode = 1;
  } finally { await server.stop(); await db.close(); }
}
