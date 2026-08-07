/**
 * drop.repo — the only place that touches drop SQL, including the PostGIS bits.
 *
 * The geography column is read/written through raw SQL (ST_MakePoint, ST_X/Y,
 * ST_DWithin, ST_Distance) via postgres.js. Composable pieces (the column list,
 * the per-device flag joins) are postgres.js fragments so they interpolate
 * safely. Everything returns a flat `DropRow` plus, where the device matters,
 * that device's saved/hearted/revealed flags — so services never see SQL.
 */
import { sqlClient } from '../db/client.js';
import type { Coordinate, RevealCondition } from '../domain/clientTypes.js';
import type { DropStatus } from '../db/schema.js';

/** A drop as the repo returns it (coordinate already split out of geography). */
export interface DropRow {
  id: string;
  deviceId: string;
  body: string;
  mood: string;
  placeLabel: string | null;
  city: string | null;
  lat: number;
  lng: number;
  status: DropStatus;
  revealCount: number;
  stoodHere: number;
  heartCount: number;
  /** Visible replies pinned under this drop ("3 voices here"). */
  replyCount: number;
  /** When it stops being findable. `null` = forever. */
  expiresAt: Date | string | null;
  /** Whether a share link may resolve to it. Never gates walking to it. */
  shareable: boolean;
  /** `'night'` / `'day'` / `null` for no condition beyond the 50 m rule. */
  revealCondition: RevealCondition | null;
  /** postgres.js returns timestamps as strings; mappers coerce to ms epoch. */
  createdAt: Date | string;
}

/**
 * The columns a shared link is allowed to see. **Deliberately has no `body`** —
 * the preview endpoint answers without a reveal on record, so the safest shape
 * is one where the text never leaves Postgres in the first place. The response
 * schema is a second gate, not the only one.
 */
export interface DropPreviewRow {
  id: string;
  mood: string;
  placeLabel: string | null;
  city: string | null;
  /** The stored, full-precision point. Coarsened by the mapper before it ships. */
  lat: number;
  lng: number;
  revealCount: number;
  expiresAt: Date | string | null;
  createdAt: Date | string;
}

/**
 * What the reveal needs to decide, before anything is unsealed: how far away
 * the walker is, and under what condition (if any) the drop opens — plus the
 * drop's own coordinate, because that is the point the sun is computed for.
 */
export interface RevealGate {
  distanceMeters: number;
  within: boolean;
  /** The drop's stored coordinate, not the walker's claimed one. */
  lat: number;
  lng: number;
  revealCondition: RevealCondition | null;
}

/** DropRow plus the requesting device's relationship to it. */
export interface DropRowForDevice extends DropRow {
  saved: boolean;
  hearted: boolean;
  revealed: boolean;
  /** Only set by nearby(): server-computed metres from the query point. */
  distanceMeters?: number;
}

interface CreateDropInput {
  deviceId: string;
  body: string;
  mood: string;
  placeLabel: string | null;
  city: string | null;
  coordinate: Coordinate;
  status: DropStatus;
  /** Server-computed (see domain/expiry). `null` = forever. */
  expiresAt: Date | null;
  /** Author's choice: may a share link point here? Defaults to true. */
  shareable: boolean;
  /** Author's choice: one extra condition, or `null` for none. */
  revealCondition: RevealCondition | null;
}

/**
 * "Still alive" predicate, shared by every read that must hide expired drops.
 * Compared against Postgres' `now()` so the database is the only clock — the
 * app server's clock never decides whether a drop is gone.
 *
 * Deliberately NOT applied to the trail queries or to `findForDevice`: an
 * author must keep seeing their own expired drops, and anyone who already
 * saved or revealed one keeps their copy. Otherwise the save button is a lie.
 */
const notExpired = sqlClient`(d.expires_at IS NULL OR d.expires_at > now())`;

/** Round to 5 dp (~1 m) so we never store the author's exact GPS fix. */
const snap = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Drop columns (geography split into lat/lng). postgres.js fragment. */
const dropCols = sqlClient`
  d.id,
  d.device_id        AS "deviceId",
  d.body,
  d.mood,
  d.place_label      AS "placeLabel",
  d.city,
  ST_Y(d.geog::geometry) AS lat,
  ST_X(d.geog::geometry) AS lng,
  d.status,
  d.reveal_count     AS "revealCount",
  d.stood_here       AS "stoodHere",
  d.heart_count      AS "heartCount",
  d.reply_count      AS "replyCount",
  d.expires_at       AS "expiresAt",
  d.shareable,
  d.reveal_condition AS "revealCondition",
  d.created_at       AS "createdAt"
`;

