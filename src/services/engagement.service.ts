/**
 * engagement.service — save/unsave and heart/unheart, plus reporting.
 *
 * Thin coordination over the repos, with existence checks so we 404 cleanly.
 */
import { notFound } from '../plugins/errorHandler.js';
import { dropRepo } from '../repositories/drop.repo.js';
import { engagementRepo } from '../repositories/engagement.repo.js';
import { reportRepo } from '../repositories/report.repo.js';
import { env } from '../config/env.js';

async function assertDropExists(dropId: string, deviceId: string): Promise<void> {
  const row = await dropRepo.findForDevice(dropId, deviceId);
  if (!row) throw notFound('Secret not found');
}

export const engagementService = {
  async setSaved(
    deviceId: string,
    dropId: string,
    saved: boolean,
  ): Promise<{ saved: boolean }> {
    await assertDropExists(dropId, deviceId);
    if (saved) await engagementRepo.save(dropId, deviceId);
    else await engagementRepo.unsave(dropId, deviceId);
    return { saved };
  },

  async setHearted(
    deviceId: string,
    dropId: string,
    hearted: boolean,
  ): Promise<{ hearted: boolean; hearts: number }> {
    await assertDropExists(dropId, deviceId);
    const hearts = hearted
      ? await engagementRepo.heart(dropId, deviceId)
      : await engagementRepo.unheart(dropId, deviceId);
    return { hearted, hearts };
  },

  /**
   * Record a report. Past REPORT_HIDE_THRESHOLD distinct reporters the drop is
   * flipped to `pending` (shadow-removed from nearby) pending human review.
   */
  async report(
    deviceId: string,
    dropId: string,
    reason: string,
  ): Promise<{ reported: true }> {
    await assertDropExists(dropId, deviceId);
    const added = await reportRepo.add(dropId, deviceId, reason);
    if (added) {
      const count = await reportRepo.distinctReporters(dropId);
      if (count >= env.REPORT_HIDE_THRESHOLD) {
        await dropRepo.setStatus(dropId, 'pending');
      }
    }
    return { reported: true };
  },
};
