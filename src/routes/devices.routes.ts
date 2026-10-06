/**
 * devices.routes — the anonymous identity endpoint, Trail stats/steps, and the
 * one-shot onboarding starter-drop seed.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { deviceController } from '../controllers/device.controller.js';
import {
  addStepsBody,
  deviceResponse,
  deviceStatsResponse,
  starterDropsBody,
  starterDropsResponse,
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

  // Once per device (enforced in the DB); the tight limit just stops a client
  // bug from hammering the global advisory lock.
  r.post(
    '/devices/me/starter-drops',
    {
      schema: {
        body: starterDropsBody,
        response: { 200: starterDropsResponse },
      },
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    deviceController.starterDrops,
  );
}
