/**
 * route.routes — GET /route/foot, the server-side walking-route proxy
 * (OpenRouteService → Mapbox → none). Used by the client to draw the path from
 * the walker to a sealed drop. Guidance only; the 50 m reveal is enforced
 * separately and never depends on this.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { routeController } from '../controllers/route.controller.js';
import {
  footRouteQuery,
  footRouteResponse,
} from '../schemas/route.schema.js';
import { errorSchema } from '../schemas/common.schema.js';

export async function routeRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/route/foot',
    {
      schema: {
        querystring: footRouteQuery,
        response: { 200: footRouteResponse, 400: errorSchema },
      },
    },
    routeController.foot,
  );
}
