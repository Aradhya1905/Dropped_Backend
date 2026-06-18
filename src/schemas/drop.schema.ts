/**
 * drop.schema — request/response schemas for create, nearby, reveal, engagement,
 * report, and trail. Used by the routes as Fastify Zod schemas (validation +
 * serialization + types in one place).
 */
import { z } from 'zod';

import {
  apiSecretSchema,
  bodySchema,
  coordinateSchema,
  errorSchema,
  moodSchema,
  paginationSchema,
} from './common.schema.js';

export const createDropBody = z.object({
  body: bodySchema,
  mood: moodSchema,
  coordinate: coordinateSchema,
  placeLabel: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
});

export const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().positive().optional(),
});

export const nearbyResponse = z.object({ secrets: z.array(apiSecretSchema) });

export const revealBody = z.object({ coordinate: coordinateSchema });

export const dropIdParams = z.object({ id: z.string().uuid() });

export const savedResponse = z.object({ saved: z.boolean() });
export const heartResponse = z.object({
  hearted: z.boolean(),
  hearts: z.number(),
});

export const reportBody = z.object({
  reason: z.string().trim().min(1).max(280),
});
export const reportResponse = z.object({ reported: z.literal(true) });

export const trailResponse = z.object({
  secrets: z.array(apiSecretSchema),
  total: z.number(),
});
export const trailQuery = paginationSchema;

export const deviceResponse = z.object({
  deviceId: z.string(),
  createdAt: z.number(),
  dropsQuotaRemaining: z.number(),
});

export const deviceStatsResponse = z.object({
  droppedTotal: z.number(),
  droppedThisMonth: z.number(),
  foundTotal: z.number(),
  foundThisMonth: z.number(),
  citiesVisited: z.number(),
  streakDays: z.number(),
});

/** Client → server: day-tagged step deltas to accumulate (one sync). */
export const addStepsBody = z.object({
  entries: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        delta: z.number().int().positive().max(200000),
      }),
    )
    .min(1)
    .max(60),
});

/** Server → client: the single steps number the Trail receipt shows. */
export const stepsResponse = z.object({ steps: z.number() });

export const healthResponse = z.object({ ok: z.boolean() });

export { apiSecretSchema, errorSchema };
