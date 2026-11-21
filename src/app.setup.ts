import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_GLOBAL_PREFIX, API_VERSION } from '@wedding/shared';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import type { Env } from './config/env.validation';

/**
 * Applies global HTTP behaviour. Shared by `main.ts` and the e2e tests so tests exercise
 * exactly the pipeline that runs in production.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  if (config.get('TRUST_PROXY', { infer: true })) {
    // Behind Nginx: trust one proxy hop so req.ip (used by rate limiting) is the real client.
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST'],
  });

  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Wedding Music Player API')
        .setDescription('Public read API for categories, songs and playlists.')
        .setVersion(API_VERSION)
        .build(),
    );
    SwaggerModule.setup(`${API_GLOBAL_PREFIX}/docs`, app, document);
  }
}
