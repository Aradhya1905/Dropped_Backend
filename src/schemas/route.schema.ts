/**
 * route.schema — Zod shapes for GET /route/foot (the walking-route proxy).
 *
 * Flat query params (Fastify's default querystring parser doesn't nest), and a
 * response that is always 200: `available` flips false with null fields when no
 * provider could serve the route, so the client just draws nothing.
 */
import { z } from 'zod';

export const footRouteQuery = z.object({
  fromLat: z.coerce.number().min(-90).max(90),
  fromLng: z.coerce.number().min(-180).max(180),
  toLat: z.coerce.number().min(-90).max(90),
  toLng: z.coerce.number().min(-180).max(180),
});

export const geoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

export const footRouteResponse = z.object({
  available: z.boolean(),
  provider: z.enum(['ors', 'mapbox']).nullable(),
  geometry: geoJsonLineStringSchema.nullable(),
  distanceMeters: z.number().nullable(),
  durationSeconds: z.number().nullable(),
});
