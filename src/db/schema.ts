/**
 * schema — Drizzle table definitions, the typed mirror of the SQL migration.
 *
 * The PostGIS `geography(Point,4326)` column on `drops` has no first-class
 * Drizzle type, so it is declared via `customType` and only ever read/written
 * through raw SQL (ST_MakePoint / ST_X / ST_Y) in drop.repo.ts. Everything else
 * is plain Drizzle.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** PostGIS geography point. Opaque to Drizzle; manipulated via raw SQL only. */
const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
});

/** Anonymous identity. `id` is the X-Device-Id UUID the client generates. */
export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Drop status drives shadow-removal: only `visible` rows appear in nearby. */
export type DropStatus = 'visible' | 'hidden' | 'pending';

export const drops = pgTable(
  'drops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    body: text('body').notNull(),
    mood: text('mood').notNull(),
    placeLabel: text('place_label'),
    city: text('city'),
    geog: geography('geog').notNull(),
    status: text('status').notNull().default('visible'),
    revealCount: integer('reveal_count').notNull().default(0),
    stoodHere: integer('stood_here').notNull().default(0),
    heartCount: integer('heart_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    // GiST index for fast ST_DWithin. Created explicitly in the SQL migration
    // (USING gist); declared here so drizzle-kit is aware of it.
    index('drops_geog_gix').using('gist', table.geog),
    index('drops_device_idx').on(table.deviceId),
    index('drops_status_idx').on(table.status),
  ],
);

/** One row per (drop, device) reveal. Drives reveal_count and the Found trail. */
export const reveals = pgTable(
  'reveals',
  {
    dropId: uuid('drop_id')
      .notNull()
      .references(() => drops.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [primaryKey({ columns: [table.dropId, table.deviceId] })],
);

/** Saves (bookmarks), keyed by device. Drives the Saved trail + `saved` flag. */
export const saves = pgTable(
  'saves',
  {
    dropId: uuid('drop_id')
      .notNull()
      .references(() => drops.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [primaryKey({ columns: [table.dropId, table.deviceId] })],
);

/** Hearts ("I feel this"), keyed by device. Drives heart_count + `hearted`. */
export const hearts = pgTable(
  'hearts',
  {
    dropId: uuid('drop_id')
      .notNull()
      .references(() => drops.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [primaryKey({ columns: [table.dropId, table.deviceId] })],
);

/**
 * Per-device, per-day step counts. Backs the Trail "steps" stat; the displayed
 * scope is decided in step.service (STEP_SCOPE), not here. Manipulated via raw
 * SQL upsert in step.repo.
 */
export const deviceSteps = pgTable(
  'device_steps',
  {
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    day: date('day').notNull(),
    steps: integer('steps').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [primaryKey({ columns: [table.deviceId, table.day] })],
);

/** Reports feed moderation. N reports flip a drop to `pending`. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dropId: uuid('drop_id')
      .notNull()
      .references(() => drops.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [index('reports_drop_idx').on(table.dropId)],
);

/**
 * Cache of walking routes from the /route/foot proxy. Keyed by quantized
 * endpoints (lat/lng ×1e4 ≈ 11 m) + profile so GPS jitter and many users
 * walking to the same drop reuse one upstream call. `geometry` is a GeoJSON
 * LineString. Rows expire via ROUTE_CACHE_TTL_DAYS (checked in the query).
 */
export const routeCache = pgTable(
  'route_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromLat: integer('from_lat').notNull(),
    fromLng: integer('from_lng').notNull(),
    toLat: integer('to_lat').notNull(),
    toLng: integer('to_lng').notNull(),
    profile: text('profile').notNull(),
    provider: text('provider').notNull(),
    geometry: jsonb('geometry').notNull(),
    distanceMeters: integer('distance_meters').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    index('route_cache_key_idx').on(
      table.fromLat,
      table.fromLng,
      table.toLat,
      table.toLng,
      table.profile,
    ),
  ],
);

/** Per-provider monthly upstream-call counter, to honour the free-tier caps. */
export const routingUsage = pgTable(
  'routing_usage',
  {
    provider: text('provider').notNull(),
    yyyymm: text('yyyymm').notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [primaryKey({ columns: [table.provider, table.yyyymm] })],
);

export const tableExports = {
  devices,
  drops,
  reveals,
  saves,
  hearts,
  reports,
  deviceSteps,
  routeCache,
  routingUsage,
};

/** Default SQL expression bag for raw queries that need `now()` etc. */
export const nowSql = sql`now()`;
