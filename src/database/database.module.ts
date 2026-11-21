import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Env } from '../config/env.validation';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        // Fail fast at boot instead of hanging when the cluster is unreachable.
        serverSelectionTimeoutMS: 5_000,
        retryAttempts: 3,
        retryDelay: 2_000,
      }),
    }),
  ],
})
export class DatabaseModule {}
