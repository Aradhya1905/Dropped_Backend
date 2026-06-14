/**
 * reveal.controller — unseal a drop after server-side 50 m verification.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { revealService } from '../services/reveal.service.js';
import type { dropIdParams, revealBody } from '../schemas/drop.schema.js';

export const revealController = {
  async reveal(
    request: FastifyRequest<{
      Params: z.infer<typeof dropIdParams>;
      Body: z.infer<typeof revealBody>;
    }>,
    reply: FastifyReply,
  ) {
    const secret = await revealService.reveal(
      request.deviceId,
      request.params.id,
      request.body.coordinate,
    );
    return reply.send(secret);
  },
};
