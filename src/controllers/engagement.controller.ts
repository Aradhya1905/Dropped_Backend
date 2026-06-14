/**
 * engagement.controller — save/unsave, heart/unheart, report.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { engagementService } from '../services/engagement.service.js';
import type { dropIdParams, reportBody } from '../schemas/drop.schema.js';

type IdReq = FastifyRequest<{ Params: z.infer<typeof dropIdParams> }>;

export const engagementController = {
  async save(request: IdReq, reply: FastifyReply) {
    return reply.send(
      await engagementService.setSaved(request.deviceId, request.params.id, true),
    );
  },

  async unsave(request: IdReq, reply: FastifyReply) {
    return reply.send(
      await engagementService.setSaved(request.deviceId, request.params.id, false),
    );
  },

  async heart(request: IdReq, reply: FastifyReply) {
    return reply.send(
      await engagementService.setHearted(request.deviceId, request.params.id, true),
    );
  },

  async unheart(request: IdReq, reply: FastifyReply) {
    return reply.send(
      await engagementService.setHearted(request.deviceId, request.params.id, false),
    );
  },

  async report(
    request: FastifyRequest<{
      Params: z.infer<typeof dropIdParams>;
      Body: z.infer<typeof reportBody>;
    }>,
    reply: FastifyReply,
  ) {
    return reply.send(
      await engagementService.report(
        request.deviceId,
        request.params.id,
        request.body.reason,
      ),
    );
  },
};
