/**
 * starter.repo — the one transaction behind starter-drop seeding.
 *
 * Claim the device's attempt, check the area, insert the drops: all under a
 * single advisory lock, so two devices onboarding into the same empty area at
 * the same moment can't both see "empty" and double-seed. Seeding is rare
 * (once per device), so serialising it globally costs nothing.
 */
import { sqlClient } from '../db/client.js';
import type { Coordinate } from '../domain/clientTypes.js';
import { STARTER_DEVICE_ID } from '../domain/starterPool.js';
import { deviceRepo } from './device.repo.js';
import { dropRepo } from './drop.repo.js';
import type { DropStatus } from '../db/schema.js';

/** A starter drop ready to insert (positions/text chosen by the service). */
export interface StarterDropInput {
  body: string;
  mood: string;
  placeLabel: string;
  coordinate: Coordinate;
  expiresAt: Date;
}

export type SeedOutcome = 'already-claimed' | 'area-occupied' | 'seeded';

export const starterRepo = {
  async claimAndSeed(
    deviceId: string,
    point: Coordinate,
    checkRadiusMeters: number,
    drops: StarterDropInput[],
  ): Promise<SeedOutcome> {
    return sqlClient.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('starter-seed'))`;

      if (!(await deviceRepo.claimStarter(deviceId, tx))) {
        return 'already-claimed' as const;
      }
      if (await dropRepo.hasDropsWithin(point, checkRadiusMeters, tx)) {
        return 'area-occupied' as const;
      }

      await deviceRepo.ensureTx(STARTER_DEVICE_ID, tx);
      const status: DropStatus = 'visible';
      for (const d of drops) {
        await dropRepo.create(
          {
            deviceId: STARTER_DEVICE_ID,
            body: d.body,
            mood: d.mood,
            placeLabel: d.placeLabel,
            city: null,
            coordinate: d.coordinate,
            status,
            expiresAt: d.expiresAt,
          },
          tx,
        );
      }
      return 'seeded' as const;
    });
  },
};
