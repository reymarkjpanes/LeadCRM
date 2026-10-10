import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
it('hashes existing reset secrets without changing identities, binding or validity', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE "PasswordResetToken" (id TEXT PRIMARY KEY, "userId" TEXT, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL);
      INSERT INTO "PasswordResetToken" VALUES ('preserved', 'account-1', 'staff@camxian.com', 'previous-secret', '2030-01-01', '2026-10-10');`);
    const before = (await db.query<Record<string, unknown>>('SELECT * FROM "PasswordResetToken"')).rows[0];
    await db.exec(readFileSync(resolve(__dirname, '../../../prisma/migrations/20261120000000_password_recovery_security/migration.sql'), 'utf8'));
    const after = (await db.query<Record<string, unknown>>('SELECT * FROM "PasswordResetToken"')).rows[0];
    expect(after).toEqual({ ...before, token: createHash('sha256').update('previous-secret').digest('hex'), submissionStatus: 'LEGACY' });
    expect(JSON.stringify(after)).not.toContain('previous-secret');
  } finally { await db.close(); }
});
