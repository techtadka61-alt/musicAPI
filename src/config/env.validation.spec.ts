import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const minimal = {
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wedding_music',
    AWS_REGION: 'ap-south-1',
    AWS_S3_BUCKET: 'nexqira-s3',
  };

  it('applies defaults for optional variables', () => {
    expect(validateEnv(minimal)).toEqual({
      NODE_ENV: 'development',
      PORT: 7102,
      API_PUBLIC_URL: 'http://localhost:7102',
      MONGODB_URI: minimal.MONGODB_URI,
      CORS_ORIGINS: ['http://localhost:7101'],
      TRUST_PROXY: false,
      RATE_LIMIT_TTL_SECONDS: 60,
      RATE_LIMIT_MAX_REQUESTS: 120,
      SWAGGER_ENABLED: true,
      STORAGE_DRIVER: 's3',
      STREAM_URL_TTL_SECONDS: 3600,
      AWS_REGION: 'ap-south-1',
      AWS_S3_BUCKET: 'nexqira-s3',
      LOCAL_STORAGE_DIR: '.storage',
    });
  });

  it('parses comma-separated CORS origins, string booleans and numeric strings', () => {
    const env = validateEnv({
      ...minimal,
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com',
      TRUST_PROXY: 'true',
      SWAGGER_ENABLED: 'false',
      PORT: '8080',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.PORT).toBe(8080);
  });

  it('accepts mongodb+srv URIs (Atlas)', () => {
    expect(() =>
      validateEnv({ ...minimal, MONGODB_URI: 'mongodb+srv://u:p@cluster0.example.mongodb.net/db' }),
    ).not.toThrow();
  });

  it('rejects a missing MONGODB_URI', () => {
    expect(() => validateEnv({ ...minimal, MONGODB_URI: undefined })).toThrow(/MONGODB_URI/);
  });

  it('lists every invalid variable in one error', () => {
    let message = '';
    try {
      validateEnv({ ...minimal, MONGODB_URI: 'postgres://x', PORT: 'abc', TRUST_PROXY: 'yes' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('MONGODB_URI');
    expect(message).toContain('PORT');
    expect(message).toContain('TRUST_PROXY');
  });

  it('rejects an invalid CORS origin', () => {
    expect(() => validateEnv({ ...minimal, CORS_ORIGINS: 'not-a-url' })).toThrow(/CORS_ORIGINS/);
  });

  describe('storage', () => {
    it('requires AWS_REGION and AWS_S3_BUCKET for the s3 driver', () => {
      expect(() => validateEnv({ MONGODB_URI: minimal.MONGODB_URI })).toThrow(
        /AWS_REGION: required[\s\S]*AWS_S3_BUCKET: required/,
      );
    });

    it('rejects an Availability Zone given as AWS_REGION', () => {
      expect(() => validateEnv({ ...minimal, AWS_REGION: 'ap-southeast-2b' })).toThrow(
        /not an Availability Zone/,
      );
    });

    it.each(['ap-south-1', 'ap-southeast-2', 'us-east-1', 'eu-central-1', 'us-gov-west-1'])(
      'accepts region %s',
      (region) => {
        expect(() => validateEnv({ ...minimal, AWS_REGION: region })).not.toThrow();
      },
    );

    it('requires a signing secret for the local driver', () => {
      expect(() =>
        validateEnv({ MONGODB_URI: minimal.MONGODB_URI, STORAGE_DRIVER: 'local' }),
      ).toThrow(/STORAGE_SIGNING_SECRET/);
    });

    it('accepts the local driver without AWS settings in development', () => {
      const env = validateEnv({
        MONGODB_URI: minimal.MONGODB_URI,
        STORAGE_DRIVER: 'local',
        STORAGE_SIGNING_SECRET: 'x'.repeat(32),
      });
      expect(env.STORAGE_DRIVER).toBe('local');
    });

    it('requires a public API_PUBLIC_URL in production', () => {
      expect(() => validateEnv({ ...minimal, NODE_ENV: 'production' })).toThrow(/API_PUBLIC_URL/);
      expect(() =>
        validateEnv({
          ...minimal,
          NODE_ENV: 'production',
          API_PUBLIC_URL: 'https://api.example.com',
        }),
      ).not.toThrow();
    });

    it('refuses the local driver in production', () => {
      expect(() =>
        validateEnv({
          MONGODB_URI: minimal.MONGODB_URI,
          NODE_ENV: 'production',
          STORAGE_DRIVER: 'local',
          STORAGE_SIGNING_SECRET: 'x'.repeat(32),
        }),
      ).toThrow(/development only/);
    });
  });
});
