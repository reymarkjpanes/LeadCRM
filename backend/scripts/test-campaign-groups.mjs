// All writes are confined to fresh, in-memory PostgreSQL-compatible databases.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const root = resolve(import.meta.dirname, '..');
for (const suite of process.argv.length > 2 ? process.argv.slice(2) : ['src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts', 'src/modules/administration/groups/groups.integration.test.ts']) {
  const db = await PGlite.create();
  await replayCrmMigrations(db);
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  await socket.start();
  try {
    const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', suite, '--maxWorkers=1', '--pool=threads', '--testTimeout=20000', '--hookTimeout=30000'], {
      cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env,
        DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_campaign_test_1?connection_limit=1`,
        JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      },
    });
    const code = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
    if (code) process.exitCode = code;
  } finally { await socket.stop(); await db.close(); }
}
