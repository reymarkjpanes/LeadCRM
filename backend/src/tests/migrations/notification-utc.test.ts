import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { replayCrmMigrations } from '../replay-crm-migrations';

it('preserves existing notification and delivery history while storing new SQL occurrences in UTC', async () => {
  const db = await PGlite.create();
  try {
    await replayCrmMigrations(db, '20261118000000');
    await db.exec(`SET TIME ZONE 'Asia/Manila';
      INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('utc-tenant','UTC test','utc-test',CURRENT_TIMESTAMP);
      INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"updatedAt") VALUES ('utc-user','utc-tenant','utc@example.test','UTC','Test','Client Admin',CURRENT_TIMESTAMP);
      INSERT INTO "Notification" (id,"tenantId","userId",type,title,"eventKey","isRead","readAt","createdAt")
        VALUES ('historical','utc-tenant','utc-user','user_created','Historical','historical-visible',true,'2020-01-02','2020-01-01');
      SELECT crm_enqueue_notification('utc-tenant','historical-outbox','user_created','User','utc-user','utc-user');
      UPDATE "NotificationEvent" SET attempts=3,"leaseToken"='historical-lease',"leaseUntil"='2026-10-10 01:00:00',"availableAt"='2026-10-10 00:00:00',"lastError"='Retry later' WHERE "eventKey"='historical-outbox';
      SELECT crm_enqueue_notification('utc-tenant','historical-processed','user_created','User','utc-user','utc-user');
      UPDATE "NotificationEvent" SET "processedAt"='2020-01-03 12:00:00' WHERE "eventKey"='historical-processed';
      INSERT INTO "NotificationDelivery" ("tenantId","userId","eventKey",outcome,"createdAt")
        VALUES ('utc-tenant','utc-user','historical-deleted','deleted','2020-01-01 12:00:00');`);
    const snapshot = async () => Promise.all(['Notification', 'NotificationEvent', 'NotificationDelivery'].map(async table => (await db.query(`SELECT * FROM "${table}" ORDER BY "eventKey"`)).rows));
    const before = await snapshot();
    expect(before[0]).toHaveLength(1);
    expect(before[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: 'historical-outbox', attempts: 3, leaseToken: 'historical-lease', lastError: 'Retry later', processedAt: null }),
      expect.objectContaining({ eventKey: 'historical-processed', processedAt: expect.any(Date) }),
    ]));
    // The visible notification's identity trigger also creates its ledger row.
    expect(before[2]).toHaveLength(2);
    expect(before[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: 'historical-deleted', outcome: 'deleted' }),
      expect.objectContaining({ eventKey: 'historical-visible', outcome: 'delivered' }),
    ]));
    const migration = await readFile(resolve(__dirname, '../../../prisma/migrations/20261119000000_notification_utc_timestamps/migration.sql'), 'utf8');
    await db.exec(migration);
    expect(await snapshot()).toEqual(before);

    const started = Date.now();
    await db.exec("SELECT crm_enqueue_notification('utc-tenant','new-outbox','user_created','User','utc-user','utc-user')");
    // Native PGlite decodes timezone-free timestamps using the process timezone.
    // Explicit UTC epochs verify the stored values independently of that decoder.
    const { rows } = await db.query<Record<string, string>>(`SELECT
      EXTRACT(EPOCH FROM ("occurredAt" AT TIME ZONE 'UTC')) * 1000 AS "occurredAt",
      EXTRACT(EPOCH FROM ("createdAt" AT TIME ZONE 'UTC')) * 1000 AS "createdAt",
      EXTRACT(EPOCH FROM ("availableAt" AT TIME ZONE 'UTC')) * 1000 AS "availableAt"
      FROM "NotificationEvent" WHERE "eventKey"='new-outbox'`);
    for (const value of Object.values(rows[0])) {
      expect(+value).toBeGreaterThanOrEqual(started - 1000);
      expect(+value).toBeLessThanOrEqual(Date.now() + 1000);
    }
  } finally { await db.close(); }
}, 60000);
