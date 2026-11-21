import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ALLOWED_AUDIO_MIME_TYPES } from '@wedding/shared';
import { Schema as MongooseSchema, type HydratedDocument, type Types } from 'mongoose';
import { Category } from '../../categories/schemas/category.schema';

/** Song metadata only. The audio and artwork bytes live in object storage (S3), referenced by key. */
@Schema({ collection: 'songs', timestamps: true })
export class Song {
  @Prop({ required: true, trim: true, maxlength: 200 })
  title: string;

  @Prop({ type: String, default: null, trim: true, maxlength: 200 })
  artist: string | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 200 })
  album: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Category.name, required: true })
  categoryId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  durationSeconds: number;

  @Prop({ required: true, min: 1 })
  fileSize: number;

  @Prop({ required: true, enum: ALLOWED_AUDIO_MIME_TYPES })
  mimeType: string;

  /** Storage key of the audio file, e.g. `music/<songId>.mp3`. */
  @Prop({ required: true, unique: true })
  audioKey: string;

  /** Storage key of the cover image, e.g. `artwork/songs/<songId>.jpg`. */
  @Prop({ type: String, default: null })
  artworkKey: string | null;

  @Prop({ required: true, enum: ['s3', 'local'] })
  storageProvider: string;

  /** Hex SHA-256 of the audio file. Unique: the same file is never imported twice. */
  @Prop({ required: true, unique: true, match: /^[a-f0-9]{64}$/ })
  checksum: string;

  /** Original file name at import time, for traceability. */
  @Prop({ type: String, default: null })
  sourceFile: string | null;

  @Prop({ required: true, default: true })
  isActive: boolean;

  /** Times listened to (see PLAY_COUNT_MIN_LISTEN_SECONDS). Only ever changed with . */
  @Prop({ required: true, default: 0, min: 0 })
  playCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export type SongDocument = HydratedDocument<Song>;
export type SongRecord = Song & { _id: Types.ObjectId };

export const SongSchema = SchemaFactory.createForClass(Song);
SongSchema.index({ categoryId: 1, isActive: 1, title: 1 });
// "Most played": songs with plays, highest count first.
SongSchema.index({ isActive: 1, playCount: -1 });
