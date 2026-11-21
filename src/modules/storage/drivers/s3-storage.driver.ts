import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectInfo, PutObjectInput, StorageDriver } from '../storage.types';

/**
 * AWS S3 driver. Credentials are never configured here: the SDK's default provider chain
 * uses the EC2 instance role in production and the local `~/.aws` profile in development.
 */
export class S3StorageDriver implements StorageDriver {
  readonly provider = 's3' as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putObject({
    key,
    body,
    contentType,
    sha256Hex,
    cacheControl,
  }: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        // S3 recomputes this and rejects the upload on mismatch.
        ChecksumSHA256: Buffer.from(sha256Hex, 'hex').toString('base64'),
        CacheControl: cacheControl,
        Metadata: { sha256: sha256Hex },
      }),
    );
  }

  async headObject(key: string): Promise<ObjectInfo | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: result.ContentLength ?? 0 };
    } catch (error) {
      // Without s3:ListBucket permission S3 answers 403 (not 404) for missing keys; that
      // surfaces as an error so a permissions problem is not mistaken for a missing file.
      if (error instanceof NotFound) return null;
      throw error;
    }
  }

  getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}
