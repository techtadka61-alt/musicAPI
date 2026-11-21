import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken } from '@nestjs/mongoose';
import { apiResponseSchema, healthStatusSchema } from '@wedding/shared';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('GET /api/v1/health (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('returns 200 with database "up" when MongoDB is reachable', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

    const body = apiResponseSchema(healthStatusSchema).parse(res.body);
    if (!body.success) throw new Error('expected success envelope');
    expect(body.data.status).toBe('ok');
    expect(body.data.checks.database.status).toBe('up');
    expect(body.data.checks.database.latencyMs).not.toBeNull();
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { statusCode: 404, code: 'NOT_FOUND', path: '/api/v1/does-not-exist' },
    });
  });

  it('is not served without the version prefix', async () => {
    await request(ctx.app.getHttpServer()).get('/api/health').expect(404);
  });

  // Keep last: closes the shared connection.
  it('returns 503 with database "down" after MongoDB disconnects', async () => {
    await ctx.app.get<Connection>(getConnectionToken()).close();

    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(503);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'degraded', checks: { database: { status: 'down', latencyMs: null } } },
    });
  });
});
