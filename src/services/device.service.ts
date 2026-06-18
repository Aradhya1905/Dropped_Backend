/**
 * device.service — business logic for the anonymous identity.
 *
 * No Fastify, no SQL. Translates repo rows into the `/devices/me` response,
 * including the remaining daily drop quota.
 */
import { env } from '../config/env.js';
import type { DeviceStats } from '../domain/clientTypes.js';
import { deviceRepo } from '../repositories/device.repo.js';

export interface DeviceSummary {
  deviceId: string;
  /** ms epoch. */
  createdAt: number;
  /** Drops this device may still create in the current 24h window. */
  dropsQuotaRemaining: number;
}

const MS_PER_DAY = 86_400_000;

/** Parse a 'YYYY-MM-DD' UTC date into a whole-day number. */
function utcDayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY);
}

/**
 * Longest run of consecutive active days ending today or yesterday (UTC).
 * `datesDesc` is the distinct activity days, newest first. If the most recent
 * activity is older than yesterday the streak is broken (0).
 */
export function computeStreak(datesDesc: string[]): number {
  if (datesDesc.length === 0) return 0;

  const today = Math.floor(Date.now() / MS_PER_DAY);
  let prev = utcDayNumber(datesDesc[0]!);
  if (today - prev > 1) return 0;

  let streak = 1;
  for (let i = 1; i < datesDesc.length; i++) {
    const cur = utcDayNumber(datesDesc[i]!);
    const gap = prev - cur;
    if (gap === 0) continue; // de-dupe safety (rows are already distinct)
    if (gap === 1) {
      streak++;
      prev = cur;
    } else {
      break;
    }
  }
  return streak;
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

  /** Aggregate Trail stats (dropped/found/cities/streak) for the device. */
  async stats(deviceId: string): Promise<DeviceStats> {
    const row = await deviceRepo.stats(deviceId);
    const { activityDates, ...counts } = row;
    return {
      ...counts,
      streakDays: computeStreak(activityDates),
    };
  },
};
