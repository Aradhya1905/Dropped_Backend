/**
 * erase.spec — `DELETE /devices/me`, the server half of the panic wipe.
 *
 * What this file is really guarding, in order of how much it would hurt to get
 * wrong:
 *
 * - **The wipe does not fail.** Nothing in the schema cascades on `device_id`,
 *   so the delete only works if every child table is cleared or re-pointed
 *   first. A missed table is a 500 on the one request a frightened user needs
 *   to succeed.
 * - **What survives, survives.** Drops and replies are anonymised, not deleted —
 *   somebody else walked 50 m to read them. A stranger must still be able to
 *   read them afterwards.
 * - **What goes, is gone.** Reveals, saves, hearts, reports, steps, and the
 *   device row itself. Re-registering the same id must return an empty history,
 *   not the old one.
 * - **The counters tell the truth afterwards.** `heart_count`, `reveal_count`
 *   and `stood_here` are denormalised onto drops that other people read. An
 *   erasure that leaves them inflated silently lies about how many people have
 *   stood somewhere.
 * - **Two erased authors can have replied to the same drop.** The unique index
 *   on (drop_id, device_id) is partial for exactly this reason; if it were not,
 *   the second person to ask for erasure would be refused because of the first.
 *
 * Runs against the real app + Postgres. Requires DATABASE_URL.
 *
 * NOTE: DROP_DAILY_LIMIT is 5 per device. No device here creates more.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';
import { DELETED_DEVICE_ID } from '../src/db/schema.js';

// Ids unique to this file — the suite shares one database and each spec cleans
// up by device id. Taken so far: 1111/2222 (expiryGate), 3333/4444 (whisper),
// 5555/6666 (preview), aaaa/bbbb (reveal), dddd/eeee/ffff (reply),
// 7777/8888/9999 (echoes, conditionGate), cccc/1212/1313 (cities).
const WIPER = '14141414-4141-4141-8141-141414141414';
const NEIGHBOUR = '15151515-5151-4151-8151-151515151515';
const STRANGER = '16161616-6161-4161-8161-161616161616';
/** A second device that also erases itself, to exercise the partial index. */
const WIPER2 = '17171717-7171-4171-8171-171717171717';

const ALL = [WIPER, NEIGHBOUR, STRANGER, WIPER2];

const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

/** This file's own patch of ocean, well away from every other spec's. */
const HERE = { lat: -41.313131, lng: 149.171717 };

let app: FastifyInstance;

/** NEIGHBOUR's drop — the one WIPER reveals, hearts, saves, replies to. */
let neighbourDrop: string;
/** WIPER's own drops. Must outlive it. */
let wiperDrop: string;
let wiperDrop2: string;
/** WIPER's reply on `neighbourDrop`, and WIPER2's on the same drop. */
let wiperReply: string;

