import { readFile, rename, writeFile } from 'node:fs/promises';
import { SLUG_PATTERN } from '@wedding/shared';
import { z } from 'zod';

/**
 * The manifest is the hand-editable source of truth for song metadata. `songs:scan` creates
 * and extends it; a person reviews titles/artists/categories; `songs:import` applies it.
 * Entries are identified by checksum, so renaming or moving a file keeps its edits.
 */
export const manifestEntrySchema = z.object({
  /** Path relative to the manifest file, with forward slashes. */
  file: z.string().min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/, 'must be a hex SHA-256'),
  category: z.string().regex(SLUG_PATTERN, 'must be a category slug like "hindi"'),
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200).nullable(),
  album: z.string().trim().min(1).max(200).nullable(),
  /** Set to false to hide a song from the app without deleting anything. */
  isActive: z.boolean(),
});

export const manifestSchema = z.object({
  version: z.literal(1),
  songs: z.array(manifestEntrySchema),
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

export async function readManifest(manifestPath: string): Promise<Manifest | null> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${manifestPath} is not valid JSON: ${(error as Error).message}`);
  }

  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`${manifestPath} is invalid:\n${problems}`);
  }

  const seen = new Set<string>();
  for (const entry of parsed.data.songs) {
    if (seen.has(entry.checksum)) {
      throw new Error(`${manifestPath}: checksum ${entry.checksum} appears more than once`);
    }
    seen.add(entry.checksum);
  }
  return parsed.data;
}

export async function writeManifest(manifestPath: string, manifest: Manifest): Promise<void> {
  const temp = `${manifestPath}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temp, manifestPath);
}
