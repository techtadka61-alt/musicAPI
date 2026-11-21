import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Rate limiting (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_MAX_REQUESTS: '3' });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('returns 429 in the error envelope once the per-IP limit is exceeded', async () => {
    const server = ctx.app.getHttpServer();
    for (let i = 0; i < 3; i += 1) {
      await request(server).get('/api/v1/categories').expect(200);
    }
    const res = await request(server).get('/api/v1/categories').expect(429);
    expect(res.body).toMatchObject({
      success: false,
      error: { statusCode: 429, code: 'TOO_MANY_REQUESTS' },
    });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('never rate-limits the health check', async () => {
    const server = ctx.app.getHttpServer();
    for (let i = 0; i < 6; i += 1) {
      await request(server).get('/api/v1/health').expect(200);
    }
  });
});
