/**
 * drizzle-kit config. We hand-author the PostGIS DDL in drizzle/*.sql and apply
 * it via `yarn db:migrate`, so this config exists mainly for `db:generate` and
 * studio/introspection convenience.
 */
import { defineConfig } from 'drizzle-kit';

import { env } from './src/config/env.js';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
