/**
 * engagement.repo — saves and hearts, keyed by device. Pure DB layer.
 *
 * Saves are a simple bookmark set. Hearts also maintain the denormalised
 * `heart_count` on the drop so nearby/detail can return it cheaply.
 */
import { sqlClient } from '../db/client.js';

export const engagementRepo = {
  /** Bookmark a drop. Idempotent. */
  async save(dropId: string, deviceId: string): Promise<void> {
    await sqlClient`
      INSERT INTO saves (drop_id, device_id) VALUES (${dropId}, ${deviceId})
      ON CONFLICT (drop_id, device_id) DO NOTHING
    `;
  },

  /** Remove a bookmark. Idempotent. */
  async unsave(dropId: string, deviceId: string): Promise<void> {
    await sqlClient`
      DELETE FROM saves WHERE drop_id = ${dropId} AND device_id = ${deviceId}
    `;
  },

  /** Heart a drop; bumps heart_count only on first heart. Returns new count. */
  async heart(dropId: string, deviceId: string): Promise<number> {
    const inserted = await sqlClient`
      INSERT INTO hearts (drop_id, device_id) VALUES (${dropId}, ${deviceId})
      ON CONFLICT (drop_id, device_id) DO NOTHING
      RETURNING drop_id
    `;
    if (inserted.length > 0) {
      await sqlClient`
        UPDATE drops SET heart_count = heart_count + 1 WHERE id = ${dropId}
      `;
    }
    const rows = await sqlClient<{ heartCount: number }[]>`
      SELECT heart_count AS "heartCount" FROM drops WHERE id = ${dropId}
    `;
    return rows[0]?.heartCount ?? 0;
  },

  /** Unheart; decrements count only if a heart existed. Returns new count. */
  async unheart(dropId: string, deviceId: string): Promise<number> {
    const removed = await sqlClient`
      DELETE FROM hearts WHERE drop_id = ${dropId} AND device_id = ${deviceId}
      RETURNING drop_id
    `;
    if (removed.length > 0) {
      await sqlClient`
        UPDATE drops SET heart_count = GREATEST(heart_count - 1, 0)
        WHERE id = ${dropId}
      `;
    }
    const rows = await sqlClient<{ heartCount: number }[]>`
      SELECT heart_count AS "heartCount" FROM drops WHERE id = ${dropId}
    `;
    return rows[0]?.heartCount ?? 0;
  },
};
