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

// Safety net: computed once at module load — names shared by more than one code
// get the code appended so they remain distinguishable.
const DUPLICATE_NAMES = (() => {
  const counts = {};
  for (const name of Object.values(displayNames)) {
    counts[name] = (counts[name] || 0) + 1;
  }
  return new Set(Object.keys(counts).filter(n => counts[n] > 1));
})();

/**
 * One-line label for lists/cards. Shows the friendly name only (e.g. "Balham").
 * Falls back to "Name (CODE)" if two districts share the same display name,
 * or to the raw code if no friendly name exists.
 */
export function formatDistrictWithCode(code) {
  const name = getPostcodeDistrictDisplayName(code);
  const upper = (code && String(code).trim().toUpperCase()) || '';
  if (!upper || upper === 'UNKNOWN') return name;
  if (name === upper) return upper;
  if (DUPLICATE_NAMES.has(name)) return `${name} (${upper})`;
  return name;
}
