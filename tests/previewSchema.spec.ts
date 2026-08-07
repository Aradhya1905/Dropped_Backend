/**
 * previewSchema.spec — the response schema is the leak guard, so it gets its
 * own assertions rather than being trusted implicitly.
 *
 * `GET /drops/:id/preview` is the one route that answers without a reveal on
 * record. If a body ever reaches its response shape, the 50 m gate stops
 * meaning anything for every drop whose id has been shared. These tests are
 * written so that a future "just add the body so the link previews nicely"
 * fails here, loudly, instead of in production.
 */
import { describe, expect, it } from 'vitest';

import { previewResponse } from '../src/schemas/drop.schema.js';

describe('previewResponse', () => {
  it('has no `body` field', () => {
    expect(Object.keys(previewResponse.shape)).not.toContain('body');
  });

  it('strips a body that the service hands over anyway', () => {
    // Belt to the schema's braces: even a mapper bug cannot push text through.
    const parsed = previewResponse.parse({
      id: 'e2d0c0a0-0000-4000-8000-000000000000',
      mood: 'ache',
      createdAt: 1_770_000_000_000,
      revealCount: 3,
      coordinate: { lat: 12.976, lng: 77.609 },
      body: 'I never told anyone about that summer',
    });
    expect(parsed).not.toHaveProperty('body');
  });

  it('accepts the optional metadata and omits it when absent', () => {
    const bare = previewResponse.parse({
      id: 'e2d0c0a0-0000-4000-8000-000000000000',
      mood: 'wonder',
      createdAt: 1_770_000_000_000,
      revealCount: 0,
      coordinate: { lat: 0, lng: 0 },
    });
    expect(bare.placeLabel).toBeUndefined();
    expect(bare.city).toBeUndefined();
    expect(bare.expiresAt).toBeUndefined();
  });

  it('rejects a mood outside the four the database allows', () => {
    expect(() =>
      previewResponse.parse({
        id: 'e2d0c0a0-0000-4000-8000-000000000000',
        mood: 'rage',
        createdAt: 1_770_000_000_000,
        revealCount: 0,
        coordinate: { lat: 0, lng: 0 },
      }),
    ).toThrow();
  });
});
