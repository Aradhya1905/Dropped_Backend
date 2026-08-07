/**
 * solar — where the sun is, for a coordinate, at an instant. Pure arithmetic,
 * no database and no network.
 *
 * This exists so a drop can be gated on "after dark" or "daytime only" without
 * ever consulting a timezone database or a client's clock. **Everything here is
 * computed in UTC from the coordinate's own longitude**, which sidesteps
 * timezones and DST entirely: the sun does not observe daylight saving. A drop
 * in London opens at the same *instant* whether or not the UK is on BST; only
 * the wall-clock name of that instant changes, and we never look at wall clocks.
 *
 * Two different jobs, deliberately answered two different ways:
 *
 * - **`isNightAt` (the gate)** compares the sun's actual altitude to the
 *   horizon. There is no day-boundary ambiguity to get wrong, and the polar
 *   cases need no special-casing — at Tromsø in June the altitude simply never
 *   drops below the horizon, so it is never night.
 * - **`sunTimes` / `nextOpensAt` (the copy)** solve for the crossing instants,
 *   because "come back after sunset — about 4 hours" needs a time, not a
 *   boolean. These *can* fail to have an answer (polar day/night), and say so
 *   with `null` rather than inventing one.
 *
 * Both use the same horizon constant, so they can never disagree about whether
 * a given instant is night.
 *
 * Accuracy is ~1 minute on the crossing times — far finer than a feature whose
 * unit of meaning is "after dark" requires.
 *
 * Algorithm: the standard low-precision solar position series (Meeus, as
 * popularised by NOAA and SunCalc).
 */

/** The lifespan of one condition an author may attach to a drop. */
export type RevealCondition = 'night' | 'day';

export const REVEAL_CONDITIONS: readonly RevealCondition[] = ['night', 'day'];

/**
 * The altitude we call sunrise/sunset: the sun's upper limb touching the
 * horizon, allowing for atmospheric refraction. This is the civil definition
 * every almanac prints, not civil twilight — "after dark" starting at sunset is
 * what someone standing outside would call it.
 */
export const HORIZON_DEG = -0.833;

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Julian date of the J2000.0 epoch. */
const J2000 = 2_451_545.0;
/** Julian date of the Unix epoch (1970-01-01T00:00:00Z). */
const UNIX_EPOCH_JD = 2_440_587.5;
/** Mean obliquity of the ecliptic, degrees. */
const OBLIQUITY_DEG = 23.4397;
/**
 * Leap-second/ΔT fudge (69.184 s in days) that shifts our "day number" onto
 * Terrestrial Time. Sub-minute, but it is free.
 */
const J0 = 0.0009;

const toJulian = (date: Date): number => date.getTime() / DAY_MS + UNIX_EPOCH_JD;
const fromJulian = (jd: number): Date =>
  new Date((jd - UNIX_EPOCH_JD) * DAY_MS);

/** Days since J2000.0. */
const daysSinceJ2000 = (date: Date): number => toJulian(date) - J2000;

const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;
const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

/** Solar mean anomaly, degrees, from days since J2000. */
const meanAnomaly = (d: number): number => norm360(357.5291 + 0.98560028 * d);

/** Equation of the centre, degrees — the orbit's eccentricity correction. */
function equationOfCentre(mDeg: number): number {
  const m = mDeg * DEG;
  return (
    1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)
  );
}

/** Apparent ecliptic longitude of the sun, degrees. */
const eclipticLongitude = (mDeg: number): number =>
  norm360(mDeg + equationOfCentre(mDeg) + 282.9372);

/** Solar declination, degrees. */
const declination = (lambdaDeg: number): number =>
  Math.asin(
    clamp(
      Math.sin(lambdaDeg * DEG) * Math.sin(OBLIQUITY_DEG * DEG),
      -1,
      1,
    ),
  ) / DEG;

/** Solar right ascension, degrees. */
const rightAscension = (lambdaDeg: number): number =>
  Math.atan2(
    Math.sin(lambdaDeg * DEG) * Math.cos(OBLIQUITY_DEG * DEG),
    Math.cos(lambdaDeg * DEG),
  ) / DEG;

/**
 * The sun's altitude above the horizon, in degrees, at `when` as seen from
 * (`lat`, `lng`). Negative means below the horizon.
 *
 * This is the gate's primitive. It answers for one instant and one point with
 * no notion of "which day" involved, which is exactly what makes it safe near
 * the international date line and inside the polar circles.
 */
