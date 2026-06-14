/**
 * rateLimit — coarse abuse throttle keyed by device id (falls back to IP).
 *
 * This guards against burst abuse across ALL endpoints. The product rule of
 * "N drops per device per day" is a separate, domain-level check in
 * drop.service (it needs the DB window, not a sliding in-memory counter).
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) =>
      request.deviceId || request.ip,
    errorResponseBuilder: () => ({
      message: 'Too many requests, slow down.',
    }),
  });
}
