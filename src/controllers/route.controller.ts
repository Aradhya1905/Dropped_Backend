/**
 * route.controller — thin handler for GET /route/foot: validated query in,
 * routingService call, shaped response out.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { routingService } from '../services/routing.service.js';
import type { footRouteQuery } from '../schemas/route.schema.js';

export const routeController = {
  async foot(
    request: FastifyRequest<{ Querystring: z.infer<typeof footRouteQuery> }>,
    reply: FastifyReply,
  ) {
    const { fromLat, fromLng, toLat, toLng } = request.query;
    const result = await routingService.footRoute(
      { lat: fromLat, lng: fromLng },
      { lat: toLat, lng: toLng },
    );
    return reply.send(result);
  },
};