export function solarAltitudeDeg(
  when: Date,
  lat: number,
  lng: number,
): number {
  const d = daysSinceJ2000(when);
  const m = meanAnomaly(d);
  const lambda = eclipticLongitude(m);
  const dec = declination(lambda) * DEG;
  // Local sidereal time, degrees east-positive; minus RA gives the hour angle.
  const hourAngle =
    (norm360(280.147 + 360.9856235 * d + lng) - rightAscension(lambda)) * DEG;
  const phi = lat * DEG;

  const sinAltitude =
    Math.sin(phi) * Math.sin(dec) +
    Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(clamp(sinAltitude, -1, 1)) / DEG;
}

/**
 * Whether it is night at (`lat`, `lng`) at the instant `when` — i.e. the sun is
 * below the horizon.
 *
 * Degrades correctly at the poles without a special case: during the polar
 * summer the altitude never goes negative, so this is `false` all "night"; during
 * the polar winter it is `true` all "day". No sentinels, no `NaN`.
 */
export const isNightAt = (when: Date, lat: number, lng: number): boolean =>
  solarAltitudeDeg(when, lat, lng) < HORIZON_DEG;

/**
 * Sunrise and sunset for the solar day containing `date` at (`lat`, `lng`).
 *
 * `null` means the sun does not cross the horizon on that day at that latitude
 * — polar day or polar night. Callers must handle it; the alternative is
 * printing a `NaN` timestamp inside "come back after sunset".
 */
export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
}

export function sunTimes(date: Date, lat: number, lng: number): SunTimes {
  // Day number of the solar day at this longitude, so a point at lng 179 gets
  // its own local day rather than Greenwich's.
  const n = Math.round(daysSinceJ2000(date) - J0 + lng / 360);
  const approxTransit = n + J0 - lng / 360;

  const m = meanAnomaly(approxTransit);
  const lambda = eclipticLongitude(m);
  const transit =
    J2000 +
    approxTransit +
    0.0053 * Math.sin(m * DEG) -
    0.0069 * Math.sin(2 * lambda * DEG);

  const dec = declination(lambda) * DEG;
  const phi = lat * DEG;
  const cosHourAngle =
    (Math.sin(HORIZON_DEG * DEG) - Math.sin(phi) * Math.sin(dec)) /
    (Math.cos(phi) * Math.cos(dec));

  // |cos| > 1 has no solution: the sun stays up all day, or never comes up.
  if (!Number.isFinite(cosHourAngle) || Math.abs(cosHourAngle) > 1) {
    return { sunrise: null, sunset: null };
  }

  const hourAngleDays = Math.acos(cosHourAngle) / DEG / 360;
  return {
    sunrise: fromJulian(transit - hourAngleDays),
    sunset: fromJulian(transit + hourAngleDays),
  };
}

/**
 * Whether a drop's condition holds at `when`, for a drop at (`lat`, `lng`).
 *
 * The short-circuit on `null` is the most important line in this file: a drop
 * with no condition — the overwhelming majority — is byte-for-byte unaffected
 * by this feature, and reverting the one call site in reveal.service restores
 * the old behaviour completely even with the column still in place.
 *
 * Lives here rather than in the service so it is testable without a database,
 * the same way `domain/expiry.isExpired` sits apart from the SQL that enforces
 * expiry.
 */
export function conditionMet(
  condition: RevealCondition | null,
  when: Date,
  lat: number,
  lng: number,
): boolean {
  if (condition === null) return true;
  const night = isNightAt(when, lat, lng);
  return condition === 'night' ? night : !night;
}

/**
 * How many days ahead `nextOpensAt` will look before giving up. A year covers
 * every latitude that has a sunrise at all; beyond that the honest answer is
 * "not for months", which the caller renders as no time at all.
 */
const OPENS_SEARCH_DAYS = 400;

/**
 * The next instant at or after `when` when `condition` starts to hold at
 * (`lat`, `lng`), or `null` if it does not within the search horizon.
 *
 * Used only for the message ("come back after sunset"), never for the gate —
 * the gate is `isNightAt`, evaluated fresh at reveal time.
 */
export function nextOpensAt(
  condition: RevealCondition,
  when: Date,
  lat: number,
  lng: number,
): Date | null {
  for (let dayOffset = 0; dayOffset <= OPENS_SEARCH_DAYS; dayOffset += 1) {
    const probe = new Date(when.getTime() + dayOffset * DAY_MS);
    const { sunrise, sunset } = sunTimes(probe, lat, lng);
    const candidate = condition === 'night' ? sunset : sunrise;
    if (candidate && candidate.getTime() > when.getTime()) {
      return candidate;
    }
  }
  return null;
}
