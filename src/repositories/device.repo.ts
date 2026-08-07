/**
 * device.repo — persistence for the anonymous device identity.
 *
 * Pure DB layer: no Fastify, no business rules. The device row is the only
 * "account" in the system.
 */
import { eq, sql } from 'drizzle-orm';

import { db, sqlClient } from '../db/client.js';
import { devices, drops } from '../db/schema.js';

/** One row of the per-city breakdown. Timestamps still in postgres form. */
export interface DeviceCityRow {
  city: string;
  foundCount: number;
  droppedCount: number;
  firstAt: Date | string;
  lastAt: Date | string;
}

/** Raw aggregate counts + activity dates backing the Trail stats. */
export interface DeviceStatsRow {
  droppedTotal: number;
  droppedThisMonth: number;
  foundTotal: number;
  foundThisMonth: number;
  citiesVisited: number;
  /** Distinct UTC activity days (reveal OR drop), 'YYYY-MM-DD', newest first. */
  activityDates: string[];
}

export const deviceRepo = {
  /** Upsert a device by id; idempotent. Called on first request. */
  async ensure(id: string): Promise<void> {
    await db
      .insert(devices)
      .values({ id })
      .onConflictDoNothing({ target: devices.id });
  },

  /** Fetch a device row, or undefined. */
  async find(id: string) {
    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.id, id))
      .limit(1);
    return rows[0];
  },

  /** Count drops this device created in the trailing `hours` window. */
  async dropsCreatedSince(deviceId: string, hours: number): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(drops)
      .where(
        sql`${drops.deviceId} = ${deviceId} AND ${drops.createdAt} > now() - (${hours} * interval '1 hour')`,
      );
    return rows[0]?.count ?? 0;
  },

  /**
   * Aggregate Trail stats for a device: dropped/found totals (all-time and this
   * calendar month), distinct cities dropped-in or revealed, and the list of
   * distinct active days used to compute the streak. One round trip for the
   * scalar counts, one for the date list.
   */
  async stats(deviceId: string): Promise<DeviceStatsRow> {
    const [counts] = await sqlClient<
      [Omit<DeviceStatsRow, 'activityDates'>]
    >`
      SELECT
        (SELECT count(*)::int FROM drops
           WHERE device_id = ${deviceId}) AS "droppedTotal",
        (SELECT count(*)::int FROM drops
           WHERE device_id = ${deviceId}
             AND created_at >= date_trunc('month', now())) AS "droppedThisMonth",
        (SELECT count(*)::int FROM reveals
           WHERE device_id = ${deviceId}) AS "foundTotal",
        (SELECT count(*)::int FROM reveals
           WHERE device_id = ${deviceId}
             AND created_at >= date_trunc('month', now())) AS "foundThisMonth",
        (SELECT count(DISTINCT lower(city))::int FROM drops
           WHERE city IS NOT NULL
             AND (device_id = ${deviceId}
                  OR id IN (SELECT drop_id FROM reveals
                              WHERE device_id = ${deviceId}))) AS "citiesVisited"
    `;

    const dateRows = await sqlClient<{ d: string }[]>`
      SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d
      FROM (
        SELECT created_at FROM reveals WHERE device_id = ${deviceId}
        UNION ALL
        SELECT created_at FROM drops   WHERE device_id = ${deviceId}
      ) t
      GROUP BY 1
      ORDER BY 1 DESC
    `;

    return { ...counts, activityDates: dateRows.map(r => r.d) };
  },

  /**
   * Per-city breakdown of everything this device found or left, newest activity
   * first — the rows behind `citiesVisited`, which on its own is just a number.
   *
   * Three things worth reading twice:
   *
   * - **Grouped by `lower(city)`, labelled with `min(city)`.** The composer
   *   sends whatever the geocoder returned, so "Bengaluru" and "bengaluru" are
   *   the same city and must not be two constellations. `citiesVisited` already
   *   counts distinct `lower(city)`; this agrees with it by construction.
   * - **`status` is asserted for reveals but not for a device's own drops**,
   *   exactly as `trail()` does. A drop moderation took down stops being part
   *   of anyone else's history; it stays part of yours.
   * - **No expiry predicate**, again as in `trail()`: a faded drop you stood
   *   inside is still somewhere you have been.
   */
  async cities(deviceId: string): Promise<DeviceCityRow[]> {
    return sqlClient<DeviceCityRow[]>`
      WITH ev AS (
        SELECT drop_id, 'found' AS kind, created_at AS at
        FROM reveals WHERE device_id = ${deviceId}
        UNION ALL
        SELECT id, 'dropped' AS kind, created_at AS at
        FROM drops   WHERE device_id = ${deviceId}
      )
      SELECT
        min(d.city)                                        AS city,
        count(*) FILTER (WHERE ev.kind = 'found')::int     AS "foundCount",
        count(*) FILTER (WHERE ev.kind = 'dropped')::int   AS "droppedCount",
        min(ev.at)                                         AS "firstAt",
        max(ev.at)                                         AS "lastAt"
      FROM ev
      JOIN drops d ON d.id = ev.drop_id
      WHERE d.city IS NOT NULL
        AND (ev.kind = 'dropped' OR d.status = 'visible')
      GROUP BY lower(d.city)
      ORDER BY "lastAt" DESC
    `;
  },
};
