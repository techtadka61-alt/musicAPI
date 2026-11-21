import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  OBJECT_KEY_PATTERN,
  type ObjectInfo,
  type PutObjectInput,
  type StorageDriver,
} from '../storage.types';
import type { LocalUrlSigner } from './local-url-signer';

/**
 * Development-only driver that stores objects on disk and serves them through
 * LocalStorageController with signed, expiring URLs. Lets the whole system run locally
 * without AWS credentials. Env validation forbids it in production.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly provider = 'local' as const;
  readonly rootDir: string;

  constructor(
    rootDir: string,
    private readonly signer: LocalUrlSigner,
    /** Absolute URL of LocalStorageController, e.g. http://localhost:7102/api/v1/storage/local */
    private readonly serveUrl: string,
  ) {
    this.rootDir = path.resolve(rootDir);
  }

  /** Maps a key to a path inside rootDir; rejects anything that could escape it. */
  resolvePath(key: string): string {
    if (!OBJECT_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid object key: ${key}`);
    }
    const resolved = path.resolve(this.rootDir, ...key.split('/'));
    if (!resolved.startsWith(this.rootDir + path.sep)) {
      throw new Error(`Invalid object key: ${key}`);
    }
    return resolved;
  }

  async putObject({ key, body, sha256Hex }: PutObjectInput): Promise<void> {
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== sha256Hex) {
      throw new Error(`Checksum mismatch for ${key}`);
    }
    const target = this.resolvePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write-then-rename so a crash never leaves a half-written file under the final key.
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, body);
    await rename(temp, target);
  }

  async headObject(key: string): Promise<ObjectInfo | null> {
    try {
      const info = await stat(this.resolvePath(key));
      return info.isFile() ? { size: info.size } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    this.resolvePath(key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const params = new URLSearchParams({
      key,
      expires: String(expires),
      signature: this.signer.sign(key, expires),
    });
    return Promise.resolve(`${this.serveUrl}?${params.toString()}`);
  }

  verifySignature(key: string, expires: number, signature: string): boolean {
    return this.signer.verify(key, expires, signature);
  }
}
