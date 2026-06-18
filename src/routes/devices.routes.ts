/**
 * devices.routes — the anonymous identity endpoint.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { deviceController } from '../controllers/device.controller.js';
import {
  addStepsBody,
  deviceResponse,
  deviceStatsResponse,
  stepsResponse,
} from '../schemas/drop.schema.js';

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

  r.get(
    '/devices/me/steps',
    { schema: { response: { 200: stepsResponse } } },
    deviceController.steps,
  );

  r.post(
    '/devices/me/steps',
    { schema: { body: addStepsBody, response: { 200: stepsResponse } } },
    deviceController.addSteps,
  );
}
