/**
 * solar.spec — the arithmetic behind time-gated drops.
 *
 * The highest-value tests in this feature. Solar math is easy to get subtly
 * wrong (a hemisphere sign, a timezone leaking in) and impossible to eyeball:
 * a sunset that is an hour off still looks like a sunset. So every reference
 * time below is a published almanac value for the given date and place,
 * asserted in **UTC**, within five minutes.
 *
 * Pure — no database, no app, no network.
 */
import { describe, expect, it } from 'vitest';

import {
  conditionMet,
  isNightAt,
  nextOpensAt,
  solarAltitudeDeg,
  sunTimes,
} from '../src/domain/solar.js';

const MINUTE_MS = 60_000;

/** Assert a computed instant is within `tolerance` minutes of a UTC reference. */
function expectNear(
  actual: Date | null,
  referenceIso: string,
  toleranceMinutes = 5,
): void {
  expect(actual).not.toBeNull();
  const drift = Math.abs(
    actual!.getTime() - new Date(referenceIso).getTime(),
  );
  expect(
    drift / MINUTE_MS,
    `${actual!.toISOString()} vs ${referenceIso}`,
  ).toBeLessThanOrEqual(toleranceMinutes);
}

const BENGALURU = { lat: 12.97, lng: 77.59 };
const LONDON = { lat: 51.5, lng: -0.13 };
const SYDNEY = { lat: -33.87, lng: 151.21 };
/** Inside the Arctic Circle: midnight sun in June, polar night in December. */
const TROMSO = { lat: 69.65, lng: 18.96 };