const create = async (deviceId: string, body: string): Promise<string> => {
  const res = await app.inject({
    method: 'POST',
    url: '/drops',
    headers: headers(deviceId),
    payload: { body, mood: 'ache', coordinate: HERE, placeLabel: 'The pier' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

const reveal = async (deviceId: string, dropId: string) => {
  const res = await app.inject({
    method: 'POST',
    url: `/drops/${dropId}/reveal`,
    headers: headers(deviceId),
    payload: { coordinate: HERE },
  });
  expect(res.statusCode, res.body).toBe(200);
};

const replyTo = async (
  deviceId: string,
  dropId: string,
  body: string,
): Promise<string> => {
  const res = await app.inject({
    method: 'POST',
    url: `/drops/${dropId}/replies`,
    headers: headers(deviceId),
    payload: { body },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

const erase = async (deviceId: string) => {
  const res = await app.inject({
    method: 'DELETE',
    url: '/devices/me',
    // No content-type: the route takes no body, and Fastify rejects an empty
    // one as 400 when the header claims JSON.
    headers: { 'x-device-id': deviceId },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

const dropRow = async (id: string) => {
  const rows = await sqlClient<
    {
      deviceId: string;
      status: string;
      heartCount: number;
      revealCount: number;
      stoodHere: number;
      replyCount: number;
    }[]
  >`
    SELECT device_id AS "deviceId", status,
           heart_count AS "heartCount", reveal_count AS "revealCount",
           stood_here AS "stoodHere", reply_count AS "replyCount"
    FROM drops WHERE id = ${id}
  `;
  return rows[0];
};

const countBy = async (table: string, deviceId: string): Promise<number> => {
  const rows = await sqlClient<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM ${sqlClient(table)} WHERE device_id = ${deviceId}
  `;
  return rows[0]?.n ?? 0;
};

describe('DELETE /devices/me — panic wipe', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    neighbourDrop = await create(NEIGHBOUR, 'the tide came in early');
    wiperDrop = await create(WIPER, 'i never told anyone this');
    wiperDrop2 = await create(WIPER, 'and i never will');

    // WIPER leaves a full trail behind: revealed, hearted, saved, replied,
    // reported, and walked. Every one of those is a row that must be cleared
    // before the device row can go.
    await reveal(WIPER, neighbourDrop);
    await app.inject({
      method: 'POST',
      url: `/drops/${neighbourDrop}/heart`,
      headers: headers(WIPER),
    });
    await app.inject({
      method: 'POST',
      url: `/drops/${neighbourDrop}/save`,
      headers: headers(WIPER),
    });
    wiperReply = await replyTo(WIPER, neighbourDrop, 'i know that pier');
    await app.inject({
      method: 'POST',
      url: `/drops/${neighbourDrop}/report`,
      headers: headers(WIPER),
      payload: { reason: 'not for me' },
    });
    await app.inject({
      method: 'POST',
      url: '/devices/me/steps',
      headers: headers(WIPER),
      payload: { entries: [{ day: '2026-08-01', delta: 4000 }] },
    });

    // A second device that will also erase itself, replying to the same drop.
    // Both replies end up owned by the sentinel — the case the partial unique
    // index exists for.
    await reveal(WIPER2, neighbourDrop);
    await replyTo(WIPER2, neighbourDrop, 'i walked it every winter');

    // STRANGER never erases anything: they are the eyes that prove the
    // anonymised content is still readable afterwards.
    await reveal(STRANGER, wiperDrop);
    await reveal(STRANGER, neighbourDrop);
    await app.inject({
      method: 'POST',
      url: `/drops/${neighbourDrop}/heart`,
      headers: headers(STRANGER),
    });
  });

  afterAll(async () => {
    // Deleting the drops cascades their reveals / saves / hearts / replies /
    // reports, including the ones this spec left owned by the sentinel — which
    // is why the sentinel row itself is never touched here. 0009 owns it, and
    // other specs' anonymised rows are none of this file's business.
    await sqlClient`
      DELETE FROM drops WHERE id IN (${neighbourDrop}, ${wiperDrop}, ${wiperDrop2})
    `;
    // device_steps hangs off the device, not off a drop, so it needs saying.
    await sqlClient`
      DELETE FROM device_steps WHERE device_id IN ${sqlClient(ALL)}
    `;
    await sqlClient`DELETE FROM devices WHERE id IN ${sqlClient(ALL)}`;
    await app.close();
    await closeDb();
  });

  describe('the receipt', () => {
    it('names what it destroyed and what it left standing', async () => {
      const receipt = await erase(WIPER);

      expect(receipt.deleted).toEqual({
        reveals: 1,
        saves: 1,
        hearts: 1,
        reports: 1,
        stepDays: 1,
      });
      // Two drops and one reply survive — the client's confirmation copy is
      // built from exactly these numbers, so they are the contract.
      expect(receipt.anonymised).toEqual({ drops: 2, replies: 1 });
    });

    it('removes the device row itself', async () => {
      // Not merely emptied — the identity stops existing. Asserted here, before
      // any later test makes a request: the X-Device-Id plugin re-registers a
      // device on the way in, so the row comes back the moment anything asks.
      const rows = await sqlClient`SELECT 1 FROM devices WHERE id = ${WIPER}`;
      expect(rows).toHaveLength(0);
    });

    it('is idempotent — erasing again is a no-op, not a 500', async () => {
      // The deviceId plugin re-registers the row on the way in, so the second
      // call meets a device with no history at all.
      const receipt = await erase(WIPER);
      expect(receipt.deleted.reveals).toBe(0);
      expect(receipt.anonymised.drops).toBe(0);
    });
  });

  describe('what is gone', () => {
    it('leaves no row anywhere keyed to the device', async () => {
      for (const table of [
        'reveals',
        'saves',
        'hearts',
        'reports',
        'device_steps',
      ]) {
        expect(await countBy(table, WIPER), table).toBe(0);
      }
    });

    it('gives the same id back an empty history', async () => {
      // A client that kept its old id must not walk back into its old life.
      const res = await app.inject({
        method: 'GET',
        url: '/devices/me/stats',
        headers: headers(WIPER),
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().droppedTotal).toBe(0);
      expect(res.json().foundTotal).toBe(0);

      const trail = await app.inject({
        method: 'GET',
        url: '/drops/trail/dropped',
        headers: headers(WIPER),
      });
      expect(trail.json().total).toBe(0);
    });
  });

  describe('what survives', () => {
    it('keeps the erased author’s drops on the map', async () => {
      const row = await dropRow(wiperDrop);
      expect(row?.status).toBe('visible');
      expect(row?.deviceId).toBe(DELETED_DEVICE_ID);
    });

    it('lets a stranger still read one', async () => {
      // The whole justification for anonymising rather than deleting: somebody
      // already walked 50 m to this. It does not get to disappear on them.
      const res = await app.inject({
        method: 'GET',
        url: '/drops/trail/found',
        headers: headers(STRANGER),
      });
      const found = res
        .json()
        .secrets.find((s: { id: string }) => s.id === wiperDrop);
      expect(found).toBeDefined();
      expect(found.body).toBe('i never told anyone this');
    });

    it('keeps the reply, owned by the sentinel', async () => {
      const rows = await sqlClient<{ deviceId: string; status: string }[]>`
        SELECT device_id AS "deviceId", status FROM replies WHERE id = ${wiperReply}
      `;
      expect(rows[0]?.deviceId).toBe(DELETED_DEVICE_ID);
      expect(rows[0]?.status).toBe('visible');
    });

    it('still shows that reply to someone who stood there', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/drops/${neighbourDrop}/replies`,
        headers: headers(STRANGER),
      });
      expect(res.statusCode, res.body).toBe(200);
      const bodies = res.json().replies.map((r: { body: string }) => r.body);
      expect(bodies).toContain('i know that pier');
    });

    it('does not hand the reply to anyone as theirs', async () => {
      // `mine` is what grants the delete button. An anonymised reply belongs to
      // nobody, so nobody may take it down.
      const res = await app.inject({
        method: 'GET',
        url: `/drops/${neighbourDrop}/replies`,
        headers: headers(STRANGER),
      });
      for (const r of res.json().replies) expect(r.mine).toBe(false);
    });
  });

  describe('the counters other people read', () => {
    it('gives back the heart', async () => {
      // WIPER and STRANGER both hearted it; only STRANGER's should remain.
      const row = await dropRow(neighbourDrop);
      expect(row?.heartCount).toBe(1);
    });

    it('gives back the reveal and the footprint', async () => {
      // Revealed by WIPER, WIPER2 and STRANGER. WIPER is gone; the other two
      // are still standing there.
      const row = await dropRow(neighbourDrop);
      expect(row?.revealCount).toBe(2);
      expect(row?.stoodHere).toBe(2);
    });

    it('leaves reply_count alone — an anonymised reply is still a voice', async () => {
      const row = await dropRow(neighbourDrop);
      expect(row?.replyCount).toBe(2);
    });

    it('never drives a counter negative', async () => {
      const rows = await sqlClient<{ n: number }[]>`
        SELECT count(*)::int AS n FROM drops
        WHERE heart_count < 0 OR reveal_count < 0 OR stood_here < 0
      `;
      expect(rows[0]?.n).toBe(0);
    });
  });

  describe('moderation', () => {
    it('takes the reporter’s row with them', async () => {
      const rows = await sqlClient<{ n: number }[]>`
        SELECT count(*)::int AS n FROM reports WHERE device_id = ${WIPER}
      `;
      expect(rows[0]?.n).toBe(0);
    });

    it('does not un-hide anything', async () => {
      // A verdict already reached is not reversed by the reporter leaving —
      // otherwise "delete my account" becomes a way to unreport content.
      const row = await dropRow(neighbourDrop);
      expect(row?.status).toBe('visible'); // one report, below the threshold
    });
  });

  describe('a second erasure', () => {
    it('succeeds even though both replied to the same drop', async () => {
      // The partial unique index earns its keep here. With the full index this
      // UPDATE collides with WIPER's already-anonymised reply and the whole
      // transaction rolls back — the second person to ask for erasure would be
      // refused because of the first.
      const receipt = await erase(WIPER2);
      expect(receipt.anonymised.replies).toBe(1);
      expect(receipt.deleted.reveals).toBe(1);

      const rows = await sqlClient<{ n: number }[]>`
        SELECT count(*)::int AS n FROM replies
        WHERE drop_id = ${neighbourDrop} AND device_id = ${DELETED_DEVICE_ID}
      `;
      expect(rows[0]?.n).toBe(2);
    });
  });

  describe('replying still works afterwards', () => {
    it('accepts a new reply and still holds one-per-device', async () => {
      // Guards the other half of the partial-index change: `ON CONFLICT
      // (drop_id, device_id) WHERE …` must still infer the index, or every
      // reply insert fails outright with "no unique or exclusion constraint
      // matching the ON CONFLICT specification".
      const first = await app.inject({
        method: 'POST',
        url: `/drops/${neighbourDrop}/replies`,
        headers: headers(STRANGER),
        payload: { body: 'i saw the tide too' },
      });
      expect(first.statusCode, first.body).toBe(201);

      // A second attempt is treated as a retry, not an error (reply.service
      // returns the reply already left), so the tell is the id and the body —
      // not the status.
      const second = await app.inject({
        method: 'POST',
        url: `/drops/${neighbourDrop}/replies`,
        headers: headers(STRANGER),
        payload: { body: 'saying it twice' },
      });
      expect(second.json().id).toBe(first.json().id);
      expect(second.json().body).toBe('i saw the tide too');
    });
  });
});
