/**
 * coarsen — blunt a coordinate before it leaves the server on a shareable link.
 *
 * A share link is forwardable: it can end up in a group chat, screenshotted, or
 * indexed. An *exact* coordinate attached to a confession is the worst-case
 * privacy failure this app has, so the public preview endpoint never emits the
 * stored point. ~3 decimal places (≈100 m) is deliberately coarser than the
 * 50 m reveal radius: the link says "there is something around here", and the
 * last hundred metres still have to be walked.
 *
 * Pure and dependency-free so the guarantee is unit-testable without a database.
 */
import type { Coordinate } from './clientTypes.js';

/** Decimal places kept. 3 dp ≈ 110 m of latitude. */
export const COARSEN_DP = 3;

const FACTOR = 10 ** COARSEN_DP;

/**
 * Round half **away from zero**, so the magnitude of the shift is identical for
 * a coordinate and its mirror. Plain `Math.round` breaks ties towards +∞, which
 * biases southern latitudes and western longitudes one way — over many shares
 * that bias is itself a (small) signal about the true point.
 *
 * `+ 0` normalizes the `-0` that `-1 * 0` produces, so coarsened values compare
 * and serialize as plain zeroes.
 */
function roundHalfAwayFromZero(n: number): number {
  const rounded = Math.round(Math.abs(n) * FACTOR) / FACTOR;
  return (n < 0 ? -rounded : rounded) + 0;
}

/**
 * Coarsen a coordinate to {@link COARSEN_DP} decimal places.
 *
 * Idempotent: coarsening an already-coarsened point is a no-op, so it is safe
 * to apply defensively at more than one layer.
 */
export function coarsen(c: Coordinate): Coordinate {
  return {
    lat: roundHalfAwayFromZero(c.lat),
    lng: roundHalfAwayFromZero(c.lng),
  };
}
