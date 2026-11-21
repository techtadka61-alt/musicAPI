/**
 * Builds small but valid MP3 files in memory: an optional ID3v2.3 tag (title, artist, album,
 * cover image) followed by silent MPEG-1 Layer 3 frames. Keeps tests independent of real songs.
 */
const FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x00]); // MPEG-1 L3, 128 kbps, 44.1 kHz, stereo
const FRAME_BYTES = 417; // floor(144 * 128000 / 44100)
const SAMPLES_PER_FRAME = 1152;
const SAMPLE_RATE = 44_100;

export interface Mp3FixtureOptions {
  title?: string;
  artist?: string;
  album?: string;
  picture?: { mimeType: string; data: Buffer };
  /** Number of audio frames; ~26 ms each. */
  frames?: number;
}

function synchsafe(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function id3Frame(id: string, data: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

/** Text frame encoded as UTF-16 with BOM (ID3v2.3 encoding 1), so Devanagari works. */
function textFrame(id: string, text: string): Buffer {
  return id3Frame(
    id,
    Buffer.concat([Buffer.from([0x01, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
  );
}

function pictureFrame(mimeType: string, data: Buffer): Buffer {
  return id3Frame(
    'APIC',
    Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from(`${mimeType}\0`, 'latin1'),
      Buffer.from([0x03]), // front cover
      Buffer.from('\0', 'latin1'),
      data,
    ]),
  );
}

export function buildMp3(options: Mp3FixtureOptions = {}): Buffer {
  const frames: Buffer[] = [];
  if (options.title) frames.push(textFrame('TIT2', options.title));
  if (options.artist) frames.push(textFrame('TPE1', options.artist));
  if (options.album) frames.push(textFrame('TALB', options.album));
  if (options.picture) frames.push(pictureFrame(options.picture.mimeType, options.picture.data));

  const parts: Buffer[] = [];
  if (frames.length > 0) {
    const body = Buffer.concat(frames);
    parts.push(Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), synchsafe(body.length), body);
  }

  const audioFrame = Buffer.concat([FRAME_HEADER, Buffer.alloc(FRAME_BYTES - FRAME_HEADER.length)]);
  for (let i = 0; i < (options.frames ?? 80); i += 1) parts.push(audioFrame);
  return Buffer.concat(parts);
}

export function expectedDurationSeconds(frames = 80): number {
  return (frames * SAMPLES_PER_FRAME) / SAMPLE_RATE;
}

/** Minimal JPEG-looking bytes (SOI/EOI markers); content is never decoded server-side. */
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
