import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Disposable test databases only. Replay history rather than reverse-engineering
// an obsolete schema from the current Prisma model.
export async function replayCrmMigrations(db, { from = '', before = '\uffff', exclude = [] } = {}) {
  const directory = resolve(import.meta.dirname, '../prisma/migrations');
  await db.exec('CREATE TABLE IF NOT EXISTS "_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)');
  for (const name of readdirSync(directory).sort()) {
    const file = resolve(directory, name, 'migration.sql');
    if (name < from || name >= before || exclude.includes(name) || !existsSync(file)) continue;
    await db.exec(readFileSync(file, 'utf8'));
    await db.query('INSERT INTO "_prisma_migrations" (migration_name, finished_at) VALUES ($1, now())', [name]);
  }
}
