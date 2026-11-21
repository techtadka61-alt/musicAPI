import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorResponse } from '@wedding/shared';
import type { Request, Response } from 'express';

/**
 * Converts every thrown error into the shared `ApiErrorResponse` envelope.
 * Unknown errors become a generic 500 so internals (stack traces, driver messages) never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const { message, details } = this.extractMessage(exception, statusCode);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        statusCode,
        code: (HttpStatus[statusCode] as string | undefined) ?? 'ERROR',
        message,
        ...(details ? { details } : {}),
        path: request.originalUrl,
        timestamp: new Date().toISOString(),
      },
    };

    response.status(statusCode).json(body);
  }

  private extractMessage(
    exception: unknown,
    statusCode: number,
  ): { message: string; details?: string[] } {
    if (!(exception instanceof HttpException)) {
      return { message: 'Internal server error' };
    }

    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return { message: payload };
    }

    // ValidationPipe produces `{ message: string[] }`; other HttpExceptions produce `{ message: string }`.
    const raw = (payload as { message?: unknown }).message;
    if (Array.isArray(raw)) {
      const details = raw.filter((item): item is string => typeof item === 'string');
      return {
        message: statusCode === HttpStatus.BAD_REQUEST ? 'Validation failed' : exception.message,
        details,
      };
    }
    return { message: typeof raw === 'string' ? raw : exception.message };
  }
}
