/**
 * reply.service — replies in place. One short line pinned under a drop.
 *
 * The whole feature is one check, and it lives here rather than in the
 * controller: **a device may neither read nor write replies on a drop it has
 * not revealed.** A `reveals` row is the server's own proof that it verified
 * the device within 50 m (see reveal.service), so replies reuse that proof
 * instead of re-deriving distance.
 *
 * Everything else is the same shape as drop ingest: screen the body through
 * moderation.service, enforce a per-device daily quota, and let reports past
 * REPORT_HIDE_THRESHOLD shadow-remove the reply.
 */
import { env } from '../config/env.js';
import type { ApiReply } from '../domain/clientTypes.js';
import {
  forbidden,
  notFound,
  tooManyRequests,
  unprocessable,
} from '../plugins/errorHandler.js';
import { dropRepo } from '../repositories/drop.repo.js';
import { replyRepo } from '../repositories/reply.repo.js';
import { reportRepo } from '../repositories/report.repo.js';
import { toApiReply } from './mappers.js';
import { moderationService } from './moderation.service.js';

/** Why a reply was refused, or `ok`. Pure — no DB, no HTTP. */
export type ReplyGate = 'ok' | 'not-revealed' | 'duplicate' | 'quota';

export interface ReplyGateInput {
  /** Does this device have a `reveals` row for the drop? */
  hasRevealed: boolean;
  /** Has it already replied on this drop? (One reply per device per drop.) */
  alreadyReplied: boolean;
  /** Replies written by this device in the trailing 24h. */
  repliesToday: number;
  /** REPLY_DAILY_LIMIT. */
  limit: number;
}

/**
 * The gate, as a pure predicate so it is testable without a database.
 *
 * Order matters: not-revealed outranks everything, because "you were never
 * here" is the honest answer even when the other rules would also refuse.
 * Authoring a drop is deliberately NOT standing at it — an author who has not
 * walked back gets `not-revealed` like anyone else.
 */
export function mayReply(input: ReplyGateInput): ReplyGate {
  if (!input.hasRevealed) return 'not-revealed';
  if (input.alreadyReplied) return 'duplicate';
  if (input.repliesToday >= input.limit) return 'quota';
  return 'ok';
}

/**
 * Load the drop and this device's relationship to it, or throw. Shared by every
 * entry point below so the gate can never be skipped by adding a new route.
 */
async function requireStoodHere(
  dropId: string,
  deviceId: string,
): Promise<void> {
  const row = await dropRepo.findForDevice(dropId, deviceId);
  if (!row || row.status !== 'visible') throw notFound('Secret not found');
  if (!row.revealed) throw forbidden('Stand here first.');
}

export const replyService = {
  /** Replies on a drop, oldest first. Gated on having stood here. */
  async list(
    deviceId: string,
    dropId: string,
    limit: number,
    offset: number,
  ): Promise<{ replies: ApiReply[]; total: number }> {
    await requireStoodHere(dropId, deviceId);
    const { rows, total } = await replyRepo.listForDrop(dropId, limit, offset);
    return { replies: rows.map(r => toApiReply(r, deviceId)), total };
  },

  /**
   * Leave a reply. Gated on having stood here, capped at one per drop and
   * REPLY_DAILY_LIMIT per day, and screened by moderation on ingest:
   * `block` → 422, `flag` → stored `pending` (invisible to others), else
   * `visible`.
   */
  async create(
    deviceId: string,
    dropId: string,
    body: string,
  ): Promise<ApiReply> {
    const row = await dropRepo.findForDevice(dropId, deviceId);
    if (!row || row.status !== 'visible') throw notFound('Secret not found');

    const existing = await replyRepo.findForDevice(dropId, deviceId);
    const repliesToday = await replyRepo.createdSince(deviceId, 24);

    const gate = mayReply({
      hasRevealed: row.revealed,
      alreadyReplied: Boolean(existing),
      repliesToday,
      limit: env.REPLY_DAILY_LIMIT,
    });

    if (gate === 'not-revealed') throw forbidden('Stand here first.');
    if (gate === 'duplicate') {
      // A retried request that already succeeded lands here. Return the reply
      // the device already left rather than an error — the client treats this
      // as success (see the plan's note on retries).
      return toApiReply(existing!, deviceId);
    }
    if (gate === 'quota') {
      throw tooManyRequests(
        `Daily reply limit reached (${env.REPLY_DAILY_LIMIT}). Try again tomorrow.`,
      );
    }

    const verdict = moderationService.screen(body);
    if (verdict.verdict === 'block') {
      throw unprocessable(verdict.reason ?? 'This can’t be posted.');
    }
    const status = verdict.verdict === 'flag' ? 'pending' : 'visible';

    const created = await replyRepo.create({ dropId, deviceId, body, status });
    if (!created) {
      // Lost the race against the unique index. Same story as `duplicate`.
      const raced = await replyRepo.findForDevice(dropId, deviceId);
      if (raced) return toApiReply(raced, deviceId);
      throw unprocessable('Could not leave that reply.');
    }
    return toApiReply(created, deviceId);
  },

  /** Delete your own reply. Someone else's is a 403, a missing one a 404. */
  async remove(
    deviceId: string,
    dropId: string,
    replyId: string,
  ): Promise<{ deleted: true }> {
    await requireStoodHere(dropId, deviceId);

    const reply = await replyRepo.find(replyId);
    if (!reply || reply.dropId !== dropId) throw notFound('Reply not found');
    if (reply.deviceId !== deviceId) throw forbidden('Not yours to remove.');

    await replyRepo.deleteOwn(replyId, dropId, deviceId);
    return { deleted: true };
  },

  /**
   * Report a reply. Past REPORT_HIDE_THRESHOLD distinct reporters it flips to
   * `pending` — shadow-removed from the list and from `reply_count` — pending
   * human review. Same threshold and same semantics as reporting a drop.
   */
  async report(
    deviceId: string,
    dropId: string,
    replyId: string,
    reason: string,
  ): Promise<{ reported: true }> {
    await requireStoodHere(dropId, deviceId);

    const reply = await replyRepo.find(replyId);
    if (!reply || reply.dropId !== dropId) throw notFound('Reply not found');

    const added = await reportRepo.addForReply(replyId, deviceId, reason);
    if (added) {
      const count = await reportRepo.distinctReplyReporters(replyId);
      if (count >= env.REPORT_HIDE_THRESHOLD) {
        await replyRepo.setStatus(replyId, dropId, 'pending');
      }
    }
    return { reported: true };
  },
};
