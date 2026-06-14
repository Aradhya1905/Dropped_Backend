/**
 * reveal.service — the 50 m verification. The part that must not break.
 *
 * The server recomputes the distance from the client's ONE-SHOT position to the
 * drop using PostGIS (ST_DWithin / ST_Distance). The client's claim is never
 * trusted, and the one-shot position is never persisted.
 */
import { REVEAL_RADIUS_M } from '../domain/clientTypes.js';
import type { ApiSecret, Coordinate } from '../domain/clientTypes.js';
import { forbidden, notFound } from '../plugins/errorHandler.js';
import { dropRepo } from '../repositories/drop.repo.js';
import { toUnsealedSecret } from './mappers.js';

export const revealService = {
  /**
   * Verify the device is within 50 m of the drop, then unseal it.
   * - No drop / not visible → 404.
   * - Outside 50 m → 403 with the server-measured distance.
   * - Inside → record the reveal (idempotent), bump counters once, return body.
   */
  async reveal(
    deviceId: string,
    dropId: string,
    position: Coordinate,
  ): Promise<ApiSecret> {
    const check = await dropRepo.distanceFrom(
      dropId,
      position,
      REVEAL_RADIUS_M,
    );
    if (!check) {
      throw notFound('Secret not found');
    }
    if (!check.within) {
      throw forbidden('Too far to reveal', {
        distanceMeters: Math.round(check.distanceMeters),
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
      distanceMeters: check.distanceMeters,
    });
  },
};
