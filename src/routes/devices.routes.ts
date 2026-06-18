/**
 * devices.routes — the anonymous identity endpoint.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { deviceController } from '../controllers/device.controller.js';
import { deviceResponse, deviceStatsResponse } from '../schemas/drop.schema.js';

export async function devicesRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/devices/me',
    { schema: { response: { 200: deviceResponse } } },
    deviceController.me,
  );

  r.get(
    '/devices/me/stats',
    { schema: { response: { 200: deviceStatsResponse } } },
    deviceController.stats,
  );
}
