import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_AUDIO_FILE_BYTES } from '@wedding/shared';
import { sha256 } from '../modules/storage/storage.service';
import { readMp3 } from './audio-file';
import { readManifest, writeManifest, type ManifestEntry } from './songs-manifest';
import { cleanOptionalTag, cleanTitle } from './title-cleanup';

export interface ScanResult {
  manifestPath: string;
  added: ManifestEntry[];
  kept: number;
  /** Manifest entries whose file is no longer in the folder (kept; already-imported songs are unaffected). */
  missingFiles: string[];
  skipped: { file: string; reason: string }[];
}

/**
 * Scans `<dir>/<category>/*.mp3` (folder name = category slug, case-insensitive) and merges
 * the result into the manifest. Existing entries keep their hand edits; new files are appended
 * with a cleaned-up title suggestion. Does not touch the database or storage.
 */
export async function scanSongs(dir: string, manifestPath: string): Promise<ScanResult> {
  const existing = (await readManifest(manifestPath))?.songs ?? [];
  const byChecksum = new Map(existing.map((entry) => [entry.checksum, entry]));
  const result: ScanResult = { manifestPath, added: [], kept: 0, missingFiles: [], skipped: [] };
  const found = new Set<string>();

  const folders = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const folder of folders) {
    if (folder.name.startsWith('.') || folder.name === 'node_modules') continue;
    const category = folder.name.toLowerCase();
    const files = (await readdir(path.join(dir, folder.name), { withFileTypes: true }))
      .filter((f) => f.isFile())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const file of files) {
      const relative = path.relative(
        path.dirname(manifestPath),
        path.join(dir, folder.name, file.name),
      );
      const relativePosix = relative.split(path.sep).join('/');
      if (!file.name.toLowerCase().endsWith('.mp3')) {
        result.skipped.push({ file: relativePosix, reason: 'not an .mp3 file' });
        continue;
      }

      const body = await readFile(path.join(dir, folder.name, file.name));
      if (body.length > MAX_AUDIO_FILE_BYTES) {
        result.skipped.push({
          file: relativePosix,
          reason: `larger than ${MAX_AUDIO_FILE_BYTES} bytes`,
        });
        continue;
      }
      const checksum = sha256(body);
      if (found.has(checksum)) {
        result.skipped.push({ file: relativePosix, reason: 'duplicate of another file' });
        continue;
      }
      found.add(checksum);

      const known = byChecksum.get(checksum);
      if (known) {
        known.file = relativePosix; // follow renames/moves, keep edits
        result.kept += 1;
        continue;
      }

      let info;
      try {
        info = await readMp3(body);
      } catch (error) {
        result.skipped.push({ file: relativePosix, reason: (error as Error).message });
        continue;
      }
      const entry: ManifestEntry = {
        file: relativePosix,
        checksum,
        category,
        title: cleanOptionalTag(info.title) ?? (cleanTitle(file.name) || file.name),
        artist: cleanOptionalTag(info.artist),
        album: cleanOptionalTag(info.album),
        isActive: true,
      };
      existing.push(entry);
      byChecksum.set(checksum, entry);
      result.added.push(entry);
    }
  }

  result.missingFiles = existing.filter((e) => !found.has(e.checksum)).map((e) => e.file);
  await writeManifest(manifestPath, { version: 1, songs: existing });
  return result;
}
