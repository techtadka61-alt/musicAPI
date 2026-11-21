import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

/** Shared by the HTTP app and the CLI so both validate env identically. */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  envFilePath: ['.env'],
  // Tests set every variable explicitly; a developer's .env must not leak into them.
  ignoreEnvFile: process.env.NODE_ENV === 'test',
  validate: validateEnv,
});
