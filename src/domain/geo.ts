/**
 * geo — COPY of the client's geo math.
 *
 * Source of truth: C:\My_Projects\Dropped\src\utils\geo.ts
 * Keep in sync. PostGIS `ST_DWithin` is the PRIMARY reveal check on the server;
 * this haversine is the test oracle that proves PostGIS and the client agree at
 * the 50 m boundary, and a dependency-free fallback if ever needed off-DB.
 */
import type { Coordinate } from './clientTypes.js';
import { REVEAL_RADIUS_M } from './clientTypes.js';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates, in meters (haversine).
 * Heart of the app: drives "how far to the secret" and the reveal unlock.
 */
export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** True when `a` is within `meters` of `b` (default = the 50 m reveal radius). */
export function isWithin(
  a: Coordinate,
  b: Coordinate,
  meters: number = REVEAL_RADIUS_M,
): boolean {
  return haversineMeters(a, b) <= meters;
}
