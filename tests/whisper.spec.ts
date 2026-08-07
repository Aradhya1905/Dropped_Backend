/**
 * whisper.spec — the whisper tier's one hard rule: a teaser may leave the 50 m
 * gate, the body may not.
 *
 * Two halves. The mapper half is pure and covers the bands and the suppression
 * rules; the HTTP half runs against the real app + PostGIS and asserts on the
 * actual `/drops/nearby` payload, because "the UI doesn't show it" is not the
 * same claim as "the server didn't send it".
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { sqlClient, closeDb } from '../src/db/client.js';
import type { DropRowForDevice } from '../src/repositories/drop.repo.js';
import { toNearbySecret } from '../src/services/mappers.js';

const BODY = 'I never told her about the letter I left under the door.';

function row(over: Partial<DropRowForDevice> = {}): DropRowForDevice {
  return {
    id: 'd1',
    deviceId: 'author',
    body: BODY,
    mood: 'ache',
    placeLabel: 'Blue Tokai',
    city: 'Bengaluru',
    lat: 12.97,
    lng: 77.59,
    status: 'visible',
    revealCount: 2,
    stoodHere: 2,
    heartCount: 1,
    replyCount: 0,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    saved: false,
    hearted: false,
    revealed: false,
    ...over,
  };
}

describe('toNearbySecret — the whisper band', () => {
  it('whispers just inside the band, and still withholds the body', () => {
    const out = toNearbySecret(row({ distanceMeters: env.WHISPER_RADIUS_M - 1 }));

    expect(out.sealed).toBe(true);
    expect(out).not.toHaveProperty('body');
    expect(out.whisper?.mood).toBe('ache');
    expect(out.whisper?.teaser.length).toBeLessThanOrEqual(
      env.WHISPER_TEASER_CHARS,
    );
    expect(BODY.startsWith(out.whisper!.teaser.replace('…', ''))).toBe(true);
  });

  it('sends nothing but a pin outside the band', () => {
    const out = toNearbySecret(row({ distanceMeters: env.WHISPER_RADIUS_M + 1 }));

    expect(out.sealed).toBe(true);
    expect(out).not.toHaveProperty('body');
    expect(out).not.toHaveProperty('whisper');
  });

  it('whispers exactly on the boundary', () => {
    const out = toNearbySecret(row({ distanceMeters: env.WHISPER_RADIUS_M }));
    expect(out.whisper).toBeDefined();
  });

  it('gives an already-revealed row the body and no whisper', () => {
    const out = toNearbySecret(
      row({ distanceMeters: env.WHISPER_RADIUS_M - 1, revealed: true }),
    );

    expect(out.sealed).toBe(false);
    expect(out.body).toBe(BODY);
    expect(out).not.toHaveProperty('whisper');
  });

  it('never whispers a drop under moderation review', () => {
    // The SQL already excludes these; the mapper asserts it too, because a
    // `pending` drop must not leak even 18 characters.
    for (const status of ['pending', 'hidden'] as const) {
      const out = toNearbySecret(
        row({ distanceMeters: env.WHISPER_RADIUS_M - 1, status }),
      );
      expect(out).not.toHaveProperty('whisper');
      expect(out).not.toHaveProperty('body');
    }
  });

  it('never whispers without a server-computed distance', () => {
    const out = toNearbySecret(row({ distanceMeters: undefined }));
    expect(out).not.toHaveProperty('whisper');
  });
});

// --- HTTP: what actually goes on the wire -----------------------------------

// Device ids must be unique across spec files: vitest runs them in parallel
// against one database, so sharing an id means sharing (and deleting) rows.
const AUTHOR = '33333333-9999-4999-8999-333333333333';
const WALKER = '44444444-aaaa-4aaa-8aaa-444444444444';
const headers = (id: string) => ({
  'content-type': 'application/json',
  'x-device-id': id,
});

/** Another quiet patch of ocean, away from reveal.spec's. */
const DROP_POINT = { lat: 11.0, lng: -31.0 };
const SECRET = 'I never told her about the letter I left under the door.';

/** Metres → degrees of latitude (~111.32 km per degree). Due north of a point. */
const northOf = (p: { lat: number; lng: number }, metres: number) => ({
  lat: p.lat + metres / 111_320,
  lng: p.lng,
});

let app: FastifyInstance;
let dropId: string;

describe('whisper tier over HTTP', () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/drops',
      headers: headers(AUTHOR),
      payload: { body: SECRET, mood: 'ache', coordinate: DROP_POINT },
    });
    expect(res.statusCode).toBe(201);
    dropId = res.json().id;
  });

  afterAll(async () => {
    // By device, not by id: a half-finished earlier run can leave a drop
    // behind, and the devices delete would then trip the foreign key instead
    // of cleaning up. Safe because these ids belong to this file alone.
    await sqlClient`DELETE FROM drops WHERE device_id IN (${AUTHOR}, ${WALKER})`;
    await sqlClient`DELETE FROM devices WHERE id IN (${AUTHOR}, ${WALKER})`;
    await app.close();
    await closeDb();
  });

  /** The drop as `/drops/nearby` returns it from `metres` away. */
  async function nearbyFrom(metres: number) {
    const from = northOf(DROP_POINT, metres);
    const res = await app.inject({
      method: 'GET',
      url: `/drops/nearby?lat=${from.lat}&lng=${from.lng}&radiusMeters=2000`,
      headers: headers(WALKER),
    });
    expect(res.statusCode).toBe(200);
    return res
      .json()
      .secrets.find((s: { id: string }) => s.id === dropId) as
      | Record<string, unknown>
      | undefined;
  }

  it('sends a bare pin from outside the whisper band', async () => {
    const mine = await nearbyFrom(env.WHISPER_RADIUS_M + 60);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty('body');
    expect(mine).not.toHaveProperty('whisper');
  });

  it('sends a whisper — and still no body — from inside the band', async () => {
    const mine = await nearbyFrom(env.WHISPER_RADIUS_M - 40);
    expect(mine).toBeDefined();
    // The check the whole feature rests on: a teaser on the wire, never a body.
    expect(mine).not.toHaveProperty('body');
    expect(mine!.whisper).toEqual({ mood: 'ache', teaser: expect.any(String) });

    const { teaser } = mine!.whisper as { teaser: string };
    expect(teaser.length).toBeLessThanOrEqual(env.WHISPER_TEASER_CHARS);
    expect(SECRET.startsWith(teaser.replace('…', ''))).toBe(true);
  });

  it('never whispers a drop under moderation review', async () => {
    await sqlClient`UPDATE drops SET status = 'pending' WHERE id = ${dropId}`;
    try {
      // Shadow-removed: no pin at all, so certainly no teaser.
      expect(await nearbyFrom(env.WHISPER_RADIUS_M - 40)).toBeUndefined();
    } finally {
      await sqlClient`UPDATE drops SET status = 'visible' WHERE id = ${dropId}`;
    }
  });
});
