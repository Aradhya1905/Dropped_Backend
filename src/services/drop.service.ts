/**
 * drop.service — create + nearby business logic.
 *
 * Owns: the per-device/day quota, moderation ingest, and sealing rules. No SQL,
 * no Fastify.
 */
import { env } from '../config/env.js';
import type { ApiSecret, Coordinate, Mood } from '../domain/clientTypes.js';
import { unprocessable, tooManyRequests } from '../plugins/errorHandler.js';
import { deviceRepo } from '../repositories/device.repo.js';
import { dropRepo } from '../repositories/drop.repo.js';
import { moderationService } from './moderation.service.js';
import { toNearbySecret, toUnsealedSecret } from './mappers.js';

export interface CreateDropInput {
  deviceId: string;
  body: string;
  mood: Mood;
  coordinate: Coordinate;
  placeLabel?: string;
  city?: string;
}

export const dropService = {
  /**
   * Create a drop. Enforces the daily quota, screens the body, and stores it
   * `visible` (clean) or `pending` (soft-flagged). Hard-blocked content is
   * rejected (422). The author always gets the unsealed view back.
   */
  async create(input: CreateDropInput): Promise<ApiSecret> {
    const usedToday = await deviceRepo.dropsCreatedSince(input.deviceId, 24);
    if (usedToday >= env.DROP_DAILY_LIMIT) {
      throw tooManyRequests(
        `Daily drop limit reached (${env.DROP_DAILY_LIMIT}). Try again tomorrow.`,
      );
    }

    const verdict = moderationService.screen(input.body);
    if (verdict.verdict === 'block') {
      throw unprocessable(verdict.reason ?? 'This can’t be posted.');
    }
    const status = verdict.verdict === 'flag' ? 'pending' : 'visible';

    const row = await dropRepo.create({
      deviceId: input.deviceId,
      body: input.body,
      mood: input.mood,
      placeLabel: input.placeLabel ?? null,
      city: input.city ?? null,
      coordinate: input.coordinate,
      status,
    });

    // The author sees their own drop unsealed, with their flags (false at birth).
    return toUnsealedSecret({
      ...row,
      saved: false,
      hearted: false,
      revealed: false,
    });
  },

  /** Visible drops near a point, sealed unless this device already revealed them. */
  async nearby(
    deviceId: string,
    point: Coordinate,
    radiusMeters: number | undefined,
  ): Promise<ApiSecret[]> {
    const radius = Math.min(
      radiusMeters ?? env.NEARBY_DEFAULT_RADIUS_M,
      env.NEARBY_MAX_RADIUS_M,
    );
    const rows = await dropRepo.nearby(deviceId, point, radius, 200);
    return rows.map(toNearbySecret);
  },
};
