/**
 * reveal.service — the 50 m verification. The part that must not break.
 *
 * The server recomputes the distance from the client's ONE-SHOT position to the
 * drop using PostGIS (ST_DWithin / ST_Distance). The client's claim is never
 * trusted, and the one-shot position is never persisted.
 *
 * A drop may also carry ONE time condition (`night` / `day`). It is enforced
 * here, next to the distance check, on the same principle: the server is the
 * source of truth. Sunrise and sunset are computed from the drop's own
 * coordinate and the server's clock — never from the device's clock, and never
 * from a timezone.
 */
import { REVEAL_RADIUS_M } from '../domain/clientTypes.js';
import type { ApiSecret, Coordinate } from '../domain/clientTypes.js';
import { conditionMet, nextOpensAt } from '../domain/solar.js';
import type { RevealCondition } from '../domain/solar.js';
import { forbidden, notFound } from '../plugins/errorHandler.js';
import { dropRepo } from '../repositories/drop.repo.js';
import { toUnsealedSecret } from './mappers.js';

/** The refusal a walker sees when they got the place right and the hour wrong. */
const conditionMessage: Record<RevealCondition, string> = {
  night: 'This one waits for dark.',
  day: 'This one only speaks in daylight.',
};

export const revealService = {
  /**
   * Verify the device is within 50 m of the drop, then unseal it.
   * - No drop / not visible / expired → 404.
   * - Outside 50 m → 403 with the server-measured distance.
   * - Right place, wrong hour → 403 with the condition and when it opens.
   * - Inside → record the reveal (idempotent), bump counters once, return body.
   */
  async reveal(
    deviceId: string,
    dropId: string,
    position: Coordinate,
  ): Promise<ApiSecret> {
    const gate = await dropRepo.revealGate(dropId, position, REVEAL_RADIUS_M);
    if (!gate) {
      throw notFound('Secret not found');
    }
    if (!gate.within) {
      throw forbidden('Too far to reveal', {
        distanceMeters: Math.round(gate.distanceMeters),
      });
    }

    // Distance first, then the condition. Someone 500 m away at midnight
    // should be told they are too far, not that they are too early — the
    // nearer truth is the more useful one, and the ordering also means a
    // stranger cannot probe a drop's condition from across town.
    const now = new Date();
    const lat = Number(gate.lat);
    const lng = Number(gate.lng);
    if (!conditionMet(gate.revealCondition, now, lat, lng)) {
      const condition = gate.revealCondition!;
      const opensAt = nextOpensAt(condition, now, lat, lng);
      throw forbidden(conditionMessage[condition], {
        revealCondition: condition,
        // Absent at the poles, where the next sunset may be months away. The
        // client renders the message without a countdown rather than a NaN.
        ...(opensAt ? { opensAt: opensAt.getTime() } : {}),
      });
    }

    await dropRepo.recordReveal(dropId, deviceId);

    // Re-fetch with this device's flags + freshly bumped counters.
    const row = await dropRepo.findForDevice(dropId, deviceId);
    if (!row) {
      throw notFound('Secret not found');
    }
    return toUnsealedSecret({
      ...row,
      distanceMeters: gate.distanceMeters,
    });
  },
};
