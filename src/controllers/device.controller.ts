/**
 * device.controller — the anonymous identity summary (`GET /devices/me`) and
 * the Trail stats (`GET /devices/me/stats`).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { deviceService } from '../services/device.service.js';

export const deviceController = {
  async me(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await deviceService.summary(request.deviceId));
  },

  async stats(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await deviceService.stats(request.deviceId));
  },
};
