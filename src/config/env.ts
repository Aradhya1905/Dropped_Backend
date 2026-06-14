/**
 * env — the single, validated source of runtime configuration.
 *
 * The whole point of the brief's host-portability rule lives here: the app reads
 * one `DATABASE_URL`. Switching from Neon to a self-hosted Postgres is a change
 * to that one value, nothing else.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Minimal .env loader (no dependency). Reads KEY=VALUE lines from the project
 * .env if present and fills any var not already in process.env. Keeps us off a
 * dotenv dependency and works identically under tsx, vitest, and plain node.
 */
function loadDotEnv(): void {
  try {
    const file = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const rawLine of file.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // No .env file — rely on the real environment (e.g. production).
  }
}

loadDotEnv();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  /** Max drops a single device may create per rolling 24h. */
  DROP_DAILY_LIMIT: z.coerce.number().int().positive().default(5),

  /** Default and hard-cap radius for the nearby query, in meters. */
  NEARBY_DEFAULT_RADIUS_M: z.coerce.number().int().positive().default(500),
  NEARBY_MAX_RADIUS_M: z.coerce.number().int().positive().default(2000),

  /** Reports needed to auto-flip a drop to `pending` (shadow-removed). */
  REPORT_HIDE_THRESHOLD: z.coerce.number().int().positive().default(3),

  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
