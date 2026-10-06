/**
 * starterSeed.spec — the area check, once-per-device claim, expiry and race
 * guard for starter drops, end to end over HTTP against the real PostGIS DB.
 *
 * Uses empty patches of the South Atlantic so the "is the area empty?" check
 * isn't affected by real rows. Cleans up only starter drops near its own test
 * points, plus its own devices.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { closeDb, sqlClient } from '../src/db/client.js';
import { destinationPoint } from '../src/domain/destination.js';
import { STARTER_DEVICE_ID } from '../src/domain/starterPool.js';

const dev = (n: number) => `5ee05ee0-0000-4000-8000-00000000000${n}`;
const DEVICES = [1, 2, 3, 4, 5, 6, 7].map(dev);

const P1 = { lat: -20.0, lng: -20.0 };
const P2 = { lat: -20.0, lng: -19.9 }; // ~10 km east of P1
const P3 = { lat: -20.0, lng: -19.8 }; // ~10 km east of P2
const TEST_POINTS = [P1, P2, P3];

const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

interface WireSecret {
  id: string;
  starter?: boolean;
  sealed: boolean;
  drop: { coordinate: { lat: number; lng: number }; placeLabel?: string };
  distanceMeters?: number;
}

let app: FastifyInstance;

async function seed(deviceId: string, coordinate: { lat: number; lng: number }) {
  const res = await app.inject({
    method: 'POST',
    url: '/devices/me/starter-drops',
    headers: headers(deviceId),
    payload: { coordinate },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { seeded: boolean; outcome: string };
}

async function startersNear(
  deviceId: string,
  point: { lat: number; lng: number },
): Promise<WireSecret[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/drops/nearby?lat=${point.lat}&lng=${point.lng}&radiusMeters=1000`,
    headers: headers(deviceId),
  });
  expect(res.statusCode).toBe(200);
  return (res.json().secrets as WireSecret[]).filter(s => s.starter);
}

async function cleanup(): Promise<void> {
  for (const p of TEST_POINTS) {
    await sqlClient`
      DELETE FROM drops
      WHERE device_id = ${STARTER_DEVICE_ID}
        AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography, 2000)
    `;
  }
  await sqlClient`DELETE FROM reveals WHERE device_id IN ${sqlClient(DEVICES)}`;
  await sqlClient`DELETE FROM devices WHERE id IN ${sqlClient(DEVICES)}`;
}

describe('starter drops', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  it('seeds 3 public starters around the first device in an empty area', async () => {
    expect(await seed(dev(1), P1)).toEqual({ seeded: true, outcome: 'seeded' });

    const starters = await startersNear(dev(1), P1);
    expect(starters).toHaveLength(3);
    for (const s of starters) {
      expect(s.sealed).toBe(true);
      expect(s.drop.placeLabel).toBe('A starter drop');
    }
    // The near one is revealable from where the user stands.
    expect(Math.min(...starters.map(s => s.distanceMeters!))).toBeLessThan(50);
  });

  it('seeds nothing for a second device 50 m away — it sees the same starters', async () => {
    const nearby = destinationPoint(P1, 90, 50);
    expect(await seed(dev(2), nearby)).toEqual({
      seeded: false,
      outcome: 'area-occupied',
    });
    expect(await startersNear(dev(2), nearby)).toHaveLength(3);
  });

  it('gives each device only one attempt', async () => {
    expect(await seed(dev(1), P2)).toEqual({
      seeded: false,
      outcome: 'already-claimed',
    });
    expect(await startersNear(dev(1), P2)).toHaveLength(0);
  });

  it('expired starters are hidden, unrevealable, and leave the area empty', async () => {
    expect((await seed(dev(3), P2)).seeded).toBe(true);
    const starters = await startersNear(dev(3), P2);
    expect(starters).toHaveLength(3);

    // dev(3) reveals the near one from its own coordinate, then all expire.
    const near = starters.reduce((a, b) =>
      a.distanceMeters! < b.distanceMeters! ? a : b,
    );
    const reveal = await app.inject({
      method: 'POST',
      url: `/drops/${near.id}/reveal`,
      headers: headers(dev(3)),
      payload: { coordinate: near.drop.coordinate },
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json().starter).toBe(true);

    const ids = starters.map(s => s.id);
    await sqlClient`
      UPDATE drops SET expires_at = now() - interval '1 minute'
      WHERE id IN ${sqlClient(ids)}
    `;

    // Another device: gone from nearby, and can't be revealed.
    expect(await startersNear(dev(4), P2)).toHaveLength(0);
    const blocked = await app.inject({
      method: 'POST',
      url: `/drops/${near.id}/reveal`,
      headers: headers(dev(4)),
      payload: { coordinate: near.drop.coordinate },
    });
    expect(blocked.statusCode).toBe(404);

    // The device that revealed it keeps it.
    const kept = await startersNear(dev(3), P2);
    expect(kept.map(s => s.id)).toEqual([near.id]);

    // Only expired drops around → the area counts as empty again.
    expect(await seed(dev(4), P2)).toEqual({ seeded: true, outcome: 'seeded' });
  });

  it('seeds exactly once when two devices onboard into the same empty area at once', async () => {
    const [a, b] = await Promise.all([
      seed(dev(5), P3),
      seed(dev(6), destinationPoint(P3, 0, 30)),
    ]);
    expect([a.seeded, b.seeded].filter(Boolean)).toHaveLength(1);
    expect(await startersNear(dev(7), P3)).toHaveLength(3);
  });
});
