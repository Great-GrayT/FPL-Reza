import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FplError, NotFoundError, SourceError, ValidationError } from '@fpl/core';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    issues?: readonly string[];
  };
}

/** Domain errors map to HTTP status by kind; anything else is an unexpected 500. */
function statusFor(error: unknown): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ValidationError) return 400;
  if (error instanceof SourceError) return 502;
  return 500;
}

function bodyFor(error: unknown, status: number): ErrorResponseBody {
  if (error instanceof ValidationError) {
    return { error: { code: error.code, message: error.message, issues: error.issues } };
  }
  if (error instanceof FplError) {
    return { error: { code: error.code, message: error.message } };
  }
  // Anything not raised on purpose keeps its detail out of the response body.
  const message =
    status === 500 ? 'internal server error' : error instanceof Error ? error.message : 'error';
  return { error: { code: status === 500 ? 'INTERNAL' : 'ERROR', message } };
}

/** Single place every route's thrown error passes through, so status codes stay consistent. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    const status = statusFor(error);
    reply.status(status).send(bodyFor(error, status));
  });
}
