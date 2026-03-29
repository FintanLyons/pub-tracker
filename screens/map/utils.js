export { distanceMeters as distanceBetween, distanceMeters as calculateDistanceMeters } from '../../utils/geo';

export const serializePostcodeAreaSummaries = (summaries) =>
  JSON.stringify(
    (Array.isArray(summaries) ? summaries : [])
      .map((summary) => ({
        postcodeArea: summary?.postcodeArea ?? '',
        lat: Number.isFinite(summary?.center?.latitude)
          ? Number(summary.center.latitude.toFixed(6))
          : null,
        lon: Number.isFinite(summary?.center?.longitude)
          ? Number(summary.center.longitude.toFixed(6))
          : null,
        total: summary?.totalPubs ?? 0,
        visited: summary?.visitedPubs ?? 0,
        completion: Number.isFinite(summary?.completionPercentage)
          ? Number(summary.completionPercentage.toFixed(4))
          : 0,
      }))
      .sort((a, b) => a.postcodeArea.localeCompare(b.postcodeArea))
  );

export const getAreaCenter = (pubsInArea) => {
  const validPubs = pubsInArea.filter((pub) => pub.lat && pub.lon);
  if (validPubs.length === 0) return null;

  const sumLat = validPubs.reduce((sum, pub) => sum + parseFloat(pub.lat), 0);
  const sumLon = validPubs.reduce((sum, pub) => sum + parseFloat(pub.lon), 0);

  return {
    latitude: sumLat / validPubs.length,
    longitude: sumLon / validPubs.length,
  };
};

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

/**
 * Map completion 0–100% between two colours (default: light neutral → amber).
 * Used for postcode area + district fills.
 */
export const interpolateColor = (percentage, lowHex = '#D8D8D8', highHex = '#D4A017') => {
  const low = hexToRgb(lowHex);
  const high = hexToRgb(highHex);

  const clamp = (value) => Math.min(100, Math.max(0, value));
  const factor = clamp(percentage) / 100;

  const r = Math.round(low.r + (high.r - low.r) * factor);
  const g = Math.round(low.g + (high.g - low.g) * factor);
  const b = Math.round(low.b + (high.b - low.b) * factor);

  return `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

