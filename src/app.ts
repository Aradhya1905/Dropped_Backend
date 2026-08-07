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

  // An empty body with `Content-Type: application/json` is not a parse error.
  //
  // Fastify's default parser rejects it outright with 400 before any route
  // schema runs, which turns a client that sets a default JSON header on every
  // request into a client that cannot call `DELETE /devices/me` — the panic
  // wipe, the one request that must not fail for a clerical reason. Handing the
  // route `undefined` instead lets its own schema decide: bodyless routes
  // proceed, and a route that genuinely needs a body still answers 400, just
  // with a message naming the missing field rather than the transport.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      if (raw.trim() === '') return done(null, undefined);
      try {
        done(null, JSON.parse(raw));
      } catch {
        const err = new Error('Body is not valid JSON') as Error & {
          statusCode?: number;
        };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

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
