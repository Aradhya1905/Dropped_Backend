/**
 * reply.controller — thin transport layer for replies in place.
 *
 * Deliberately holds no rules: the "have you stood here?" gate lives in
 * reply.service so it applies to every entry point, present and future.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { replyService } from '../services/reply.service.js';
import type { dropIdParams, reportBody } from '../schemas/drop.schema.js';
import type {
  createReplyBody,
  repliesQuery,
  replyIdParams,
} from '../schemas/reply.schema.js';

type ListReq = FastifyRequest<{
  Params: z.infer<typeof dropIdParams>;
  Querystring: z.infer<typeof repliesQuery>;
}>;

type CreateReq = FastifyRequest<{
  Params: z.infer<typeof dropIdParams>;
  Body: z.infer<typeof createReplyBody>;
}>;

type ReplyIdReq = FastifyRequest<{ Params: z.infer<typeof replyIdParams> }>;

type ReportReq = FastifyRequest<{
  Params: z.infer<typeof replyIdParams>;
  Body: z.infer<typeof reportBody>;
}>;

export const replyController = {
  async list(request: ListReq, reply: FastifyReply) {
    const { limit, offset } = request.query;
    return reply.send(
      await replyService.list(
        request.deviceId,
        request.params.id,
        limit,
        offset,
      ),
    );
  },

  async create(request: CreateReq, reply: FastifyReply) {
    const created = await replyService.create(
      request.deviceId,
      request.params.id,
      request.body.body,
    );
    return reply.status(201).send(created);
  },

  async remove(request: ReplyIdReq, reply: FastifyReply) {
    return reply.send(
      await replyService.remove(
        request.deviceId,
        request.params.id,
        request.params.replyId,
      ),
    );
  },

  async report(request: ReportReq, reply: FastifyReply) {
    return reply.send(
      await replyService.report(
        request.deviceId,
        request.params.id,
        request.params.replyId,
        request.body.reason,
      ),
    );
  },
};
