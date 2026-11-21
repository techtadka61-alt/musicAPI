import { describe, expect, it } from 'vitest';
import { cleanOptionalTag, cleanTitle } from './title-cleanup';

describe('cleanTitle', () => {
  it.each([
    ['Sajan Sajan Teri Dulhan_320(KoshalWorld.Com).mp3', 'Sajan Sajan Teri Dulhan'],
    ['Ghagra Yeh Jawaani Hai Deewani 320 Kbps.mp3', 'Ghagra Yeh Jawaani Hai Deewani'],
    ['Tenu Leke ❤️ Salman Khan.mp3', 'Tenu Leke Salman Khan'],
    [
      'Saajanji Ghar Aaye Full Video - Kuch Kuch Hota Hai',
      'Saajanji Ghar Aaye - Kuch Kuch Hota Hai',
    ],
    ['#VIDEO #Arvind Akela Kallu माड़ो देशी गारी.mp3', 'Akela Kallu माड़ो देशी गारी'],
    ['Lollypop Lagelu OFFICIAL VIDEO', 'Lollypop Lagelu'],
    ['Saat Samundar Paar 4K Song', 'Saat Samundar Paar Song'],
    ['www.songs.pk - Mehndi Laga Ke Rakhna', 'Mehndi Laga Ke Rakhna'],
    ['Ghagra - PagalNew', 'Ghagra'],
    ['London Thumakda (Mr-Jatt)', 'London Thumakda'],
  ])('%s → %s', (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
  });

  it('keeps Devanagari text intact', () => {
    expect(cleanTitle('मकईया में राजा जी')).toBe('मकईया में राजा जी');
  });
});

describe('cleanOptionalTag', () => {
  it('returns null for empty or noise-only values', () => {
    expect(cleanOptionalTag(undefined)).toBeNull();
    expect(cleanOptionalTag('')).toBeNull();
    expect(cleanOptionalTag('KoshalWorld.Com')).toBeNull();
  });

  it('returns the cleaned value otherwise', () => {
    expect(cleanOptionalTag('Alka Yagnik ')).toBe('Alka Yagnik');
  });
});
