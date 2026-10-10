import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// An in-memory database exercises migration/backfill and the immutable history
// trigger without loading application credentials or opening any live database.
describe('Deal lifetime outcome migration', () => {
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec(`
      CREATE TABLE "Lead" (id TEXT); CREATE TABLE "Contact" (id TEXT); CREATE TABLE "Account" (id TEXT);
      CREATE TABLE "Stage" (id TEXT PRIMARY KEY, "tenantId" TEXT, "isWon" BOOLEAN);
      CREATE TABLE "Deal" (id TEXT PRIMARY KEY, "tenantId" TEXT, "stageId" TEXT, "wonConfirmedAt" TIMESTAMP);
      CREATE TABLE "DealStageHistory" ("dealId" TEXT, "tenantId" TEXT, "newStageId" TEXT, "previousStageId" TEXT);
      INSERT INTO "Stage" VALUES ('won', 'tenant', true), ('lost', 'tenant', false), ('lead', 'tenant', false), ('foreign-won', 'other', true);
      INSERT INTO "Deal" VALUES ('current-won','tenant','won',NULL), ('historical-won','tenant','lost',NULL),
        ('confirmed','tenant','lost','2026-10-01'), ('unknown','tenant','lead',NULL), ('foreign','tenant','lead',NULL);
      INSERT INTO "DealStageHistory" VALUES ('historical-won','tenant','lost','won'), ('foreign','other','foreign-won','lead');
    `);
    const migration = await readFile(path.resolve(__dirname, '../../../../../prisma/migrations/20261022000000_workflow_record_lifecycle/migration.sql'), 'utf8');
    await db.exec(migration);
  }, 60_000);
  afterAll(async () => { await db.close(); });
  const row = async (id: string) => (await db.query<{ hasEverBeenWon: boolean; wonHistoryVerified: boolean }>(
    'SELECT "hasEverBeenWon", "wonHistoryVerified" FROM "Deal" WHERE id = $1', [id])).rows[0];

  it.each(['current-won', 'historical-won', 'confirmed'])('backfills authoritative Won evidence for %s', async id => {
    expect(await row(id)).toEqual({ hasEverBeenWon: true, wonHistoryVerified: true });
  });
  it('does not mistake missing or another tenant’s history for verified never-Won', async () => {
    expect(await row('unknown')).toEqual({ hasEverBeenWon: false, wonHistoryVerified: false });
    expect(await row('foreign')).toEqual({ hasEverBeenWon: false, wonHistoryVerified: false });
  });
  it('gives a genuinely new opportunity its own verified empty history', async () => {
    await db.exec(`INSERT INTO "Deal" (id, "tenantId", "stageId") VALUES ('new', 'tenant', 'lead');`);
    expect(await row('new')).toEqual({ hasEverBeenWon: false, wonHistoryVerified: true });
  });
  it('records Won through any write path and refuses later attempts to erase it', async () => {
    await db.exec(`INSERT INTO "Deal" (id, "tenantId", "stageId") VALUES ('lifecycle', 'tenant', 'won');
      UPDATE "Deal" SET "stageId" = 'lost', "hasEverBeenWon" = false, "wonHistoryVerified" = false WHERE id = 'lifecycle';`);
    expect(await row('lifecycle')).toEqual({ hasEverBeenWon: true, wonHistoryVerified: true });
  });
});
