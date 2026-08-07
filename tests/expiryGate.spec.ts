/**
 * expiryGate.spec — what an expired drop is and isn't allowed to do.
 *
 * Runs against the real app + Postgres, because the guarantee is a SQL
 * predicate: the filtering happens against the database's `now()`, so asserting
 * it in JS would assert nothing. Drives the HTTP surface via inject() and
 * cleans up its own rows.
 *
 * The pairing matters more than either half. If only `nearby` filtered, an
 * expired drop would vanish from the map while staying revealable by anyone who
 * still had its id — the leak this file exists to catch.
 *
 * Requires DATABASE_URL and the 0005 migration.
 *
 * NOTE: AUTHOR creates exactly DROP_DAILY_LIMIT (5) drops across this file —
 * three fixtures plus two throwaways. A sixth create would hit the quota and
 * fail with 429; add another device id rather than another drop.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';

// Device ids unique to this file. The suite shares one real database and
// vitest runs the files concurrently, so reusing another spec's ids means this
// file's cleanup deletes that file's rows out from under it mid-run.
const AUTHOR = '11111111-7777-4777-8777-111111111111';
const WALKER = '22222222-8888-4888-8888-222222222222';
const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

// A quiet patch of ocean, away from the other specs' points and any seed rows.
const DROP_POINT = { lat: -20.0, lng: -40.0 };
// ~33 m north — inside the 50 m reveal radius.
const AT_THE_DROP = { lat: DROP_POINT.lat + 0.0003, lng: DROP_POINT.lng };

let app: FastifyInstance;
/** Fades in 7 days — visible throughout. */
let liveId: string;
/** Backdated to already-expired once the fixtures are set up. */
let expiredId: string;
/** Revealed and saved by WALKER *before* it expires. */
let claimedId: string;

