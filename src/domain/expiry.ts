/**
 * expiry — the lifespan arithmetic for expiring drops, kept pure so it is
 * testable without a database.
 *
 * A drop lives 7 days, 30 days, or forever. Forever is `null`, which is also
 * what every row predating this feature carries, so "no expiry" needs no
 * backfill.
 *
 * The windows are exact multiples of 24 h, not calendar days: the column is
 * `timestamptz`, and "7 days" should mean 168 hours everywhere on earth rather
 * than shifting an hour whenever a DST boundary falls inside the window.
 *
 * **Filtering still happens in SQL against `now()`**, so Postgres is the single
 * clock. These helpers only compose an expiry at create time and answer
 * display-side questions.
 */

/** The lifespans an author may choose. Absent/undefined means forever. */
export type ExpiresInDays = 7 | 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant a drop created at `createdAt` should stop being findable, or
 * `null` for a drop that never expires.
 */
export function expiresAtFrom(
  createdAt: Date,
  days?: ExpiresInDays,
): Date | null {
  if (days === undefined) return null;
  return new Date(createdAt.getTime() + days * DAY_MS);
}

/**
 * Whether a drop is expired at `now`. A `null` expiry is never expired.
 *
 * The boundary instant counts as **already expired**, because the SQL keeps a
 * row only while `expires_at > now()` — at exactly `expires_at` that predicate
 * is false and the drop is gone from `nearby`. So this uses `>=`, not `>`; the
 * two must not disagree, or the UI would still promise "fades in 0 days" for a
 * drop the server has already stopped serving.
 */
export function isExpired(now: Date, expiresAt: Date | null): boolean {
  if (expiresAt === null) return false;
  return now.getTime() >= expiresAt.getTime();
}
