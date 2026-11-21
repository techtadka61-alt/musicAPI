import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_AUDIO_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
} from '@wedding/shared';
import type { Env } from '../../config/env.validation';
import {
  STORAGE_DRIVER,
  type ObjectInfo,
  type StorageDriver,
  type StorageProvider,
} from './storage.types';

export class StorageValidationError extends Error {
  override readonly name = 'StorageValidationError';
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Keys are derived from database ids, so fixing a title or category never moves a file. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface SignedReadUrl {
  url: string;
  expiresAt: Date;
}

@Injectable()
export class StorageService {
  private readonly urlTtlSeconds: number;

  constructor(
    @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
    config: ConfigService<Env, true>,
  ) {
    this.urlTtlSeconds = config.get('STREAM_URL_TTL_SECONDS', { infer: true });
  }

  get provider(): StorageProvider {
    return this.driver.provider;
  }

  audioKey(songId: string, mimeType: string): string {
    return `music/${songId}.${this.extensionFor(mimeType)}`;
  }

  artworkKey(owner: 'songs' | 'categories', ownerId: string, mimeType: string): string {
    return `artwork/${owner}/${ownerId}.${this.extensionFor(mimeType)}`;
  }

  async uploadAudio(key: string, body: Buffer, mimeType: string, sha256Hex: string): Promise<void> {
    this.assertAllowed(mimeType, ALLOWED_AUDIO_MIME_TYPES, body, MAX_AUDIO_FILE_BYTES);
    this.assertChecksum(body, sha256Hex);
    await this.driver.putObject({
      key,
      body,
      contentType: mimeType,
      sha256Hex,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  }

  async uploadImage(key: string, body: Buffer, mimeType: string): Promise<void> {
    this.assertAllowed(mimeType, ALLOWED_IMAGE_MIME_TYPES, body, MAX_IMAGE_FILE_BYTES);
    await this.driver.putObject({
      key,
      body,
      contentType: mimeType,
      sha256Hex: sha256(body),
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  }

  headObject(key: string): Promise<ObjectInfo | null> {
    return this.driver.headObject(key);
  }

  async getReadUrl(key: string): Promise<SignedReadUrl> {
    const url = await this.driver.getSignedReadUrl(key, this.urlTtlSeconds);
    return { url, expiresAt: new Date(Date.now() + this.urlTtlSeconds * 1000) };
  }

  /** Signed URL for an optional key; null in, null out. */
  async getOptionalReadUrl(key: string | null): Promise<string | null> {
    return key ? (await this.getReadUrl(key)).url : null;
  }

  private extensionFor(mimeType: string): string {
    const extension = EXTENSION_BY_MIME[mimeType];
    if (!extension) throw new StorageValidationError(`Unsupported content type: ${mimeType}`);
    return extension;
  }

  private assertAllowed(
    mimeType: string,
    allowed: readonly string[],
    body: Buffer,
    maxBytes: number,
  ): void {
    if (!allowed.includes(mimeType)) {
      throw new StorageValidationError(
        `Content type ${mimeType} is not allowed (allowed: ${allowed.join(', ')})`,
      );
    }
    if (body.length === 0) {
      throw new StorageValidationError('File is empty');
    }
    if (body.length > maxBytes) {
      throw new StorageValidationError(
        `File is ${body.length} bytes; the limit is ${maxBytes} bytes`,
      );
    }
  }

  private assertChecksum(body: Buffer, expectedHex: string): void {
    if (sha256(body) !== expectedHex) {
      throw new StorageValidationError('Checksum mismatch: file changed since it was scanned');
    }
  }
}

export function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
