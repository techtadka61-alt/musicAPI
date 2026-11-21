import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_GLOBAL_PREFIX, API_VERSION } from '@wedding/shared';
import type { Env } from '../../config/env.validation';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { LocalUrlSigner } from './drivers/local-url-signer';
import { S3StorageDriver } from './drivers/s3-storage.driver';
import { LocalStorageController } from './local-storage.controller';
import { StorageService } from './storage.service';
import { STORAGE_DRIVER, type StorageDriver } from './storage.types';

function createStorageDriver(config: ConfigService<Env, true>): StorageDriver {
  if (config.get('STORAGE_DRIVER', { infer: true }) === 's3') {
    // Presence is guaranteed by env validation when STORAGE_DRIVER=s3.
    const region = config.get('AWS_REGION', { infer: true }) as string;
    const bucket = config.get('AWS_S3_BUCKET', { infer: true }) as string;
    return new S3StorageDriver(new S3Client({ region }), bucket);
  }

  const secret = config.get('STORAGE_SIGNING_SECRET', { infer: true }) as string;
  const serveUrl = `${config.get('API_PUBLIC_URL', { infer: true })}/${API_GLOBAL_PREFIX}/v${API_VERSION}/storage/local`;
  return new LocalStorageDriver(
    config.get('LOCAL_STORAGE_DIR', { infer: true }),
    new LocalUrlSigner(secret),
    serveUrl,
  );
}

@Module({
  controllers: [LocalStorageController],
  providers: [
    { provide: STORAGE_DRIVER, inject: [ConfigService], useFactory: createStorageDriver },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
