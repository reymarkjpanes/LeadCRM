import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

test('six-status migration retains historical records and uses only delivery evidence', async () => {
  const db = await PGlite.create();
  const migration = '20261109000000_campaign_final_statuses';
  try {
    await replayCrmMigrations(db, { before: migration });
    await db.exec(`INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('status-tenant','Status test','status-test',now());`);
    const cases = [
      ['draft','DRAFT',[], 'DRAFT'], ['active','ACTIVE',['submitted'],'SENDING'],
      ['scheduled','SCHEDULED',[], 'SENDING'], ['paused','PAUSED',['sent','failed'],'PARTIALLY_SENT'],
      ['completed','COMPLETED',['delivered','delivered','excluded'],'DELIVERED'],
      ['failed','PAUSED',['failed','failed'],'FAILED'], ['sent','SENDING',['sent','delivered'],'SENT'],
      ['legacy-acceptance','COMPLETED',['legacy','failed'],'SENDING'],
      ['engagement','ACTIVE',['opened','clicked'],'SENDING'], ['incomplete','COMPLETED',['delivered'],'SENDING'],
    ];
    for (const [id,status,states] of cases) {
      const count = id === 'incomplete' ? 2 : states.filter(s => s !== 'excluded').length;
      await db.query('INSERT INTO "Campaign" (id,"tenantId",name,type,status,"recipientCount","updatedAt") VALUES ($1,\'status-tenant\',$1,\'EMAIL\',$2,$3,now())',[id,status,count]);
      for (const [i,state] of states.entries()) {
        await db.query(`INSERT INTO "CampaignContact" (id,"tenantId","campaignId",status,"submittedAt","sentAt","deliveredAt")
          VALUES ($1,'status-tenant',$2,$3,CASE WHEN $3 IN ('submitted','sent','delivered') THEN now() ELSE NULL END,
            CASE WHEN $3 IN ('sent','delivered','legacy') THEN now() ELSE NULL END,CASE WHEN $3 = 'delivered' THEN now() ELSE NULL END)`,[`${id}-${i}`,id,state]);
      }
    }
    const before = (await db.query('SELECT count(*)::int AS count FROM "CampaignContact"')).rows[0].count;
    // Assert this migration's historical boundary; recovery has separate current-schema coverage.
    await replayCrmMigrations(db, { from: migration, before: '20261110000000' });
    assert.deepEqual((await db.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid = '"CampaignStatus"'::regtype ORDER BY enumsortorder`)).rows.map(r => r.enumlabel), ['SENDING','SENT','PARTIALLY_SENT','DELIVERED','FAILED','DRAFT']);
    const rows = (await db.query('SELECT id,status,"submissionStartedAt","submissionFinishedAt" FROM "Campaign"')).rows;
    assert.equal(rows.length, cases.length);
    for (const [id,,,expected] of cases) {
      const row = rows.find(r => r.id === id);
      assert.equal(row.status, expected, id);
      assert.equal(!!row.submissionStartedAt, id !== 'draft');
      assert.equal(!!row.submissionFinishedAt, id !== 'draft');
    }
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "CampaignContact"')).rows[0].count, before);
    for (const removed of ['ACTIVE','SCHEDULED','PAUSED','COMPLETED']) {
      await assert.rejects(db.query('UPDATE "Campaign" SET status = $1 WHERE id = \'draft\'', [removed]), /invalid input value for enum/);
    }
  } finally { await db.close(); }
});
