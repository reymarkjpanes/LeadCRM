// Database-backed acceptance; all migrations and writes target an in-memory database.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const db = await PGlite.create();
let socket;
try {
  await replayCrmMigrations(db);
  socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 10 }); await socket.start();
  const database = `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_quotation_test_${Date.now()}?connection_limit=1&statement_cache_size=0`;
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../node_modules/vitest/vitest.mjs'), 'run', '--no-file-parallelism',
    'src/modules/marketing/campaigns/__tests__/quotations.test.ts', 'src/modules/marketing/campaigns/__tests__/quotations.integration.test.ts',
    'src/modules/marketing/templates/default-templates.test.ts', 'src/modules/marketing/templates/templates-search.test.ts'], {
    cwd: resolve(import.meta.dirname, '..'), windowsHide: true, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: database, DIRECT_URL: database,
      JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), BREVO_API_KEY: '', TEXTBEE_API_KEY: '' },
  });
  process.exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => done(code ?? 1)); });
} finally { await socket?.stop(); await db.close(); }
