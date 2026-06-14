/**
 * device.service — business logic for the anonymous identity.
 *
 * No Fastify, no SQL. Translates repo rows into the `/devices/me` response,
 * including the remaining daily drop quota.
 */
import { env } from '../config/env.js';
import { deviceRepo } from '../repositories/device.repo.js';

export interface DeviceSummary {
  deviceId: string;
  /** ms epoch. */
  createdAt: number;
  /** Drops this device may still create in the current 24h window. */
  dropsQuotaRemaining: number;
}

export const deviceService = {
  async summary(deviceId: string): Promise<DeviceSummary> {
    // The deviceId plugin already ensured the row exists.
    const row = await deviceRepo.find(deviceId);
    const usedToday = await deviceRepo.dropsCreatedSince(deviceId, 24);
    const remaining = Math.max(0, env.DROP_DAILY_LIMIT - usedToday);

    return {
      deviceId,
      createdAt: (row?.createdAt ?? new Date()).getTime(),
      dropsQuotaRemaining: remaining,
    };
  },
};
