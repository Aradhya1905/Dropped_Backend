/**
 * common.schema — shared Zod pieces (coordinate, the error envelope, the
 * client-shaped secret response). Reused across route schemas.
 */
import { z } from 'zod';

import {
  MAX_BODY_LENGTH,
  MOODS,
  REVEAL_CONDITIONS,
} from '../domain/clientTypes.js';

export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const moodSchema = z.enum(
  MOODS as unknown as [string, ...string[]],
);

/**
 * The one extra condition a drop may carry. A closed enum, matched by the
 * `drops_reveal_condition_chk` constraint in SQL — the composer offers exactly
 * these two, and weather gating is a separate, later ticket.
 */
export const revealConditionSchema = z.enum(
  REVEAL_CONDITIONS as unknown as [string, ...string[]],
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
  /**
   * The city the drop was left in, as the composer resolved it. Absent when the
   * author's device never named one — every drop predating the column, and any
   * drop made without reverse geocoding.
   *
   * It is coarser than `placeLabel` and therefore *safer*, not more sensitive:
   * it is what lets the client group a trail into one constellation per city.
   */
  city: z.string().optional(),
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
  /** Visible replies pinned under this drop. Readable only by standing there. */
  replyCount: z.number(),
  sealed: z.boolean(),
  saved: z.boolean(),
  hearted: z.boolean(),
  distanceMeters: z.number().optional(),
  /** ms epoch when this drop fades. Absent = forever. */
  expiresAt: z.number().optional(),
  /**
   * Mood + a short teaser, sent only for a sealed drop inside the whisper band
   * (150–50 m). Never present alongside `body`.
   */
  whisper: z.object({ mood: moodSchema, teaser: z.string() }).optional(),
  /**
   * Whether a share link may point here. Surfaced to every reader, not just
   * the author: otherwise a reader offers a share sheet whose link 404s for
   * whoever receives it.
   */
  shareable: z.boolean(),
  /**
   * The extra condition guarding this drop. Absent = none. Present on sealed
   * rows on purpose — a pin that says "waits for dark" lets someone plan the
   * walk, and saying *when* gives away nothing about *what*.
   */
  revealCondition: revealConditionSchema.optional(),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