const create = async (body: string, expiresInDays?: 7 | 30): Promise<string> => {
  const res = await app.inject({
    method: 'POST',
    url: '/drops',
    headers: headers(AUTHOR),
    payload: { body, mood: 'wonder', coordinate: DROP_POINT, expiresInDays },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

const nearbyIds = async (deviceId: string): Promise<string[]> => {
  const res = await app.inject({
    method: 'GET',
    url: `/drops/nearby?lat=${DROP_POINT.lat}&lng=${DROP_POINT.lng}`,
    headers: headers(deviceId),
  });
  expect(res.statusCode).toBe(200);
  return res.json().secrets.map((s: { id: string }) => s.id);
};

const trailIds = async (
  deviceId: string,
  kind: 'found' | 'saved' | 'dropped',
): Promise<string[]> => {
  const res = await app.inject({
    method: 'GET',
    url: `/drops/trail/${kind}`,
    headers: headers(deviceId),
  });
  expect(res.statusCode).toBe(200);
  return res.json().secrets.map((s: { id: string }) => s.id);
};

describe('expiring drops', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    liveId = await create('still here, still findable', 7);
    expiredId = await create('this one has already faded');
    claimedId = await create('found before it faded');

    // Claim the third one while it is still alive: reveal it (which is what
    // "found" means) and save it.
    const revealed = await app.inject({
      method: 'POST',
      url: `/drops/${claimedId}/reveal`,
      headers: headers(WALKER),
      payload: { coordinate: AT_THE_DROP },
    });
    expect(revealed.statusCode).toBe(200);

    const saved = await app.inject({
      method: 'POST',
      url: `/drops/${claimedId}/save`,
      headers: headers(WALKER),
      // The header declares JSON, so Fastify rejects a genuinely empty body.
      payload: {},
    });
    expect(saved.statusCode).toBe(200);

    // Now expire two of them. Backdating in SQL rather than waiting is the
    // only way to test a 7-day window in a 20-second suite.
    await sqlClient`
      UPDATE drops SET expires_at = now() - interval '1 minute'
      WHERE id IN (${expiredId}, ${claimedId})
    `;
  });

  afterAll(async () => {
    // By device, not by id: this spec creates throwaway drops inside individual
    // tests too, and a run that fails partway must not strand rows that then
    // block the devices delete (FK) or eat the next run's daily quota.
    await sqlClient`DELETE FROM drops WHERE device_id IN (${AUTHOR}, ${WALKER})`;
    await sqlClient`DELETE FROM devices WHERE id IN (${AUTHOR}, ${WALKER})`;
    await app.close();
    await closeDb();
  });

  describe('creating', () => {
    it('defaults to forever — no expiresAt on the wire', async () => {
      const id = await create('forever, because nobody chose otherwise');
      const [row] = await sqlClient<{ expiresAt: Date | null }[]>`
        SELECT expires_at AS "expiresAt" FROM drops WHERE id = ${id}
      `;
      expect(row!.expiresAt).toBeNull();
      await sqlClient`DELETE FROM drops WHERE id = ${id}`;
    });

    it('computes expires_at server-side from a duration', async () => {
      const [row] = await sqlClient<{ days: number }[]>`
        SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS days
        FROM drops WHERE id = ${liveId}
      `;
      expect(Number(row!.days)).toBeCloseTo(7, 2);
    });

    it('refuses a lifespan that is not 7 or 30', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/drops',
        headers: headers(AUTHOR),
        payload: {
          body: 'a year sounds about right',
          mood: 'wonder',
          coordinate: DROP_POINT,
          expiresInDays: 365,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('ignores a client-supplied expires_at — the server owns the clock', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/drops',
        headers: headers(AUTHOR),
        payload: {
          body: 'I would like to never expire, thanks',
          mood: 'wonder',
          coordinate: DROP_POINT,
          expiresInDays: 7,
          expiresAt: Date.now() + 999 * 24 * 3600 * 1000,
        },
      });
      expect(res.statusCode).toBe(201);
      const id = res.json().id;
      const [row] = await sqlClient<{ days: number }[]>`
        SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS days
        FROM drops WHERE id = ${id}
      `;
      expect(Number(row!.days)).toBeCloseTo(7, 2);
      await sqlClient`DELETE FROM drops WHERE id = ${id}`;
    });
  });

  describe('once expired', () => {
    it('leaves the nearby query', async () => {
      const ids = await nearbyIds(WALKER);
      expect(ids).not.toContain(expiredId);
    });

    it('leaves an unexpired drop at the same spot alone', async () => {
      const ids = await nearbyIds(WALKER);
      expect(ids).toContain(liveId);
    });

    it('surfaces expiresAt on a live drop so the client can count down', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/drops/nearby?lat=${DROP_POINT.lat}&lng=${DROP_POINT.lng}`,
        headers: headers(WALKER),
      });
      const live = res
        .json()
        .secrets.find((s: { id: string }) => s.id === liveId);
      expect(typeof live.expiresAt).toBe('number');
      expect(live.expiresAt).toBeGreaterThan(Date.now());
    });

    it('cannot be revealed even from right on top of it (404, not a blank body)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${expiredId}/reveal`,
        headers: headers(WALKER),
        payload: { coordinate: AT_THE_DROP },
      });
      // 404 — the same answer as a drop that never existed. Standing in the
      // right place must not be enough once it has faded.
      expect(res.statusCode).toBe(404);
      expect(res.json().body).toBeUndefined();
    });

    it('is not hard-deleted — the row survives for moderation history', async () => {
      const [row] = await sqlClient<{ n: number }[]>`
        SELECT count(*)::int AS n FROM drops WHERE id = ${expiredId}
      `;
      expect(row!.n).toBe(1);
    });
  });

  describe('what expiry does not take away', () => {
    it('keeps the author’s own expired drop in their dropped trail', async () => {
      const ids = await trailIds(AUTHOR, 'dropped');
      expect(ids).toContain(expiredId);
    });

    it('keeps a saved drop readable to whoever saved it', async () => {
      // Otherwise the save button is a lie.
      const ids = await trailIds(WALKER, 'saved');
      expect(ids).toContain(claimedId);
    });

    it('keeps a found drop in the finder’s found trail', async () => {
      const ids = await trailIds(WALKER, 'found');
      expect(ids).toContain(claimedId);
    });

    it('still serves the body of a drop you already revealed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/drops/trail/found',
        headers: headers(WALKER),
      });
      const mine = res
        .json()
        .secrets.find((s: { id: string }) => s.id === claimedId);
      expect(mine.sealed).toBe(false);
      expect(mine.body).toBe('found before it faded');
    });
  });
});
