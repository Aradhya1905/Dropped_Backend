/**
 * reveal.spec — spoof-resistance, the part that must not break.
 *
 * Runs against the real app + PostGIS (Neon), because the guarantee IS that the
 * server's ST_DWithin recheck — not the client's claim — decides the reveal.
 * Drives the HTTP surface via Fastify's inject(), and cleans up its own rows.
 *
 * Requires DATABASE_URL. The PostGIS distance and the copied haversine oracle
 * must agree at the 50 m boundary.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { sqlClient, closeDb } from '../src/db/client.js';
import { haversineMeters } from '../src/domain/geo.js';

const AUTHOR = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const WALKER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

// A quiet patch of ocean — unlikely to collide with seed/other test rows.
const DROP_POINT = { lat: 10.0, lng: -30.0 };

let app: FastifyInstance;
let dropId: string;

describe('reveal verification (spoof resistance)', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/drops',
      headers: headers(AUTHOR),
      payload: {
        body: 'a secret only the server can unlock',
        mood: 'wonder',
        coordinate: DROP_POINT,
      },
    });
    expect(res.statusCode).toBe(201);
    dropId = res.json().id;
  });

  afterAll(async () => {
    // Remove everything this test created (children cascade from drops).
    await sqlClient`DELETE FROM drops WHERE id = ${dropId}`;
    await sqlClient`DELETE FROM devices WHERE id IN (${AUTHOR}, ${WALKER}, 'cccccccc-3333-4333-8333-cccccccccccc')`;
    await app.close();
    await closeDb();
  });

  it('seals the body in the nearby query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/drops/nearby?lat=${DROP_POINT.lat}&lng=${DROP_POINT.lng}`,
      headers: headers(WALKER),
    });
    expect(res.statusCode).toBe(200);
    const mine = res
      .json()
      .secrets.find((s: { id: string }) => s.id === dropId);
    expect(mine).toBeDefined();
    expect(mine.sealed).toBe(true);
    expect(mine.body).toBeUndefined();
  });

  it('rejects a reveal from just outside 50 m (403)', async () => {
    // ~60 m north. Confirm with the oracle, then assert the server agrees.
    const far = { lat: DROP_POINT.lat + 0.00054, lng: DROP_POINT.lng };
    expect(haversineMeters(DROP_POINT, far)).toBeGreaterThan(50);

    const res = await app.inject({
      method: 'POST',
      url: `/drops/${dropId}/reveal`,
      headers: headers(WALKER),
      payload: { coordinate: far },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/too far/i);
    expect(res.json().distanceMeters).toBeGreaterThan(50);
  });

  it('accepts a reveal from inside 50 m and returns the body', async () => {
    // ~33 m north — comfortably inside.
    const near = { lat: DROP_POINT.lat + 0.0003, lng: DROP_POINT.lng };
    expect(haversineMeters(DROP_POINT, near)).toBeLessThanOrEqual(50);

    const res = await app.inject({
      method: 'POST',
      url: `/drops/${dropId}/reveal`,
      headers: headers(WALKER),
      payload: { coordinate: near },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sealed).toBe(false);
    expect(body.body).toBe('a secret only the server can unlock');
    expect(body.revealCount).toBe(1);
    expect(body.stoodHere).toBe(1);
  });

  it('is idempotent: a second reveal does not double-count', async () => {
    const near = { lat: DROP_POINT.lat + 0.0003, lng: DROP_POINT.lng };
    const res = await app.inject({
      method: 'POST',
      url: `/drops/${dropId}/reveal`,
      headers: headers(WALKER),
      payload: { coordinate: near },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revealCount).toBe(1);
    expect(res.json().stoodHere).toBe(1);
  });

  it('ignores a spoofed client distance — only the position matters', async () => {
    // The client cannot send a "distance"; it sends a position the server
    // rechecks. A far position can never be talked into a reveal.
    const farLie = { lat: DROP_POINT.lat + 0.01, lng: DROP_POINT.lng }; // ~1.1 km
    const res = await app.inject({
      method: 'POST',
      url: `/drops/${dropId}/reveal`,
      headers: headers('cccccccc-3333-4333-8333-cccccccccccc'),
      payload: { coordinate: farLie },
    });
    expect(res.statusCode).toBe(403);
  });
});
