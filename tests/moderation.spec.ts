/**
 * moderation.spec — the ingest filter is the product's hard problem, so its
 * decisions are pinned: block hard (slur/threat/PII), flag soft (borderline),
 * allow clean.
 */
import { describe, expect, it } from 'vitest';

import { moderationService } from '../src/services/moderation.service.js';

const verdict = (body: string) => moderationService.screen(body).verdict;

describe('moderation ingest filter', () => {
  describe('hard-block', () => {
    it('blocks explicit threats of violence', () => {
      expect(verdict('i will kill you tonight')).toBe('block');
      expect(verdict('go kill yourself')).toBe('block');
      expect(verdict('kys')).toBe('block');
    });

    it('blocks PII: phone numbers', () => {
      expect(verdict('call me at 555 123 4567')).toBe('block');
      expect(verdict('my number is +1-202-555-0188')).toBe('block');
    });

    it('blocks PII: email addresses', () => {
      expect(verdict('reach me jane.doe@example.com')).toBe('block');
    });

    it('blocks PII: street addresses', () => {
      expect(verdict('I live at 221 Baker Street alone')).toBe('block');
    });
  });

  describe('soft-flag', () => {
    it('flags borderline cruelty for review (not rejected)', () => {
      expect(verdict('you are pathetic')).toBe('flag');
      expect(verdict('everyone hates you')).toBe('flag');
    });
  });

  describe('allow', () => {
    it('allows genuine, clean confessions', () => {
      expect(verdict('the rain smelled like childhood today')).toBe('allow');
      expect(verdict('I waited here for someone who never came.')).toBe('allow');
      expect(verdict('I told her I loved her right here.')).toBe('allow');
    });

    it('does not flag ordinary numbers that are not contact info', () => {
      expect(verdict('we sat here for 3 hours and 12 minutes')).toBe('allow');
    });
  });
});
