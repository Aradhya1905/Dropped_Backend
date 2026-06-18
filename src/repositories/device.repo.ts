/**
 * device.repo — persistence for the anonymous device identity.
 *
 * Pure DB layer: no Fastify, no business rules. The device row is the only
 * "account" in the system.
 */
import { eq, sql } from 'drizzle-orm';

import { db, sqlClient } from '../db/client.js';
import { devices, drops } from '../db/schema.js';

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
};
