/**
 * reply.schema — request/response schemas for replies in place.
 *
 * The response shape carries **no authorship**: `{ id, body, createdAt, mine }`
 * and nothing else. `mine` is derived per-request against the caller, so it
 * says which reply the caller may delete without saying who wrote any other.
 * Fastify serializes against this schema, so a `deviceId` accidentally added to
 * the mapper later would be stripped here rather than leaking.
 */
import { z } from 'zod';

import { MAX_REPLY_LENGTH } from '../domain/clientTypes.js';
import { paginationSchema } from './common.schema.js';

/** One line, not a comment thread. */
export const replyBodySchema = z
  .string()
  .trim()
  .min(1, 'Say something.')
  .max(MAX_REPLY_LENGTH, `Keep it under ${MAX_REPLY_LENGTH} characters.`);

export const createReplyBody = z.object({ body: replyBodySchema });

export const replyResponse = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.number(),
  mine: z.boolean(),
});

export const repliesResponse = z.object({
  replies: z.array(replyResponse),
  total: z.number(),
});

export const replyIdParams = z.object({
  id: z.string().uuid(),
  replyId: z.string().uuid(),
});

export const repliesQuery = paginationSchema;

export const deleteReplyResponse = z.object({ deleted: z.literal(true) });
