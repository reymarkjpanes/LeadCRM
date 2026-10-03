// Runs against a disposable PostgreSQL-compatible database. Never reads deployment credentials.
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
const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', 'src/integrations/gmail/engagement-rules.test.ts', 'src/integrations/gmail/mailbox.integration.test.ts'], {
  cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env,
    DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_mailbox_test_1?connection_limit=1`,
    JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    GMAIL_CLIENT_ID: 'mailbox-test-client', GMAIL_CLIENT_SECRET: 'mailbox-test-secret', GMAIL_REDIRECT_URI: 'http://localhost:4000/api/v1/integrations/gmail/callback', APP_URL: 'http://localhost:3000',
  },
});
const code = await new Promise(resolve => child.on('exit', resolve));
await socket.stop(); await db.close(); process.exitCode = code ?? 1;
