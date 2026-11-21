import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from '../modules/categories/schemas/category.schema';
import { Song, SongSchema } from '../modules/songs/schemas/song.schema';

/** Registers catalog models once; feature modules and the CLI import this instead of re-registering. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Song.name, schema: SongSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class CatalogModelsModule {}
