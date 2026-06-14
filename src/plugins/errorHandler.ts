/**
 * errorHandler — every error leaves the server as `{ message: string }`.
 *
 * The client's axios layer reads `response.data.message`, so this is the one
 * shape we must always emit. We also map our typed AppError to its status and
 * Zod validation failures to 400.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** A domain error that carries an HTTP status and optional extra fields. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly extra: Record<string, unknown>;

  constructor(
    statusCode: number,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.extra = extra;
  }
}

export const badRequest = (m: string, extra?: Record<string, unknown>) =>
  new AppError(400, m, extra);
export const unauthorized = (m: string) => new AppError(401, m);
export const forbidden = (m: string, extra?: Record<string, unknown>) =>
  new AppError(403, m, extra);
export const notFound = (m: string) => new AppError(404, m);
export const unprocessable = (m: string, extra?: Record<string, unknown>) =>
  new AppError(422, m, extra);
export const tooManyRequests = (m: string) => new AppError(429, m);

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        return reply
          .status(error.statusCode)
          .send({ message: error.message, ...error.extra });
      }

      if (hasZodFastifySchemaValidationErrors(error)) {
        const first = error.validation[0];
        const detail = first
          ? `${first.instancePath || 'request'} ${first.message}`
          : 'Invalid request';
        return reply.status(400).send({ message: detail });
      }

      // Fastify's own rate-limit / known errors carry a statusCode.
      const status =
        typeof (error as { statusCode?: number }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : 500;

      if (status >= 500) {
        request.log.error({ err: error }, 'unhandled error');
        return reply.status(500).send({ message: 'Internal server error' });
      }

      const message =
        (error as { message?: string }).message ?? 'Request failed';
      return reply.status(status).send({ message });
    },
  );

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ message: 'Not found' });
  });
}