describe('sunTimes', () => {
  it('matches Bengaluru on the June solstice', () => {
    const { sunrise, sunset } = sunTimes(
      new Date('2026-06-21T06:00:00Z'),
      BENGALURU.lat,
      BENGALURU.lng,
    );
    // 05:55 / 18:49 IST.
    expectNear(sunrise, '2026-06-21T00:25:00Z');
    expectNear(sunset, '2026-06-21T13:19:00Z');
  });

  it('matches Bengaluru on the December solstice', () => {
    const { sunrise, sunset } = sunTimes(
      new Date('2026-12-21T06:00:00Z'),
      BENGALURU.lat,
      BENGALURU.lng,
    );
    // 06:38 / 17:59 IST.
    expectNear(sunrise, '2026-12-21T01:08:00Z');
    expectNear(sunset, '2026-12-21T12:29:00Z');
  });

  it('matches London on the June solstice', () => {
    // A high latitude swings ~13 hours between solstices where Bengaluru swings
    // ~1. That range is what catches a sign error the tropics would hide.
    const { sunrise, sunset } = sunTimes(
      new Date('2026-06-21T12:00:00Z'),
      LONDON.lat,
      LONDON.lng,
    );
    // 04:43 / 21:22 BST.
    expectNear(sunrise, '2026-06-21T03:43:00Z');
    expectNear(sunset, '2026-06-21T20:22:00Z');
  });

  it('matches London on the December solstice', () => {
    const { sunrise, sunset } = sunTimes(
      new Date('2026-12-21T12:00:00Z'),
      LONDON.lat,
      LONDON.lng,
    );
    expectNear(sunrise, '2026-12-21T08:04:00Z');
    expectNear(sunset, '2026-12-21T15:53:00Z');
  });

  it('matches Sydney on the June solstice — the shortest day, not the longest', () => {
    // Southern hemisphere: a flipped declination sign would hand back Sydney's
    // *summer* here, ~14 hours of daylight instead of ~9.
    const { sunrise, sunset } = sunTimes(
      new Date('2026-06-21T02:00:00Z'),
      SYDNEY.lat,
      SYDNEY.lng,
    );
    // 07:01 / 16:54 AEST — note the sunrise lands on the previous UTC day.
    expectNear(sunrise, '2026-06-20T21:01:00Z');
    expectNear(sunset, '2026-06-21T06:54:00Z');

    const daylightHours =
      (sunset!.getTime() - sunrise!.getTime()) / (60 * MINUTE_MS);
    expect(daylightHours).toBeLessThan(10);
  });

  it('gives each longitude its own solar day, either side of the date line', () => {
    // Suva (+178) and Apia (-172) are ~700 km apart but on opposite sides of
    // 180°. If the day number came from Greenwich's calendar rather than the
    // coordinate's, one of these would be a day out.
    const suva = sunTimes(new Date('2026-06-21T00:00:00Z'), -18.14, 178.44);
    const apia = sunTimes(new Date('2026-06-21T00:00:00Z'), -13.83, -171.77);
    const gap = Math.abs(suva.sunset!.getTime() - apia.sunset!.getTime());
    expect(gap / (60 * MINUTE_MS)).toBeLessThan(2);
  });

  describe('the DST trap', () => {
    // The whole point of computing from a coordinate: 2026-03-29 is the day
    // the UK springs forward. If local time leaked in anywhere, sunrise would
    // jump a whole hour across that boundary.
    const riseOn = (iso: string) =>
      sunTimes(new Date(iso), LONDON.lat, LONDON.lng).sunrise!;

    it('shifts by minutes across the clock change, not by an hour', () => {
      const DAY_MS = 24 * 60 * MINUTE_MS;
      const before = riseOn('2026-03-28T12:00:00Z');
      const after = riseOn('2026-03-29T12:00:00Z');
      // Compare the two sunrises a calendar day apart: subtract the day, and
      // what's left is how much earlier the sun came up.
      const earlierByMinutes =
        (before.getTime() + DAY_MS - after.getTime()) / MINUTE_MS;
      // One day nearer the solstice: sunrise comes ~4 minutes earlier. An hour
      // here would mean BST leaked into a calculation that must never see it.
      expect(earlierByMinutes).toBeGreaterThan(1);
      expect(earlierByMinutes).toBeLessThan(10);
    });

    it('lands on the fixed UTC instant regardless of the host clock', () => {
      // 06:43 BST = 05:43 UTC. Asserted in UTC because that is the only frame
      // the server ever uses.
      expectNear(riseOn('2026-03-29T12:00:00Z'), '2026-03-29T05:43:00Z');
    });
  });

  describe('polar', () => {
    it('reports no sunrise or sunset under the midnight sun', () => {
      const times = sunTimes(
        new Date('2026-06-21T12:00:00Z'),
        TROMSO.lat,
        TROMSO.lng,
      );
      expect(times.sunrise).toBeNull();
      expect(times.sunset).toBeNull();
    });

    it('reports the same during polar night', () => {
      const times = sunTimes(
        new Date('2026-12-21T12:00:00Z'),
        TROMSO.lat,
        TROMSO.lng,
      );
      expect(times.sunrise).toBeNull();
      expect(times.sunset).toBeNull();
    });
  });
});

describe('isNightAt', () => {
  it('is night at Bengaluru at 01:30 local', () => {
    expect(
      isNightAt(new Date('2026-06-21T20:00:00Z'), BENGALURU.lat, BENGALURU.lng),
    ).toBe(true);
  });

  it('is not night at Bengaluru at local noon', () => {
    expect(
      isNightAt(new Date('2026-06-21T06:30:00Z'), BENGALURU.lat, BENGALURU.lng),
    ).toBe(false);
  });

  it('flips exactly once across sunset', () => {
    const { sunset } = sunTimes(
      new Date('2026-06-21T06:00:00Z'),
      BENGALURU.lat,
      BENGALURU.lng,
    );
    const before = new Date(sunset!.getTime() - 2 * MINUTE_MS);
    const after = new Date(sunset!.getTime() + 2 * MINUTE_MS);
    expect(isNightAt(before, BENGALURU.lat, BENGALURU.lng)).toBe(false);
    expect(isNightAt(after, BENGALURU.lat, BENGALURU.lng)).toBe(true);
  });

  describe('polar, where there are no crossings to compare against', () => {
    it('is never night under the midnight sun, and never NaN', () => {
      for (let hour = 0; hour < 24; hour += 1) {
        const when = new Date(
          `2026-06-21T${String(hour).padStart(2, '0')}:00:00Z`,
        );
        const altitude = solarAltitudeDeg(when, TROMSO.lat, TROMSO.lng);
        expect(Number.isNaN(altitude)).toBe(false);
        expect(isNightAt(when, TROMSO.lat, TROMSO.lng)).toBe(false);
      }
    });

    it('is night around the clock during polar night', () => {
      for (let hour = 0; hour < 24; hour += 1) {
        const when = new Date(
          `2026-12-21T${String(hour).padStart(2, '0')}:00:00Z`,
        );
        expect(isNightAt(when, TROMSO.lat, TROMSO.lng)).toBe(true);
      }
    });
  });
});

