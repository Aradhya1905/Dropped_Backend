/**
 * echo — the anniversary arithmetic behind "a year ago you stood here".
 *
 * Pure on purpose: date maths is the part of this feature most likely to be
 * subtly wrong (leap days, DST, clock skew), and it is the part that never
 * needs a database to check.
 *
 * An echo fires when something you left, or something you revealed, happened
 * almost exactly a round interval ago — six months, a year, two years — give or
 * take a few days, because a memory that only fires on the exact calendar day
 * is a memory almost nobody is walking past on that day.
 *
 * The windows are exact multiples of 24 h rather than calendar months, matching
 * `domain/expiry`: `created_at` is `timestamptz`, and an interval that shifts by
 * an hour whenever a DST boundary falls inside it would put rows in and out of
 * a window for reasons that have nothing to do with anniversaries. The ±3 day
 * tolerance is two orders of magnitude larger than any of that anyway.
 */

/** The round intervals an echo may celebrate. */
export type EchoInterval = '6mo' | '1yr' | '2yr';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far off the exact anniversary still counts, in days.
 *
 * ±3 gives a week-long window per interval — wide enough that a weekly walking
 * routine will pass the place at least once inside it, narrow enough that "a
 * year ago" is still literally true.
 */
export const ECHO_TOLERANCE_DAYS = 3;

/**
 * Interval → age in days. Six months is 182 days (half of 365) rather than a
 * calendar half-year: with a ±3 day tolerance the difference is noise, and a
 * fixed number keeps every window the same width.
 *
 * Ordered nearest-first, so `intervalFor` reports the closest anniversary when
 * (impossibly, given the gaps below) two ever matched.
 */
const INTERVAL_DAYS: readonly { interval: EchoInterval; days: number }[] = [
  { interval: '6mo', days: 182 },
  { interval: '1yr', days: 365 },
  { interval: '2yr', days: 730 },
];

/** One time range that an event's timestamp must land in to echo. */
export interface EchoWindow {
  interval: EchoInterval;
  /** Inclusive. Oldest instant that still counts as this anniversary. */
  from: Date;
  /** Inclusive. Newest instant that still counts. */
  to: Date;
}

/**
 * The windows to query for, evaluated at `now`. Each is `[now - (days+tol),
 * now - (days-tol)]` — inclusive at both ends, so a SQL `BETWEEN` and
 * {@link intervalFor} agree on the boundary rather than disagreeing by a
 * microsecond.
 *
 * The ranges never overlap (185 < 362, 368 < 727), which is what lets the
 * caller treat "which window did this land in?" as a total function.
 */
export function echoWindows(
  now: Date,
  toleranceDays: number = ECHO_TOLERANCE_DAYS,
): EchoWindow[] {
  const tolerance = toleranceDays * DAY_MS;
  return INTERVAL_DAYS.map(({ interval, days }) => ({
    interval,
    from: new Date(now.getTime() - days * DAY_MS - tolerance),
    to: new Date(now.getTime() - days * DAY_MS + tolerance),
  }));
}

/**
 * Which anniversary `createdAt` is having at `now`, or `null` for none.
 *
 * Two deliberate `null`s beyond "no window matched":
 * - a timestamp in the *future* (a device with a skewed clock, or a row written
 *   by one) — never a negative interval;
 * - anything younger than the shortest window, so a drop left ten minutes ago
 *   can't produce a "0 years ago you stood here".
 */
export function intervalFor(
  createdAt: Date,
  now: Date,
  toleranceDays: number = ECHO_TOLERANCE_DAYS,
): EchoInterval | null {
  const ageMs = now.getTime() - createdAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;

  const tolerance = toleranceDays * DAY_MS;
  for (const { interval, days } of INTERVAL_DAYS) {
    if (Math.abs(ageMs - days * DAY_MS) <= tolerance) return interval;
  }
  return null;
}
