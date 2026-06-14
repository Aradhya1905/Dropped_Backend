/**
 * common.schema — shared Zod pieces (coordinate, the error envelope, the
 * client-shaped secret response). Reused across route schemas.
 */
import { z } from 'zod';

import { MAX_BODY_LENGTH, MOODS } from '../domain/clientTypes.js';

export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const moodSchema = z.enum(
  MOODS as unknown as [string, ...string[]],
);

export const bodySchema = z
  .string()
  .trim()
  .min(1, 'Say something.')
  .max(MAX_BODY_LENGTH, `Keep it under ${MAX_BODY_LENGTH} characters.`);

/** The standard error envelope the client reads (`response.data.message`). */
export const errorSchema = z
  .object({ message: z.string() })
  .catchall(z.unknown());

const dropSchema = z.object({
  id: z.string(),
  coordinate: coordinateSchema,
  placeLabel: z.string().optional(),
  createdAt: z.number(),
});

/** Response shape for a secret (sealed or unsealed). Superset of client Secret. */
export const apiSecretSchema = z.object({
  id: z.string(),
  body: z.string().optional(),
  drop: dropSchema,
  createdAt: z.number(),
  revealCount: z.number().optional(),
  mood: moodSchema,
  hearts: z.number(),
  stoodHere: z.number(),
  sealed: z.boolean(),
  saved: z.boolean(),
  hearted: z.boolean(),
  distanceMeters: z.number().optional(),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
