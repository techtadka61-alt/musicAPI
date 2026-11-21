import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { ApiErrorResponse } from '@wedding/shared';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHost() {
  const json = vi.fn<(body: ApiErrorResponse) => void>();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/test' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('maps an HttpException to its status and code', () => {
    const { host, status, json } = createHost();
    filter.catch(new NotFoundException('Song not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: expect.objectContaining({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Song not found',
        path: '/api/v1/test',
      }),
    });
  });

  it('exposes validation messages as details', () => {
    const { host, json } = createHost();
    filter.catch(
      new BadRequestException(['title must be a string', 'page must be positive']),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      success: false,
      error: expect.objectContaining({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Validation failed',
        details: ['title must be a string', 'page must be positive'],
      }),
    });
  });

  it('hides internals of unknown errors behind a generic 500', () => {
    const { host, status, json } = createHost();
    filter.catch(new Error('connection string leaked: mongodb://secret'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0];
    expect(body?.error.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
