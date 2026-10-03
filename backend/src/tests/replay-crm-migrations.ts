import type { PGlite } from '@electric-sql/pglite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Replay committed SQL into a disposable database, including database-only guards. */
export async function replayCrmMigrations(db: PGlite, before?: string, from = '') {
  const directory = resolve(__dirname, '../../prisma/migrations');
  await db.exec('CREATE TABLE IF NOT EXISTS "_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)');
  for (const name of readdirSync(directory).sort()) {
    const file = resolve(directory, name, 'migration.sql');
    if (name >= from && (!before || name < before) && existsSync(file)) {
      await db.exec(readFileSync(file, 'utf8'));
      await db.query('INSERT INTO "_prisma_migrations" (migration_name, finished_at) VALUES ($1, now())', [name]);
    }
  }
}
