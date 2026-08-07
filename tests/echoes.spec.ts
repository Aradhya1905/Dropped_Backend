/**
 * echoes.spec — what `GET /drops/echoes` may remember, and what it must not.
 *
 * The date arithmetic is covered purely in echo.spec; this file is about the
 * predicates that only exist in SQL — the moderation status, the radius, and
 * the "this device's own past only" scoping — plus the one product rule that
 * matters most: **a drop that was taken down never echoes.** An anniversary
 * reminder of something moderated away is the worst version of this feature.
 *
 * Runs against the real app + Postgres. Requires DATABASE_URL.
 *
 * NOTE: AUTHOR creates exactly 5 drops, which is DROP_DAILY_LIMIT. A sixth
 * would 429 — prefer backdating an existing drop over creating another.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';

// Ids unique to this file — the suite shares one database and vitest runs files
// concurrently, so reusing another spec's ids means this file's cleanup deletes
// that file's rows mid-run.
//
// Taken so far: 1111/2222 (expiryGate), 3333/4444 (whisper), 5555/6666
// (preview), aaaa/bbbb (reveal), dddd/eeee/ffff (reply).
const AUTHOR = '77777777-dddd-4ddd-8ddd-777777777777';
const WALKER = '88888888-eeee-4eee-8eee-888888888888';
const STRANGER = '99999999-ffff-4fff-8fff-999999999999';

const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

/** Its own quiet patch of ocean, well away from every other spec's. */
const HERE = { lat: 41.555555, lng: -160.777777 };
/** ~600 m north — outside the 250 m default radius, inside an 800 m one. */
const FAR = { lat: HERE.lat + 0.0054, lng: HERE.lng };

let app: FastifyInstance;
let remembered: string; // revealed by WALKER a year ago
let takenDown: string; // same, then hidden by moderation
let recent: string; // revealed 100 days ago — no anniversary
let faraway: string; // a year ago, but 600 m away
let faded: string; // a year ago, and has since expired

