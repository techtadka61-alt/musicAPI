import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-signed, expiring URLs for the development-only local storage driver (mimics S3 pre-signing). */
export class LocalUrlSigner {
  constructor(private readonly secret: string) {}

  sign(key: string, expiresAtEpochSeconds: number): string {
    return createHmac('sha256', this.secret)
      .update(`${key}\n${expiresAtEpochSeconds}`)
      .digest('base64url');
  }

  verify(
    key: string,
    expiresAtEpochSeconds: number,
    signature: string,
    nowMs = Date.now(),
  ): boolean {
    if (!Number.isSafeInteger(expiresAtEpochSeconds) || expiresAtEpochSeconds * 1000 < nowMs) {
      return false;
    }
    const expected = Buffer.from(this.sign(key, expiresAtEpochSeconds));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
}
