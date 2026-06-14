/**
 * geo.spec — the copied haversine must agree with the client's, and the 50 m
 * boundary must be exact. This is the oracle the reveal check is judged against.
 */
import { describe, expect, it } from 'vitest';

import { haversineMeters, isWithin } from '../src/domain/geo.js';
import { REVEAL_RADIUS_M } from '../src/domain/clientTypes.js';

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    const p = { lat: 12.9756, lng: 77.6094 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it('matches the client fixture (~70 m on MG Road, Bengaluru)', () => {
    // Same fixture the client uses in src/utils/geo.test.ts.
    const a = { lat: 12.9756, lng: 77.6094 };
    const b = { lat: 12.9759, lng: 77.61 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(100);
  });

  it('is symmetric', () => {
    const a = { lat: 40.0, lng: -74.0 };
    const b = { lat: 40.001, lng: -74.001 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('isWithin (the reveal rule)', () => {
  const origin = { lat: 12.9756, lng: 77.6094 };

  it('defaults to the 50 m reveal radius', () => {
    expect(isWithin(origin, origin)).toBe(true);
  });

  it('is inclusive at the boundary', () => {
    // A point ~49 m north is inside; ~51 m north is outside.
    // ~0.00001 deg latitude ≈ 1.11 m, so 49 m ≈ 0.000441 deg.
    const near = { lat: origin.lat + 0.00044, lng: origin.lng };
    const far = { lat: origin.lat + 0.00046, lng: origin.lng };
    expect(haversineMeters(origin, near)).toBeLessThanOrEqual(REVEAL_RADIUS_M);
    expect(haversineMeters(origin, far)).toBeGreaterThan(REVEAL_RADIUS_M);
    expect(isWithin(origin, near)).toBe(true);
    expect(isWithin(origin, far)).toBe(false);
  });

  it('honours a custom radius', () => {
    const a = { lat: 12.9756, lng: 77.6094 };
    const b = { lat: 12.9759, lng: 77.61 };
    expect(isWithin(a, b, 50)).toBe(false);
    expect(isWithin(a, b, 200)).toBe(true);
  });
});
