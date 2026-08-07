/**
 * reply.spec — replies in place, end to end against the real app + PostGIS.
 *
 * The guarantee under test: a device with no `reveals` row can neither READ nor
 * WRITE replies — 403 on both, not an empty list. Also pins the one-per-device
 * rule, the moderation path, and the fact that authorship never appears on the
 * wire.
 *
 * Requires DATABASE_URL. Cleans up its own rows.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';

const AUTHOR = 'dddddddd-4444-4444-8444-dddddddddddd';
const WALKER = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const STRANGER = 'ffffffff-6666-4666-8666-ffffffffffff';
const DEVICE_IDS = [AUTHOR, WALKER, STRANGER];

const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});
/** DELETE carries no body — declaring a JSON content-type without one is a 400. */
const noBodyHeaders = (id: string) => ({ 'x-device-id': id });

// A quiet patch of ocean, distinct from reveal.spec's, so the two can run
// together without their nearby queries seeing each other's rows.
const DROP_POINT = { lat: -20.0, lng: -40.0 };
/** ~33 m north — comfortably inside the 50 m radius. */
const NEAR = { lat: DROP_POINT.lat + 0.0003, lng: DROP_POINT.lng };
/** ~1.1 km north — far outside. */
const FAR = { lat: DROP_POINT.lat + 0.01, lng: DROP_POINT.lng };

let app: FastifyInstance;
let dropId: string;
let replyId: string;

describe('replies in place', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/drops',
      headers: headers(AUTHOR),
      payload: {
        body: 'I sat on this bench and decided to leave',
        mood: 'ache',
        coordinate: DROP_POINT,
      },
    });
    expect(res.statusCode).toBe(201);
    dropId = res.json().id;
  });

  afterAll(async () => {
    // replies + reports cascade from drops.
    await sqlClient`DELETE FROM drops WHERE id = ${dropId}`;
    await sqlClient`DELETE FROM devices WHERE id IN ${sqlClient(DEVICE_IDS)}`;
    await app.close();
    await closeDb();
  });

  describe('the gate — you must have stood here', () => {
    it('refuses to LIST replies for a device that has not revealed (403, not [])', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/drops/${dropId}/replies`,
        headers: headers(STRANGER),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/stand here/i);
      expect(res.json().replies).toBeUndefined();
    });

    it('refuses to WRITE a reply for a device that has not revealed (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/replies`,
        headers: headers(STRANGER),
        payload: { body: 'I was never here' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('refuses the author too, until they walk back and reveal', async () => {
      // Authoring is not standing there. Same 403 as a stranger.
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/replies`,
        headers: headers(AUTHOR),
        payload: { body: 'replying to my own drop' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a failed reveal from far away does not open the gate', async () => {
      const reveal = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/reveal`,
        headers: headers(STRANGER),
        payload: { coordinate: FAR },
      });
      expect(reveal.statusCode).toBe(403);

      const res = await app.inject({
        method: 'GET',
        url: `/drops/${dropId}/replies`,
        headers: headers(STRANGER),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('after revealing', () => {
    beforeAll(async () => {
      const reveal = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/reveal`,
        headers: headers(WALKER),
        payload: { coordinate: NEAR },
      });
      expect(reveal.statusCode).toBe(200);
    });

    it('lists replies (empty at first) instead of 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/drops/${dropId}/replies`,
        headers: headers(WALKER),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ replies: [], total: 0 });
    });

    it('accepts a reply and returns it without any authorship', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/replies`,
        headers: headers(WALKER),
        payload: { body: 'I sat here too. It got better.' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      replyId = body.id;

      expect(body.body).toBe('I sat here too. It got better.');
      expect(body.mine).toBe(true);
      // Authorship never leaves the server. Assert on the key set so this
      // fails if someone adds a device id (hashed or otherwise) later.
      expect(Object.keys(body).sort()).toEqual([
        'body',
        'createdAt',
        'id',
        'mine',
      ]);
    });

    it('bumps reply_count on the drop', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/drops/nearby?lat=${DROP_POINT.lat}&lng=${DROP_POINT.lng}`,
        headers: headers(WALKER),
      });
      const mine = res
        .json()
        .secrets.find((s: { id: string }) => s.id === dropId);
      expect(mine.replyCount).toBe(1);
    });

    it('treats a second reply on the same drop as the existing one', async () => {
      // The unique index makes a retried-but-already-succeeded request safe:
      // the device gets its own reply back, not an error to render.
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/replies`,
        headers: headers(WALKER),
        payload: { body: 'a different second line' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe(replyId);
      expect(res.json().body).toBe('I sat here too. It got better.');

      const list = await app.inject({
        method: 'GET',
        url: `/drops/${dropId}/replies`,
        headers: headers(WALKER),
      });
      expect(list.json().total).toBe(1);
    });

    it('rejects a body over 140 characters (400 from the schema)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/replies`,
        headers: headers(AUTHOR),
        payload: { body: 'x'.repeat(141) },
      });
      expect(res.statusCode).toBe(400);
    });

    it('blocks a reply that fails moderation (422)', async () => {
      // The author reveals their own drop first so only moderation can refuse.
      const reveal = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/reveal`,
        headers: headers(AUTHOR),
        payload: { coordinate: NEAR },
      });
      expect(reveal.statusCode).toBe(200);

      const res = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/replies`,
        headers: headers(AUTHOR),
        payload: { body: 'call me at 555 123 4567' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/personal info/i);
    });

    it('stores a soft-flagged reply but hides it from everyone', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/drops/${dropId}/replies`,
        headers: headers(AUTHOR),
        payload: { body: 'you are pathetic' },
      });
      expect(res.statusCode).toBe(201);

      // Written, but pending review — invisible in the list and uncounted.
      const list = await app.inject({
        method: 'GET',
        url: `/drops/${dropId}/replies`,
        headers: headers(WALKER),
      });
      expect(list.json().total).toBe(1);
      expect(
        list.json().replies.some((r: { body: string }) => r.body.includes('pathetic')),
      ).toBe(false);
    });

    it('refuses to delete someone else’s reply (403)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/drops/${dropId}/replies/${replyId}`,
        headers: noBodyHeaders(AUTHOR),
      });
      expect(res.statusCode).toBe(403);
    });

    it('deletes your own reply and decrements the count', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/drops/${dropId}/replies/${replyId}`,
        headers: noBodyHeaders(WALKER),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ deleted: true });

      const rows = await sqlClient<{ replyCount: number }[]>`
        SELECT reply_count AS "replyCount" FROM drops WHERE id = ${dropId}
      `;
      expect(rows[0]?.replyCount).toBe(0);
    });
  });
});
