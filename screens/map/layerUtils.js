import bbox from '@turf/bbox';
import { APP_DISPLAY_NAME } from '../../constants/app';
import { COLORS } from '../../constants/theme';
import { formatDistrictWithCode } from '../../utils/postcodeDistrictDisplayNames';
import { interpolateColor } from './utils';

/**
 * Map district / area completion shading — tune here.
 *
 * Colour: `interpolateColor(completion, RAMP_MIN_COLOR, RAMP_MAX_COLOR)` on features with pub counts.
 * Districts with no pubs in loaded data use NO_STATS_COLOR (flat).
 *
 * Opacity scales with completion (separate below / above PUBS_MIN). “Outside” focused letter-area uses DIM.
 */
export const MAP_COMPLETION_STYLE = {
  RAMP_MIN_COLOR: '#D8D8D8',
  RAMP_MAX_COLOR: COLORS.amber,
  NO_STATS_COLOR: '#D8D8D8',
  /** Fill opacity at 0% and 100% completion (zoom < PUBS_MIN, coloured ramp). */
  DISTRICT_OPACITY_AT_ZERO: 0.06,
  DISTRICT_OPACITY_AT_FULL: 0.5,
  /** Same idea when zoom ≥ PUBS_MIN (solid amber fill mode). */
  DISTRICT_PUB_ZOOM_OPACITY_AT_ZERO: 0.1,
  DISTRICT_PUB_ZOOM_OPACITY_AT_FULL: 0.5,
  NO_STATS_OPACITY_DISTRICT: 0.06,
  NO_STATS_OPACITY_PUB_ZOOM: 0.1,
  DIM_OUTSIDE_FOCUSED_AREA: 0.04,
  OUTSIDE_FOCUSED_PUB_ZOOM: 0.08,
  SELECTED_OPACITY_BOOST: 0.08,
  SELECTED_OPACITY_CAP: 0.58,
  /** Letter-area (E, SW, …) polygon fill under AREA_FILL_MAX_ZOOM */
  AREA_FILL_OPACITY: 0.22,
};

export const MAP_STYLE = {
  version: 8,
  name: `${APP_DISPLAY_NAME} Raster`,
  // Required for any symbol layer with text-field; without it Mbgl-HttpRequest logs
  // "Unable to parse resourceUrl" on Android/iOS native.
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '&copy; OpenStreetMap contributors, &copy; CARTO',
      maxzoom: 20,
    },
  },
  layers: [
    {
      id: 'osm-base',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 22,
      paint: {
        'raster-saturation': -0.2,
        'raster-contrast': -0.1,
        'raster-brightness-min': 0.12,
        'raster-brightness-max': 0.96,
      },
    },
  ],
};

export const DEFAULT_CAMERA = {
  center: [-0.1278, 51.5074],
  zoom: 9.6,
};

/** Zoom bands: postcode areas (wide) → districts → pubs */
export const ZOOM_LEVELS = {
  POSTCODE_AREAS_MAX: 9.8,
  /** District text labels (SW12, …) only at/above this zoom — hidden when letter-area outlines dominate. */
  DISTRICT_LABELS_MIN: 9.9,
  DISTRICTS_MIN: 9.2,
  /** Merged letter-area (E, SW, …) fill: only below this so district colouring shows once districts appear. */
  AREA_FILL_MAX_ZOOM: 9.15,
  /** District fill/labels use this for outer zoom cap; district outline lines have no max (always on). */
  DISTRICTS_MAX: 13.0,
  /** Pub markers + amber district shading at/above this zoom; raise to hide pubs sooner when zooming out. */
  PUBS_MIN: 12.35,
  /** Floor zoom when centring on GPS via the location control (below this = wider neighbourhood context). */
  CURRENT_LOCATION_MIN: 13.85,
};

/**
 * Attach completion stats to postcode-area features (polygons or label points).
 * Polygons: `data/geo/london_postcode_areas.min.json`
 * One label Point per area: `data/geo/london_postcode_area_label_points.min.json`
 * Regenerate both: `python3 scripts/build_london_postcode_areas.py`
 */
export const buildPostcodeAreaLayerCollection = (geojson, postcodeAreaSummaries = []) => {
  const statsByArea = new Map(
    (Array.isArray(postcodeAreaSummaries) ? postcodeAreaSummaries : [])
      .filter((item) => typeof item?.postcodeArea === 'string' && item.postcodeArea.trim().length > 0)
      .map((item) => [item.postcodeArea.trim().toLowerCase(), item]),
  );

  return {
    type: 'FeatureCollection',
    features: (geojson?.features || []).map((feature) => {
      const areaCode = (feature?.properties?.postcode_area || '').trim();
      const stats = statsByArea.get(areaCode.toLowerCase()) || null;
      const completion = Number.isFinite(stats?.completionPercentage)
        ? Number(stats.completionPercentage)
        : 0;

      return {
        ...feature,
        properties: {
          ...feature.properties,
          completion,
          visitedPubs: Number(stats?.visitedPubs || 0),
          totalPubs: Number(stats?.totalPubs || 0),
          fillColor: interpolateColor(
            completion,
            MAP_COMPLETION_STYLE.RAMP_MIN_COLOR,
            MAP_COMPLETION_STYLE.RAMP_MAX_COLOR,
          ),
        },
      };
    }),
  };
};

