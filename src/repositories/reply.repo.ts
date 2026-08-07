/**
 * reply.repo — the only place that touches reply SQL. Pure DB layer.
 *
 * `drops.reply_count` is denormalised so nearby can render "3 voices here"
 * without an N+1, and it counts `visible` rows only — a reply flipped to
 * `pending` by moderation stops being counted as well as stops being listed.
 * Every write that can change visibility goes through `recount` in the same
 * transaction as the write, so the column can't drift.
 */
import type { TransactionSql } from 'postgres';

import { sqlClient } from '../db/client.js';
import type { ReplyStatus } from '../db/schema.js';

/** A reply as the repo returns it. `deviceId` never leaves the service layer. */
export interface ReplyRow {
  id: string;
  dropId: string;
  deviceId: string;
  body: string;
  status: ReplyStatus;
  /** postgres.js returns timestamps as strings; mappers coerce to ms epoch. */
  createdAt: Date | string;
}

const replyCols = sqlClient`
  r.id,
  r.drop_id    AS "dropId",
  r.device_id  AS "deviceId",
  r.body,
  r.status,
  r.created_at AS "createdAt"
`;

/** Recompute drops.reply_count from visible rows. Cheap; keeps it honest. */
const recount = (tx: TransactionSql, dropId: string) => tx`
  UPDATE drops SET reply_count = (
    SELECT count(*)::int FROM replies
    WHERE drop_id = ${dropId} AND status = 'visible'
  )
  WHERE id = ${dropId}
`;

export const replyRepo = {
  /**
   * Insert a reply and refresh the drop's counter atomically. Returns undefined
   * if the unique index rejected it (this device already replied here) — the
   * caller turns that into a duplicate verdict rather than a 500.
   *
   * The `WHERE` on the conflict target is not a filter — it is how Postgres
   * identifies which index to arbitrate on, and `replies_drop_device_uniq` is
   * partial since 0009_device_erasure.sql (the erased-author sentinel is exempt,
   * so two erased devices can both have replied to the same drop). The predicate
   * must stay character-identical to the index's or the INSERT fails outright
   * with "no unique or exclusion constraint matching the ON CONFLICT
   * specification". Inlined rather than parameterised for the same reason.
   */
  async create(input: {
    dropId: string;
    deviceId: string;
    body: string;
    status: ReplyStatus;
  }): Promise<ReplyRow | undefined> {
    return sqlClient.begin(async tx => {
      const rows = await tx<ReplyRow[]>`
        INSERT INTO replies (drop_id, device_id, body, status)
        VALUES (${input.dropId}, ${input.deviceId}, ${input.body}, ${input.status})
        ON CONFLICT (drop_id, device_id) WHERE device_id <> '__deleted__'
        DO NOTHING
        RETURNING
          id, drop_id AS "dropId", device_id AS "deviceId", body, status,
          created_at AS "createdAt"
      `;
      const row = rows[0];
      if (!row) return undefined;
      await recount(tx, input.dropId);
      return row;
    });
  },

  /** Visible replies on a drop, oldest first (a thread reads forwards). */
  async listForDrop(
    dropId: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: ReplyRow[]; total: number }> {
    const rows = await sqlClient<ReplyRow[]>`
      SELECT ${replyCols}
      FROM replies r
      WHERE r.drop_id = ${dropId} AND r.status = 'visible'
      ORDER BY r.created_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countRows = await sqlClient<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM replies
      WHERE drop_id = ${dropId} AND status = 'visible'
    `;
    return { rows, total: countRows[0]?.total ?? 0 };
  },

  /** A single reply by id, or undefined. */
  async find(replyId: string): Promise<ReplyRow | undefined> {
    const rows = await sqlClient<ReplyRow[]>`
      SELECT ${replyCols} FROM replies r WHERE r.id = ${replyId} LIMIT 1
    `;
    return rows[0];
  },

  /** This device's reply on a drop, if it has one. Drives the duplicate check. */
  async findForDevice(
    dropId: string,
    deviceId: string,
  ): Promise<ReplyRow | undefined> {
    const rows = await sqlClient<ReplyRow[]>`
      SELECT ${replyCols}
      FROM replies r
      WHERE r.drop_id = ${dropId} AND r.device_id = ${deviceId}
      LIMIT 1
    `;
    return rows[0];
  },

  /** Delete a reply, author only. Returns true if a row was removed. */
  async deleteOwn(
    replyId: string,
    dropId: string,
    deviceId: string,
  ): Promise<boolean> {
    return sqlClient.begin(async tx => {
      const removed = await tx`
        DELETE FROM replies
        WHERE id = ${replyId} AND drop_id = ${dropId} AND device_id = ${deviceId}
        RETURNING id
      `;
      if (removed.length === 0) return false;
      await recount(tx, dropId);
      return true;
    });
  },

  /** Count replies this device wrote in the trailing `hours` window. */
  async createdSince(deviceId: string, hours: number): Promise<number> {
    const rows = await sqlClient<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM replies
      WHERE device_id = ${deviceId}
        AND created_at > now() - (${hours} * interval '1 hour')
    `;
    return rows[0]?.count ?? 0;
  },

  /** Set a reply's moderation status and refresh the drop's counter. */
  async setStatus(
    replyId: string,
    dropId: string,
    status: ReplyStatus,
  ): Promise<void> {
    await sqlClient.begin(async tx => {
      await tx`UPDATE replies SET status = ${status} WHERE id = ${replyId}`;
      await recount(tx, dropId);
    });
  },
};
