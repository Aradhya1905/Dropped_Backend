/**
 * device.controller — the anonymous identity summary (`GET /devices/me`), the
 * Trail stats (`GET /devices/me/stats`), the per-city breakdown behind them
 * (`GET /devices/me/cities`), the Trail steps (`GET`/`POST
 * /devices/me/steps`), and the panic wipe (`DELETE /devices/me`).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { deviceService } from '../services/device.service.js';
import { stepService } from '../services/step.service.js';
import type { addStepsBody } from '../schemas/drop.schema.js';

export const deviceController = {
  async me(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await deviceService.summary(request.deviceId));
  },

  async stats(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await deviceService.stats(request.deviceId));
  },

  async cities(request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ cities: await deviceService.cities(request.deviceId) });
  },

  async erase(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await deviceService.erase(request.deviceId));
  },

  async steps(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await stepService.get(request.deviceId));
  },

  async addSteps(
    request: FastifyRequest<{ Body: z.infer<typeof addStepsBody> }>,
    reply: FastifyReply,
  ) {
    await stepService.add(request.deviceId, request.body.entries);
    return reply.send(await stepService.get(request.deviceId));
  },
};
