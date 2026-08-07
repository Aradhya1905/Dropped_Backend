/**
 * cities.spec — `GET /devices/me/cities` and the `?city=` trail filter, the two
 * halves of the city constellation's data.
 *
 * What this file is really guarding:
 *
 * - **The index carries no map.** `/devices/me/cities` answers with counts and
 *   dates only. No coordinates, no bodies. The points are drawn from the trail,
 *   which is already gated on this device having stood there.
 * - **One city, one entry.** The composer sends whatever the geocoder returned,
 *   so "Riverport" and "riverport" must be one constellation, not two.
 * - **The same status rules as the Trail.** A drop moderation took down leaves
 *   other people's histories and stays in the author's own.
 *
 * Runs against the real app + Postgres. Requires DATABASE_URL.
 *
 * NOTE: AUTHOR creates exactly 5 drops, which is DROP_DAILY_LIMIT. A sixth
 * would 429.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';

// Ids unique to this file — the suite shares one database, and a spec cleans up
// by device id. Taken so far: 1111/2222 (expiryGate), 3333/4444 (whisper),
// 5555/6666 (preview), aaaa/bbbb (reveal), dddd/eeee/ffff (reply),
// 7777/8888/9999 (echoes, conditionGate).
const AUTHOR = 'cccccccc-3333-4333-8333-cccccccccccc';
const WALKER = '12121212-7171-4171-8171-121212121212';
const STRANGER = '13131313-7272-4272-8272-131313131313';

const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

/** This file's own patch of ocean, well away from every other spec's. */
const RIVERPORT = { lat: -37.424242, lng: 151.808080 };
/** ~2 km east — a different place, but the reveal is done standing on it. */
const LAKEBURN = { lat: -37.424242, lng: 151.831111 };

interface CityRow {
  city: string;
  foundCount: number;
  droppedCount: number;
  firstAt: number;
  lastAt: number;
}

let app: FastifyInstance;
let riverA: string; // Riverport, revealed by WALKER
let riverB: string; // "riverport" (lowercased) — same city, revealed by WALKER
let lakeC: string; // Lakeburn, revealed by WALKER 100 days ago
let noCity: string; // no city at all — belongs to no constellation
let hidden: string; // Riverport, revealed by WALKER, then taken down

