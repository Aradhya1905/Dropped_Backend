/**
 * devices.routes — the anonymous identity endpoints, and the one that ends it.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { deviceController } from '../controllers/device.controller.js';
import {
  addStepsBody,
  deviceCitiesResponse,
  deviceEraseResponse,
  deviceResponse,
  deviceStatsResponse,
  errorSchema,
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

  // The per-city breakdown the constellation is drawn from. Strictly this
  // device's own history — like every other /devices/me route, there is nothing
  // here it did not already do itself.
  r.get(
    '/devices/me/cities',
    { schema: { response: { 200: deviceCitiesResponse } } },
    deviceController.cities,
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

  // The panic wipe. Takes no body and no confirmation token: the two-step
  // confirm belongs on the handset, where the user can read what survives, and
  // a server-side token would only be a second thing to get wrong.
  //
  // It answers 200 with a receipt rather than 204 because the client has to
  // report what actually happened, and because a wipe that says nothing is
  // indistinguishable from a wipe that did nothing.
  //
  // Tighter limit than the global 120/min: this is the one destructive route in
  // the API, and a client stuck in a retry loop should be stopped by the server
  // rather than by luck. Rotating the device id defeats it, which is fine — an
  // attacker rotating device ids is only ever erasing identities they invented.
  r.delete(
    '/devices/me',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        response: { 200: deviceEraseResponse, 403: errorSchema, 429: errorSchema },
      },
    },
    deviceController.erase,
  );
}
