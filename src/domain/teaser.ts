/**
 * teaser — the whisper band's truncation, kept pure so it is testable without a
 * database.
 *
 * This is the security-relevant function in the whisper tier. A teaser is the
 * only content that ever leaves the 50 m gate, so the rules are conservative:
 *
 * - The returned string is **never longer than `n`**, ellipsis included. The
 *   ellipsis is paid for out of the budget rather than added on top, so tuning
 *   `WHISPER_TEASER_CHARS` down is the only lever anyone needs.
 * - Cuts land on a word boundary, so half a word can't hint at the rest. A
 *   single word longer than the budget is hard-cut, since there is no boundary
 *   to find.
 * - All whitespace collapses to single spaces first, so a teaser can never leak
 *   the note's layout (line breaks, indentation) along with its first words.
 *
 * The truncation happens here, server-side. Shipping the body and letting the
 * client cut it would hand the whole secret to anyone reading the response —
 * the exact thing the 50 m gate exists to prevent.
 */

const ELLIPSIS = '…';

/**
 * The first ≤`n` characters of `body`, cut at a word boundary, with an ellipsis
 * when anything was dropped. Returns `''` for an empty/whitespace body.
 */
export function teaserFrom(body: string, n: number): string {
  if (n <= 0) return '';

  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= n) return flat;

  // Everything below drops content, so an ellipsis is going on the end — take
  // its cost out of the budget up front.
  const budget = n - ELLIPSIS.length;
  if (budget <= 0) return ELLIPSIS;

  // A space sitting exactly on the boundary means the budget already ends on a
  // whole word; otherwise back up to the last space inside it.
  const head =
    flat[budget] === ' ' ? flat.slice(0, budget) : cutAtWord(flat.slice(0, budget));

  return head.trimEnd() + ELLIPSIS;
}

/** Back up to the last space, or keep the hard cut when there is no space. */
function cutAtWord(cut: string): string {
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}
