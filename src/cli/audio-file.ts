import { parseBuffer } from 'music-metadata';

export interface AudioFileInfo {
  durationSeconds: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  picture: { mimeType: string; data: Buffer } | null;
}

export class InvalidAudioFileError extends Error {
  override readonly name = 'InvalidAudioFileError';
}

/**
 * Parses an MP3 from its bytes. Verifies the content really is MPEG Layer 3 audio,
 * not just a file with a .mp3 extension.
 */
export async function readMp3(body: Buffer): Promise<AudioFileInfo> {
  let metadata: Awaited<ReturnType<typeof parseBuffer>>;
  try {
    metadata = await parseBuffer(body, { mimeType: 'audio/mpeg' }, { duration: true });
  } catch (error) {
    throw new InvalidAudioFileError(`Not a readable MP3: ${(error as Error).message}`);
  }

  const { format, common } = metadata;
  if (!/layer 3/i.test(format.codec ?? '')) {
    throw new InvalidAudioFileError(`Not MP3 audio (detected: ${format.codec ?? 'unknown'})`);
  }
  if (!format.duration || format.duration <= 0) {
    throw new InvalidAudioFileError('Could not determine duration');
  }

  const picture = common.picture?.[0];
  return {
    durationSeconds: Math.round(format.duration * 100) / 100,
    title: common.title ?? null,
    artist: common.artist ?? null,
    album: common.album ?? null,
    picture: picture
      ? { mimeType: normalizeImageMime(picture.format), data: Buffer.from(picture.data) }
      : null,
  };
}

/** ID3 APIC frames sometimes store "jpg" or "JPEG" instead of a MIME type. */
function normalizeImageMime(format: string): string {
  const value = format.toLowerCase();
  if (value === 'jpg' || value === 'jpeg' || value === 'image/jpg') return 'image/jpeg';
  if (value === 'png') return 'image/png';
  return value;
}
