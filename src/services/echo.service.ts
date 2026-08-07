/**
 * echo.service — "a year ago you stood here".
 *
 * Owns the two decisions the SQL deliberately doesn't make: which event is the
 * better memory when a device both dropped and revealed the same secret, and
 * which anniversary a timestamp is actually having (that lives in `domain/echo`
 * so it stays testable without a database).
 *
 * What it must never do is turn a memory into content: the sealing rule is in
 * `toEchoSecret`, and it is the same 50 m rule as everywhere else.
 */
import { env } from '../config/env.js';
import type { Coordinate, Echo } from '../domain/clientTypes.js';
import { echoWindows, intervalFor } from '../domain/echo.js';
import { dropRepo, type EchoRow } from '../repositories/drop.repo.js';
import { toEchoSecret } from './mappers.js';

/** ms epoch from whatever postgres.js handed back. */
function epochMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export const echoService = {
  /**
   * Anniversaries near a point, oldest memory first.
   *
   * `now` is injectable purely so the tests can stand a year in the future
   * without backdating rows twice; production always passes the real clock.
   */
  async near(
    deviceId: string,
    point: Coordinate,
    radiusMeters: number | undefined,
    now: Date = new Date(),
  ): Promise<Echo[]> {
    const radius = Math.min(
      radiusMeters ?? env.ECHO_DEFAULT_RADIUS_M,
      env.ECHO_MAX_RADIUS_M,
    );

    // Over-fetch: one drop can appear twice (authored *and* revealed by the
    // same device), and those duplicates are collapsed below — asking for
    // exactly the cap would let them eat other people's places.
    const rows = await dropRepo.echoes(
      deviceId,
      point,
      radius,
      echoWindows(now),
      env.ECHO_MAX_RESULTS * 2,
    );

    // One echo per drop. Rows arrive oldest-first, so the first one wins: if
    // you left a secret and later revealed it, the day you left it is the
    // memory worth having.
    const seen = new Set<string>();
    const echoes: Echo[] = [];

    for (const row of rows as EchoRow[]) {
      if (seen.has(row.id)) continue;

      const stoodAt = epochMs(row.stoodAt);
      // The window that matched in SQL, named. `null` should be unreachable —
      // the same helper generated those windows — but a row whose interval
      // can't be named has nothing gentle to say, so it is dropped rather than
      // labelled with a guess.
      const interval = intervalFor(new Date(stoodAt), now);
      if (interval === null) continue;

      seen.add(row.id);
      echoes.push({
        secret: toEchoSecret(row, deviceId),
        interval,
        kind: row.echoKind,
        stoodAt,
      });

      if (echoes.length >= env.ECHO_MAX_RESULTS) break;
    }

    return echoes;
  },
};
