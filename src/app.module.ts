import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module';
import type { Env } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { HealthModule } from './modules/health/health.module';
import { SongsModule } from './modules/songs/songs.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('RATE_LIMIT_TTL_SECONDS', { infer: true }) * 1_000,
          limit: config.get('RATE_LIMIT_MAX_REQUESTS', { infer: true }),
        },
      ],
    }),
    DatabaseModule,
    HealthModule,
    StorageModule,
    CategoriesModule,
    SongsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
