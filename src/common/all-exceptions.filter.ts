import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ConcurrencyError } from '../ingest/errors';

/** Prisma's codes for the two failures that are not really server errors. */
const UNIQUE_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';

/**
 * Turns the handful of errors this service actually produces into the status
 * codes they deserve, and everything else into a 500 that says nothing useful
 * to a caller and everything useful to a log.
 *
 * Without it a lost race and a missing row both surface as 500, which reads to
 * anyone watching as "the service is broken" rather than "you asked for
 * something that is not there" or "try that again".
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const { status, message } = this.classify(exception);

    if (status >= 500) {
      // Only unexpected faults are worth an error log. A 404 or a lost race is
      // ordinary traffic, and logging it as an error trains people to ignore
      // the error log.
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    void reply.status(status).send({ statusCode: status, message });
  }

  private classify(exception: unknown): { status: number; message: string } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      return {
        status: exception.getStatus(),
        message:
          typeof response === 'string'
            ? response
            : ((response as { message?: string }).message ?? exception.message),
      };
    }

    // Losing a compare-and-swap is a conflict, not a fault: the caller can
    // simply try again.
    if (exception instanceof ConcurrencyError) {
      return {
        status: HttpStatus.CONFLICT,
        message: 'the record changed while writing; retry',
      };
    }

    const code = (exception as { code?: unknown } | null)?.code;

    if (code === UNIQUE_VIOLATION) {
      return { status: HttpStatus.CONFLICT, message: 'already exists' };
    }

    if (code === RECORD_NOT_FOUND) {
      return { status: HttpStatus.NOT_FOUND, message: 'not found' };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'internal server error',
    };
  }
}
