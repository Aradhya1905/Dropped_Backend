/**
 * preview.spec — what a shared link may and may not tell a stranger.
 *
 * `GET /drops/:id/preview` is the only route that answers someone who has done
 * nothing but hold an id: no walk, no reveal, no relationship to the drop. So
 * the interesting assertions are all about what is *absent* from the response,
 * and about the three states (hidden / pending / expired) that must be
 * indistinguishable from "never existed".
 *
 * Runs against the real app + Postgres because status and expiry are SQL
 * predicates evaluated against the database's own clock. Requires DATABASE_URL.
 *
 * NOTE: AUTHOR creates exactly 4 drops (DROP_DAILY_LIMIT is 5). A sixth would
 * 429. Prefer another device id over another drop.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';
import { haversineMeters } from '../src/domain/geo.js';

// Ids unique to this file — the suite shares one database and vitest runs
// files concurrently, so reusing another spec's ids means this file's cleanup
// deletes that file's rows mid-run. Before adding a spec, grep the others:
// this file and whisper.spec both independently reached for 3333…/4444… and
// the collision only surfaced when the two branches merged.
//
// Taken so far: 1111/2222 (expiryGate), 3333/4444 (whisper),
// aaaa/bbbb (reveal), dddd/eeee/ffff (reply).
const AUTHOR = '55555555-bbbb-4bbb-8bbb-555555555555';
const STRANGER = '66666666-cccc-4ccc-8ccc-666666666666';
const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

// A quiet patch of ocean of its own, at deliberately awkward precision so the
// coarsening is visible in the assertions.
const DROP_POINT = { lat: -30.123456, lng: -50.654321 };

let app: FastifyInstance;
let visibleId: string;
let hiddenId: string;
let expiredId: string;
let privateId: string;

const create = async (body: string, shareable?: boolean): Promise<string> => {
  const res = await app.inject({
    method: 'POST',
    url: '/drops',
    headers: headers(AUTHOR),
    payload: {
      body,
      mood: 'ache',
      coordinate: DROP_POINT,
      placeLabel: 'The bench by the water',
      city: 'Nowhere',
      ...(shareable === undefined ? {} : { shareable }),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

const preview = (id: string, deviceId = STRANGER) =>
  app.inject({
    method: 'GET',
    url: `/drops/${id}/preview`,
    headers: headers(deviceId),
  });

describe('share-a-spot preview', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    visibleId = await create('the one you can still be pointed at');
    hiddenId = await create('taken down by moderation');
    expiredId = await create('this one has already faded');
    privateId = await create('for whoever walks past, not for a group chat', false);

    await sqlClient`UPDATE drops SET status = 'hidden' WHERE id = ${hiddenId}`;
    await sqlClient`
      UPDATE drops SET expires_at = now() - interval '1 minute'
      WHERE id = ${expiredId}
    `;
  });

  afterAll(async () => {
    await sqlClient`DELETE FROM drops WHERE device_id IN (${AUTHOR}, ${STRANGER})`;
    await sqlClient`DELETE FROM devices WHERE id IN (${AUTHOR}, ${STRANGER})`;
    await app.close();
    await closeDb();
  });

  describe('what it gives a stranger', () => {
    it('answers 200 without any reveal on record', () => {
      // The whole point of the growth loop: you can be handed a place before
      // you have earned anything.
      return preview(visibleId).then((res) => {
        expect(res.statusCode).toBe(200);
      });
    });

    it('carries the metadata that makes a link worth tapping', async () => {
      const res = await preview(visibleId);
      const json = res.json();
      expect(json.id).toBe(visibleId);
      expect(json.placeLabel).toBe('The bench by the water');
      expect(json.city).toBe('Nowhere');
      expect(json.mood).toBe('ache');
      expect(typeof json.createdAt).toBe('number');
      expect(json.revealCount).toBe(0);
    });
  });

  describe('what it must never give', () => {
    it('has no body field at all — not empty, absent', async () => {
      // The single most important assertion in the file. A shared link that
      // carries the confession makes the 50 m gate decorative.
      const res = await preview(visibleId);
      expect(res.json()).not.toHaveProperty('body');
    });

    it('never carries the sealed/saved/hearted device relationship', async () => {
      const json = (await preview(visibleId)).json();
      for (const key of ['sealed', 'saved', 'hearted', 'stoodHere']) {
        expect(json, key).not.toHaveProperty(key);
      }
    });

    it('coarsens the coordinate rather than returning the stored point', async () => {
      const json = (await preview(visibleId)).json();
      expect(json.coordinate.lat).not.toBe(DROP_POINT.lat);
      expect(json.coordinate.lng).not.toBe(DROP_POINT.lng);
    });

    it('rounds to 3 decimal places, server-side', async () => {
      const json = (await preview(visibleId)).json();
      expect(json.coordinate.lat).toBe(-30.123);
      expect(json.coordinate.lng).toBe(-50.654);
    });

    it('lands within ~110 m of the truth — coarse, not wrong', async () => {
      // Coarse enough that the link cannot pinpoint the author's drop-off;
      // close enough that walking to it puts you in reveal range's neighbourhood.
      const json = (await preview(visibleId)).json();
      expect(haversineMeters(DROP_POINT, json.coordinate)).toBeLessThan(110);
    });
  });

  describe('drops a link must not resolve', () => {
    it('404s a hidden drop', async () => {
      const res = await preview(hiddenId);
      expect(res.statusCode).toBe(404);
    });

    it('404s an expired drop', async () => {
      const res = await preview(expiredId);
      expect(res.statusCode).toBe(404);
    });

    it('404s an id that never existed', async () => {
      const res = await preview('00000000-0000-4000-8000-000000000000');
      expect(res.statusCode).toBe(404);
    });

    it('gives a hidden drop and a nonexistent one the same answer', async () => {
      // A 403 here, or a different message, would confirm to anyone holding a
      // link that the drop is real and merely under moderation.
      const hidden = await preview(hiddenId);
      const missing = await preview('00000000-0000-4000-8000-000000000000');
      expect(hidden.statusCode).toBe(missing.statusCode);
      expect(hidden.json().message).toBe(missing.json().message);
    });

    it('rejects a malformed id before it reaches the database', async () => {
      const res = await preview('not-a-uuid');
      expect(res.statusCode).toBe(400);
    });
  });

  describe('the author opt-out', () => {
    it('defaults to shareable when the author says nothing', async () => {
      const res = await preview(visibleId);
      expect(res.statusCode).toBe(200);
    });

    it('404s a drop the author opted out of sharing', async () => {
      const res = await preview(privateId);
      expect(res.statusCode).toBe(404);
    });

    it('still lets someone standing there reveal an opted-out drop', async () => {
      // The opt-out is on the *link*, not on the drop. Walking past it is the
      // premise of the app and must be untouched by declining to be shared.
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${privateId}/reveal`,
        headers: headers(STRANGER),
        // ~33 m north of the drop — inside the 50 m radius.
        payload: {
          coordinate: { lat: DROP_POINT.lat + 0.0003, lng: DROP_POINT.lng },
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().body).toBe('for whoever walks past, not for a group chat');
    });

    it('tells every reader whether a drop can be shared', async () => {
      // Not just the author: a reader whose share sheet produced a link that
      // 404s for the recipient is a worse experience than no share button.
      const res = await app.inject({
        method: 'GET',
        url: `/drops/nearby?lat=${DROP_POINT.lat}&lng=${DROP_POINT.lng}`,
        headers: headers(STRANGER),
      });
      const secrets = res.json().secrets as { id: string; shareable: boolean }[];
      expect(secrets.find(s => s.id === visibleId)?.shareable).toBe(true);
      expect(secrets.find(s => s.id === privateId)?.shareable).toBe(false);
    });
  });
});
