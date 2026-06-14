/**
 * trail.controller — found / saved / dropped lists for the requesting device.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { trailService, type TrailKind } from '../services/trail.service.js';
import type { trailQuery } from '../schemas/drop.schema.js';

type TrailReq = FastifyRequest<{ Querystring: z.infer<typeof trailQuery> }>;

const handler = (kind: TrailKind) => async (req: TrailReq, reply: FastifyReply) => {
  const { limit, offset } = req.query;
  return reply.send(await trailService.list(req.deviceId, kind, limit, offset));
};

export const trailController = {
  found: handler('found'),
  saved: handler('saved'),
  dropped: handler('dropped'),
};
