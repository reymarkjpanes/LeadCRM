// Full migration replay and real HTTP/Prisma acceptance tests in disposable PostgreSQL.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const db = await PGlite.create();
await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
await socket.start();
const root = resolve(import.meta.dirname, '..');
try {
  const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run',
    'src/modules/crm/leads/sales-automation.integration.test.ts',
    'src/modules/crm/leads/product-normalization.integration.test.ts',
    'src/modules/crm/imports/imports.integration.test.ts',
    'src/modules/notifications/notifications.integration.test.ts', '--maxWorkers=1'], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env,
      DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_forms_test_2?connection_limit=1&statement_cache_size=0`,
      JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), NODE_ENV: 'test',
    },
  });
  process.exitCode = await new Promise((done, fail) => { child.on('exit', code => done(code ?? 1)); child.on('error', fail); });
} finally { await socket.stop(); await db.close(); }
