import { describe, expect, it } from 'vitest';
import { LocalUrlSigner } from './local-url-signer';

describe('LocalUrlSigner', () => {
  const signer = new LocalUrlSigner('s'.repeat(32));
  const now = Date.UTC(2026, 0, 1);
  const future = now / 1000 + 600;

  it('accepts its own unexpired signature', () => {
    expect(signer.verify('music/a.mp3', future, signer.sign('music/a.mp3', future), now)).toBe(
      true,
    );
  });

  it('rejects a signature for a different key', () => {
    expect(signer.verify('music/b.mp3', future, signer.sign('music/a.mp3', future), now)).toBe(
      false,
    );
  });

  it('rejects a modified expiry (cannot extend a link)', () => {
    const signature = signer.sign('music/a.mp3', future);
    expect(signer.verify('music/a.mp3', future + 3600, signature, now)).toBe(false);
  });

  it('rejects an expired link', () => {
    const past = now / 1000 - 1;
    expect(signer.verify('music/a.mp3', past, signer.sign('music/a.mp3', past), now)).toBe(false);
  });

  it('rejects a signature from another secret', () => {
    const other = new LocalUrlSigner('o'.repeat(32));
    expect(signer.verify('music/a.mp3', future, other.sign('music/a.mp3', future), now)).toBe(
      false,
    );
  });

  it('rejects malformed input without throwing', () => {
    expect(signer.verify('music/a.mp3', Number.NaN, 'x', now)).toBe(false);
    expect(signer.verify('music/a.mp3', future, '', now)).toBe(false);
  });
});
