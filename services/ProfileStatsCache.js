import * as Location from 'expo-location';
import { fetchLondonPubs } from './PubService';

let cachedStats = null;
let cachedLocation = null;
let preloadPromise = null;

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const isFiniteCoordinate = (value) => Number.isFinite(value) && !Number.isNaN(value);

const normalizeAreaName = (area) => {
  if (typeof area !== 'string') {
    return 'Unknown';
  }
  const trimmed = area.trim();
  return trimmed.length > 0 ? trimmed : 'Unknown';
};

const normalizeBoroughName = (borough) => {
  if (typeof borough !== 'string') {
    return 'Unknown';
  }
  const trimmed = borough.trim();
  return trimmed.length > 0 ? trimmed : 'Unknown';
};

const buildStatsFromPubs = (pubs, location) => {
  const safePubs = Array.isArray(pubs) ? pubs : [];
  const areaMap = {};
  const boroughMap = {};
  let visitedCount = 0;

  safePubs.forEach((pub) => {
    const areaName = normalizeAreaName(pub.area);
    const boroughName = normalizeBoroughName(pub.borough);
    const lat = Number.parseFloat(pub.lat);
    const lon = Number.parseFloat(pub.lon);
    const hasValidCoords = isFiniteCoordinate(lat) && isFiniteCoordinate(lon);
    const isVisited = !!pub.isVisited;

    if (isVisited) {
      visitedCount += 1;
    }

    let areaEntry = areaMap[areaName];
    if (!areaEntry) {
      areaEntry = {
        name: areaName,
        borough: boroughName !== 'Unknown' ? boroughName : null,
        total: 0,
        visited: 0,
        sumLat: 0,
        sumLon: 0,
        coordCount: 0,
      };
      areaMap[areaName] = areaEntry;
    }

    if (!areaEntry.borough && boroughName !== 'Unknown') {
      areaEntry.borough = boroughName;
    }

    areaEntry.total += 1;
    if (isVisited) {
      areaEntry.visited += 1;
    }
    if (hasValidCoords) {
      areaEntry.sumLat += lat;
      areaEntry.sumLon += lon;
      areaEntry.coordCount += 1;
    }

    let boroughEntry = boroughMap[boroughName];
    if (!boroughEntry) {
      boroughEntry = {
        name: boroughName,
        total: 0,
        visited: 0,
        sumLat: 0,
        sumLon: 0,
        coordCount: 0,
        areas: new Set(),
      };
      boroughMap[boroughName] = boroughEntry;
    }

    boroughEntry.total += 1;
    if (isVisited) {
      boroughEntry.visited += 1;
    }
    if (hasValidCoords) {
      boroughEntry.sumLat += lat;
      boroughEntry.sumLon += lon;
      boroughEntry.coordCount += 1;
    }
    if (areaName !== 'Unknown') {
      boroughEntry.areas.add(areaName);
    }
  });

  const areaDistanceMap = {};
  const boroughDistanceMap = {};

  const areaStats = Object.entries(areaMap).map(([areaKey, areaEntry]) => {
    const center =
      areaEntry.coordCount > 0
        ? {
            latitude: areaEntry.sumLat / areaEntry.coordCount,
            longitude: areaEntry.sumLon / areaEntry.coordCount,
          }
        : null;

    let distance = null;
    if (location && center) {
      try {
        distance = calculateDistance(
          location.latitude,
          location.longitude,
          center.latitude,
          center.longitude
        );
        areaDistanceMap[areaKey] = distance;
      } catch (error) {
        console.warn(
          `Profile stats distance calculation failed for area ${areaKey}:`,
          error?.message || error
        );
        distance = null;
      }
    }

    return {
      area: areaEntry.name,
      borough: areaEntry.borough,
      total: areaEntry.total,
      visited: areaEntry.visited,
      percentage:
        areaEntry.total > 0
          ? Math.round((areaEntry.visited / areaEntry.total) * 100)
          : 0,
      distance,
    };
  });

  const areaStatsByName = areaStats.reduce((acc, stat) => {
    acc[stat.area] = stat;
    return acc;
  }, {});

  const boroughStats = Object.entries(boroughMap).map(
    ([boroughKey, boroughEntry]) => {
      const center =
        boroughEntry.coordCount > 0
          ? {
              latitude: boroughEntry.sumLat / boroughEntry.coordCount,
              longitude: boroughEntry.sumLon / boroughEntry.coordCount,
            }
          : null;

      let distance = null;
      if (location && center) {
        try {
          distance = calculateDistance(
            location.latitude,
            location.longitude,
            center.latitude,
            center.longitude
          );
          boroughDistanceMap[boroughKey] = distance;
        } catch (error) {
          console.warn(
            `Profile stats distance calculation failed for borough ${boroughKey}:`,
            error?.message || error
          );
          distance = null;
        }
      }

      const areaNames = Array.from(boroughEntry.areas);
      const totalAreas = areaNames.length;
      const completedAreas = areaNames.filter((areaName) => {
        const areaStat = areaStatsByName[areaName];
        if (!areaStat) {
          return false;
        }
        return areaStat.visited >= areaStat.total && areaStat.total > 0;
      }).length;

      return {
        borough: boroughEntry.name,
        total: boroughEntry.total,
        visited: boroughEntry.visited,
        percentage:
          boroughEntry.total > 0
            ? Math.round((boroughEntry.visited / boroughEntry.total) * 100)
            : 0,
        distance,
        totalAreas,
        completedAreas,
      };
    }
  );

  return {
    pubs: safePubs,
    totalCount: safePubs.length,
    visitedCount,
    areaStats,
    boroughStats,
    areaDistanceMap,
    boroughDistanceMap,
    location: location || null,
    timestamp: Date.now(),
  };
};

