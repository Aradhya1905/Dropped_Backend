/**
 * conditionGate.spec — what a time-gated drop will and won't do over HTTP.
 *
 * Runs against the real app + Postgres, because the claim under test is about
 * the actual response payload: "the UI doesn't show it" is not the same claim
 * as "the server didn't send it".
 *
 * The trick that makes this deterministic without a fake clock: the server
 * decides day-or-night from the **drop's coordinate**, so the fixtures pick
 * their longitude from the current UTC time. One drop is planted where it is
 * local midnight right now, another where it is local noon. The suite is
 * therefore correct at 3 a.m. in Bengaluru and at 3 p.m. in London, and it
 * exercises the real server clock rather than a mocked one.
 *
 * Requires DATABASE_URL and the 0008 migration.
 *
 * NOTE: AUTHOR creates 4 drops here — DROP_DAILY_LIMIT defaults to 5. A fifth
 * would sit on the quota boundary; add another device id rather than another
 * drop.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';
import { isNightAt } from '../src/domain/solar.js';

// Device ids unique to this file. The suite shares one real database and vitest
// runs the files concurrently, so reusing another spec's ids means this file's
// cleanup deletes that file's rows out from under it mid-run.
const AUTHOR = '77777777-dddd-4ddd-8ddd-777777777777';
const WALKER = '88888888-eeee-4eee-8eee-888888888888';
const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

/**
 * A mid-latitude that always has a real sunrise and a real sunset — no polar
 * edge cases, and far from the tropics where the two points would be close in
 * altitude.
 */
const LAT = -35.5;

/** The longitude at which local solar time is `hour` right now. */
function lngWhereLocalHourIs(now: Date, hour: number): number {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const raw = (hour - utcHours) * 15;
  // Wrap into [-180, 180], which is what the coordinate schema accepts.
  return Math.round((((raw + 180) % 360) + 360) % 360) - 180;
}

const NOW = new Date();
/** Local midnight: night here, whenever the suite happens to run. */
const NIGHT_POINT = { lat: LAT, lng: lngWhereLocalHourIs(NOW, 0) };
/** Local noon: broad daylight here, whenever the suite happens to run. */
const DAY_POINT = { lat: LAT, lng: lngWhereLocalHourIs(NOW, 12) };

/** ~33 m north of a point — inside the 50 m reveal radius. */
const closeTo = (p: { lat: number; lng: number }) => ({
  lat: p.lat + 0.0003,
  lng: p.lng,
});
/** ~555 m north — comfortably outside it. */
const farFrom = (p: { lat: number; lng: number }) => ({
  lat: p.lat + 0.005,
  lng: p.lng,
});

const NIGHT_BODY = 'the thing I only admit after the streetlights come on';
const DAY_BODY = 'I have never once said this out loud in the dark';
const UNGATED_BODY = 'no conditions, no cleverness, just a place';

let app: FastifyInstance;
/** No condition at all — the regression fixture. */
let ungatedId: string;
/** Night-gated, planted where it is currently daytime: shut. */
let shutId: string;
/** Night-gated, planted where it is currently night: open. */
let openId: string;
/** Day-gated, planted where it is currently daytime: open. */
let daylitId: string;

