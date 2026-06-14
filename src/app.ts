/**
 * app — builds the Fastify instance: Zod validation/serialization, the
 * device-id auth + rate-limit plugins, the normalized error handler, and routes.
 * Exported separately from server.ts so tests can build an app without listening.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import {
  jsonSchemaTransform,
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

  // OpenAPI doc, generated from the Zod route schemas (jsonSchemaTransform).
  // Registered before routes so it can collect every schema. The X-Device-Id
  // header is declared as a security scheme so it can be set once in the UI.
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Dropped — Backend API',
        description:
          'Anonymous, location-gated secret confessions (drop → walk → reveal). ' +
          'Every route except /health requires an X-Device-Id (UUID v4) header.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          deviceId: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Device-Id',
            description: 'Anonymous device identity — any UUID v4.',
          },
        },
      },
      security: [{ deviceId: [] }],
    },
    transform: jsonSchemaTransform,
  });

  // Scalar interactive docs at /docs (reads the OpenAPI doc above).
  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: { url: '/openapi.json' },
  });

  // Coarse burst throttle (keyed by device id once parsed; else IP).
  await registerRateLimit(app);

  // The anonymous identity. /health and the docs are exempt.
  await app.register(deviceIdPlugin, {
    publicPaths: ['/health', '/docs', '/openapi.json'],
  });

  await registerRoutes(app);

  return app;
}
