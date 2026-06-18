/**
 * step.service — business logic for the Trail "steps" stat.
 *
 * The ONE place that decides what "steps" means on the receipt. Flip STEP_SCOPE
 * to surface a daily / monthly / lifetime total without any client change — the
 * UI calls a single endpoint and renders whatever number this returns.
 */
import { stepRepo, type StepDayEntry, type StepScope } from '../repositories/step.repo.js';

/** Change this to switch the receipt between day / month / lifetime steps. */
export const STEP_SCOPE: StepScope = 'lifetime';

export const stepService = {
  /** Add the client's day-tagged step deltas. */
  add(deviceId: string, entries: StepDayEntry[]): Promise<void> {
    return stepRepo.addDays(deviceId, entries);
  },

  /** The single number the Trail receipt shows, per STEP_SCOPE. */
  async get(deviceId: string): Promise<{ steps: number }> {
    const steps = await stepRepo.total(deviceId, STEP_SCOPE);
    return { steps };
  },
};
