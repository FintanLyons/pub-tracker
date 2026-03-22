import displayNames from '../data/postcode_district_display_names.json';

/** @type {Record<string, string>} */
const BY_UPPER = displayNames;

/**
 * Human-readable primary locality for a London postcode district code (e.g. SW12 → Balham).
 * Falls back to the code itself (or "Unknown") when not in the bundled map.
 */
export function getPostcodeDistrictDisplayName(code) {
  if (code == null || typeof code !== 'string') return 'Unknown';
  const trimmed = code.trim();
  if (!trimmed) return 'Unknown';
  const upper = trimmed.toUpperCase();
  if (upper === 'UNKNOWN') return 'Unknown';
  return BY_UPPER[upper] || trimmed;
}

/**
 * One-line label for lists/cards: "Balham (SW12)". If no friendly name, returns the code only.
 */
export function formatDistrictWithCode(code) {
  const name = getPostcodeDistrictDisplayName(code);
  const upper = (code && String(code).trim().toUpperCase()) || '';
  if (!upper || upper === 'UNKNOWN') return name;
  if (name === upper) return upper;
  return `${name} (${upper})`;
}
