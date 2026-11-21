import type { Model } from 'mongoose';
import type { Song } from '../modules/songs/schemas/song.schema';
import type { StorageService } from '../modules/storage/storage.service';

export interface StorageCheckResult {
  checked: number;
  problems: string[];
}

/**
 * Verifies every song's audio (and artwork) object exists in storage with the recorded size.
 * On EC2 this also proves the instance role can read the bucket.
 */
export async function checkStorage(
  songModel: Model<Song>,
  storage: StorageService,
): Promise<StorageCheckResult> {
  const songs = await songModel
    .find({}, { title: 1, audioKey: 1, artworkKey: 1, fileSize: 1, storageProvider: 1 })
    .lean()
    .exec();
  const result: StorageCheckResult = { checked: songs.length, problems: [] };

  for (const song of songs) {
    const label = `"${song.title}" (${song._id.toString()})`;
    if (song.storageProvider !== storage.provider) {
      result.problems.push(
        `${label}: stored with "${song.storageProvider}" but the active driver is "${storage.provider}"`,
      );
      continue;
    }
    try {
      const audio = await storage.headObject(song.audioKey);
      if (!audio) {
        result.problems.push(`${label}: audio missing at ${song.audioKey}`);
      } else if (audio.size !== song.fileSize) {
        result.problems.push(`${label}: audio is ${audio.size} bytes, expected ${song.fileSize}`);
      }
      if (song.artworkKey && !(await storage.headObject(song.artworkKey))) {
        result.problems.push(`${label}: artwork missing at ${song.artworkKey}`);
      }
    } catch (error) {
      result.problems.push(`${label}: ${(error as Error).name}: ${(error as Error).message}`);
    }
  }
  return result;
}
