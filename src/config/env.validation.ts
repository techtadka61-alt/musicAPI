import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

/** `ap-south-1`, `us-east-1`, `ap-southeast-2`. Rejects Availability Zones like `ap-southeast-2b`. */
const AWS_REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(7102),
    /** Public base URL of this API (scheme + host + port, no path). Used to build local-storage URLs. */
    API_PUBLIC_URL: z
      .url()
      .default('http://localhost:7102')
      .transform((url) => url.replace(/\/+$/, '')),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:7101')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.url()).min(1)),
    TRUST_PROXY: booleanFromString.default(false),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    SWAGGER_ENABLED: booleanFromString.default(true),

    /** `s3` in production. `local` stores files on disk for development without AWS credentials. */
    STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
    STREAM_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(43_200).default(3_600),
    AWS_REGION: z
      .string()
      .regex(AWS_REGION_PATTERN, 'must be a region like ap-south-1 (not an Availability Zone)')
      .optional(),
    AWS_S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid S3 bucket name')
      .optional(),
    LOCAL_STORAGE_DIR: z.string().min(1).default('.storage'),
    STORAGE_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  })
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(env.API_PUBLIC_URL)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_PUBLIC_URL'],
        message: 'must be the public URL of the API in production (used in artwork links)',
      });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['AWS_REGION', 'AWS_S3_BUCKET'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=s3' });
        }
      }
    }
    if (env.STORAGE_DRIVER === 'local') {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'local storage is for development only; use s3 in production',
        });
      }
      if (!env.STORAGE_SIGNING_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_SIGNING_SECRET'],
          message: 'required when STORAGE_DRIVER=local',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Passed to `ConfigModule.forRoot({ validate })`. Throws on startup with every invalid
 * variable listed, so a misconfigured deployment fails immediately instead of at first use.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
