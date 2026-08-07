/**
 * drops.routes — everything under /drops: create, nearby, reveal, save, heart,
 * report, and the trail lists. Schemas validate input and serialize output.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { dropController } from '../controllers/drop.controller.js';
import { revealController } from '../controllers/reveal.controller.js';
import { engagementController } from '../controllers/engagement.controller.js';
import { replyController } from '../controllers/reply.controller.js';
import { trailController } from '../controllers/trail.controller.js';
import {
  apiSecretSchema,
  createDropBody,
  dropIdParams,
  echoesQuery,
  echoesResponse,
  errorSchema,
  heartResponse,
  nearbyQuery,
  nearbyResponse,
  previewResponse,
  reportBody,
  reportResponse,
  revealBody,
  savedResponse,
  trailQuery,
  trailResponse,
} from '../schemas/drop.schema.js';
import {
  createReplyBody,
  deleteReplyResponse,
  repliesQuery,
  repliesResponse,
  replyIdParams,
  replyResponse,
} from '../schemas/reply.schema.js';

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

  // Anniversary echoes. Answers only about the calling device's own past —
  // drops it left, secrets it revealed — so there is nothing here to scrape
  // that the device didn't already do.
  //
  // The tighter limit is about battery and cost, not disclosure: the client
  // polls this from a location watch, and its own discipline (once per day per
  // ~250 m) lives on the device where it can be turned off. This is the floor
  // under a client that gets that wrong.
  r.get(
    '/drops/echoes',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        querystring: echoesQuery,
        response: { 200: echoesResponse, 429: errorSchema },
      },
    },
    dropController.echoes,
  );

  // Share-a-spot: public metadata for one drop, for someone who has a link and
  // has not walked anywhere. It is the only route that answers without a reveal
  // on record, which makes it the most scrapeable surface in the API — hence a
  // per-route limit well under the global 120/min. It still requires a valid
  // X-Device-Id like everything else; the link opens the app, and the app
  // always has one.
  //
  // Keyed by IP, unlike the global limiter's device id. A device id is a
  // self-asserted header — an enumerating client rotates it for free, so
  // keying the *scrape-sensitive* route on it would throttle nobody.
  r.get(
    '/drops/:id/preview',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.ip,
        },
      },
      schema: {
        params: dropIdParams,
        response: {
          200: previewResponse,
          404: errorSchema,
          429: errorSchema,
        },
      },
    },
    dropController.preview,
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

  // Replies in place. Both read and write are gated on a `reveals` row for
  // (drop, device) — a device that has not physically stood here gets 403 on
  // the list, not an empty array. The gate is in reply.service.
  r.get(
    '/drops/:id/replies',
    {
      schema: {
        params: dropIdParams,
        querystring: repliesQuery,
        response: { 200: repliesResponse, 403: errorSchema, 404: errorSchema },
      },
    },
    replyController.list,
  );

  r.post(
    '/drops/:id/replies',
    {
      schema: {
        params: dropIdParams,
        body: createReplyBody,
        response: {
          201: replyResponse,
          403: errorSchema,
          404: errorSchema,
          422: errorSchema,
          429: errorSchema,
        },
      },
    },
    replyController.create,
  );

  r.delete(
    '/drops/:id/replies/:replyId',
    {
      schema: {
        params: replyIdParams,
        response: {
          200: deleteReplyResponse,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    replyController.remove,
  );

  r.post(
    '/drops/:id/replies/:replyId/report',
    {
      schema: {
        params: replyIdParams,
        body: reportBody,
        response: { 200: reportResponse, 403: errorSchema, 404: errorSchema },
      },
    },
    replyController.report,
  );
}
