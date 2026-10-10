import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const root = resolve(import.meta.dirname, '..');
const requested = process.argv.slice(2);
const files = requested.length ? requested : ['src/modules/automation/workflows/__tests__/workflow-polish.integration.test.ts', 'src/modules/automation/workflows/__tests__/workflow-names.integration.test.ts', 'src/modules/automation/workflows/__tests__/workflow.integration.test.ts'];
// Each Prisma worker needs its own server-side prepared statement namespace.
for (const file of files) {
  const db = await PGlite.create();
  await replayCrmMigrations(db);
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  await socket.start();
  try {
  const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', file, '--maxWorkers=1'], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env,
      DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_workflow_test_1?connection_limit=1`,
      JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      BREVO_API_KEY: '', BREVO_SMS_SENDER: '', NODE_ENV: 'test',
    },
  });
  const code = await new Promise((resolve, reject) => { child.on('exit', code => resolve(code ?? 1)); child.on('error', reject); });
  if (code) process.exitCode = code;
  } finally { await socket.stop(); await db.close(); }
}
