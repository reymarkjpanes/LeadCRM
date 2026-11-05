// Database writes use fresh disposable PGlite databases, or native PostgreSQL with --native.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
import { notificationTestPostgres } from './notification-test-postgres.mjs';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '..');
const native = process.argv.includes('--native');
const requested = process.argv.slice(2).filter(arg => arg !== '--native');
const { qaEnvironment } = createRequire(import.meta.url)('../../scripts/qa-environment.cjs');
for (const suite of requested.length ? requested : ['src/modules/marketing/campaigns/__tests__/campaigns.integration.test.ts', 'src/modules/administration/groups/groups.integration.test.ts']) {
  const pg = native ? await notificationTestPostgres() : null;
  const db = native ? null : await PGlite.create();
  let socket;
  try {
    if (db) {
      await replayCrmMigrations(db);
      socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
      await socket.start();
    }
    const url = pg ? await pg.database('leadcrm_campaign_test_1') : `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_campaign_test_1?connection_limit=1`;
    if (pg) console.log(`Native ${pg.version}; durability ${JSON.stringify(pg.durability)}; four campaign connections`);
    const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', suite, '--silent', '--reporter=dot', '--maxWorkers=1', '--pool=threads', '--testTimeout=20000', '--hookTimeout=30000'], {
      cwd: root, stdio: 'inherit', windowsHide: true, env: qaEnvironment(resolve(root, '..'), {
        DATABASE_URL: url, DIRECT_URL: url, CAMPAIGN_TEST_POOL_SIZE: native ? '4' : '1',
        JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      }),
    });
    const code = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
    if (code) process.exitCode = code;
  } finally { if (socket) await socket.stop(); if (db) await db.close(); if (pg) pg.stop(); }
}
