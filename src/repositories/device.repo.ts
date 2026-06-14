/**
 * device.repo — persistence for the anonymous device identity.
 *
 * Pure DB layer: no Fastify, no business rules. The device row is the only
 * "account" in the system.
 */
import { eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { devices, drops } from '../db/schema.js';

export const deviceRepo = {
  /** Upsert a device by id; idempotent. Called on first request. */
  async ensure(id: string): Promise<void> {
    await db
      .insert(devices)
      .values({ id })
      .onConflictDoNothing({ target: devices.id });
  },

  /** Fetch a device row, or undefined. */
  async find(id: string) {
    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.id, id))
      .limit(1);
    return rows[0];
  },

  /** Count drops this device created in the trailing `hours` window. */
  async dropsCreatedSince(deviceId: string, hours: number): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(drops)
      .where(
        sql`${drops.deviceId} = ${deviceId} AND ${drops.createdAt} > now() - (${hours} * interval '1 hour')`,
      );
    return rows[0]?.count ?? 0;
  },
};
