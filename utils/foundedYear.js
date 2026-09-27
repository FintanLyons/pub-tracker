/** Earliest year accepted as a founding date (older values are treated as unknown). */
export const EARLIEST_FOUNDED_YEAR = 1000;

/**
 * Founding year from the free-text `founded` field, or null if it can't be read.
 * - "1822", "c. 1822", "Est. 1822" → 1822
 * - "17th century" → 1600 (start of the century)
 * Plain parseInt turned "17th century" into year 17.
 */
export function parseFoundedYear(founded) {
  if (founded == null) return null;
  const text = String(founded).trim();
  if (!text) return null;
  const currentYear = new Date().getFullYear();

  const fourDigits = text.match(/\b(\d{4})\b/);
  if (fourDigits) {
    const year = Number(fourDigits[1]);
    return year >= EARLIEST_FOUNDED_YEAR && year <= currentYear ? year : null;
  }

  const century = text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/i);
  if (century) {
    const year = (Number(century[1]) - 1) * 100;
    return year >= EARLIEST_FOUNDED_YEAR && year <= currentYear ? year : null;
  }

  return null;
}
