import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  API_GLOBAL_PREFIX,
  API_VERSION,
  type MostPlayedSongDto,
  type Paginated,
  type PlayRecordedDto,
  type SongDto,
  type StreamUrlDto,
} from '@wedding/shared';
import type { Env } from '../../config/env.validation';
import type { Model, QueryFilter, Types } from 'mongoose';
import { CategoriesService } from '../categories/categories.service';
import type { CategoryRecord } from '../categories/schemas/category.schema';
import { StorageService } from '../storage/storage.service';
import type { ListSongsQueryDto } from './dto/list-songs.query';
import type { MostPlayedQueryDto } from './dto/most-played.query';
import { Song, type SongRecord } from './schemas/song.schema';

/** Case-insensitive title sort that treats "a" and "A" alike. */
const TITLE_COLLATION = { locale: 'en', strength: 2 } as const;

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class SongsService {
  private readonly artworkBaseUrl: string;

  constructor(
    @InjectModel(Song.name) private readonly songModel: Model<Song>,
    private readonly categoriesService: CategoriesService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.artworkBaseUrl = `${config.get('API_PUBLIC_URL', { infer: true })}/${API_GLOBAL_PREFIX}/v${API_VERSION}/songs`;
  }

  async list(query: ListSongsQueryDto): Promise<Paginated<SongDto>> {
    // Songs are only visible while their category is active too.
    const categories = query.category
      ? [await this.categoriesService.findActiveRecordBySlug(query.category)]
      : await this.categoriesService.findActiveRecords();
    const categoriesById = new Map(categories.map((c) => [c._id.toString(), c]));

    const filter: QueryFilter<Song> = {
      isActive: true,
      categoryId: { $in: categories.map((c) => c._id) },
    };
    if (query.search) {
      // Substring match (not $text) so partial words like "saaj" find "Saajanji".
      // Fine at this library size; revisit with Atlas Search if it grows to many thousands.
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ title: pattern }, { artist: pattern }, { album: pattern }];
    }

    const { page, limit } = query;
    const [songs, total] = await Promise.all([
      this.songModel
        .find(filter)
        .collation(TITLE_COLLATION)
        .sort({ title: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SongRecord[]>()
        .exec(),
      this.songModel.countDocuments(filter).exec(),
    ]);

    const items = songs.map((song) =>
      this.toDto(song, categoriesById.get(song.categoryId.toString())),
    );
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  /** Songs listened to at least once, most plays first (ties: by title). */
  async mostPlayed(query: MostPlayedQueryDto): Promise<Paginated<MostPlayedSongDto>> {
    const categories = await this.categoriesService.findActiveRecords();
    const categoriesById = new Map(categories.map((c) => [c._id.toString(), c]));
    const filter: QueryFilter<Song> = {
      isActive: true,
      playCount: { $gt: 0 },
      categoryId: { $in: categories.map((c) => c._id) },
    };

    const { page, limit } = query;
    const [songs, total] = await Promise.all([
      this.songModel
        .find(filter)
        .collation(TITLE_COLLATION)
        .sort({ playCount: -1, title: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SongRecord[]>()
        .exec(),
      this.songModel.countDocuments(filter).exec(),
    ]);

    const items = songs.map((song) => ({
      ...this.toDto(song, categoriesById.get(song.categoryId.toString())),
      playCount: song.playCount,
    }));
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  /** Counts one listen. The client calls this once per play, after the minimum listen time. */
  async recordPlay(id: Types.ObjectId): Promise<PlayRecordedDto> {
    await this.findPlayable(id);
    const updated = await this.songModel
      .findOneAndUpdate(
        { _id: id, isActive: true },
        { $inc: { playCount: 1 } },
        { returnDocument: 'after', projection: { playCount: 1 } },
      )
      .lean<Pick<SongRecord, 'playCount'>>()
      .exec();
    if (!updated) throw new NotFoundException('Song not found');
    return { playCount: updated.playCount };
  }

  async getById(id: Types.ObjectId): Promise<SongDto> {
    const { song, category } = await this.findPlayable(id);
    return this.toDto(song, category);
  }

  async getStreamUrl(id: Types.ObjectId): Promise<StreamUrlDto> {
    const { song } = await this.findPlayable(id);
    const { url, expiresAt } = await this.storage.getReadUrl(song.audioKey);
    return {
      url,
      expiresAt: expiresAt.toISOString(),
      mimeType: song.mimeType,
      fileSize: song.fileSize,
      checksum: song.checksum,
    };
  }

  /** Fresh signed URL of the song's cover image; 404 when the song has none. */
  async getArtworkUrl(id: Types.ObjectId): Promise<string> {
    const { song } = await this.findPlayable(id);
    if (!song.artworkKey) throw new NotFoundException('Song has no artwork');
    return (await this.storage.getReadUrl(song.artworkKey)).url;
  }

  /** An active song whose category is also active; anything else is reported as not found. */
  private async findPlayable(
    id: Types.ObjectId,
  ): Promise<{ song: SongRecord; category: CategoryRecord }> {
    const song = await this.songModel
      .findOne({ _id: id, isActive: true })
      .lean<SongRecord>()
      .exec();
    const categories = song ? await this.categoriesService.findActiveRecords() : [];
    const category = categories.find((c) => c._id.equals(song?.categoryId));
    if (!song || !category) throw new NotFoundException('Song not found');
    return { song, category };
  }

  private toDto(song: SongRecord, category: CategoryRecord | undefined): SongDto {
    if (!category) {
      // Unreachable: queries are scoped to active categories.
      throw new Error(`Song ${song._id.toString()} has no active category`);
    }
    const id = song._id.toString();
    return {
      id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      category: { id: category._id.toString(), slug: category.slug, name: category.name },
      // A stable URL (redirects to a fresh signed one), so clients can keep it in saved
      // queues/history and cache it, unlike a signed URL that expires.
      artworkUrl: song.artworkKey ? `${this.artworkBaseUrl}/${id}/artwork` : null,
      durationSeconds: song.durationSeconds,
      fileSize: song.fileSize,
      mimeType: song.mimeType,
      checksum: song.checksum,
    };
  }
}
