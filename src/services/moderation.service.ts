/**
 * moderation.service — ingest screening for drop bodies. "Block hard, flag soft."
 *
 * The product's hard problem ("cruelty gets erased"). On ingest we decide one of:
 *  - 'block'  — clear threats, doxxing PII, or slurs. Rejected at the API (422).
 *  - 'flag'   — borderline content. Stored but `status: 'pending'` (hidden from
 *               nearby) until a human reviews it.
 *  - 'allow'  — clean. Stored `status: 'visible'`.
 *
 * Pure functions, no DB — easy to unit-test, which the brief specifically asks
 * for. Word lists are intentionally small and centralised; tune in review.
 */

export type Verdict = 'allow' | 'flag' | 'block';

export interface ScreenResult {
  verdict: Verdict;
  /** Human-readable reason, surfaced on block (422) and logged on flag. */
  reason?: string;
}

/** Hard-block: explicit slurs / dehumanising terms. Kept short; expand in review. */
const SLURS: readonly string[] = [
  '\\bn[i1]gg(?:er|a)\\b',
  '\\bf[a@]gg?[o0]t\\b',
  '\\bk[i1]ke\\b',
  '\\bsp[i1]c\\b',
  '\\bch[i1]nk\\b',
  '\\btr[a@]nny\\b',
  '\\bret[a@]rd\\b',
];

/** Hard-block: explicit threats of violence toward a person. */
const THREATS: readonly string[] = [
  "\\bi('?| wi)ll (kill|murder|stab|shoot|hurt|rape)\\b",
  '\\b(kill|murder|stab|shoot) (you|him|her|them|u)\\b',
  '\\byou (should|deserve to) die\\b',
  '\\bgo (kill|hang) yourself\\b',
  '\\bkys\\b',
];

/** PII that doxxes a real person: phone, email, exact street address. */
const PII: { re: RegExp; reason: string }[] = [
  {
    re: /\b(?:\+?\d[\s-]?){9,14}\d\b/,
    reason: 'looks like a phone number',
  },
  {
    re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
    reason: 'looks like an email address',
  },
  {
    // "12 Baker Street", "221B Elm Rd" — number + street + street-type word.
    re: /\b\d{1,5}[a-z]?\s+[a-z][a-z .'-]{2,}\s+(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way|close|crescent)\b/i,
    reason: 'looks like a street address',
  },
];

/** Soft-flag: harsh but not auto-blockable; sent to review as `pending`. */
const FLAG_TERMS: readonly string[] = [
  '\\bworthless\\b',
  '\\bnobody (loves|likes|wants) you\\b',
  '\\beveryone hates you\\b',
  '\\byou(?:\'re| are) (ugly|stupid|pathetic|disgusting)\\b',
];

const compile = (patterns: readonly string[]) =>
  patterns.map(p => new RegExp(p, 'i'));

const SLUR_RES = compile(SLURS);
const THREAT_RES = compile(THREATS);
const FLAG_RES = compile(FLAG_TERMS);

export const moderationService = {
  /** Screen a drop body on ingest. */
  screen(body: string): ScreenResult {
    const text = body.normalize('NFKC');

    for (const re of SLUR_RES) {
      if (re.test(text)) {
        return { verdict: 'block', reason: 'Contains a slur' };
      }
    }
    for (const re of THREAT_RES) {
      if (re.test(text)) {
        return { verdict: 'block', reason: 'Contains a threat of violence' };
      }
    }
    for (const { re, reason } of PII) {
      if (re.test(text)) {
        return { verdict: 'block', reason: `Contains personal info (${reason})` };
      }
    }
    for (const re of FLAG_RES) {
      if (re.test(text)) {
        return { verdict: 'flag', reason: 'Borderline cruelty — pending review' };
      }
    }
    return { verdict: 'allow' };
  },
};