/**
 * District polygons: per-district completion + optional focus on one postcode area / district.
 */
export const buildPostcodeDistrictLayerCollection = (
  geojson,
  focusedPostcodeArea,
  selectedDistrictName,
  districtStatsMap = null,
) => {
  const focused = typeof focusedPostcodeArea === 'string' ? focusedPostcodeArea.trim().toLowerCase() : null;
  const selected = typeof selectedDistrictName === 'string' ? selectedDistrictName.trim().toLowerCase() : null;

  const lerpOpacity = (t, a, b) => a + (b - a) * Math.min(1, Math.max(0, t));

  // Track which district keys have already been assigned a text label.
  // Some postcode districts are stored as multiple separate polygon features
  // (discontinuous geometry split across parts). Only the first feature per
  // district key gets a label so the name never appears more than once.
  const labeledDistricts = new Set();

  return {
    type: 'FeatureCollection',
    features: (geojson?.features || [])
      .map((feature) => {
        const districtName = feature?.properties?.name || '';
        const districtKey = districtName.toLowerCase();
        const rawLabel = districtName ? formatDistrictWithCode(districtName) : '';
        const shouldLabel = Boolean(rawLabel) && !labeledDistricts.has(districtKey);
        if (shouldLabel) labeledDistricts.add(districtKey);
        const districtLabel = shouldLabel ? rawLabel : '';
        const featureArea = feature?.properties?.postcode_area?.trim?.().toLowerCase?.() || null;
        const isSelected = Boolean(selected && districtKey === selected);
        const isInFocusedArea = !focused || (featureArea && focused && featureArea === focused);
        const stats = districtStatsMap?.get(districtKey) || null;
        const completion = stats ? (stats.total > 0 ? (stats.visited / stats.total) * 100 : 0) : 0;
        const hasStats = stats !== null && stats.total > 0;
        let fillColor;
        if (isSelected) {
          fillColor = COLORS.amber;
        } else if (hasStats) {
          fillColor = interpolateColor(
            completion,
            MAP_COMPLETION_STYLE.RAMP_MIN_COLOR,
            MAP_COMPLETION_STYLE.RAMP_MAX_COLOR,
          );
        } else {
          fillColor = MAP_COMPLETION_STYLE.NO_STATS_COLOR;
        }

        let districtFillOpacity = hasStats
          ? lerpOpacity(
              completion / 100,
              MAP_COMPLETION_STYLE.DISTRICT_OPACITY_AT_ZERO,
              MAP_COMPLETION_STYLE.DISTRICT_OPACITY_AT_FULL,
            )
          : MAP_COMPLETION_STYLE.NO_STATS_OPACITY_DISTRICT;
        let districtFillOpacityPub = hasStats
          ? lerpOpacity(
              completion / 100,
              MAP_COMPLETION_STYLE.DISTRICT_PUB_ZOOM_OPACITY_AT_ZERO,
              MAP_COMPLETION_STYLE.DISTRICT_PUB_ZOOM_OPACITY_AT_FULL,
            )
          : MAP_COMPLETION_STYLE.NO_STATS_OPACITY_PUB_ZOOM;

        if (isSelected) {
          districtFillOpacity = Math.min(
            MAP_COMPLETION_STYLE.SELECTED_OPACITY_CAP,
            districtFillOpacity + MAP_COMPLETION_STYLE.SELECTED_OPACITY_BOOST,
          );
          districtFillOpacityPub = Math.min(
            MAP_COMPLETION_STYLE.SELECTED_OPACITY_CAP,
            districtFillOpacityPub + MAP_COMPLETION_STYLE.SELECTED_OPACITY_BOOST,
          );
        } else if (focused && !isInFocusedArea) {
          districtFillOpacity = MAP_COMPLETION_STYLE.DIM_OUTSIDE_FOCUSED_AREA;
          districtFillOpacityPub = MAP_COMPLETION_STYLE.OUTSIDE_FOCUSED_PUB_ZOOM;
        }

        return {
          ...feature,
          properties: {
            ...feature.properties,
            districtLabel,
            isSelected,
            isInFocusedArea,
            fillColor,
            districtFillOpacity,
            districtFillOpacityPub,
          },
        };
      }),
  };
};

export const buildPubFeatureCollection = (pubs) => ({
  type: 'FeatureCollection',
  features: (Array.isArray(pubs) ? pubs : [])
    .filter((pub) => Number.isFinite(pub?.lon) && Number.isFinite(pub?.lat))
    .map((pub) => ({
      type: 'Feature',
      id: pub.id,
      properties: {
        ...pub,
        pubId: pub.id,
        isVisited: pub.isVisited === true,
      },
      geometry: {
        type: 'Point',
        coordinates: [pub.lon, pub.lat],
      },
    })),
});

export const getFeatureBounds = (feature) => {
  if (!feature) return null;
  const [minX, minY, maxX, maxY] = bbox(feature);
  return [minX, minY, maxX, maxY];
};
