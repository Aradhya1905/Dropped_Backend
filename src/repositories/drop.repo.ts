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
import type { Coordinate } from '../domain/clientTypes.js';
import type { DropStatus } from '../db/schema.js';

/** A drop as the repo returns it (coordinate already split out of geography). */
export interface DropRow {
  id: string;
  deviceId: string;
  body: string;
  mood: string;
  placeLabel: string | null;
  lat: number;
  lng: number;
  status: DropStatus;
  revealCount: number;
  stoodHere: number;
  heartCount: number;
  /** postgres.js returns timestamps as strings; mappers coerce to ms epoch. */
  createdAt: Date | string;
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
  coordinate: Coordinate;
  status: DropStatus;
}

/** Round to 5 dp (~1 m) so we never store the author's exact GPS fix. */
const snap = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Drop columns (geography split into lat/lng). postgres.js fragment. */
const dropCols = sqlClient`
  d.id,
  d.device_id        AS "deviceId",
  d.body,
  d.mood,
  d.place_label      AS "placeLabel",
  ST_Y(d.geog::geometry) AS lat,
  ST_X(d.geog::geometry) AS lng,
  d.status,
  d.reveal_count     AS "revealCount",
  d.stood_here       AS "stoodHere",
  d.heart_count      AS "heartCount",
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
      INSERT INTO drops (device_id, body, mood, place_label, geog, status)
      VALUES (
        ${input.deviceId},
        ${input.body},
        ${input.mood},
        ${input.placeLabel},
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${input.status}
      )
      RETURNING
        id, device_id AS "deviceId", body, mood, place_label AS "placeLabel",
        ST_Y(geog::geometry) AS lat, ST_X(geog::geometry) AS lng,
        status, reveal_count AS "revealCount", stood_here AS "stoodHere",
        heart_count AS "heartCount", created_at AS "createdAt"
    `;
    return rows[0]!;
  },

  /**
   * Visible drops within `radiusMeters` of a point, nearest first, with the
   * requesting device's flags. Excludes anything not `visible` (shadow-removal).
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
        AND ST_DWithin(
          d.geog,
          ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
          ${radiusMeters}
        )
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit}
    `;
  },

  /** A single drop with the device's flags, or undefined. */
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
   * Server-side distance check for the reveal. Returns metres from the one-shot
   * point to the drop, and whether it's within `radiusMeters` — computed in
   * Postgres so a spoofed client distance is irrelevant. Undefined if no drop.
   */
  async distanceFrom(
    id: string,
    point: Coordinate,
    radiusMeters: number,
  ): Promise<{ distanceMeters: number; within: boolean } | undefined> {
    const rows = await sqlClient<{ distanceMeters: number; within: boolean }[]>`
      SELECT
        ST_Distance(geog, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography) AS "distanceMeters",
        ST_DWithin(geog, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography, ${radiusMeters}) AS within
      FROM drops
      WHERE id = ${id} AND status = 'visible'
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

  /** List a device's drops by relationship, newest first. Returns rows + total. */
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
