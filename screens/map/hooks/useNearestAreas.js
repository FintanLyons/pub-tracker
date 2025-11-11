import { useMemo } from 'react';
import { distanceBetween } from '../utils';
import { NEIGHBOURHOOD_LIMIT } from '../constants';

export const useNearestAreaKeys = (mapRegion, areaStatsMap, activeBoroughs, fallbackRegionRef) =>
  useMemo(() => {
    const region = mapRegion || fallbackRegionRef.current;
    if (!region || !areaStatsMap) {
      return [];
    }

    const center = {
      latitude: region.latitude,
      longitude: region.longitude,
    };

    return Object.entries(areaStatsMap)
      .filter(([key, stats]) => {
        if (!stats?.center) {
          return false;
        }
        if (!stats.borough || activeBoroughs.length === 0) {
          return true;
        }
        return activeBoroughs.includes(stats.borough);
      })
      .map(([key, stats]) => ({
        key,
        distance: distanceBetween(stats.center, center),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEIGHBOURHOOD_LIMIT)
      .map(({ key }) => key);
  }, [mapRegion, areaStatsMap, activeBoroughs, fallbackRegionRef]);

