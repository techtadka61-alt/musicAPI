import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { CatalogModelsModule } from '../database/catalog-models.module';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../modules/storage/storage.module';

/** Minimal context for maintenance commands: config, database, models and storage. No HTTP. */
@Module({
  imports: [AppConfigModule, DatabaseModule, CatalogModelsModule, StorageModule],
})
export class CliModule {}
