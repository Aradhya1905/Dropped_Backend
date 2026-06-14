/**
 * client — the single Postgres pool + Drizzle instance.
 *
 * Standard TCP driver (postgres.js), NOT a Neon-specific driver: switching host
 * is just a DATABASE_URL change. SSL is required by Neon; `require` is harmless
 * for a self-hosted server too.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env.js';
import * as schema from './schema.js';

/** Raw postgres.js client — used for the PostGIS raw SQL in repositories. */
export const sqlClient = postgres(env.DATABASE_URL, {
  ssl: 'require',
  max: 10,
});

/** Drizzle instance bound to our schema. */
export const db = drizzle(sqlClient, { schema });

export type Database = typeof db;

/** Close the pool (tests, graceful shutdown). */
export async function closeDb(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}
