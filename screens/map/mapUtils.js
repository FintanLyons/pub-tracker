import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { formatDistrictWithCode, getPostcodeDistrictDisplayName } from '../../utils/postcodeDistrictDisplayNames';
import { ZOOM_LEVELS } from './layerUtils';

export const PUB_FETCH_BUFFER_RATIO = 0.55;
export const MIN_PUB_FETCH_ZOOM = ZOOM_LEVELS.PUBS_MIN - 0.15;

/** Rough visible bounds for a phone viewport at a given zoom (used before MapLibre reports bounds). */
export const approximateBoundsFromCenter = (latitude, longitude, zoom) => {
  if (![latitude, longitude, zoom].every(Number.isFinite)) return null;
  const metersPerPixel =
    (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / (2 ** zoom);
  const latDelta = (metersPerPixel * 700) / 111320;
  const lonDelta =
    (metersPerPixel * 400) / (111320 * Math.cos((latitude * Math.PI) / 180));
  return {
    north: latitude + latDelta / 2,
    south: latitude - latDelta / 2,
    east: longitude + lonDelta / 2,
    west: longitude - lonDelta / 2,
  };
};

export const findFeatureByPostcodeArea = (featureCollection, areaCode) => {
  if (!areaCode || typeof areaCode !== 'string') return null;
  const normalized = areaCode.trim().toLowerCase();
  return (featureCollection?.features || []).find(
    (feature) => feature?.properties?.postcode_area?.trim?.().toLowerCase?.() === normalized,
  ) || null;
};

/** MapLibre `onRegionDidChange` uses `bounds` [west, south, east, north]; legacy maps used `visibleBounds`. */
export const parseVisibleBounds = (visibleBounds) => {
  if (!visibleBounds) return null;

  if (Array.isArray(visibleBounds) && visibleBounds.length === 4 && visibleBounds.every(Number.isFinite)) {
    const [west, south, east, north] = visibleBounds;
    return { north, south, east, west };
  }

  if (Array.isArray(visibleBounds) && visibleBounds.length === 2 && visibleBounds.every(Array.isArray)) {
    const points = visibleBounds.flat();
    if (points.length === 4 && points.every(Number.isFinite)) {
      const [lonA, latA, lonB, latB] = points;
      return {
        north: Math.max(latA, latB),
        south: Math.min(latA, latB),
        east: Math.max(lonA, lonB),
        west: Math.min(lonA, lonB),
      };
    }
  }

  return null;
};

export const expandBounds = (bounds, ratio = PUB_FETCH_BUFFER_RATIO) => {
  if (!bounds) return null;
  const latSpan = Math.max(bounds.north - bounds.south, 0.02);
  const lonSpan = Math.max(bounds.east - bounds.west, 0.02);
  const latPad = latSpan * ratio;
  const lonPad = lonSpan * ratio;
  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lonPad,
    west: bounds.west - lonPad,
  };
};

export const boundsContain = (outer, inner) => {
  if (!outer || !inner) return false;
  return (
    Number.isFinite(outer.north) && Number.isFinite(outer.south) && Number.isFinite(outer.east) && Number.isFinite(outer.west) &&
    Number.isFinite(inner.north) && Number.isFinite(inner.south) && Number.isFinite(inner.east) && Number.isFinite(inner.west) &&
    outer.north >= inner.north &&
    outer.south <= inner.south &&
    outer.east >= inner.east &&
    outer.west <= inner.west
  );
};

export const mergeBounds = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  return {
    north: Math.max(a.north, b.north),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    west: Math.min(a.west, b.west),
  };
};

export const pubInsideFeature = (pub, feature) => {
  if (!feature || !Number.isFinite(pub?.lon) || !Number.isFinite(pub?.lat)) {
    return false;
  }
  try {
    return booleanPointInPolygon(point([pub.lon, pub.lat]), feature);
  } catch {
    return false;
  }
};

export const findFeatureByName = (featureCollection, name) => {
  if (!name || typeof name !== 'string') return null;
  const normalized = name.trim().toLowerCase();
  return (featureCollection?.features || []).find(
    (feature) => feature?.properties?.name?.trim?.().toLowerCase?.() === normalized,
  ) || null;
};

/** Match district polygon by outward code, or by locality label / "Name (CODE)" from search bar. */
export const findDistrictFeatureBySearchQuery = (featureCollection, rawQuery) => {
  if (!rawQuery || typeof rawQuery !== 'string') return null;
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;
  const q = trimmed.toLowerCase();
  const byCode = findFeatureByName(featureCollection, trimmed);
  if (byCode) return byCode;
  const paren = trimmed.match(/\(([A-Z0-9]{2,5})\)\s*$/i);
  if (paren) {
    const inner = findFeatureByName(featureCollection, paren[1]);
    if (inner) return inner;
  }
  const features = featureCollection?.features || [];
  return (
    features.find((f) => {
      const code = f?.properties?.name;
      if (!code || typeof code !== 'string') return false;
      return getPostcodeDistrictDisplayName(code).toLowerCase() === q;
    })
    || features.find((f) => {
      const code = f?.properties?.name;
      if (!code || typeof code !== 'string') return false;
      return formatDistrictWithCode(code).toLowerCase() === q;
    })
    || features.find((f) => {
      const code = f?.properties?.name;
      if (!code || typeof code !== 'string') return false;
      const label = getPostcodeDistrictDisplayName(code).toLowerCase();
      const full = formatDistrictWithCode(code).toLowerCase();
      return label.includes(q) || full.includes(q);
    })
    || null
  );
};

export const findFeatureContainingCoordinate = (featureCollection, latitude, longitude) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const candidatePoint = point([longitude, latitude]);
  return (featureCollection?.features || []).find((feature) => {
    try {
      return booleanPointInPolygon(candidatePoint, feature);
    } catch {
      return false;
    }
  }) || null;
};
