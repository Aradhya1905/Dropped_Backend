/**
 * deviceId — turns the anonymous `X-Device-Id` header into request.deviceId.
 *
 * This IS the auth model: no accounts, the device id is the identity. The header
 * must be a UUID (matches the client's generator). The device row is lazily
 * upserted so any first request "registers" the device with no signup step.
 *
 * `/health` and other public paths are exempt via the `publicPaths` option.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { deviceRepo } from '../repositories/device.repo.js';
import { unauthorized } from './errorHandler.js';

const DEVICE_HEADER = 'x-device-id';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    /** The anonymous device identity for this request. */
    deviceId: string;
  }
}

interface DeviceIdOptions {
  /** Paths that do not require a device id (exact match). */
  publicPaths?: string[];
}

export const deviceIdPlugin = fp<DeviceIdOptions>(
  async (app: FastifyInstance, opts) => {
    const publicPaths = opts.publicPaths ?? ['/health'];
    const exact = new Set(publicPaths);

    const isPublic = (path: string): boolean => {
      if (exact.has(path)) return true;
      // Prefix match so a docs mount (e.g. /docs) also exempts its assets
      // (/docs/, /docs/foo.js). /health stays an exact match.
      return publicPaths.some(
        (p) => p !== '/health' && (path === p || path.startsWith(p + '/')),
      );
    };

    app.decorateRequest('deviceId', '');

    app.addHook('onRequest', async (request: FastifyRequest) => {
      // request.url carries the query string; strip it before matching.
      const path = (request.routeOptions.url ?? request.url).split('?')[0] ?? '';
      if (isPublic(path)) {
        return;
      }

      const raw = request.headers[DEVICE_HEADER];
      const value = Array.isArray(raw) ? raw[0] : raw;

      if (!value || !UUID_RE.test(value)) {
        throw unauthorized('Missing or invalid X-Device-Id header');
      }

      request.deviceId = value;
      // Lazily register the device — first request is the "account".
      await deviceRepo.ensure(value);
    });
  },
  { name: 'device-id' },
);
