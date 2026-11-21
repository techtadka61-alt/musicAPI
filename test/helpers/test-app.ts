import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';

export const TEST_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef';

export interface TestContext {
  app: NestExpressApplication;
  storageDir: string;
  close: () => Promise<void>;
}

/**
 * Boots the real AppModule with the same global pipeline as production, against a throwaway
 * MongoDB and a temporary local-storage directory. Every env var is set explicitly.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestContext> {
  const mongo = await MongoMemoryServer.create();
  // A dot-folder like the real default (`.storage`) — regression guard for express sendFile,
  // which refuses absolute paths containing dot-segments.
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'wedding storage '));
  const storageDir = path.join(tempRoot, '.storage');

  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri('wedding_music_test'),
    API_PUBLIC_URL: 'http://localhost:4000',
    SWAGGER_ENABLED: 'false',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX_REQUESTS: '1000',
    STORAGE_DRIVER: 'local',
    STORAGE_SIGNING_SECRET: TEST_SIGNING_SECRET,
    LOCAL_STORAGE_DIR: storageDir,
    STREAM_URL_TTL_SECONDS: '600',
    ...env,
  });

  // Imported after env is set: ConfigModule.forRoot() validates env when the module is evaluated.
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  return {
    app,
    storageDir,
    close: async () => {
      await app.close();
      await mongo.stop();
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

/** Turns an absolute local-storage URL into a path supertest can request against the app. */
export function toRequestPath(absoluteUrl: string): string {
  const url = new URL(absoluteUrl);
  return `${url.pathname}${url.search}`;
}