describe('conditionMet', () => {
  const NOON_IST = new Date('2026-06-21T06:30:00Z');
  const MIDNIGHT_IST = new Date('2026-06-21T20:00:00Z');

  it('is always true with no condition — the ungated majority', () => {
    expect(conditionMet(null, NOON_IST, BENGALURU.lat, BENGALURU.lng)).toBe(
      true,
    );
    expect(conditionMet(null, MIDNIGHT_IST, BENGALURU.lat, BENGALURU.lng)).toBe(
      true,
    );
  });

  it('holds a night drop shut at noon and open at midnight', () => {
    expect(conditionMet('night', NOON_IST, BENGALURU.lat, BENGALURU.lng)).toBe(
      false,
    );
    expect(
      conditionMet('night', MIDNIGHT_IST, BENGALURU.lat, BENGALURU.lng),
    ).toBe(true);
  });

  it('is the exact inverse for a day drop at the same instants', () => {
    expect(conditionMet('day', NOON_IST, BENGALURU.lat, BENGALURU.lng)).toBe(
      true,
    );
    expect(
      conditionMet('day', MIDNIGHT_IST, BENGALURU.lat, BENGALURU.lng),
    ).toBe(false);
  });

  it('judges by the drop’s coordinate, not by the instant alone', () => {
    // One instant, two places: 08:00 UTC is early afternoon in Bengaluru and
    // an hour past sunset in Sydney. A gate that read a clock instead of a
    // coordinate could not tell these apart.
    const sameInstant = new Date('2026-06-21T08:00:00Z');
    expect(
      conditionMet('night', sameInstant, BENGALURU.lat, BENGALURU.lng),
    ).toBe(false);
    expect(conditionMet('night', sameInstant, SYDNEY.lat, SYDNEY.lng)).toBe(
      true,
    );
  });
});

describe('nextOpensAt', () => {
  it('points a night drop at today’s sunset when asked at noon', () => {
    const opens = nextOpensAt(
      'night',
      new Date('2026-06-21T06:30:00Z'),
      BENGALURU.lat,
      BENGALURU.lng,
    );
    expectNear(opens, '2026-06-21T13:19:00Z');
  });

  it('points a day drop at tomorrow’s sunrise when asked at midnight', () => {
    const opens = nextOpensAt(
      'day',
      new Date('2026-06-21T20:00:00Z'),
      BENGALURU.lat,
      BENGALURU.lng,
    );
    expectNear(opens, '2026-06-22T00:26:00Z');
  });

  it('always returns an instant in the future', () => {
    const when = new Date('2026-06-21T13:00:00Z');
    const opens = nextOpensAt('night', when, BENGALURU.lat, BENGALURU.lng)!;
    expect(opens.getTime()).toBeGreaterThan(when.getTime());
  });

  it('looks past the midnight sun to the season’s first sunset', () => {
    // Tromsø's midnight sun ends in late July. The answer is months away, but
    // it exists, so the walker gets a date rather than a shrug.
    const opens = nextOpensAt(
      'night',
      new Date('2026-06-21T12:00:00Z'),
      TROMSO.lat,
      TROMSO.lng,
    );
    expect(opens).not.toBeNull();
    expect(opens!.getUTCMonth()).toBe(6); // July
  });
});
