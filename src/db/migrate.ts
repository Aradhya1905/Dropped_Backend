/**
 * migrate — applies the hand-authored SQL files in drizzle/ in filename order.
 *
 * We author the PostGIS DDL by hand (CREATE EXTENSION, geography GiST), so we
 * run plain .sql files rather than drizzle-kit's journal-based migrator. Each
 * file is idempotent (IF NOT EXISTS), so re-running is safe. A migrations table
 * records what's been applied to skip already-run files.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { env } from '../config/env.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../drizzle');

async function main(): Promise<void> {
  const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const already = await sql`
        SELECT 1 FROM _migrations WHERE name = ${file}
      `;
      if (already.length > 0) {
        console.log(`• skip ${file} (already applied)`);
        continue;
      }

      const ddl = readFileSync(join(migrationsDir, file), 'utf8');
      console.log(`→ applying ${file}`);
      await sql.unsafe(ddl);
      await sql`INSERT INTO _migrations (name) VALUES (${file})`;
      console.log(`✓ applied ${file}`);
    }

    console.log('Migrations complete.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