const getLocationIfNeeded = async () => {
  if (
    cachedLocation &&
    isFiniteCoordinate(cachedLocation.latitude) &&
    isFiniteCoordinate(cachedLocation.longitude)
  ) {
    return cachedLocation;
  }

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    let position = null;
    if (typeof Location.getLastKnownPositionAsync === 'function') {
      position = await Location.getLastKnownPositionAsync();
    }

    if (!position) {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Lowest,
        maximumAge: 60000,
      });
    }

    if (!position || !position.coords) {
      return null;
    }

    const nextLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    cachedLocation = nextLocation;
    return nextLocation;
  } catch (error) {
    console.warn('Profile stats location preload failed:', error?.message || error);
    return null;
  }
};

export const getCachedProfileStats = () => cachedStats;

export const cacheProfileStats = (stats) => {
  if (!stats) {
    cachedStats = null;
    return;
  }

  cachedStats = {
    ...stats,
    areaStats: Array.isArray(stats.areaStats) ? [...stats.areaStats] : [],
    boroughStats: Array.isArray(stats.boroughStats)
      ? [...stats.boroughStats]
      : [],
    areaDistanceMap: stats.areaDistanceMap
      ? { ...stats.areaDistanceMap }
      : {},
    boroughDistanceMap: stats.boroughDistanceMap
      ? { ...stats.boroughDistanceMap }
      : {},
    timestamp: Date.now(),
  };

  if (cachedStats.location) {
    cachedLocation = { ...cachedStats.location };
  }
};

export const primeProfileStatsFromPubs = (pubs) => {
  if (!Array.isArray(pubs) || pubs.length === 0) {
    return cachedStats;
  }

  const location =
    cachedLocation ||
    (cachedStats && cachedStats.location ? { ...cachedStats.location } : null);
  const stats = buildStatsFromPubs(pubs, location);
  cachedStats = stats;
  return stats;
};

export const updateCachedProfileLocation = (location) => {
  if (
    !location ||
    !isFiniteCoordinate(location.latitude) ||
    !isFiniteCoordinate(location.longitude)
  ) {
    return;
  }

  cachedLocation = {
    latitude: location.latitude,
    longitude: location.longitude,
  };

  if (cachedStats && Array.isArray(cachedStats.pubs) && cachedStats.pubs.length > 0) {
    cachedStats = buildStatsFromPubs(cachedStats.pubs, cachedLocation);
  } else if (cachedStats) {
    cachedStats = {
      ...cachedStats,
      location: cachedLocation,
      timestamp: Date.now(),
    };
  }
};

export const preloadProfileStats = async () => {
  if (
    cachedStats &&
    Array.isArray(cachedStats.pubs) &&
    cachedStats.pubs.length > 0
  ) {
    if (cachedLocation) {
      cachedStats = buildStatsFromPubs(cachedStats.pubs, cachedLocation);
    }
    return cachedStats;
  }

  if (!preloadPromise) {
    preloadPromise = (async () => {
      try {
        const pubs = await fetchLondonPubs();
        const location = await getLocationIfNeeded();
        const stats = buildStatsFromPubs(pubs, location);
        cachedStats = stats;
        return stats;
      } finally {
        preloadPromise = null;
      }
    })();
  }

  return preloadPromise;
};

