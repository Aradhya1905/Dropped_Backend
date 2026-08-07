/**
 * report.repo — moderation reports, keyed by (target, device). Pure DB layer.
 *
 * A report targets exactly one of a drop or a reply (XOR, enforced by
 * `reports_target_chk`). One report per device per target (idempotent). Exposes
 * the distinct report count so the service can flip the target to `pending`
 * past a threshold (shadow-removal).
 */
import { sqlClient } from '../db/client.js';

export const reportRepo = {
  /** Record a report against a drop. Idempotent per device+drop. */
  async add(dropId: string, deviceId: string, reason: string): Promise<boolean> {
    // De-dupe per device by checking first (no unique constraint, so one device
    // can't inflate the count by reporting repeatedly).
    const existing = await sqlClient`
      SELECT 1 FROM reports
      WHERE drop_id = ${dropId} AND device_id = ${deviceId}
      LIMIT 1
    `;
    if (existing.length > 0) return false;

    await sqlClient`
      INSERT INTO reports (drop_id, device_id, reason)
      VALUES (${dropId}, ${deviceId}, ${reason})
    `;
    return true;
  },

  /** Record a report against a reply. Idempotent per device+reply. */
  async addForReply(
    replyId: string,
    deviceId: string,
    reason: string,
  ): Promise<boolean> {
    const existing = await sqlClient`
      SELECT 1 FROM reports
      WHERE reply_id = ${replyId} AND device_id = ${deviceId}
      LIMIT 1
    `;
    if (existing.length > 0) return false;

    await sqlClient`
      INSERT INTO reports (reply_id, device_id, reason)
      VALUES (${replyId}, ${deviceId}, ${reason})
    `;
    return true;
  },

  /** Distinct devices that have reported this drop. */
  async distinctReporters(dropId: string): Promise<number> {
    const rows = await sqlClient<{ count: number }[]>`
      SELECT count(DISTINCT device_id)::int AS count
      FROM reports WHERE drop_id = ${dropId}
    `;
    return rows[0]?.count ?? 0;
  },

  /** Distinct devices that have reported this reply. */
  async distinctReplyReporters(replyId: string): Promise<number> {
    const rows = await sqlClient<{ count: number }[]>`
      SELECT count(DISTINCT device_id)::int AS count
      FROM reports WHERE reply_id = ${replyId}
    `;
    return rows[0]?.count ?? 0;
  },
};