/** LEFT JOINs that expose this device's saved/hearted/revealed flags. */
const deviceFlagJoins = (deviceId: string) => sqlClient`
  LEFT JOIN reveals rv ON rv.drop_id = d.id AND rv.device_id = ${deviceId}
  LEFT JOIN saves   sv ON sv.drop_id = d.id AND sv.device_id = ${deviceId}
  LEFT JOIN hearts  ht ON ht.drop_id = d.id AND ht.device_id = ${deviceId}
`;

const deviceFlagCols = sqlClient`
  (rv.device_id IS NOT NULL) AS revealed,
  (sv.device_id IS NOT NULL) AS saved,
  (ht.device_id IS NOT NULL) AS hearted
`;

export const dropRepo = {
  /** Insert a drop. Coordinate is snapped before storage (privacy). */
  async create(input: CreateDropInput): Promise<DropRow> {
    const lat = snap(input.coordinate.lat);
    const lng = snap(input.coordinate.lng);
    const rows = await sqlClient<DropRow[]>`
      INSERT INTO drops (device_id, body, mood, place_label, city, geog, status, expires_at, shareable, reveal_condition)
      VALUES (
        ${input.deviceId},
        ${input.body},
        ${input.mood},
        ${input.placeLabel},
        ${input.city},
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${input.status},
        -- ISO string + explicit cast: postgres.js cannot infer a parameter
        -- type for a bare Date here and fails to bind it (ERR_INVALID_ARG_TYPE).
        ${input.expiresAt ? input.expiresAt.toISOString() : null}::timestamptz,
        ${input.shareable},
        ${input.revealCondition}
      )
      RETURNING
        id, device_id AS "deviceId", body, mood, place_label AS "placeLabel",
        city,
        ST_Y(geog::geometry) AS lat, ST_X(geog::geometry) AS lng,
        status, reveal_count AS "revealCount", stood_here AS "stoodHere",
        heart_count AS "heartCount", reply_count AS "replyCount",
        expires_at AS "expiresAt", shareable,
        reveal_condition AS "revealCondition",
        created_at AS "createdAt"
    `;
    return rows[0]!;
  },

  /**
   * Visible, unexpired drops within `radiusMeters` of a point, nearest first,
   * with the requesting device's flags. Excludes anything not `visible`
   * (shadow-removal) and anything past its `expires_at`.
   */
  async nearby(
    deviceId: string,
    point: Coordinate,
    radiusMeters: number,
    limit: number,
  ): Promise<DropRowForDevice[]> {
    return sqlClient<DropRowForDevice[]>`
      SELECT
        ${dropCols},
        ST_Distance(d.geog, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography) AS "distanceMeters",
        ${deviceFlagCols}
      FROM drops d
      ${deviceFlagJoins(deviceId)}
      WHERE d.status = 'visible'
        AND ${notExpired}
        AND ST_DWithin(
          d.geog,
          ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
          ${radiusMeters}
        )
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit}
    `;
  },

  /**
   * A single drop with the device's flags, or undefined.
   *
   * No expiry predicate on purpose: this backs save/heart/report, the reply
   * gate, and the reveal's re-fetch — all of which belong to devices that have
   * already stood there or already saved it. Expiry hides a drop from people
   * who haven't found it yet; it doesn't confiscate one you already hold.
   */
  async findForDevice(
    id: string,
    deviceId: string,
  ): Promise<DropRowForDevice | undefined> {
    const rows = await sqlClient<DropRowForDevice[]>`
      SELECT ${dropCols}, ${deviceFlagCols}
      FROM drops d
      ${deviceFlagJoins(deviceId)}
      WHERE d.id = ${id}
      LIMIT 1
    `;
    return rows[0];
  },

  /**
   * Public metadata for one drop, for the shared-link preview. No device, no
   * body, no flags.
   *
   * The expiry and status predicates are both here and both matter: this is the
   * only read in the repo that answers a caller who has done nothing but hold
   * an id. A `pending` drop under moderation review, one that has faded, and
   * one the author opted out of sharing must all be indistinguishable from one
   * that never existed — hence a single `undefined` for every case, which the
   * service turns into a 404 rather than a 403. A 403 would confirm the drop
   * is real.
   *
   * `shareable` gates the *link*, not the drop: an opted-out drop is still
   * found by walking past it, which is the premise of the app.
   */
  async findPublic(id: string): Promise<DropPreviewRow | undefined> {
    const rows = await sqlClient<DropPreviewRow[]>`
      SELECT
        d.id,
        d.mood,
        d.place_label AS "placeLabel",
        d.city,
        ST_Y(d.geog::geometry) AS lat,
        ST_X(d.geog::geometry) AS lng,
        d.reveal_count AS "revealCount",
        d.expires_at   AS "expiresAt",
        d.created_at   AS "createdAt"
      FROM drops d
      WHERE d.id = ${id}
        AND d.status = 'visible'
        AND d.shareable
        AND ${notExpired}
      LIMIT 1
    `;
    return rows[0];
  },

  /**
   * Server-side gate data for the reveal: metres from the one-shot point to the
   * drop, whether that is within `radiusMeters`, and everything else the reveal
   * must check before unsealing. Computed in Postgres so a spoofed client
   * distance is irrelevant. Undefined if no drop.
   *
   * This is the gate the reveal runs first, so the expiry predicate lives here
   * as well as in `nearby`: without it an expired drop would stay revealable by
   * anyone still holding its id, which is a real leak.
   *
   * It also returns the drop's **own** coordinate alongside its
   * `revealCondition`, so the time gate is evaluated against where the drop is,
   * not where the walker claims to be — one query, and no opportunity to hand
   * the sun the wrong point.
   */
  async revealGate(
    id: string,
    point: Coordinate,
    radiusMeters: number,
  ): Promise<RevealGate | undefined> {
    const rows = await sqlClient<RevealGate[]>`
      SELECT
        ST_Distance(d.geog, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography) AS "distanceMeters",
        ST_DWithin(d.geog, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography, ${radiusMeters}) AS within,
        ST_Y(d.geog::geometry) AS lat,
        ST_X(d.geog::geometry) AS lng,
        d.reveal_condition AS "revealCondition"
      FROM drops d
      WHERE d.id = ${id} AND d.status = 'visible' AND ${notExpired}
      LIMIT 1
    `;
    return rows[0];
  },

  /**
   * Record a reveal for (drop, device). Idempotent: on first reveal it inserts
   * and bumps reveal_count + stood_here; repeat reveals are no-ops. Returns
   * whether this was the first time.
   */
  async recordReveal(id: string, deviceId: string): Promise<boolean> {
    const inserted = await sqlClient`
      INSERT INTO reveals (drop_id, device_id)
      VALUES (${id}, ${deviceId})
      ON CONFLICT (drop_id, device_id) DO NOTHING
      RETURNING drop_id
    `;
    if (inserted.length === 0) return false;
    await sqlClient`
      UPDATE drops
      SET reveal_count = reveal_count + 1, stood_here = stood_here + 1
      WHERE id = ${id}
    `;
    return true;
  },

  /**
   * List a device's drops by relationship, newest first. Returns rows + total.
   *
   * Expired drops are **kept** here: the author must still see their own
   * history (rendered faded, not hidden), and a saved drop stays readable to
   * whoever saved it.
   */
  async trail(
    deviceId: string,
    kind: 'found' | 'saved' | 'dropped',
    limit: number,
    offset: number,
  ): Promise<{ rows: DropRowForDevice[]; total: number }> {
    const joinFilter =
      kind === 'found'
        ? sqlClient`JOIN reveals j ON j.drop_id = d.id AND j.device_id = ${deviceId}`
        : kind === 'saved'
          ? sqlClient`JOIN saves j ON j.drop_id = d.id AND j.device_id = ${deviceId}`
          : sqlClient``;

    const whereFilter =
      kind === 'dropped'
        ? sqlClient`WHERE d.device_id = ${deviceId}`
        : sqlClient`WHERE d.status = 'visible'`;

    // found/saved order by interaction time; dropped by creation time.
    const orderCol =
      kind === 'dropped' ? sqlClient`d.created_at` : sqlClient`j.created_at`;

    const rows = await sqlClient<DropRowForDevice[]>`
      SELECT ${dropCols}, ${deviceFlagCols}
      FROM drops d
      ${joinFilter}
      ${deviceFlagJoins(deviceId)}
      ${whereFilter}
      ORDER BY ${orderCol} DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRows = await sqlClient<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM drops d
      ${joinFilter}
      ${whereFilter}
    `;

    return { rows, total: countRows[0]?.total ?? 0 };
  },

  /** Set a drop's moderation status. */
  async setStatus(id: string, status: DropStatus): Promise<void> {
    await sqlClient`UPDATE drops SET status = ${status} WHERE id = ${id}`;
  },
};
