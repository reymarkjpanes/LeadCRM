import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('preserves uncertain historical attempts when upgrading unfinished campaigns', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENDING');
      CREATE TABLE "Campaign" (id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
        status "CampaignStatus", "submissionStartedAt" TIMESTAMP(3), "submissionFinishedAt" TIMESTAMP(3));
      CREATE TABLE "CampaignContact" (id TEXT PRIMARY KEY, "campaignId" TEXT, "tenantId" TEXT, status TEXT);
      INSERT INTO "Campaign" VALUES
        ('unfinished', 'tenant-a', 'SENDING', '2026-10-09 12:00:00', NULL),
        ('finished', 'tenant-a', 'SENDING', '2026-10-09 12:00:00', '2026-10-09 12:01:00'),
        ('draft', 'tenant-a', 'DRAFT', NULL, NULL);
      INSERT INTO "CampaignContact" VALUES
        ('pending', 'unfinished', 'tenant-a', 'pending'),
        ('submitting', 'unfinished', 'tenant-a', 'submitting'),
        ('accepted', 'unfinished', 'tenant-a', 'submitted'),
        ('foreign', 'unfinished', 'tenant-b', 'pending'),
        ('finished', 'finished', 'tenant-a', 'pending'),
        ('draft', 'draft', 'tenant-a', 'pending');
    `);
    await db.exec(await readFile(resolve(__dirname, '../../../prisma/migrations/20261117000000_campaign_submission_recovery/migration.sql'), 'utf8'));
    const { rows } = await db.query<{ id: string; attempted: string | null }>(
      'SELECT id, "submissionAttemptedAt"::text AS attempted FROM "CampaignContact" ORDER BY id',
    );
    const attempts = Object.fromEntries(rows.map(row => [row.id, row.attempted]));
    expect(attempts).toEqual({ accepted: null, draft: null, finished: null, foreign: null,
      pending: '2026-10-09 12:00:00', submitting: '2026-10-09 12:00:00' });
    expect((await db.query("SELECT 'INTERRUPTED'::\"CampaignStatus\" AS status")).rows[0]).toEqual({ status: 'INTERRUPTED' });
  } finally { await db.close(); }
}, 20000);
