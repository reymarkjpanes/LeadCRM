import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { replayCrmMigrations } from '../backend/scripts/replay-crm-migrations.mjs';
const require = createRequire(import.meta.url);
const db = await PGlite.create();
let socket;
try {
  await replayCrmMigrations(db);
  socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
  const url = `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_forms_test_2?sslmode=disable`;
  const child = spawn(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', resolve('backend/prisma/schema.prisma'), '--script'], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
  process.exitCode = await new Promise(resolve => child.once('exit', resolve));
} finally { if (socket) await socket.stop(); await db.close(); }
