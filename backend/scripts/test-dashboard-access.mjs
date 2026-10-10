import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const root = resolve(import.meta.dirname, '../..');
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
try {
  await replayCrmMigrations(db); await server.start();
  const url = `postgresql://postgres:postgres@${server.getServerConn()}/leadcrm_environment_test_${Date.now()}?connection_limit=1&statement_cache_size=0`;
  const child = spawn(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--no-file-parallelism',
    'src/core/permissions/permissions.integration.test.ts', 'src/modules/administration/roles/__tests__/roles.integration.test.ts'],
    { cwd: resolve(root, 'backend'), windowsHide: true, stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: 'disposable-access-test-only' } });
  process.exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => done(code ?? 1)); });
} finally { await server.stop(); await db.close(); }
