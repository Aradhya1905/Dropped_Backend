/**
 * app — builds the Fastify instance: Zod validation/serialization, the
 * device-id auth + rate-limit plugins, the normalized error handler, and routes.
 * Exported separately from server.ts so tests can build an app without listening.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import { registerErrorHandler } from './plugins/errorHandler.js';
import { deviceIdPlugin } from './plugins/deviceId.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { registerRoutes } from './routes/index.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
  });

  // Zod is the single source for validation + response serialization.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  // Coarse burst throttle (keyed by device id once parsed; else IP).
  await registerRateLimit(app);

  // The anonymous identity. /health is exempt.
  await app.register(deviceIdPlugin, { publicPaths: ['/health'] });

  await registerRoutes(app);

  return app;
}
