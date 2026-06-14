/**
 * routes — registers every route group plus /health.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { sqlClient } from '../db/client.js';
import { healthResponse } from '../schemas/drop.schema.js';
import { devicesRoutes } from './devices.routes.js';
import { dropsRoutes } from './drops.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Public: liveness + DB ping. Exempt from the device-id requirement.
  r.get(
    '/health',
    { schema: { response: { 200: healthResponse } } },
    async (_request, reply) => {
      await sqlClient`SELECT 1`;
      return reply.send({ ok: true });
    },
  );

  await app.register(devicesRoutes);
  await app.register(dropsRoutes);
}
