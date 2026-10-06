/**
 * starterPlan.spec — pure placement/text logic for starter drops (no DB).
 */
import { describe, expect, it } from 'vitest';

import { MAX_BODY_LENGTH, MOODS } from '../src/domain/clientTypes.js';
import { destinationPoint } from '../src/domain/destination.js';
import { haversineMeters } from '../src/domain/geo.js';
import { STARTER_POOL } from '../src/domain/starterPool.js';
import { RINGS, pickTexts, planStarters } from '../src/services/starter.service.js';

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORIGIN = { lat: 12.9756, lng: 77.6094 };

describe('destinationPoint', () => {
  it('round-trips with haversine at several bearings and distances', () => {
    for (const bearing of [0, 45, 90, 180, 270, 359]) {
      for (const meters of [10, 250, 600, 5000]) {
        const p = destinationPoint(ORIGIN, bearing, meters);
        expect(haversineMeters(ORIGIN, p)).toBeCloseTo(meters, 3);
      }
    }
  });

  it('goes north for bearing 0 and east for bearing 90', () => {
    const north = destinationPoint(ORIGIN, 0, 100);
    expect(north.lat).toBeGreaterThan(ORIGIN.lat);
    expect(north.lng).toBeCloseTo(ORIGIN.lng, 9);

    const east = destinationPoint(ORIGIN, 90, 100);
    expect(east.lng).toBeGreaterThan(ORIGIN.lng);
  });

  it('wraps longitude across the antimeridian', () => {
    const p = destinationPoint({ lat: 0, lng: 179.9999 }, 90, 1000);
    expect(p.lng).toBeLessThan(-179);
  });
});

describe('starter text pool', () => {
  it('fits the body limit and uses only known moods', () => {
    for (const t of STARTER_POOL) {
      expect(t.body.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
      expect(MOODS).toContain(t.mood);
    }
  });

  it('picks distinct texts with distinct moods when possible', () => {
    for (let s = 1; s <= 50; s++) {
      const picked = pickTexts(3, seeded(s));
      expect(new Set(picked).size).toBe(3);
      expect(new Set(picked.map(t => t.mood)).size).toBe(3);
    }
  });

  it('falls back to repeated moods when the pool runs short of them', () => {
    const pool = [
      { body: 'a', mood: 'joy' as const },
      { body: 'b', mood: 'joy' as const },
      { body: 'c', mood: 'joy' as const },
    ];
    expect(pickTexts(3, seeded(7), pool)).toHaveLength(3);
  });
});

describe('planStarters', () => {
  it('places one drop inside each ring', () => {
    for (let s = 1; s <= 50; s++) {
      const plan = planStarters(ORIGIN, seeded(s), 0);
      expect(plan).toHaveLength(RINGS.length);
      plan.forEach((d, i) => {
        const dist = haversineMeters(ORIGIN, d.coordinate);
        expect(dist).toBeGreaterThanOrEqual(RINGS[i]!.min - 0.01);
        expect(dist).toBeLessThanOrEqual(RINGS[i]!.max + 0.01);
      });
    }
  });

  it('keeps the near drop inside the 50 m reveal radius', () => {
    for (let s = 1; s <= 50; s++) {
      const [near] = planStarters(ORIGIN, seeded(s), 0);
      expect(haversineMeters(ORIGIN, near!.coordinate)).toBeLessThan(50);
    }
  });

  it('labels every drop as a starter and sets an expiry in the future', () => {
    const now = Date.UTC(2026, 9, 6);
    for (const d of planStarters(ORIGIN, seeded(3), now)) {
      expect(d.placeLabel).toBe('A starter drop');
      expect(d.expiresAt.getTime()).toBeGreaterThan(now);
    }
  });
});
