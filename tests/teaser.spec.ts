/**
 * teaser.spec — the truncation that decides how much of a secret leaves the
 * 50 m gate. Pure, no database.
 */
import { describe, expect, it } from 'vitest';

import { MAX_BODY_LENGTH } from '../src/domain/clientTypes.js';
import { teaserFrom } from '../src/domain/teaser.js';

const N = 18;

describe('teaserFrom', () => {
  it('returns a short body whole', () => {
    expect(teaserFrom('I lied.', N)).toBe('I lied.');
  });

  it('returns a body of exactly n whole, with no ellipsis', () => {
    const body = 'a'.repeat(N);
    expect(teaserFrom(body, N)).toBe(body);
  });

  it('never exceeds n characters', () => {
    const bodies = [
      'I never told her that I was the one who left the note on the door.',
      'Supercalifragilisticexpialidocious and then some more words after it',
      'one two three four five six seven eight nine ten',
      '   leading and trailing whitespace everywhere   ',
    ];
    for (const body of bodies) {
      for (const n of [4, 8, 12, 18, 24, 40]) {
        expect(teaserFrom(body, n).length).toBeLessThanOrEqual(n);
      }
    }
  });

  it('cuts at a word boundary, never mid-word', () => {
    const body = 'I never told her about the letter';
    const out = teaserFrom(body, N);
    expect(out).toBe('I never told her…');

    // Every word that survived is a whole word from the body.
    const words = out.replace('…', '').trim().split(' ');
    for (const word of words) {
      expect(body.split(' ')).toContain(word);
    }
  });

  it('hard-cuts a single word longer than n', () => {
    // No boundary to find, so the cut is hard — but still inside the budget.
    const out = teaserFrom('Supercalifragilisticexpialidocious', N);
    expect(out).toBe('Supercalifragilis…');
    expect(out.length).toBe(N);
  });

  it('collapses newlines and runs of whitespace to single spaces', () => {
    expect(teaserFrom('I\nsat\n\nhere', N)).toBe('I sat here');
    expect(teaserFrom('  I   sat  here  ', N)).toBe('I sat here');
  });

  it('returns an empty string for an empty or whitespace body', () => {
    expect(teaserFrom('', N)).toBe('');
    expect(teaserFrom('   \n  ', N)).toBe('');
  });

  it('returns an empty string for a non-positive n', () => {
    expect(teaserFrom('anything at all', 0)).toBe('');
    expect(teaserFrom('anything at all', -5)).toBe('');
  });

  it('leaks no more than n characters of a maximum-length body', () => {
    // The leak guard. A future refactor that "helpfully" returns more fails here.
    const body = 'I have carried this for years and never said it out loud. '
      .repeat(10)
      .slice(0, MAX_BODY_LENGTH);
    expect(body.length).toBe(MAX_BODY_LENGTH);
    expect(teaserFrom(body, N).length).toBeLessThanOrEqual(N);
  });
});
