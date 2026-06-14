/**
 * drops.routes — everything under /drops: create, nearby, reveal, save, heart,
 * report, and the trail lists. Schemas validate input and serialize output.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { dropController } from '../controllers/drop.controller.js';
import { revealController } from '../controllers/reveal.controller.js';
import { engagementController } from '../controllers/engagement.controller.js';
import { trailController } from '../controllers/trail.controller.js';
import {
  apiSecretSchema,
  createDropBody,
  dropIdParams,
  errorSchema,
  heartResponse,
  nearbyQuery,
  nearbyResponse,
  reportBody,
  reportResponse,
  revealBody,
  savedResponse,
  trailQuery,
  trailResponse,
} from '../schemas/drop.schema.js';

export async function dropsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/drops',
    {
      schema: {
        body: createDropBody,
        response: { 201: apiSecretSchema, 422: errorSchema, 429: errorSchema },
      },
    },
    dropController.create,
  );

  r.get(
    '/drops/nearby',
    { schema: { querystring: nearbyQuery, response: { 200: nearbyResponse } } },
    dropController.nearby,
  );

  // Trail lists. Declared before "/drops/:id/*" is irrelevant (distinct paths),
  // but grouped here for the per-device scrapbook.
  r.get(
    '/drops/trail/found',
    { schema: { querystring: trailQuery, response: { 200: trailResponse } } },
    trailController.found,
  );
  r.get(
    '/drops/trail/saved',
    { schema: { querystring: trailQuery, response: { 200: trailResponse } } },
    trailController.saved,
  );
  r.get(
    '/drops/trail/dropped',
    { schema: { querystring: trailQuery, response: { 200: trailResponse } } },
    trailController.dropped,
  );

  r.post(
    '/drops/:id/reveal',
    {
      schema: {
        params: dropIdParams,
        body: revealBody,
        response: { 200: apiSecretSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    revealController.reveal,
  );

  r.post(
    '/drops/:id/save',
    { schema: { params: dropIdParams, response: { 200: savedResponse } } },
    engagementController.save,
  );
  r.delete(
    '/drops/:id/save',
    { schema: { params: dropIdParams, response: { 200: savedResponse } } },
    engagementController.unsave,
  );

  r.post(
    '/drops/:id/heart',
    { schema: { params: dropIdParams, response: { 200: heartResponse } } },
    engagementController.heart,
  );
  r.delete(
    '/drops/:id/heart',
    { schema: { params: dropIdParams, response: { 200: heartResponse } } },
    engagementController.unheart,
  );

  r.post(
    '/drops/:id/report',
    {
      schema: {
        params: dropIdParams,
        body: reportBody,
        response: { 200: reportResponse },
      },
    },
    engagementController.report,
  );
}
