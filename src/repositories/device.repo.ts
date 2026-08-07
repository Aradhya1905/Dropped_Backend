/**
 * device.repo — persistence for the anonymous device identity.
 *
 * Pure DB layer: no Fastify, no business rules. The device row is the only
 * "account" in the system.
 */
import { eq, sql } from 'drizzle-orm';

import { db, sqlClient } from '../db/client.js';
import { DELETED_DEVICE_ID, devices, drops } from '../db/schema.js';

/**
 * What a wipe destroyed and what it left standing — the receipt for
 * `DELETE /devices/me`.
 *
 * It exists because the confirmation dialog has to name both halves. "Erase
 * everything" that quietly leaves eleven confessions on the map is the kind of
 * broken promise this whole feature is meant to answer.
 */
export interface DeviceErasure {
  deleted: {
    reveals: number;
    saves: number;
    hearts: number;
    reports: number;
    stepDays: number;
  };
  anonymised: {
    drops: number;
    replies: number;
  };
}

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

  /**
   * Erase a device: everything that says who it was, in one transaction.
   *
   * **Nothing cascades.** Every `device_id` foreign key in the schema is a plain
   * `REFERENCES devices(id)`, so the final `DELETE FROM devices` only succeeds
   * once every child row has been cleared or re-pointed. The order below is
   * therefore load-bearing, not stylistic, and it all runs inside one
   * transaction: a half-erased device is worse than an un-erased one, because
   * the user has already been told it worked.
   *
   * Three decisions worth reading before changing anything here:
   *
   * - **Counters are given back before the rows go.** `heart_count`,
   *   `reveal_count` and `stood_here` are denormalised onto `drops`, and each is
   *   bumped exactly once per `hearts` / `reveals` row (engagement.repo,
   *   drop.repo `recordReveal`). Deleting the rows without decrementing would
   *   permanently overstate how many people have stood somewhere — a number a
   *   stranger reads off the map. `GREATEST(… - 1, 0)` because a counter that
   *   has already drifted must not go negative and turn a privacy operation into
   *   a 500.
   *
   * - **Drops and replies are anonymised, never deleted.** Someone else walked
   *   50 m to read them; they are part of a place now, not of a person. They are
   *   re-pointed at the shared {@link DELETED_DEVICE_ID} row — shared so that one
   *   erased author's drops cannot be re-linked to each other.
   *   `drops.reply_count` needs no recount: it counts *visible* replies and
   *   nothing here changes a status.
   *
   * - **Reports are deleted, and nothing is un-hidden.** A report is the
   *   reporter's personal data and goes with them. Moderation outcomes stay
   *   where they are: `REPORT_HIDE_THRESHOLD` counts distinct reporters at
   *   report time, and letting an erasure resurrect content someone else
   *   reported would make "delete my account" a moderation-evasion tool. (This
   *   is also why reports are not anonymised to the sentinel — that would
   *   collapse many erased reporters into one distinct device and *lower* the
   *   count, which has the same effect by accident.)
   */
  async erase(deviceId: string): Promise<DeviceErasure> {
    return sqlClient.begin(async tx => {
      // 1. Hand back one heart on every drop this device hearted, then let the
      //    hearts go. `hearts` is keyed (drop_id, device_id), so the UPDATE …
      //    FROM touches each drop exactly once.
      await tx`
        UPDATE drops d
        SET heart_count = GREATEST(d.heart_count - 1, 0)
        FROM hearts h
        WHERE h.drop_id = d.id AND h.device_id = ${deviceId}
      `;
      const hearts = await tx`
        DELETE FROM hearts WHERE device_id = ${deviceId} RETURNING drop_id
      `;

      // 2. Same for reveals, which carry two counters rather than one.
      await tx`
        UPDATE drops d
        SET reveal_count = GREATEST(d.reveal_count - 1, 0),
            stood_here   = GREATEST(d.stood_here - 1, 0)
        FROM reveals r
        WHERE r.drop_id = d.id AND r.device_id = ${deviceId}
      `;
      const reveals = await tx`
        DELETE FROM reveals WHERE device_id = ${deviceId} RETURNING drop_id
      `;

      // 3. Saves and step days back no counter — they are purely this device's.
      const saves = await tx`
        DELETE FROM saves WHERE device_id = ${deviceId} RETURNING drop_id
      `;
      const stepDays = await tx`
        DELETE FROM device_steps WHERE device_id = ${deviceId} RETURNING day
      `;

      // 4. Reports. See the note above: the rows go, the verdicts stand.
      const reports = await tx`
        DELETE FROM reports WHERE device_id = ${deviceId} RETURNING id
      `;

      // 5. Anonymise what the world has already read. Replies first, so that if
      //    the partial unique index ever rejects one the drops are untouched and
      //    the whole transaction rolls back cleanly.
      const keptReplies = await tx`
        UPDATE replies SET device_id = ${DELETED_DEVICE_ID}
        WHERE device_id = ${deviceId}
        RETURNING id
      `;
      const keptDrops = await tx`
        UPDATE drops SET device_id = ${DELETED_DEVICE_ID}
        WHERE device_id = ${deviceId}
        RETURNING id
      `;

      // 6. Only now can the identity itself go.
      await tx`DELETE FROM devices WHERE id = ${deviceId}`;

      return {
        deleted: {
          reveals: reveals.length,
          saves: saves.length,
          hearts: hearts.length,
          reports: reports.length,
          stepDays: stepDays.length,
        },
        anonymised: { drops: keptDrops.length, replies: keptReplies.length },
      };
    });
  },
};
