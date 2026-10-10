// Focused checks against a fresh, disposable database. No deployment credentials.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const root = resolve(import.meta.dirname, '../..');
const db = await PGlite.create();
let socket;
try {
  await replayCrmMigrations(db);
  socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  await socket.start();
  const databaseUrl = `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_forms_test_2?connection_limit=1&statement_cache_size=0`;
  const groups = [
    ['src/modules/marketing/forms', 'src/modules/administration/product-interests/product-interests.validation.test.ts'],
    ['src/modules/crm/leads/sales-automation.integration.test.ts', '-t', 'looks up Closed Won deals'],
  ];
  for (const group of groups) {
    const child = spawn(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--no-file-parallelism', ...group], {
      cwd: resolve(root, 'backend'), stdio: 'inherit', windowsHide: true,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, JWT_SECRET: randomBytes(32).toString('hex') },
    });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
    if (code !== 0) { process.exitCode = code ?? 1; break; }
  }
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  await socket?.stop(); await db.close();
}
