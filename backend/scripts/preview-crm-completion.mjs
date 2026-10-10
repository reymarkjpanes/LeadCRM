// Disposable local UI fixture; never connects to the application's database.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const db = await PGlite.create();
await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 10 });
await socket.start();
const root = resolve(import.meta.dirname, '..');
const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'scripts/preview-crm-completion.ts'], {
  cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_ENV: 'test',
    DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_completion_preview?connection_limit=1`,
    JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  },
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
try { process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 0))); }
finally { await socket.stop(); await db.close(); }
