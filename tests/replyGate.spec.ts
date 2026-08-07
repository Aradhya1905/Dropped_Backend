/**
 * replyGate.spec — the rule that IS the feature, tested without a database.
 *
 * `mayReply` is extracted as a pure predicate precisely so the "you must have
 * physically stood here" decision can be pinned in a fast test rather than only
 * exercised through PostGIS.
 */
import { describe, expect, it } from 'vitest';

import { mayReply } from '../src/services/reply.service.js';

const base = {
  hasRevealed: true,
  alreadyReplied: false,
  repliesToday: 0,
  limit: 20,
};

describe('mayReply — the physical gate', () => {
  it('refuses a device that has not revealed the drop', () => {
    expect(mayReply({ ...base, hasRevealed: false })).toBe('not-revealed');
  });

  it('allows a revealed device with no prior reply, under quota', () => {
    expect(mayReply(base)).toBe('ok');
  });

  it('refuses a second reply on the same drop', () => {
    expect(mayReply({ ...base, alreadyReplied: true })).toBe('duplicate');
  });

  it('refuses at the daily limit', () => {
    expect(mayReply({ ...base, repliesToday: 20 })).toBe('quota');
    expect(mayReply({ ...base, repliesToday: 19 })).toBe('ok');
  });

  it('refuses past the daily limit too (not just exactly at it)', () => {
    expect(mayReply({ ...base, repliesToday: 99 })).toBe('quota');
  });

  it('reports not-revealed first, even when other rules would also refuse', () => {
    // Authoring a drop is NOT standing at it. An author who has not walked
    // back is refused for the same reason as a stranger.
    expect(
      mayReply({
        hasRevealed: false,
        alreadyReplied: true,
        repliesToday: 500,
        limit: 20,
      }),
    ).toBe('not-revealed');
  });
});
