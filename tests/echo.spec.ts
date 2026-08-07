/**
 * echo.spec — the anniversary arithmetic.
 *
 * Pure: no DB, no app. The selection itself is SQL, so what's worth pinning
 * down here is that the windows are where they claim to be, that they agree
 * with `intervalFor` on their own boundaries (the SQL uses BETWEEN, which is
 * inclusive at both ends — so this must be too), and that the three ways date
 * maths goes wrong in production all return `null` rather than a wrong memory.
 */
import { describe, expect, it } from 'vitest';

import {
  ECHO_TOLERANCE_DAYS,
  echoWindows,
  intervalFor,
} from '../src/domain/echo.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-07T12:00:00.000Z');

/** A timestamp exactly `days` before NOW. */
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('intervalFor', () => {
  it('names the one-year anniversary at exactly 365 days', () => {
    expect(intervalFor(daysAgo(365), NOW)).toBe('1yr');
  });

  it('still fires at the edges of the ±3 day tolerance', () => {
    expect(intervalFor(daysAgo(362), NOW)).toBe('1yr');
    expect(intervalFor(daysAgo(368), NOW)).toBe('1yr');
  });

  it('says nothing outside it', () => {
    // A year and a week ago is not "a year ago", and the whole feature rests
    // on the claim being literally true.
    expect(intervalFor(daysAgo(358), NOW)).toBeNull();
    expect(intervalFor(daysAgo(372), NOW)).toBeNull();
  });

  it('names six months at 182 days ± 3', () => {
    expect(intervalFor(daysAgo(182), NOW)).toBe('6mo');
    expect(intervalFor(daysAgo(179), NOW)).toBe('6mo');
    expect(intervalFor(daysAgo(185), NOW)).toBe('6mo');
    expect(intervalFor(daysAgo(175), NOW)).toBeNull();
  });

  it('names two years at 730 days ± 3', () => {
    expect(intervalFor(daysAgo(730), NOW)).toBe('2yr');
    expect(intervalFor(daysAgo(727), NOW)).toBe('2yr');
    expect(intervalFor(daysAgo(733), NOW)).toBe('2yr');
  });

  it('survives a leap day without throwing or missing', () => {
    // 2024-02-29 → 2025-03-01 is 366 days: inside the 362–368 window. A
    // calendar-month implementation would have to decide what "a year after
    // Feb 29" means; 24 h arithmetic never asks.
    const leapDrop = new Date('2024-02-29T09:00:00.000Z');
    const oneYearLater = new Date('2025-03-01T09:00:00.000Z');
    expect(intervalFor(leapDrop, oneYearLater)).toBe('1yr');
  });

  it('never echoes something that just happened', () => {
    // No "0 years ago you stood here" ten minutes after dropping.
    expect(intervalFor(new Date(NOW.getTime() - 10 * 60 * 1000), NOW)).toBeNull();
    expect(intervalFor(NOW, NOW)).toBeNull();
  });

  it('returns null for a future timestamp rather than a negative interval', () => {
    // Device clocks are wrong all the time; a row written by one must produce
    // silence, not "-1 years ago".
    expect(intervalFor(new Date(NOW.getTime() + 5 * DAY), NOW)).toBeNull();
    expect(intervalFor(daysAgo(-365), NOW)).toBeNull();
  });

  it('honours a custom tolerance', () => {
    expect(intervalFor(daysAgo(368), NOW, 1)).toBeNull();
    expect(intervalFor(daysAgo(366), NOW, 1)).toBe('1yr');
  });
});

describe('echoWindows', () => {
  it('returns one window per interval', () => {
    expect(echoWindows(NOW).map(w => w.interval)).toEqual(['6mo', '1yr', '2yr']);
  });

  it('places each window symmetrically around its anniversary', () => {
    const year = echoWindows(NOW).find(w => w.interval === '1yr')!;
    expect(year.from.getTime()).toBe(NOW.getTime() - 368 * DAY);
    expect(year.to.getTime()).toBe(NOW.getTime() - 362 * DAY);
  });

  it('never overlaps — "which anniversary is this?" has one answer', () => {
    const windows = echoWindows(NOW).sort(
      (a, b) => a.from.getTime() - b.from.getTime(),
    );
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]!.from.getTime()).toBeGreaterThan(
        windows[i - 1]!.to.getTime(),
      );
    }
  });

  it('agrees with intervalFor on its own boundaries', () => {
    // The windows are the SQL predicate and intervalFor is the label put on
    // whatever came back. If they disagreed by so much as a millisecond, rows
    // would arrive that could not be named — and get silently dropped.
    for (const window of echoWindows(NOW)) {
      expect(intervalFor(window.from, NOW)).toBe(window.interval);
      expect(intervalFor(window.to, NOW)).toBe(window.interval);
      expect(intervalFor(new Date(window.from.getTime() - 1), NOW)).not.toBe(
        window.interval,
      );
      expect(intervalFor(new Date(window.to.getTime() + 1), NOW)).not.toBe(
        window.interval,
      );
    }
  });

  it('widens with the tolerance', () => {
    const [six] = echoWindows(NOW, 10);
    expect(six!.to.getTime() - six!.from.getTime()).toBe(20 * DAY);
    expect(ECHO_TOLERANCE_DAYS).toBe(3);
  });
});
