import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { replayCrmMigrations } from '../../../tests/replay-crm-migrations';

it('applies current auth and Deal receipts without retiring compatibility columns', async () => {
  const db = await PGlite.create();
  try {
    await replayCrmMigrations(db, '20261102000000');
    await db.exec(`INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('t','Migration','migration',NOW());
      INSERT INTO "User" (id,"tenantId",email,"firstName","lastName",role,"mustChangePassword","updatedAt") VALUES
      ('old','t','old@camxian.com','Old','User','Client Admin',false,NOW()),
      ('new','t','new@camxian.com','New','User','Sales',true,NOW());`);
    // Verify the additive release boundary before later independently guarded retirements.
    await replayCrmMigrations(db, '20261105000000', '20261103000000');
    const users = await db.query<{id:string;completed:boolean}>(`SELECT id,"onboardingCompletedAt" IS NOT NULL AS completed FROM "User" ORDER BY id`);
    expect(users.rows).toEqual([{id:'new',completed:false},{id:'old',completed:true}]);
    const columns = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Deal' AND column_name IN ('leadId','contactId')`);
    expect(columns.rows).toHaveLength(2);
    expect((await db.query(`SELECT * FROM "DealCreationReceipt"`)).rows).toEqual([]);
    expect((await db.query(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name='20261102000000_retire_relationship_compatibility'`)).rows).toEqual([]);
  } finally { await db.close(); }
}, 60_000);
