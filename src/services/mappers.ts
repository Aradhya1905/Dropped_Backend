/**
 * mappers — DB rows → the client-shaped response (superset of `Secret`/`Drop`).
 *
 * One place owns the wire shape, so field names/casing/ms-epoch are consistent
 * and any drift from the copied client types is a compile error.
 */
import { env } from '../config/env.js';
import type {
  ApiReply,
  ApiSecret,
  DropPreview,
  Mood,
  Whisper,
} from '../domain/clientTypes.js';
import { coarsen } from '../domain/coarsen.js';
import { teaserFrom } from '../domain/teaser.js';
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
  // On the base secret, so it rides along on the SEALED view too. That is the
  // whole point of a time gate being visible: the pin can say "waits for dark"
  // before the walk, which is *when* it opens, never *what* it says.
  ...(row.revealCondition ? { revealCondition: row.revealCondition } : {}),
});

/**
 * Sealed view: body withheld. Used by nearby (pre-reveal).
 *
 * `whisper` is passed in rather than derived here so this stays the one place
 * that owns the sealed wire shape: a caller that has no distance (and so no
 * business whispering) simply can't produce one.
 */
export function toSealedSecret(
  row: DropRowForDevice,
  whisper?: Whisper,
): ApiSecret {
  return {
    ...baseSecret(row),
    sealed: true,
    ...(row.distanceMeters !== undefined
      ? { distanceMeters: Math.round(row.distanceMeters) }
      : {}),
    ...(whisper ? { whisper } : {}),
  };
}

/**
 * The whisper for a sealed nearby row, or `undefined`.
 *
 * Three gates, all of which must hold:
 * - the row is inside the whisper band, by the server's own `ST_Distance` —
 *   never a distance the client claimed;
 * - the row is `visible` — a `pending` drop under moderation review must not
 *   leak even 18 characters, so this is asserted here as well as in the SQL;
 * - the device hasn't already revealed it, in which case it gets the body.
 */
function whisperFor(row: DropRowForDevice): Whisper | undefined {
  if (row.revealed) return undefined;
  if (row.status !== 'visible') return undefined;
  if (row.distanceMeters === undefined) return undefined;
  if (row.distanceMeters > env.WHISPER_RADIUS_M) return undefined;

  return {
    mood: row.mood as Mood,
    teaser: teaserFrom(row.body, env.WHISPER_TEASER_CHARS),
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
 *
 * Sealed rows inside the whisper band also carry a teaser. `toUnsealedSecret`
 * is deliberately left alone — the body is already there on that path, so a
 * whisper would be redundant and would risk someone wiring a teaser into a
 * response that also carries the full text.
 */
export function toNearbySecret(row: DropRowForDevice): ApiSecret {
  return row.revealed
    ? toUnsealedSecret(row)
    : toSealedSecret(row, whisperFor(row));
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
