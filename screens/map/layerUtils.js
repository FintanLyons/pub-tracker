import bbox from '@turf/bbox';
import { COLORS } from '../../constants/theme';
import { interpolateColor } from './utils';

export const MAP_STYLE = {
  version: 8,
  name: 'Pub Tracker Raster',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
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

export const ZOOM_LEVELS = {
  BOROUGHS_MAX: 9.8,
  WARDS_MIN: 9.2,
  WARDS_MAX: 13.0,
  PUBS_MIN: 11.6,
};

export const buildBoroughFeatureCollection = (geojson, boroughSummaries = []) => {
  const statsByName = new Map(
    (Array.isArray(boroughSummaries) ? boroughSummaries : [])
      .filter((item) => typeof item?.borough === 'string' && item.borough.trim().length > 0)
      .map((item) => [item.borough.trim().toLowerCase(), item]),
  );

  return {
    type: 'FeatureCollection',
    features: (geojson?.features || []).map((feature) => {
      const name = feature?.properties?.name || '';
      const stats = statsByName.get(name.toLowerCase()) || null;
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
          fillColor: interpolateColor(completion),
        },
      };
    }),
  };
};

export const buildWardFeatureCollection = (geojson, focusedBorough, selectedWardName, wardStatsMap = null) => {
  const focused = typeof focusedBorough === 'string' ? focusedBorough.trim().toLowerCase() : null;
  const selected = typeof selectedWardName === 'string' ? selectedWardName.trim().toLowerCase() : null;

  return {
    type: 'FeatureCollection',
    features: (geojson?.features || [])
      .map((feature) => {
        const wardName = feature?.properties?.name || '';
        const wardKey = wardName.toLowerCase();
        const featureBorough = feature?.properties?.borough?.trim?.().toLowerCase?.() || null;
        const isSelected = Boolean(selected && wardKey === selected);
        const isInFocusedBorough = Boolean(focused && featureBorough === focused);
        const stats = wardStatsMap?.get(wardKey) || null;
        const completion = stats ? (stats.total > 0 ? (stats.visited / stats.total) * 100 : 0) : 0;
        const hasStats = stats !== null && stats.total > 0;
        let fillColor;
        if (isSelected) {
          fillColor = COLORS.amber;
        } else if (hasStats) {
          fillColor = interpolateColor(completion);
        } else {
          fillColor = '#D8D8D8';
        }
        return {
          ...feature,
          properties: {
            ...feature.properties,
            isSelected,
            isInFocusedBorough,
            fillColor,
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
