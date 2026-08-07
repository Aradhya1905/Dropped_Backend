/**
 * drop.controller — create a drop, query nearby. Thin: validated input in,
 * service call, shaped response out.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { dropService } from '../services/drop.service.js';
import type { Mood } from '../domain/clientTypes.js';
import type {
  createDropBody,
  dropIdParams,
  nearbyQuery,
} from '../schemas/drop.schema.js';

export const dropController = {
  async create(
    request: FastifyRequest<{ Body: z.infer<typeof createDropBody> }>,
    reply: FastifyReply,
  ) {
    const { body, mood, coordinate, placeLabel, city, expiresInDays, shareable } =
      request.body;
    const secret = await dropService.create({
      deviceId: request.deviceId,
      body,
      mood: mood as Mood,
      coordinate,
      placeLabel,
      city,
      expiresInDays,
      shareable,
    });
    return reply.status(201).send(secret);
  },

  async nearby(
    request: FastifyRequest<{ Querystring: z.infer<typeof nearbyQuery> }>,
    reply: FastifyReply,
  ) {
    const { lat, lng, radiusMeters, mood } = request.query;
    const { secrets, hiddenByFilter } = await dropService.nearby(
      request.deviceId,
      { lat, lng },
      radiusMeters,
      mood as Mood[] | undefined,
    );
    return reply.send({ secrets, hiddenByFilter });
  },

  /** Public metadata for a shared spot. No device relationship, no body. */
  async preview(
    request: FastifyRequest<{ Params: z.infer<typeof dropIdParams> }>,
    reply: FastifyReply,
  ) {
    const preview = await dropService.preview(request.params.id);
    return reply.send(preview);
  },
};
