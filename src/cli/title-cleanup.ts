/**
 * Best-effort cleanup of titles taken from downloaded file names / tags, e.g.
 * "Sajan Sajan Teri Dulhan_320(KoshalWorld.Com).mp3" → "Sajan Sajan Teri Dulhan".
 * Only a starting suggestion: the manifest is meant to be reviewed and edited by hand.
 */
const NOISE_PATTERNS: RegExp[] = [
  /\.mp3$/i,
  // Site names, bracketed or bare: (KoshalWorld.Com), www.example.in
  /[([]\s*[^)\]]*\.(?:com|in|net|org|co|info|pk)\s*[)\]]/gi,
  /\b(?:www\.)?[a-z0-9-]+\.(?:com|in|net|org|co|info|pk)\b/gi,
  // Well-known MP3 download sites written without a domain, e.g. "Ghagra - PagalNew"
  /\b(?:pagal\s?(?:new|world|free)|dj\s?maza|mr-?jatt|songs\s?pk|koshal\s?world|raag\s?fm|webmusic)\b/gi,
  // Bitrate markers: 320 Kbps, _320
  /\b\d{2,3}\s*kbps\b/gi,
  /_\d{2,3}(?=\W|$)/g,
  // Hashtags and emoji
  /#\S+/g,
  /\p{Extended_Pictographic}|\uFE0F/gu,
  // Video-upload phrasing
  /\b(?:official|full|lyrical)\s+(?:music\s+)?(?:video|audio)(?:\s+song)?\b/gi,
  /\b(?:video|audio)\s+song\b/gi,
  /\b(?:4k|hd)\b/gi,
];

export function cleanTitle(raw: string): string {
  let title = raw.normalize('NFC');
  for (const pattern of NOISE_PATTERNS) {
    title = title.replace(pattern, ' ');
  }
  return title
    .replace(/_/g, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-|,.:]+|[\s\-|,.:]+$/g, '')
    .trim();
}

/** Tag values from converter sites are often just a domain or empty; treat those as missing. */
export function cleanOptionalTag(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = cleanTitle(raw);
  return cleaned.length > 0 ? cleaned : null;
}
