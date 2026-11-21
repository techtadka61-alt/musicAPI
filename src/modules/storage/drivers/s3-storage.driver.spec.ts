import {
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3StorageDriver } from './s3-storage.driver';

function createDriver(send: (command: unknown) => Promise<unknown>) {
  // Static fake credentials: presigning is a local computation, no network involved.
  const client = new S3Client({
    region: 'ap-south-1',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
  });
  vi.spyOn(client, 'send').mockImplementation(send as never);
  return { driver: new S3StorageDriver(client, 'nexqira-s3'), client };
}

describe('S3StorageDriver', () => {
  it('uploads with content type, cache headers and an S3-verified SHA-256 checksum', async () => {
    const sent: unknown[] = [];
    const { driver } = createDriver(async (command) => {
      sent.push(command);
      return {};
    });
    const sha256Hex = 'ab'.repeat(32);

    await driver.putObject({
      key: 'music/abc.mp3',
      body: Buffer.from('audio'),
      contentType: 'audio/mpeg',
      sha256Hex,
      cacheControl: 'public, max-age=31536000, immutable',
    });

    const command = sent[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'nexqira-s3',
      Key: 'music/abc.mp3',
      ContentType: 'audio/mpeg',
      ContentLength: 5,
      ChecksumSHA256: Buffer.from(sha256Hex, 'hex').toString('base64'),
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('returns the size from HeadObject', async () => {
    const { driver } = createDriver(async (command) => {
      expect(command).toBeInstanceOf(HeadObjectCommand);
      return { ContentLength: 1234 };
    });
    await expect(driver.headObject('music/abc.mp3')).resolves.toEqual({ size: 1234 });
  });

  it('returns null for a missing object', async () => {
    const { driver } = createDriver(async () => {
      throw new NotFound({ message: 'Not Found', $metadata: { httpStatusCode: 404 } });
    });
    await expect(driver.headObject('music/missing.mp3')).resolves.toBeNull();
  });

  it('surfaces access-denied instead of reporting the object as missing', async () => {
    const { driver } = createDriver(async () => {
      throw new S3ServiceException({
        name: 'Forbidden',
        $fault: 'client',
        $metadata: { httpStatusCode: 403 },
        message: 'Forbidden',
      });
    });
    await expect(driver.headObject('music/abc.mp3')).rejects.toThrow('Forbidden');
  });

  it('creates a pre-signed GET URL for the bucket/key with the requested expiry', async () => {
    const { driver } = createDriver(async () => ({}));
    const url = new URL(await driver.getSignedReadUrl('music/abc.mp3', 900));

    expect(url.hostname).toBe('nexqira-s3.s3.ap-south-1.amazonaws.com');
    expect(url.pathname).toBe('/music/abc.mp3');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toContain('ap-south-1/s3/aws4_request');
  });
});
