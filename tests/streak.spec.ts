/**
 * streak.spec — the Trail streak counts consecutive UTC days with a reveal OR
 * drop, ending today or yesterday. A gap of two or more days breaks it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeStreak } from '../src/services/device.service.js';

/** 'YYYY-MM-DD' for `daysAgo` days before a fixed UTC "now". */
const NOW = Date.UTC(2026, 5, 18, 9, 30); // 2026-06-18T09:30Z
const MS_PER_DAY = 86_400_000;
const ago = (days: number): string =>
  new Date(NOW - days * MS_PER_DAY).toISOString().slice(0, 10);

describe('computeStreak', () => {
  afterEach(() => vi.useRealTimers());

  const freezeNow = () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  };

  it('returns 0 with no activity', () => {
    freezeNow();
    expect(computeStreak([])).toBe(0);
  });

  it('counts a run ending today', () => {
    freezeNow();
    expect(computeStreak([ago(0), ago(1), ago(2)])).toBe(3);
  });

  it('counts a run ending yesterday (grace day)', () => {
    freezeNow();
    expect(computeStreak([ago(1), ago(2)])).toBe(2);
  });

  it('breaks when the latest activity is older than yesterday', () => {
    freezeNow();
    expect(computeStreak([ago(2), ago(3)])).toBe(0);
  });

  it('stops at the first gap', () => {
    freezeNow();
    // today, yesterday, then a 2-day gap before more activity
    expect(computeStreak([ago(0), ago(1), ago(4), ago(5)])).toBe(2);
  });

  it('is robust to duplicate dates', () => {
    freezeNow();
    expect(computeStreak([ago(0), ago(0), ago(1)])).toBe(2);
  });
});
