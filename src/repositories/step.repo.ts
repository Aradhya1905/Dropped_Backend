/**
 * step.repo — persistence for per-device, per-day step counts (device_steps).
 *
 * Pure DB layer: raw `sqlClient` upserts/aggregates, no business rules. The
 * displayed scope (day / month / lifetime) is chosen one layer up, in
 * step.service; here we only know how to map a scope to a WHERE filter.
 */
import { sqlClient } from '../db/client.js';

export type StepScope = 'day' | 'month' | 'lifetime';

/** A day's step delta to add, from the client's local-day sync buffer. */
export interface StepDayEntry {
  /** 'YYYY-MM-DD' (the device's local calendar day). */
  day: string;
  /** Positive step count to add to that day. */
  delta: number;
}

export const stepRepo = {
  /**
   * Add each day's delta into device_steps, accumulating on conflict. Wrapped in
   * one transaction so a multi-day sync is all-or-nothing.
   */
  async addDays(deviceId: string, entries: StepDayEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await sqlClient.begin(async sql => {
      for (const { day, delta } of entries) {
        await sql`
          INSERT INTO device_steps (device_id, day, steps)
          VALUES (${deviceId}, ${day}, ${delta})
          ON CONFLICT (device_id, day)
          DO UPDATE SET steps = device_steps.steps + EXCLUDED.steps,
                        updated_at = now()
        `;
      }
    });
  },

  /** Sum of steps for the device within the given scope (0 if none). */
  async total(deviceId: string, scope: StepScope): Promise<number> {
    const scopeFilter =
      scope === 'month'
        ? sqlClient`AND day >= date_trunc('month', now())::date`
        : scope === 'day'
          ? sqlClient`AND day = (now())::date`
          : sqlClient``; // lifetime: no filter

    const rows = await sqlClient<{ total: number }[]>`
      SELECT coalesce(sum(steps), 0)::int AS total
      FROM device_steps
      WHERE device_id = ${deviceId} ${scopeFilter}
    `;
    return rows[0]?.total ?? 0;
  },
};
