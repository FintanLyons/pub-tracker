export const serializeBoroughSummaries = (summaries) =>
  JSON.stringify(
    (Array.isArray(summaries) ? summaries : [])
      .map((summary) => ({
        borough: summary?.borough ?? '',
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
      .sort((a, b) => a.borough.localeCompare(b.borough))
  );

export const distanceBetween = (a, b) => {
  if (!a || !b) return Infinity;
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);

  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return earthRadius * c;
};

export const calculateDistanceMeters = (pointA, pointB) => {
  if (!pointA || !pointB) return Infinity;

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000; // meters
  const lat1 = toRadians(pointA.latitude);
  const lat2 = toRadians(pointB.latitude);
  const deltaLat = toRadians(pointB.latitude - pointA.latitude);
  const deltaLon = toRadians(pointB.longitude - pointA.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

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

export const interpolateColor = (percentage) => {
  const grey = { r: 0x75, g: 0x75, b: 0x75 };
  const amber = { r: 0xd4, g: 0xa0, b: 0x17 };

  const clamp = (value) => Math.min(100, Math.max(0, value));
  const factor = clamp(percentage) / 100;

  const r = Math.round(grey.r + (amber.r - grey.r) * factor);
  const g = Math.round(grey.g + (amber.g - grey.g) * factor);
  const b = Math.round(grey.b + (amber.b - grey.b) * factor);

  return `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

