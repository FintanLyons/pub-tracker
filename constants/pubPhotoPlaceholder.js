/**
 * Default image when a pub has no photo_url1..5.
 * Hosted on R2 (see scripts/upload_pub_photo_placeholder_to_r2.py) — not stored in pubs_list.
 */
const PLACEHOLDER_URL =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_PUB_PHOTO_PLACEHOLDER_URL
    ? String(process.env.EXPO_PUBLIC_PUB_PHOTO_PLACEHOLDER_URL).trim()
    : '';

/** Remote placeholder URL from R2 (empty until EXPO_PUBLIC_PUB_PHOTO_PLACEHOLDER_URL is set). */
export const PUB_PHOTO_PLACEHOLDER_URL = PLACEHOLDER_URL;

/** Bundled fallback for local dev before R2 URL is configured. */
export const PUB_PHOTO_PLACEHOLDER_LOCAL = require('../assets/pub-photo-placeholder.jpg');

/**
 * @returns {import('react-native').ImageSourcePropType}
 */
export function getPubPhotoPlaceholderSource() {
  if (PUB_PHOTO_PLACEHOLDER_URL) {
    return { uri: PUB_PHOTO_PLACEHOLDER_URL };
  }
  return PUB_PHOTO_PLACEHOLDER_LOCAL;
}

/**
 * @param {string[]|null|undefined} photoUrls
 * @param {string|null|undefined} photoUrl
 * @returns {string[]} At least one entry — real URLs or the placeholder URL/key.
 */
export function resolvePubPhotoUrls(photoUrls, photoUrl) {
  const fromArray = Array.isArray(photoUrls)
    ? photoUrls.map((u) => (u != null ? String(u).trim() : '')).filter(Boolean)
    : [];
  if (fromArray.length > 0) return fromArray;
  const single = photoUrl != null ? String(photoUrl).trim() : '';
  if (single) return [single];
  if (PUB_PHOTO_PLACEHOLDER_URL) return [PUB_PHOTO_PLACEHOLDER_URL];
  return ['__local_placeholder__'];
}