async function create(
  body: string,
  coordinate: { lat: number; lng: number },
  revealCondition?: 'night' | 'day',
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/drops',
    headers: headers(AUTHOR),
    payload: { body, mood: 'wonder', coordinate, revealCondition },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

const revealFrom = (id: string, coordinate: { lat: number; lng: number }) =>
  app.inject({
    method: 'POST',
    url: `/drops/${id}/reveal`,
    headers: headers(WALKER),
    payload: { coordinate },
  });

describe('time-gated drops', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // If these two ever disagree with the gate, every assertion below is
    // meaningless — so assert the fixtures before trusting them.
    expect(isNightAt(NOW, NIGHT_POINT.lat, NIGHT_POINT.lng)).toBe(true);
    expect(isNightAt(NOW, DAY_POINT.lat, DAY_POINT.lng)).toBe(false);

    ungatedId = await create(UNGATED_BODY, DAY_POINT);
    shutId = await create(NIGHT_BODY, DAY_POINT, 'night');
    openId = await create(NIGHT_BODY, NIGHT_POINT, 'night');
    daylitId = await create(DAY_BODY, DAY_POINT, 'day');
  });

  afterAll(async () => {
    // By device, not by id: a run that fails partway must not strand rows that
    // then block the devices delete (FK) or eat the next run's daily quota.
    await sqlClient`DELETE FROM drops WHERE device_id IN (${AUTHOR}, ${WALKER})`;
    await sqlClient`DELETE FROM devices WHERE id IN (${AUTHOR}, ${WALKER})`;
    await app.close();
    await closeDb();
  });

  describe('composing', () => {
    it('defaults to no condition — nothing stored, nothing on the wire', async () => {
      const [row] = await sqlClient<{ revealCondition: string | null }[]>`
        SELECT reveal_condition AS "revealCondition"
        FROM drops WHERE id = ${ungatedId}
      `;
      expect(row!.revealCondition).toBeNull();
    });

    it('stores and echoes the author’s chosen condition', async () => {
      const [row] = await sqlClient<{ revealCondition: string | null }[]>`
        SELECT reveal_condition AS "revealCondition"
        FROM drops WHERE id = ${shutId}
      `;
      expect(row!.revealCondition).toBe('night');
    });

    it('refuses a condition that is not night or day', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/drops',
        headers: headers(AUTHOR),
        payload: {
          body: 'open only when it rains, please',
          mood: 'wonder',
          coordinate: DAY_POINT,
          revealCondition: 'rain',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuses to stack conditions — one per drop', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/drops',
        headers: headers(AUTHOR),
        payload: {
          body: 'after dark AND in daylight, somehow',
          mood: 'wonder',
          coordinate: DAY_POINT,
          revealCondition: ['night', 'day'],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('the ungated majority', () => {
    it('reveals exactly as before — the regression this feature must not cause', async () => {
      const res = await revealFrom(ungatedId, closeTo(DAY_POINT));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().body).toBe(UNGATED_BODY);
      expect(res.json().sealed).toBe(false);
    });

    it('carries no revealCondition on the wire', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/drops/nearby?lat=${DAY_POINT.lat}&lng=${DAY_POINT.lng}`,
        headers: headers(WALKER),
      });
      const pin = res
        .json()
        .secrets.find((s: { id: string }) => s.id === ungatedId);
      expect(pin.revealCondition).toBeUndefined();
    });
  });

  describe('right place, wrong hour', () => {
    it('refuses with 403 and says which condition is holding it shut', async () => {
      const res = await revealFrom(shutId, closeTo(DAY_POINT));
      expect(res.statusCode).toBe(403);
      expect(res.json().revealCondition).toBe('night');
    });

    it('names roughly when it opens, so the refusal is an invitation', async () => {
      const res = await revealFrom(shutId, closeTo(DAY_POINT));
      const { opensAt } = res.json();
      expect(typeof opensAt).toBe('number');
      expect(opensAt).toBeGreaterThan(Date.now());
      // Sunset is hours away at local noon, never days.
      expect(opensAt).toBeLessThan(Date.now() + 24 * 3600 * 1000);
    });

    it('does not leak the body in the refusal', async () => {
      const res = await revealFrom(shutId, closeTo(DAY_POINT));
      expect(res.json().body).toBeUndefined();
      // Not just the field — the text must be nowhere in the payload.
      expect(res.body).not.toContain(NIGHT_BODY);
    });

    it('does not record a reveal for a refused attempt', async () => {
      await revealFrom(shutId, closeTo(DAY_POINT));
      const [row] = await sqlClient<{ n: number }[]>`
        SELECT count(*)::int AS n FROM reveals
        WHERE drop_id = ${shutId} AND device_id = ${WALKER}
      `;
      expect(row!.n).toBe(0);
    });
  });

  describe('precedence', () => {
    it('says too far, not too early, when both are true', async () => {
      // 500 m away from a night drop in daylight. The nearer truth is the more
      // useful one — and it means a stranger cannot probe a drop's condition
      // from across town.
      const res = await revealFrom(shutId, farFrom(DAY_POINT));
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe('Too far to reveal');
      expect(typeof res.json().distanceMeters).toBe('number');
      expect(res.json().revealCondition).toBeUndefined();
    });
  });

  describe('right place, right hour', () => {
    it('opens a night drop that is standing in the dark', async () => {
      const res = await revealFrom(openId, closeTo(NIGHT_POINT));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().body).toBe(NIGHT_BODY);
    });

    it('opens a day drop that is standing in daylight', async () => {
      const res = await revealFrom(daylitId, closeTo(DAY_POINT));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().body).toBe(DAY_BODY);
    });
  });

  describe('the hint before the walk', () => {
    it('tells a sealed pin when it opens, without telling it what it says', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/drops/nearby?lat=${DAY_POINT.lat}&lng=${DAY_POINT.lng}`,
        headers: headers(WALKER),
      });
      const pin = res
        .json()
        .secrets.find((s: { id: string }) => s.id === shutId);
      expect(pin.sealed).toBe(true);
      expect(pin.revealCondition).toBe('night');
      expect(pin.body).toBeUndefined();
    });
  });
});
