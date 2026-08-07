/**
 * drop.service — create + nearby business logic.
 *
 * Owns: the per-device/day quota, moderation ingest, and sealing rules. No SQL,
 * no Fastify.
 */
import { env } from '../config/env.js';
import type { ApiSecret, Coordinate, Mood } from '../domain/clientTypes.js';
import { expiresAtFrom, type ExpiresInDays } from '../domain/expiry.js';
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
  /** 7 or 30. Absent = forever. */
  expiresInDays?: ExpiresInDays;
}

export const dropService = {
  /**
   * Create a drop. Enforces the daily quota, screens the body, and stores it
   * `visible` (clean) or `pending` (soft-flagged). Hard-blocked content is
   * rejected (422). The author always gets the unsealed view back.
   *
   * `expiresInDays` (7 / 30 / absent = forever) is turned into a stored
   * `expires_at` here — the client never sends a timestamp.
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
      // The author picks a lifespan; the server turns it into an instant. The
      // request may not carry a timestamp — see createDropBody.
      expiresAt: expiresAtFrom(new Date(), input.expiresInDays),
    });

    // The author sees their own drop unsealed, with their flags (false at birth).
    return toUnsealedSecret({
      ...row,
      saved: false,
      hearted: false,
      revealed: false,
    });
  },

  /**
   * Visible drops near a point, sealed unless this device already revealed them.
   *
   * `moods` (undefined = every mood) narrows what comes back. The filter is
   * applied *here* rather than as a SQL predicate on purpose: the map has to
   * tell the user how many drops the filter is hiding, and splitting the same
   * nearest-200 result set gives that count exactly, from one query, with the
   * hidden rows discarded before they ever reach the wire.
   */
  async nearby(
    deviceId: string,
    point: Coordinate,
    radiusMeters: number | undefined,
    moods?: Mood[],
  ): Promise<{ secrets: ApiSecret[]; hiddenByFilter: number }> {
    const radius = Math.min(
      radiusMeters ?? env.NEARBY_DEFAULT_RADIUS_M,
      env.NEARBY_MAX_RADIUS_M,
    );
    const rows = await dropRepo.nearby(deviceId, point, radius, 200);
    if (moods === undefined || moods.length === 0) {
      return { secrets: rows.map(toNearbySecret), hiddenByFilter: 0 };
    }
    const wanted = new Set<string>(moods);
    const kept = rows.filter(r => wanted.has(r.mood));
    return {
      secrets: kept.map(toNearbySecret),
      hiddenByFilter: rows.length - kept.length,
    };
  },
};
