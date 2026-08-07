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
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
    /** Denormalised count of `visible` replies. See the replies table below. */
    replyCount: integer('reply_count').notNull().default(0),
    /**
     * When this drop stops being findable. NULL = forever (the default, and
     * what every row predating 0005 carries). Filtered on read against `now()`;
     * expired rows are never hard-deleted — reports and moderation history
     * reference them, and the author still sees them in their own Trail.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * Whether a share link may resolve to this drop. False makes
     * `GET /drops/:id/preview` 404 — see 0006_drop_shareable.sql.
     *
     * An opt-out on the *link*, not on the drop: an unshareable drop is still
     * found by walking past it, which is the premise of the app.
     */
    shareable: boolean('shareable').notNull().default(true),
    /**
     * One extra condition on top of the 50 m rule: `'night'`, `'day'`, or NULL
     * for no condition (the default, and what every row predating 0008
     * carries). Constrained to those two values in SQL — see
     * 0008_reveal_condition.sql.
     *
     * Nothing about sunrise/sunset is stored: it is derived at reveal time from
     * the drop's own `geog` (src/domain/solar.ts), so no timezone ever enters
     * the picture.
     */
    revealCondition: text('reveal_condition'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    // GiST index for fast ST_DWithin. Created explicitly in the SQL migration
    // (USING gist); declared here so drizzle-kit is aware of it.
    index('drops_geog_gix').using('gist', table.geog),
    index('drops_device_idx').on(table.deviceId),
    // Anniversary echoes: "this device's drops, in a window around a year ago".
    // See 0007_echo_indexes.sql.
    index('drops_device_created_idx').on(table.deviceId, table.createdAt),
    index('drops_status_idx').on(table.status),
    // Partial in SQL (WHERE expires_at IS NOT NULL) — see 0005_drop_expiry.sql.
    index('drops_expires_idx').on(table.expiresAt),
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
  table => [
    primaryKey({ columns: [table.dropId, table.deviceId] }),
    // The PK is (drop_id, device_id) and so cannot answer "everything this
    // device revealed around a year ago" — the echo query. See
    // 0007_echo_indexes.sql.
    index('reveals_device_created_idx').on(table.deviceId, table.createdAt),
  ],
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

/**
 * One short line pinned under a drop. Writable and readable only by a device
 * with a `reveals` row for that drop — the physical gate is reused, not
 * re-derived. Authorship never leaves the server: `device_id` exists purely for
 * the one-per-device rule, the daily quota, and author-only delete.
 */
export type ReplyStatus = 'visible' | 'hidden' | 'pending';

export const replies = pgTable(
  'replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dropId: uuid('drop_id')
      .notNull()
      .references(() => drops.id, { onDelete: 'cascade' }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    body: text('body').notNull(),
    status: text('status').notNull().default('visible'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    index('replies_drop_idx').on(table.dropId),
    index('replies_device_idx').on(table.deviceId),
    // One reply per device per drop, enforced in the DB (see 0004_replies.sql).
    uniqueIndex('replies_drop_device_uniq').on(table.dropId, table.deviceId),
  ],
);

/**
 * Reports feed moderation. N reports flip the target to `pending`.
 *
 * A report targets exactly one of a drop or a reply — enforced in SQL by
 * `reports_target_chk`, an XOR over the two nullable foreign keys.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dropId: uuid('drop_id').references(() => drops.id, { onDelete: 'cascade' }),
    replyId: uuid('reply_id').references(() => replies.id, {
      onDelete: 'cascade',
    }),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    index('reports_drop_idx').on(table.dropId),
    index('reports_reply_idx').on(table.replyId),
  ],
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
  replies,
  reports,
  deviceSteps,
  routeCache,
  routingUsage,
};

/** Default SQL expression bag for raw queries that need `now()` etc. */
export const nowSql = sql`now()`;
