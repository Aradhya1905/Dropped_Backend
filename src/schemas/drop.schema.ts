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
  /**
   * How long the drop lives. Absent = forever (the default).
   *
   * A *duration*, never a timestamp: the server computes `expires_at` from its
   * own clock, because a client-supplied expiry is a client-supplied clock.
   */
  expiresInDays: z.union([z.literal(7), z.literal(30)]).optional(),
  /**
   * May a share link point at this drop? Absent = yes.
   *
   * An opt-out on the *link*, not on the drop: a confession meant for
   * strangers walking past is a different thing from one forwarded into a
   * group chat. False makes `GET /drops/:id/preview` 404; the drop is still
   * found by walking to it.
   */
  shareable: z.boolean().optional(),
});

export const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().positive().optional(),
  /**
   * Comma-separated mood filter, e.g. `?mood=joy,wonder`. Absent = every mood.
   *
   * Absent must stay `undefined` rather than `[]`: "all moods" and "no moods"
   * are opposite answers, and collapsing them returns an empty map.
   */
  mood: z
    .string()
    .optional()
    .transform(s =>
      s === undefined ? undefined : s.split(',').map(m => m.trim()).filter(Boolean),
    )
    .pipe(z.array(moodSchema).min(1).max(4).optional()),
});

export const nearbyResponse = z.object({
  secrets: z.array(apiSecretSchema),
  /**
   * Drops in range that the mood filter removed. The map shows this so
   * filtering reads as a *view* over the world rather than as content that
   * doesn't exist — the product promise is "you can only read what you walk
   * to", and a silent filter muddies it. Always 0 when no filter is applied.
   */
  hiddenByFilter: z.number(),
});

/**
 * `GET /drops/echoes?lat&lng&radiusMeters` — anniversaries near a point.
 *
 * No pagination and no mood filter on purpose: the answer is at most a handful
 * of places, and a filtered memory is not a memory.
 */
export const echoesQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().positive().optional(),
});

export const echoesResponse = z.object({
  echoes: z.array(
    z.object({
      /**
       * Sealed unless this device revealed the drop or wrote it. An echo says
       * *you were here*; reading still costs the same 50 m walk it always did.
       */
      secret: apiSecretSchema,
      interval: z.enum(['6mo', '1yr', '2yr']),
      /** `dropped` = you left it here. `found` = you revealed it here. */
      kind: z.enum(['dropped', 'found']),
      /** ms epoch of the remembered drop / reveal. */
      stoodAt: z.number(),
    }),
  ),
});

/**
 * Public metadata for a shared spot — what `GET /drops/:id/preview` returns to
 * someone who has a link but has not walked anywhere.
 *
 * **No `body`, and never the stored coordinate.** This schema is the
 * enforcement point, not a description of one: `fastify-type-provider-zod`
 * serializes strictly, so a field absent here cannot reach the wire even if the
 * service hands one over. `coordinate` is deliberately the *coarsened* point
 * (see domain/coarsen) — a share link says "there is something around here",
 * and the last hundred metres are still walked.
 */
export const previewResponse = z.object({
  id: z.string(),
  placeLabel: z.string().optional(),
  city: z.string().optional(),
  mood: moodSchema,
  createdAt: z.number(),
  revealCount: z.number(),
  /** COARSENED to ~3 dp (≈100 m). Never the point the drop is stored at. */
  coordinate: coordinateSchema,
  /** ms epoch when the drop fades. Absent = forever. */
  expiresAt: z.number().optional(),
});

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
