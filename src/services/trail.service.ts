/**
 * trail.service — the device's scrapbook: found / saved / dropped.
 *
 * Trail entries always show the body (the device has earned/owns them), so they
 * map to the unsealed view.
 */
import type { ApiSecret } from '../domain/clientTypes.js';
import { dropRepo } from '../repositories/drop.repo.js';
import { toUnsealedSecret } from './mappers.js';

export type TrailKind = 'found' | 'saved' | 'dropped';

export interface TrailPage {
  secrets: ApiSecret[];
  total: number;
}

export const trailService = {
  async list(
    deviceId: string,
    kind: TrailKind,
    limit: number,
    offset: number,
  ): Promise<TrailPage> {
    const { rows, total } = await dropRepo.trail(deviceId, kind, limit, offset);
    return { secrets: rows.map(toUnsealedSecret), total };
  },
};
