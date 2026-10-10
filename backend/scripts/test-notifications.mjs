// Never reads .env or connects to an existing database.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const db = await PGlite.create();
await db.exec("SET TIME ZONE 'UTC'");
const migration = '20261114000000_notification_delivery';
await replayCrmMigrations(db, { before: migration });
await db.exec(`INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('preserved','Preserved','preserved',now());
 INSERT INTO "User"(id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('preserved-user','preserved','preserved@camxian.com','Existing','User','Viewer',now());
 INSERT INTO "Notification"(id,"tenantId","userId",type,title,"eventKey","isRead","readAt","createdAt")
 VALUES ('preserved-notification','preserved','preserved-user','lead_assigned','Original title','preserved-event',true,'2025-01-01','2024-01-01');
 INSERT INTO "Task"(id,"tenantId",title,"assignedUserId","dueDate","updatedAt")
 VALUES ('past-task','preserved','Existing task','preserved-user','2024-01-01',now()),
 ('future-task','preserved','Future task','preserved-user',now()+interval '7 days',now());`);
await replayCrmMigrations(db, { from: migration });
const retained = (await db.query(`SELECT title,"isRead","readAt"::text,"createdAt"::text FROM "Notification" WHERE id='preserved-notification'`)).rows[0];
assert.equal(retained.title, 'Original title'); assert.equal(retained.isRead, true);
assert.ok(retained.createdAt.startsWith('2024-01-01'));
assert.ok(retained.readAt.startsWith('2025-01-01'));
assert.equal((await db.query(`SELECT count(*)::int n FROM "NotificationDelivery" WHERE "eventKey"='preserved-event'`)).rows[0].n, 1);
assert.equal((await db.query(`SELECT count(*)::int n FROM "NotificationEvent" WHERE "processedAt" IS NULL AND "availableAt"<=CURRENT_TIMESTAMP`)).rows[0].n, 0);
assert.equal((await db.query(`SELECT count(*)::int n FROM "NotificationEvent" WHERE "entityId"='future-task' AND "processedAt" IS NULL`)).rows[0].n, 2);
assert.equal((await db.query(`SELECT count(*)::int n FROM "NotificationDelivery" WHERE outcome='legacy_baseline'`)).rows[0].n, 2);
console.log('Populated migration: IDs, titles, read state, timestamps and delivery identity preserved; no historical replay.');
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
await socket.start();
const root = resolve(import.meta.dirname, '..');
try {
 const suites = process.argv.slice(2);
 const url = `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_forms_test_2?connection_limit=1&statement_cache_size=0`;
 const child = spawn(process.execPath, [resolve(root, '../node_modules/vitest/vitest.mjs'), 'run', '--no-file-parallelism',
   ...(suites.length ? suites : ['src/modules/notifications/notifications.integration.test.ts','src/modules/notifications/notification-delivery.integration.test.ts'])], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') },
 });
 process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
} finally { await socket.stop(); await db.close(); }
