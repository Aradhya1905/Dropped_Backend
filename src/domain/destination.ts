/**
 * destination — forward geodesic step: from a point, go `meters` along a
 * compass bearing. Used to place starter drops around an onboarding device.
 *
 * Kept out of geo.ts on purpose: that file is a verbatim COPY of the client's
 * geo math, and this helper is server-only.
 */
import type { Coordinate } from './clientTypes.js';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * The point `meters` away from `origin` along `bearingDeg` (0 = north,
 * 90 = east), on a spherical Earth — the same model as `haversineMeters`, so
 * the two round-trip exactly.
 */
export function destinationPoint(
  origin: Coordinate,
  bearingDeg: number,
  meters: number,
): Coordinate {
  const delta = meters / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) +
      Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );

  // Normalise longitude to [-180, 180).
  const lng = ((toDeg(lng2) + 540) % 360) - 180;
  return { lat: toDeg(lat2), lng };
}
