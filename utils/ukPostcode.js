/**
 * UK postcode normalisation and parsing (outward → district + letter area).
 * Mirrors `public.uk_postcode_from_address` in scripts/backfill_pub_spatial_postcodes.sql.
 */

/** @returns {string} Normalised postcode e.g. "SW1A 1AA", or "" if invalid. */
export function normalizeUkPostcode(raw) {
  const compact = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (compact.length < 5) return '';
  const inward = compact.slice(-3);
  const outward = compact.slice(0, -3);
  if (!/^[0-9][A-Z]{2}$/.test(inward) || !/^[A-Z]{1,2}[0-9][0-9A-Z]?$/.test(outward)) {
    return '';
  }
  return `${outward} ${inward}`;
}

/**
 * @param {string} raw
 * @returns {{ postcode: string|null, postcodeDistrict: string|null, postcodeArea: string|null }}
 */
export function parseUkPostcode(raw) {
  const postcode = normalizeUkPostcode(raw);
  if (!postcode) {
    return { postcode: null, postcodeDistrict: null, postcodeArea: null };
  }
  const outward = postcode.split(' ')[0];
  const areaMatch = outward.match(/^([A-Z]+)/);
  return {
    postcode,
    postcodeDistrict: outward,
    postcodeArea: areaMatch ? areaMatch[1] : null,
  };
}
