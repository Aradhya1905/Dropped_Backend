/**
 * expiry.spec — the lifespan arithmetic behind expiring drops.
 *
 * Pure: no DB, no app. The filtering itself is SQL (`expires_at > now()`), so
 * what's worth pinning down here is that the composed instant is exactly N×24 h
 * later regardless of calendar, and that the JS boundary check agrees with that
 * SQL comparison rather than being off by the boundary instant.
 */
import { describe, expect, it } from 'vitest';

import { expiresAtFrom, isExpired } from '../src/domain/expiry.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('expiresAtFrom', () => {
  const created = new Date('2026-08-07T10:00:00.000Z');

  it('returns null for forever (no choice made)', () => {
    expect(expiresAtFrom(created, undefined)).toBeNull();
  });

  it('is exactly 7×24 h later for a 7-day drop', () => {
    expect(expiresAtFrom(created, 7)!.getTime() - created.getTime()).toBe(7 * DAY);
  });

  it('is exactly 30×24 h later for a 30-day drop', () => {
    expect(expiresAtFrom(created, 30)!.getTime() - created.getTime()).toBe(30 * DAY);
  });

  it('keeps a 7-day window at 168 hours across a DST boundary', () => {
    // Europe/London springs forward on 2026-03-29. A calendar-day
    // implementation would land 1 h off; UTC arithmetic does not.
    const beforeDst = new Date('2026-03-26T12:00:00.000Z');
    const expires = expiresAtFrom(beforeDst, 7)!;
    expect(expires.getTime() - beforeDst.getTime()).toBe(168 * HOUR);
    expect(expires.toISOString()).toBe('2026-04-02T12:00:00.000Z');
  });
});

describe('isExpired', () => {
  const expires = new Date('2026-08-14T10:00:00.000Z');

  it('never expires a forever drop', () => {
    expect(isExpired(new Date('2099-01-01T00:00:00.000Z'), null)).toBe(false);
  });

  it('is false before the instant', () => {
    expect(isExpired(new Date(expires.getTime() - 1), expires)).toBe(false);
  });

  it('is true AT the instant — matching SQL `expires_at > now()`', () => {
    // The SQL keeps a row only while expires_at > now(), so at exactly
    // expires_at the drop has already left `nearby`. This helper must say the
    // same thing at that instant, or the UI would advertise a drop the server
    // no longer serves.
    expect(isExpired(new Date(expires.getTime()), expires)).toBe(true);
  });

  it('is true after the instant', () => {
    expect(isExpired(new Date(expires.getTime() + 1), expires)).toBe(true);
  });
});
