import { Module } from '@nestjs/common';
import { CatalogModelsModule } from '../../database/catalog-models.module';
import { CategoriesModule } from '../categories/categories.module';
import { StorageModule } from '../storage/storage.module';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';

@Module({
  imports: [CatalogModelsModule, CategoriesModule, StorageModule],
  controllers: [SongsController],
  providers: [SongsService],
})
export class SongsModule {}
