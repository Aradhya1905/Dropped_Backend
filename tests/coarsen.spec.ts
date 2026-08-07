/**
 * coarsen.spec — the deanonymisation guard on the public preview endpoint.
 *
 * These assertions are the feature's real security boundary: a share link is
 * forwardable, so if `coarsen` ever stops blunting the point, an exact
 * confession location leaks into whatever group chat the link lands in. Pure,
 * no database — the guarantee should be provable without one.
 */
import { describe, expect, it } from 'vitest';

import { COARSEN_DP, coarsen } from '../src/domain/coarsen.js';
import { haversineMeters } from '../src/domain/geo.js';

/** Decimal places in a number's shortest round-trip representation. */
const dp = (n: number): number => String(n).split('.')[1]?.length ?? 0;

/** A sweep that crosses the equator, the prime meridian, and both poles-ish. */
const SWEEP = [
  { lat: 12.975612, lng: 77.609421 }, // Bengaluru, MG Road
  { lat: -33.868821, lng: 151.209296 }, // Sydney
  { lat: 40.712776, lng: -74.005974 }, // New York
  { lat: -12.345678, lng: -40.987654 }, // southern + western
  { lat: 0.000499, lng: -0.000499 }, // straddling zero, both signs
  { lat: 89.999999, lng: 179.999999 }, // extremes
  { lat: -89.999999, lng: -179.999999 },
  { lat: 0, lng: 0 },
];

describe('coarsen', () => {
  it('never returns more than 3 decimal places', () => {
    for (const c of SWEEP) {
      const out = coarsen(c);
      expect(dp(out.lat), `lat of ${JSON.stringify(c)}`).toBeLessThanOrEqual(
        COARSEN_DP,
      );
      expect(dp(out.lng), `lng of ${JSON.stringify(c)}`).toBeLessThanOrEqual(
        COARSEN_DP,
      );
    }
  });

  it('shifts a coordinate and its mirror by the same magnitude', () => {
    // Plain Math.round breaks ties towards +∞, which would move a southern
    // latitude further than its northern twin. Over many shares that asymmetry
    // is itself a hint about the true point.
    for (const c of SWEEP) {
      const pos = coarsen({ lat: Math.abs(c.lat), lng: Math.abs(c.lng) });
      const neg = coarsen({ lat: -Math.abs(c.lat), lng: -Math.abs(c.lng) });
      // Summed rather than negated: at the origin `-pos.lat` is -0, which is
      // exactly the value coarsen normalizes away.
      expect(neg.lat + pos.lat, `lat of ${JSON.stringify(c)}`).toBe(0);
      expect(neg.lng + pos.lng, `lng of ${JSON.stringify(c)}`).toBe(0);
    }
  });

  it('never moves a point further than ~110 m', () => {
    // 3 dp of latitude is ~111 m; the diagonal worst case is half a cell each
    // way. Anything beyond this and the "walk the last stretch" promise breaks
    // in the other direction — the link would point at the wrong block.
    for (const c of SWEEP) {
      expect(haversineMeters(c, coarsen(c)), JSON.stringify(c)).toBeLessThan(
        110,
      );
    }
  });

  it('is idempotent', () => {
    for (const c of SWEEP) {
      expect(coarsen(coarsen(c))).toEqual(coarsen(c));
    }
  });

  it('does not emit negative zero', () => {
    // -0 round-trips through JSON as 0 anyway, but it breaks toEqual against a
    // freshly coarsened point, which would make the idempotence check lie.
    const out = coarsen({ lat: -0.0001, lng: -0.0004 });
    expect(Object.is(out.lat, -0)).toBe(false);
    expect(Object.is(out.lng, -0)).toBe(false);
  });

  it('actually loses precision — the exact point is not recoverable', () => {
    const exact = { lat: 12.975612, lng: 77.609421 };
    const out = coarsen(exact);
    expect(out.lat).not.toBe(exact.lat);
    expect(out.lng).not.toBe(exact.lng);
  });
});
