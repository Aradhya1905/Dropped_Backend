/**
 * device.service — business logic for the anonymous identity.
 *
 * No Fastify, no SQL. Translates repo rows into the `/devices/me` response,
 * including the remaining daily drop quota.
 */
import { env } from '../config/env.js';
import { DELETED_DEVICE_ID } from '../db/schema.js';
import type { DeviceCity, DeviceStats } from '../domain/clientTypes.js';
import type { DeviceErasure } from '../repositories/device.repo.js';
import { deviceRepo } from '../repositories/device.repo.js';
import { forbidden } from '../plugins/errorHandler.js';

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

  /**
   * The per-city breakdown behind `citiesVisited` — one entry per city this
   * device has found or left something in, newest activity first.
   *
   * Timestamps are coerced here rather than in SQL for the same reason every
   * other response does it in the mapper layer: postgres.js hands back strings,
   * and the wire contract is ms epoch everywhere.
   */
  async cities(deviceId: string): Promise<DeviceCity[]> {
    const rows = await deviceRepo.cities(deviceId);
    return rows.map(r => ({
      city: r.city,
      foundCount: r.foundCount,
      droppedCount: r.droppedCount,
      firstAt: new Date(r.firstAt).getTime(),
      lastAt: new Date(r.lastAt).getTime(),
    }));
  },

  /**
   * Erase this device — the server half of the panic wipe.
   *
   * There is nothing to decide here: the ordering, the counter corrections and
   * the anonymise-don't-delete rule are all one transaction in the repo, because
   * splitting them across layers is how a wipe ends up half-done. What this
   * layer owns is the receipt the client needs in order to tell the truth in its
   * confirmation, and the one guard below.
   *
   * The client must not wipe locally until this resolves. A local wipe after a
   * failed server call leaves someone believing their confessions are gone when
   * they are still on the map — the worst outcome this feature can produce.
   */
  async erase(deviceId: string): Promise<DeviceErasure> {
    // Unreachable through HTTP — the X-Device-Id plugin only accepts UUIDs and
    // the sentinel deliberately is not one. Kept because the failure it prevents
    // is unrecoverable: erasing the sentinel would orphan every drop whose
    // author has already left.
    if (deviceId === DELETED_DEVICE_ID) {
      throw forbidden('That identity cannot be erased.');
    }
    return deviceRepo.erase(deviceId);
  },
};