const create = async (
  body: string,
  at: { lat: number; lng: number },
  city?: string,
): Promise<string> => {
  const res = await app.inject({
    method: 'POST',
    url: '/drops',
    headers: headers(AUTHOR),
    payload: {
      body,
      mood: 'wonder',
      coordinate: at,
      placeLabel: 'The jetty',
      ...(city ? { city } : {}),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

const reveal = async (id: string, at: { lat: number; lng: number }) => {
  const res = await app.inject({
    method: 'POST',
    url: `/drops/${id}/reveal`,
    headers: headers(WALKER),
    payload: { coordinate: at },
  });
  expect(res.statusCode, res.body).toBe(200);
};

const cities = async (deviceId: string): Promise<CityRow[]> => {
  const res = await app.inject({
    method: 'GET',
    url: '/devices/me/cities',
    headers: headers(deviceId),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().cities;
};

const trailFound = async (
  deviceId: string,
  city?: string,
): Promise<{ secrets: { id: string; drop: { city?: string } }[]; total: number }> => {
  const query = city === undefined ? '' : `?city=${encodeURIComponent(city)}`;
  const res = await app.inject({
    method: 'GET',
    url: `/drops/trail/found${query}`,
    headers: headers(deviceId),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

describe('city constellation data', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    riverA = await create('the letter I never sent', RIVERPORT, 'Riverport');
    riverB = await create('what I said on the bridge', RIVERPORT, 'riverport');
    lakeC = await create('the winter by the water', LAKEBURN, 'Lakeburn');
    noCity = await create('somewhere with no name', RIVERPORT);
    hidden = await create('the one that got reported', RIVERPORT, 'Riverport');

    await reveal(riverA, RIVERPORT);
    await reveal(riverB, RIVERPORT);
    await reveal(lakeC, LAKEBURN);
    await reveal(noCity, RIVERPORT);
    await reveal(hidden, RIVERPORT);

    // Push Lakeburn into the past so the newest-activity-first ordering is a
    // fact about the data rather than about how fast the fixture ran.
    await sqlClient`
      UPDATE reveals SET created_at = now() - interval '100 days'
      WHERE drop_id = ${lakeC} AND device_id = ${WALKER}
    `;
    await sqlClient`
      UPDATE drops SET created_at = now() - interval '100 days'
      WHERE id = ${lakeC}
    `;

    await sqlClient`UPDATE drops SET status = 'hidden' WHERE id = ${hidden}`;
  });

  afterAll(async () => {
    await sqlClient`DELETE FROM reveals WHERE device_id IN (${AUTHOR}, ${WALKER}, ${STRANGER})`;
    await sqlClient`DELETE FROM drops WHERE device_id IN (${AUTHOR}, ${WALKER}, ${STRANGER})`;
    await sqlClient`DELETE FROM devices WHERE id IN (${AUTHOR}, ${WALKER}, ${STRANGER})`;
    await app.close();
    await closeDb();
  });

  describe('GET /devices/me/cities', () => {
    it('breaks a walker’s history down per city', async () => {
      const list = await cities(WALKER);
      const names = list.map(c => c.city.toLowerCase());
      expect(names).toContain('riverport');
      expect(names).toContain('lakeburn');
    });

    it('counts "Riverport" and "riverport" as one city', async () => {
      // Two drops, two spellings, one constellation.
      const list = await cities(WALKER);
      const riverport = list.filter(c => c.city.toLowerCase() === 'riverport');
      expect(riverport).toHaveLength(1);
      expect(riverport[0]!.foundCount).toBe(2);
    });

    it('leaves a drop moderation took down out of the walker’s count', async () => {
      // WALKER revealed `hidden` before it was taken down. It stops being part
      // of their history the moment it stops being visible.
      const riverport = (await cities(WALKER)).find(
        c => c.city.toLowerCase() === 'riverport',
      )!;
      expect(riverport.foundCount).toBe(2);
    });

    it('keeps the author’s own taken-down drop in their own count', async () => {
      // The mirror of the rule above, and the same one `trail('dropped')`
      // applies: it leaves everyone else's history, not yours.
      const riverport = (await cities(AUTHOR)).find(
        c => c.city.toLowerCase() === 'riverport',
      )!;
      expect(riverport.droppedCount).toBe(3);
      expect(riverport.foundCount).toBe(0);
    });

    it('ignores a drop that never resolved a city', async () => {
      const total = (await cities(WALKER)).reduce(
        (n, c) => n + c.foundCount,
        0,
      );
      // riverA + riverB + lakeC. Not `noCity`, not `hidden`.
      expect(total).toBe(3);
    });

    it('orders by most recent activity first', async () => {
      const list = await cities(WALKER);
      const lastAts = list.map(c => c.lastAt);
      expect([...lastAts].sort((a, b) => b - a)).toEqual(lastAts);
      expect(list[0]!.city.toLowerCase()).toBe('riverport');
    });

    it('dates each city with ms epochs, first before last', async () => {
      const lakeburn = (await cities(WALKER)).find(
        c => c.city.toLowerCase() === 'lakeburn',
      )!;
      expect(typeof lakeburn.firstAt).toBe('number');
      expect(lakeburn.firstAt).toBeLessThanOrEqual(lakeburn.lastAt);
      // Backdated 100 days, so it is comfortably in the past.
      expect(lakeburn.lastAt).toBeLessThan(Date.now() - 86_400_000);
    });

    it('carries no coordinate and no secret text', async () => {
      // The index is counts and dates. Anything else here would be a place a
      // body could leak from, in the one response a user is likely to export.
      const raw = JSON.stringify(await cities(WALKER));
      expect(raw).not.toContain('lat');
      expect(raw).not.toContain('lng');
      expect(raw).not.toContain('coordinate');
      expect(raw).not.toContain('the letter I never sent');
    });

    it('tells a device with no history nothing at all', async () => {
      expect(await cities(STRANGER)).toEqual([]);
    });
  });

  describe('city on the wire', () => {
    it('carries drop.city on a trail secret', async () => {
      const { secrets } = await trailFound(WALKER);
      const found = secrets.find(s => s.id === riverA)!;
      expect(found.drop.city).toBe('Riverport');
    });

    it('omits it entirely for a drop that never had one', async () => {
      const { secrets } = await trailFound(WALKER);
      const found = secrets.find(s => s.id === noCity)!;
      expect(found.drop.city).toBeUndefined();
    });
  });

  describe('?city= on the trail', () => {
    it('narrows the list to one city', async () => {
      const { secrets, total } = await trailFound(WALKER, 'Riverport');
      expect(secrets.map(s => s.id).sort()).toEqual([riverA, riverB].sort());
      expect(total).toBe(2);
    });

    it('matches case-insensitively', async () => {
      const { total } = await trailFound(WALKER, 'RIVERPORT');
      expect(total).toBe(2);
    });

    it('returns nothing for a city you have never been to', async () => {
      const { secrets, total } = await trailFound(WALKER, 'Nowhere At All');
      expect(secrets).toEqual([]);
      expect(total).toBe(0);
    });

    it('leaves the unfiltered list alone', async () => {
      const { total } = await trailFound(WALKER);
      // riverA, riverB, lakeC, noCity — `hidden` is filtered by status.
      expect(total).toBe(4);
    });
  });
});
