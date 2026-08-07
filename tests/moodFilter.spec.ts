/**
 * moodFilter.spec — parsing of the `?mood=` nearby filter.
 *
 * Pure schema tests: no DB, no app. The one that matters is the absent case —
 * "all moods" and "no moods" are opposite answers, and a schema that collapses
 * absent into `[]` hands the map an empty world.
 */
import { describe, expect, it } from 'vitest';

import { nearbyQuery } from '../src/schemas/drop.schema.js';

const at = { lat: '12.97', lng: '77.59' };

describe('nearbyQuery mood filter', () => {
  it('parses a comma-separated list', () => {
    const parsed = nearbyQuery.parse({ ...at, mood: 'joy,wonder' });
    expect(parsed.mood).toEqual(['joy', 'wonder']);
  });

  it('parses a single mood', () => {
    expect(nearbyQuery.parse({ ...at, mood: 'ache' }).mood).toEqual(['ache']);
  });

  it('tolerates whitespace around the commas', () => {
    expect(nearbyQuery.parse({ ...at, mood: 'joy, trouble ' }).mood).toEqual([
      'joy',
      'trouble',
    ]);
  });

  it('leaves an absent filter undefined, not an empty array', () => {
    expect(nearbyQuery.parse(at).mood).toBeUndefined();
  });

  it('rejects an unknown mood', () => {
    expect(() => nearbyQuery.parse({ ...at, mood: 'joy,nonsense' })).toThrow();
  });

  it('rejects an empty string rather than reading it as "none"', () => {
    expect(() => nearbyQuery.parse({ ...at, mood: '' })).toThrow();
  });

  it('rejects more moods than exist', () => {
    expect(() =>
      nearbyQuery.parse({ ...at, mood: 'joy,ache,trouble,wonder,joy' }),
    ).toThrow();
  });

  it('still parses lat/lng and radius alongside the filter', () => {
    const parsed = nearbyQuery.parse({ ...at, radiusMeters: '800', mood: 'joy' });
    expect(parsed.lat).toBeCloseTo(12.97);
    expect(parsed.radiusMeters).toBe(800);
  });
});
