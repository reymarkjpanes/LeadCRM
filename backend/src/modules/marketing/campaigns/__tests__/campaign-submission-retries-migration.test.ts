import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('adds Submitted and retry fields without enrolling historical failed or uncertain recipients', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT','SENDING','SENT');
      CREATE TABLE "CampaignContact" (id TEXT PRIMARY KEY, status TEXT, "submissionAttemptedAt" TIMESTAMP);
      INSERT INTO "CampaignContact" VALUES ('failed','failed',NOW()),('unknown','pending',NOW()),('untouched','pending',NULL);`);
    await db.exec(readFileSync(resolve(process.cwd(), 'prisma/migrations/20261231000000_campaign_submission_retries/migration.sql'), 'utf8'));
    expect((await db.query('SELECT id,status,"submissionAttemptCount","nextSubmissionAttemptAt" FROM "CampaignContact" ORDER BY id')).rows).toEqual([
      { id: 'failed', status: 'failed', submissionAttemptCount: 1, nextSubmissionAttemptAt: null },
      { id: 'unknown', status: 'pending', submissionAttemptCount: 1, nextSubmissionAttemptAt: null },
      { id: 'untouched', status: 'pending', submissionAttemptCount: 0, nextSubmissionAttemptAt: null },
    ]);
    expect((await db.query(`SELECT 'SUBMITTED'::"CampaignStatus" AS status`)).rows).toEqual([{ status: 'SUBMITTED' }]);
  } finally { await db.close(); }
}, 30000);
