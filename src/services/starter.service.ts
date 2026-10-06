/**
 * starter.service — seed starter drops so a new user never opens to an empty map.
 *
 * On a device's first onboarding the client sends its first live fix. If there
 * is no visible, unexpired drop within STARTER_CHECK_RADIUS_M, we pin one drop
 * per RING around that point (shared and public, authored by the system
 * starter device, expiring after STARTER_DROP_TTL_DAYS). If drops already
 * exist — including starters seeded for an earlier user nearby — nothing is
 * added. Each device gets exactly one attempt. No SQL, no Fastify.
 */
import { env } from '../config/env.js';
import type { Coordinate, Mood } from '../domain/clientTypes.js';
import { destinationPoint } from '../domain/destination.js';
import {
  STARTER_PLACE_LABEL,
  STARTER_POOL,
  type StarterText,
} from '../domain/starterPool.js';
import {
  starterRepo,
  type SeedOutcome,
  type StarterDropInput,
} from '../repositories/starter.repo.js';

/**
 * Distance bands (metres) from the onboarding point, one drop per ring.
 * near: revealable on the spot (inside the 50 m radius even with GPS drift);
 * mid: a short walk; far: a real walk.
 */
export const RINGS: readonly { min: number; max: number }[] = [
  { min: 10, max: 25 },
  { min: 150, max: 250 },
  { min: 400, max: 600 },
];

/** Rings are spread evenly around the compass, each jittered by up to ±this. */
const BEARING_JITTER_DEG = 20;

const MS_PER_DAY = 86_400_000;

/**
 * Pick `n` distinct texts, preferring a different mood for each. `rand` is
 * injectable so tests are deterministic.
 */
export function pickTexts(
  n: number,
  rand: () => number = Math.random,
  pool: readonly StarterText[] = STARTER_POOL,
): StarterText[] {
  // Fisher–Yates shuffle a copy, then take mood-distinct entries first.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  const picked: StarterText[] = [];
  const moods = new Set<Mood>();
  for (const t of shuffled) {
    if (picked.length === n) break;
    if (!moods.has(t.mood)) {
      picked.push(t);
      moods.add(t.mood);
    }
  }
  for (const t of shuffled) {
    if (picked.length === n) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
}

/** Plan one starter drop per ring around `point`. Pure (given `rand`/`now`). */
export function planStarters(
  point: Coordinate,
  rand: () => number = Math.random,
  now: number = Date.now(),
): StarterDropInput[] {
  const texts = pickTexts(RINGS.length, rand);
  const base = rand() * 360;
  const step = 360 / RINGS.length;
  const expiresAt = new Date(now + env.STARTER_DROP_TTL_DAYS * MS_PER_DAY);

  return RINGS.map((ring, i) => {
    const jitter = (rand() * 2 - 1) * BEARING_JITTER_DEG;
    const bearing = (base + i * step + jitter + 360) % 360;
    const distance = ring.min + rand() * (ring.max - ring.min);
    const text = texts[i]!;
    return {
      body: text.body,
      mood: text.mood,
      placeLabel: STARTER_PLACE_LABEL,
      coordinate: destinationPoint(point, bearing, distance),
      expiresAt,
    };
  });
}

export const starterService = {
  /**
   * Seed starter drops around `point` if this device hasn't tried before and
   * the area is empty. Returns whether anything was seeded.
   */
  async seed(
    deviceId: string,
    point: Coordinate,
  ): Promise<{ seeded: boolean; outcome: SeedOutcome | 'disabled' }> {
    if (!env.STARTER_DROPS_ENABLED) {
      return { seeded: false, outcome: 'disabled' };
    }
    const outcome = await starterRepo.claimAndSeed(
      deviceId,
      point,
      env.STARTER_CHECK_RADIUS_M,
      planStarters(point),
    );
    return { seeded: outcome === 'seeded', outcome };
  },
};
