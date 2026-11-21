import type { ConfigService } from '@nestjs/config';
import { MAX_IMAGE_FILE_BYTES } from '@wedding/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.validation';
import { sha256, StorageService, StorageValidationError } from './storage.service';
import type { PutObjectInput, StorageDriver } from './storage.types';

describe('StorageService', () => {
  let putObject: ReturnType<typeof vi.fn<(input: PutObjectInput) => Promise<void>>>;
  let service: StorageService;

  beforeEach(() => {
    putObject = vi.fn<(input: PutObjectInput) => Promise<void>>().mockResolvedValue(undefined);
    const driver: StorageDriver = {
      provider: 's3',
      putObject,
      headObject: vi.fn(),
      getSignedReadUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`),
    };
    const config = { get: () => 600 } as unknown as ConfigService<Env, true>;
    service = new StorageService(driver, config);
  });

  it('derives keys from ids, not titles', () => {
    expect(service.audioKey('6650f0c2a1b2c3d4e5f60718', 'audio/mpeg')).toBe(
      'music/6650f0c2a1b2c3d4e5f60718.mp3',
    );
    expect(service.artworkKey('songs', 'abc', 'image/png')).toBe('artwork/songs/abc.png');
    expect(() => service.audioKey('abc', 'audio/wav')).toThrow(StorageValidationError);
  });

  it('uploads valid audio with immutable caching', async () => {
    const body = Buffer.from('mp3 bytes');
    await service.uploadAudio('music/a.mp3', body, 'audio/mpeg', sha256(body));
    expect(putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'music/a.mp3',
        contentType: 'audio/mpeg',
        sha256Hex: sha256(body),
        cacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  });

  it('rejects a disallowed audio content type', async () => {
    const body = Buffer.from('x');
    await expect(
      service.uploadAudio('music/a.mp3', body, 'audio/wav', sha256(body)),
    ).rejects.toThrow(/not allowed/);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects empty files', async () => {
    const body = Buffer.alloc(0);
    await expect(
      service.uploadAudio('music/a.mp3', body, 'audio/mpeg', sha256(body)),
    ).rejects.toThrow(/empty/);
  });

  it('rejects audio whose bytes do not match the expected checksum', async () => {
    await expect(
      service.uploadAudio(
        'music/a.mp3',
        Buffer.from('changed'),
        'audio/mpeg',
        sha256(Buffer.from('orig')),
      ),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects oversized images', async () => {
    await expect(
      service.uploadImage(
        'artwork/songs/a.jpg',
        Buffer.alloc(MAX_IMAGE_FILE_BYTES + 1),
        'image/jpeg',
      ),
    ).rejects.toThrow(/limit/);
  });

  it('returns a read URL with an expiry matching the configured TTL', async () => {
    const before = Date.now();
    const { url, expiresAt } = await service.getReadUrl('music/a.mp3');
    expect(url).toBe('https://cdn.test/music/a.mp3');
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    await expect(service.getOptionalReadUrl(null)).resolves.toBeNull();
  });
});
