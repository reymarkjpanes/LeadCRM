// An in-memory PostgreSQL-compatible database; never uses deployment credentials.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const root = resolve(import.meta.dirname, '..');
// Match a suite's existing disposable-database guard without ever using its credentials.
const databaseName = process.env.LEADCRM_POLISH_DATABASE_NAME ?? 'leadcrm_polish_test';
if (!/^leadcrm_[a-z_]*test(?:_\d+)?$/.test(databaseName)) throw new Error('Use a disposable LeadCRM test database name.');
const requestedFiles = process.argv.slice(2);
const files = requestedFiles.length ? requestedFiles : ['src/modules/administration/users/user-groups.integration.test.ts'];
// The socket adapter retains prepared statements across client reconnects.
// Give each suite its own database and process, just as the self-contained tests do.
for (const file of files) {
  const db = await PGlite.create();
  let socket;
  try {
    await replayCrmMigrations(db);
    socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
    await socket.start();
    const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', file, '--maxWorkers=1', '--pool=threads', '--testTimeout=20000'], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env,
      DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/${databaseName}?connection_limit=1`,
      JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), NODE_ENV: 'test',
    },
    });
    const code = await new Promise((done, fail) => { child.on('exit', code => done(code ?? 1)); child.on('error', fail); });
    if (code !== 0) process.exitCode = code;
  } finally { await socket?.stop(); await db.close(); }
}
