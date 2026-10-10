// Disposable, in-memory SQL replay. Never connects to an existing database.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const { deploymentPlan } = createRequire(import.meta.url)('./deploy-crm-imports.cjs');
const db = await PGlite.create();
const names = readdirSync(new URL('../prisma/migrations', import.meta.url));
const baseline = names.filter(name => /^\d+_/.test(name) && name <= '20261109000000_campaign_final_statuses'
  && !['20261102000000_retire_relationship_compatibility', '20261106000000_scoped_mailbox_delivery'].includes(name));
try {
  await replayCrmMigrations(db, { exclude: names.filter(name => !baseline.includes(name)) });
  await db.exec(`
    INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('preserved','Preserved','preserved',now());
    INSERT INTO "User"(id,"tenantId",email,"firstName","lastName",role,"updatedAt")
      VALUES ('preserved-user','preserved','preserved@example.test','Existing','User','Agent',now());
    INSERT INTO "Lead"(id,"tenantId","firstName","lastName","assignedUserId",description,website,"productInterestOther","updatedAt")
      VALUES ('preserved-lead','preserved','Existing','Lead','preserved-user','Historical text','','Historical product','2025-01-01');
    INSERT INTO "Notification"(id,"tenantId","userId",type,title,"eventKey","isRead","readAt","createdAt")
      VALUES ('preserved-notification','preserved','preserved-user','lead_assigned','Original title','preserved-event',true,'2025-01-01','2024-01-01');
    INSERT INTO "EmailAccount"(id,"tenantId","userId",email,"accessToken","refreshToken",scopes,"updatedAt")
      VALUES ('preserved-mailbox','preserved','preserved-user','preserved@example.test','opaque-access','opaque-refresh',ARRAY['mail'],'2025-01-01');
  `);
  const before = (await db.query('SELECT row_to_json(n) AS value FROM "Notification" n')).rows[0].value;
  const plan = deploymentPlan(baseline.map(migration_name => ({ migration_name, finished_at: new Date() })), names);
  await replayCrmMigrations(db, { exclude: [...baseline, ...plan.exclude] });
  const retained = (await db.query('SELECT row_to_json(n)::jsonb - \'occurredAt\' AS value FROM "Notification" n')).rows[0].value;
  assert.deepEqual(retained, before);
  const lead = (await db.query('SELECT description,website,"productInterestOther","updatedAt"::text FROM "Lead"')).rows[0];
  assert.deepEqual(lead, { description: 'Historical text', website: '', productInterestOther: 'Historical product', updatedAt: '2025-01-01 00:00:00' });
  const archive = (await db.query('SELECT "fieldId",value FROM "CustomFieldValue" ORDER BY "fieldId"')).rows;
  assert.deepEqual(archive.map(row => row.value), ['Historical text','Historical product','']);
  const mailbox = (await db.query('SELECT "accessToken","refreshToken","mailboxVersion" FROM "EmailAccount"')).rows[0];
  assert.deepEqual(mailbox, { accessToken: 'opaque-access', refreshToken: 'opaque-refresh', mailboxVersion: 0 });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "NotificationDelivery" WHERE "eventKey"=\'preserved-event\'')).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "NotificationEvent" WHERE "processedAt" IS NULL AND "availableAt"<=CURRENT_TIMESTAMP')).rows[0].n, 0);
  const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Contact' AND column_name IN ('lastContactedAt','qualifiedAt','disqualifiedReason')`)).rows;
  assert.equal(columns.length, 3);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='Deal' AND column_name='billingFrequency'`)).rows[0].n, 1);
  console.log('PASS: production-shaped migration chain preserves legacy columns, lead archive values, mailbox credentials and notification history without replay.');
} finally { await db.close(); }
