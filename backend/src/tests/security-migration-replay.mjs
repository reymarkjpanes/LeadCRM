// Replays the unchanged migration history and new forward migrations in disposable PostgreSQL.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
await server.start();
const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?connection_limit=1`;
const child = spawn(process.execPath, [resolve(root, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(root, 'prisma/schema.prisma')], {
  cwd: root, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'inherit', windowsHide: true,
});
const code = await new Promise(resolve => child.on('exit', resolve));
await server.stop(); await db.close(); process.exit(code ?? 1);
