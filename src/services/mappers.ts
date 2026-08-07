/**
 * mappers — DB rows → the client-shaped response (superset of `Secret`/`Drop`).
 *
 * One place owns the wire shape, so field names/casing/ms-epoch are consistent
 * and any drift from the copied client types is a compile error.
 */
import type {
  ApiReply,
  ApiSecret,
  DropPreview,
  Mood,
} from '../domain/clientTypes.js';
import { coarsen } from '../domain/coarsen.js';
import type {
  DropPreviewRow,
  DropRow,
  DropRowForDevice,
} from '../repositories/drop.repo.js';
import type { ReplyRow } from '../repositories/reply.repo.js';

/**
 * Coerce a timestamp to ms epoch. Raw postgres.js queries hand back timestamps
 * as strings (not Drizzle-parsed Dates), so normalize defensively.
 */
function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/** Build the nested client `Drop` from a row. */
function toDrop(row: DropRow) {
  return {
    id: row.id,
    coordinate: { lat: Number(row.lat), lng: Number(row.lng) },
    ...(row.placeLabel ? { placeLabel: row.placeLabel } : {}),
    createdAt: toEpochMs(row.createdAt),
  };
}

const baseSecret = (row: DropRowForDevice) => ({
  id: row.id,
  drop: toDrop(row),
  createdAt: toEpochMs(row.createdAt),
  revealCount: Number(row.revealCount),
  mood: row.mood as Mood,
  hearts: Number(row.heartCount),
  stoodHere: Number(row.stoodHere),
  replyCount: Number(row.replyCount ?? 0),
  saved: row.saved,
  hearted: row.hearted,
  shareable: row.shareable,
  // Omitted entirely when the drop is forever, so the client can treat
  // "absent" as "no countdown" without a sentinel value.
  ...(row.expiresAt ? { expiresAt: toEpochMs(row.expiresAt) } : {}),
});

/** Sealed view: body withheld. Used by nearby (pre-reveal). */
export function toSealedSecret(row: DropRowForDevice): ApiSecret {
  return {
    ...baseSecret(row),
    sealed: true,
    ...(row.distanceMeters !== undefined
      ? { distanceMeters: Math.round(row.distanceMeters) }
      : {}),
  };
}

/** Unsealed view: body included. Used after a verified reveal and on trails. */
export function toUnsealedSecret(row: DropRowForDevice): ApiSecret {
  return {
    ...baseSecret(row),
    body: row.body,
    sealed: false,
    ...(row.distanceMeters !== undefined
      ? { distanceMeters: Math.round(row.distanceMeters) }
      : {}),
  };
}

/**
 * For nearby: seal everything the device hasn't already revealed; show the body
 * for ones it has (so a re-open in range stays readable without a round-trip).
 */
export function toNearbySecret(row: DropRowForDevice): ApiSecret {
  return row.revealed ? toUnsealedSecret(row) : toSealedSecret(row);
}

/**
 * Public view of a spot, for a shared link. The row it takes carries no body at
 * all (see `DropPreviewRow`), and the coordinate is coarsened **here**, on the
 * server — the client is never handed the exact point and asked to round it.
 */
export function toDropPreview(row: DropPreviewRow): DropPreview {
  return {
    id: row.id,
    coordinate: coarsen({ lat: Number(row.lat), lng: Number(row.lng) }),
    ...(row.placeLabel ? { placeLabel: row.placeLabel } : {}),
    ...(row.city ? { city: row.city } : {}),
    mood: row.mood as Mood,
    createdAt: toEpochMs(row.createdAt),
    revealCount: Number(row.revealCount),
    ...(row.expiresAt ? { expiresAt: toEpochMs(row.expiresAt) } : {}),
  };
}

/**
 * A reply on the wire. **`deviceId` is deliberately absent** — authorship never
 * leaves the server, so the anonymity promise is unambiguous. `mine` is derived
 * against the requesting device only, so it tells that device which reply it
 * may delete without telling it anything about anyone else's.
 */
export function toApiReply(row: ReplyRow, requestingDeviceId: string): ApiReply {
  return {
    id: row.id,
    body: row.body,
    createdAt: toEpochMs(row.createdAt),
    mine: row.deviceId === requestingDeviceId,
  };
}
