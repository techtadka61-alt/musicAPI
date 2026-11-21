import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Types, type Model } from 'mongoose';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_FILE_BYTES } from '@wedding/shared';
import type { Category } from '../modules/categories/schemas/category.schema';
import type { Song } from '../modules/songs/schemas/song.schema';
import type { StorageService } from '../modules/storage/storage.service';
import { readMp3 } from './audio-file';
import { readManifest, type ManifestEntry } from './songs-manifest';

const AUDIO_MIME = 'audio/mpeg';

export interface ImportDeps {
  songModel: Model<Song>;
  categoryModel: Model<Category>;
  storage: StorageService;
  onProgress?: (line: string) => void;
}

export interface ImportResult {
  created: string[];
  updated: string[];
  unchanged: number;
  warnings: string[];
  failed: { file: string; error: string }[];
}

/**
 * Applies the manifest. Idempotent: songs are matched by checksum, so re-running only creates
 * new songs and updates edited metadata. Per-song failures are collected; one bad file does not
 * stop the rest. Audio is uploaded before the database record is written, so a song never
 * appears in the app without its file.
 */
export async function importSongs(deps: ImportDeps, manifestPath: string): Promise<ImportResult> {
  const manifest = await readManifest(manifestPath);
  if (!manifest) throw new Error(`Manifest not found: ${manifestPath}. Run songs:scan first.`);

  const categories = await deps.categoryModel.find().lean().exec();
  const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c._id]));
  const result: ImportResult = { created: [], updated: [], unchanged: 0, warnings: [], failed: [] };
  const baseDir = path.dirname(manifestPath);

  for (const entry of manifest.songs) {
    const categoryId = categoryIdBySlug.get(entry.category);
    if (!categoryId) {
      result.failed.push({
        file: entry.file,
        error: `Unknown category "${entry.category}" (known: ${[...categoryIdBySlug.keys()].join(', ')})`,
      });
      continue;
    }

    try {
      const existing = await deps.songModel.findOne({ checksum: entry.checksum }).exec();
      if (existing) {
        const changes = metadataChanges(existing, entry, categoryId);
        if (Object.keys(changes).length === 0) {
          result.unchanged += 1;
        } else {
          await deps.songModel.updateOne(
            { _id: existing._id },
            { $set: changes },
            { runValidators: true },
          );
          result.updated.push(`${entry.title} (${Object.keys(changes).join(', ')})`);
          deps.onProgress?.(`updated  ${entry.title}`);
        }
        continue;
      }

      await createSong(deps, entry, categoryId, path.resolve(baseDir, entry.file), result);
      result.created.push(entry.title);
      deps.onProgress?.(`created  ${entry.title}`);
    } catch (error) {
      result.failed.push({ file: entry.file, error: (error as Error).message });
      deps.onProgress?.(`FAILED   ${entry.file}: ${(error as Error).message}`);
    }
  }
  return result;
}

async function createSong(
  deps: ImportDeps,
  entry: ManifestEntry,
  categoryId: Types.ObjectId,
  absolutePath: string,
  result: ImportResult,
): Promise<void> {
  const body = await readFile(absolutePath);
  const info = await readMp3(body);
  const id = new Types.ObjectId();

  // uploadAudio re-verifies the checksum, so a file edited after scanning is rejected.
  const audioKey = deps.storage.audioKey(id.toString(), AUDIO_MIME);
  await deps.storage.uploadAudio(audioKey, body, AUDIO_MIME, entry.checksum);

  let artworkKey: string | null = null;
  if (info.picture) {
    const { mimeType, data } = info.picture;
    const allowed = (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
    if (allowed && data.length <= MAX_IMAGE_FILE_BYTES) {
      artworkKey = deps.storage.artworkKey('songs', id.toString(), mimeType);
      await deps.storage.uploadImage(artworkKey, data, mimeType);
    } else {
      result.warnings.push(
        `${entry.file}: embedded artwork skipped (${mimeType}, ${data.length} bytes)`,
      );
    }
  }

  await deps.songModel.create({
    _id: id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    categoryId,
    durationSeconds: info.durationSeconds,
    fileSize: body.length,
    mimeType: AUDIO_MIME,
    audioKey,
    artworkKey,
    storageProvider: deps.storage.provider,
    checksum: entry.checksum,
    sourceFile: path.basename(absolutePath),
    isActive: entry.isActive,
  });
}

function metadataChanges(
  song: Song,
  entry: ManifestEntry,
  categoryId: Types.ObjectId,
): Partial<Pick<Song, 'title' | 'artist' | 'album' | 'categoryId' | 'isActive'>> {
  const changes: Partial<Pick<Song, 'title' | 'artist' | 'album' | 'categoryId' | 'isActive'>> = {};
  if (song.title !== entry.title) changes.title = entry.title;
  if (song.artist !== entry.artist) changes.artist = entry.artist;
  if (song.album !== entry.album) changes.album = entry.album;
  if (!song.categoryId.equals(categoryId)) changes.categoryId = categoryId;
  if (song.isActive !== entry.isActive) changes.isActive = entry.isActive;
  return changes;
}
