/**
 * report.repo — moderation reports, keyed by (drop, device). Pure DB layer.
 *
 * One report per device per drop (idempotent). Exposes the distinct report count
 * so the service can flip a drop to `pending` past a threshold (shadow-removal).
 */
import { sqlClient } from '../db/client.js';

export const reportRepo = {
  /** Record a report. Idempotent per device+drop. Returns true if newly added. */
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

  /** Distinct devices that have reported this drop. */
  async distinctReporters(dropId: string): Promise<number> {
    const rows = await sqlClient<{ count: number }[]>`
      SELECT count(DISTINCT device_id)::int AS count
      FROM reports WHERE drop_id = ${dropId}
    `;
    return rows[0]?.count ?? 0;
  },
};
