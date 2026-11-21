import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { CategoryDto } from '@wedding/shared';
import type { Model, Types } from 'mongoose';
import { Song } from '../songs/schemas/song.schema';
import { StorageService } from '../storage/storage.service';
import { Category, type CategoryRecord } from './schemas/category.schema';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<Category>,
    @InjectModel(Song.name) private readonly songModel: Model<Song>,
    private readonly storage: StorageService,
  ) {}

  async listActive(): Promise<CategoryDto[]> {
    const categories = await this.findActiveRecords();
    const counts = await this.countActiveSongs(categories.map((category) => category._id));
    return Promise.all(
      categories.map((category) => this.toDto(category, counts.get(category._id.toString()) ?? 0)),
    );
  }

  async getActiveBySlug(slug: string): Promise<CategoryDto> {
    const category = await this.findActiveRecordBySlug(slug);
    const counts = await this.countActiveSongs([category._id]);
    return this.toDto(category, counts.get(category._id.toString()) ?? 0);
  }

  /** Active categories ordered for display. Used by SongsService to scope song queries. */
  findActiveRecords(): Promise<CategoryRecord[]> {
    return this.categoryModel
      .find({ isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean<CategoryRecord[]>()
      .exec();
  }

  async findActiveRecordBySlug(slug: string): Promise<CategoryRecord> {
    const category = await this.categoryModel
      .findOne({ slug, isActive: true })
      .lean<CategoryRecord>()
      .exec();
    if (!category) throw new NotFoundException(`Category "${slug}" not found`);
    return category;
  }

  private async countActiveSongs(categoryIds: Types.ObjectId[]): Promise<Map<string, number>> {
    const rows = await this.songModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { isActive: true, categoryId: { $in: categoryIds } } },
        { $group: { _id: '$categoryId', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [row._id.toString(), row.count]));
  }

  private async toDto(category: CategoryRecord, songCount: number): Promise<CategoryDto> {
    return {
      id: category._id.toString(),
      name: category.name,
      slug: category.slug,
      description: category.description,
      artworkUrl: await this.storage.getOptionalReadUrl(category.artworkKey),
      songCount,
    };
  }
}