const create = async (body: string, at = HERE): Promise<string> => {
  const res = await app.inject({
    method: 'POST',
    url: '/drops',
    headers: headers(AUTHOR),
    payload: {
      body,
      mood: 'wonder',
      coordinate: at,
      placeLabel: 'The bridge',
      city: 'Nowhere',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

const reveal = async (id: string, at = HERE): Promise<void> => {
  const res = await app.inject({
    method: 'POST',
    url: `/drops/${id}/reveal`,
    headers: headers(WALKER),
    payload: { coordinate: at },
  });
  expect(res.statusCode, res.body).toBe(200);
};

const backdateReveal = (id: string, days: number) =>
  sqlClient`
    UPDATE reveals SET created_at = now() - (${days} * interval '1 day')
    WHERE drop_id = ${id} AND device_id = ${WALKER}
  `;

const echoes = async (
  deviceId: string,
  at = HERE,
  radiusMeters?: number,
): Promise<{ secret: { id: string; body?: string; sealed: boolean }; interval: string; kind: string; stoodAt: number }[]> => {
  const radius = radiusMeters === undefined ? '' : `&radiusMeters=${radiusMeters}`;
  const res = await app.inject({
    method: 'GET',
    url: `/drops/echoes?lat=${at.lat}&lng=${at.lng}${radius}`,
    headers: headers(deviceId),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().echoes;
};

const idsOf = (list: { secret: { id: string } }[]) => list.map(e => e.secret.id);

describe('anniversary echoes', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    remembered = await create('the thing you read here that winter');
    takenDown = await create('the one that got reported');
    recent = await create('read a few months ago, not a year');
    faraway = await create('a year ago, but six hundred metres away', FAR);
    faded = await create('a year ago, and it has since faded');

    await reveal(remembered);
    await reveal(takenDown);
    await reveal(recent);
    await reveal(faraway, FAR);
    await reveal(faded);

    await backdateReveal(remembered, 365);
    await backdateReveal(takenDown, 365);
    await backdateReveal(recent, 100);
    await backdateReveal(faraway, 365);
    await backdateReveal(faded, 365);

    // The author's own anniversary: one drop that was *left* here a year ago.
    await sqlClient`
      UPDATE drops SET created_at = now() - interval '365 days'
      WHERE id = ${remembered}
    `;

    await sqlClient`UPDATE drops SET status = 'hidden' WHERE id = ${takenDown}`;
    await sqlClient`
      UPDATE drops SET expires_at = now() - interval '1 day' WHERE id = ${faded}
    `;
  });

  afterAll(async () => {
    await sqlClient`DELETE FROM reveals WHERE device_id IN (${AUTHOR}, ${WALKER}, ${STRANGER})`;
    await sqlClient`DELETE FROM drops WHERE device_id IN (${AUTHOR}, ${WALKER}, ${STRANGER})`;
    await sqlClient`DELETE FROM devices WHERE id IN (${AUTHOR}, ${WALKER}, ${STRANGER})`;
    await app.close();
    await closeDb();
  });

  describe('what it remembers', () => {
    it('returns the place you stood a year ago', async () => {
      const list = await echoes(WALKER);
      expect(idsOf(list)).toContain(remembered);
    });

    it('tags it with the interval and how you came to be here', async () => {
      const echo = (await echoes(WALKER)).find(e => e.secret.id === remembered)!;
      expect(echo.interval).toBe('1yr');
      expect(echo.kind).toBe('found');
      expect(typeof echo.stoodAt).toBe('number');
    });

    it('calls the author’s own anniversary "dropped", not "found"', async () => {
      // Same drop, different device, different sentence: "you left something
      // here" is not "you found something here".
      const echo = (await echoes(AUTHOR)).find(e => e.secret.id === remembered)!;
      expect(echo.kind).toBe('dropped');
      expect(echo.interval).toBe('1yr');
    });

    it('still echoes a drop that has since faded', async () => {
      // Expiry hides a drop from people who never found it. It does not
      // confiscate one you already stood inside — same rule as the Trail.
      expect(idsOf(await echoes(WALKER))).toContain(faded);
    });

    it('gives the body for a drop this device revealed', async () => {
      const echo = (await echoes(WALKER)).find(e => e.secret.id === remembered)!;
      expect(echo.secret.sealed).toBe(false);
      expect(echo.secret.body).toBe('the thing you read here that winter');
    });
  });

  describe('what it must never remember', () => {
    it('never echoes a drop that moderation took down', async () => {
      // The single most important assertion in the file.
      expect(idsOf(await echoes(WALKER))).not.toContain(takenDown);
    });

    it('ignores an event that is not near an anniversary', async () => {
      expect(idsOf(await echoes(WALKER))).not.toContain(recent);
    });

    it('ignores a place you are not standing near', async () => {
      expect(idsOf(await echoes(WALKER))).not.toContain(faraway);
    });

    it('finds that same place once the radius reaches it', async () => {
      expect(idsOf(await echoes(WALKER, HERE, 800))).toContain(faraway);
    });

    it('tells a device with no history here nothing at all', async () => {
      // Echoes are strictly a device's own past. A stranger standing on the
      // same bridge learns nothing about who stood there before.
      expect(await echoes(STRANGER)).toEqual([]);
    });

    it('does not leak the walker’s past to the author, or the reverse', async () => {
      // The author never revealed `faded`; it is only in their echoes as their
      // own drop, and only because they wrote it.
      const authorIds = idsOf(await echoes(AUTHOR));
      expect(authorIds).not.toContain(faded);
      expect(authorIds).not.toContain(takenDown);
    });
  });

  describe('shape', () => {
    it('returns one echo per drop, even when you dropped and revealed it', async () => {
      // AUTHOR wrote `remembered` a year ago; WALKER revealed it a year ago.
      // Neither device may see the same place twice in one answer.
      for (const device of [AUTHOR, WALKER]) {
        const ids = idsOf(await echoes(device));
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it('rejects a call with no coordinate', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/drops/echoes',
        headers: headers(WALKER),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
