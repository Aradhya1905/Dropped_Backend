/**
 * mappers — DB rows → the client-shaped response (superset of `Secret`/`Drop`).
 *
 * One place owns the wire shape, so field names/casing/ms-epoch are consistent
 * and any drift from the copied client types is a compile error.
 */
import type { ApiSecret, Mood } from '../domain/clientTypes.js';
import type { DropRow, DropRowForDevice } from '../repositories/drop.repo.js';

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
  saved: row.saved,
  hearted: row.hearted,
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
