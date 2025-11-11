import { useMemo, useCallback } from 'react';

export const useAreaStats = (allPubs) => {
  const areaStatsMap = useMemo(() => {
    if (!Array.isArray(allPubs) || allPubs.length === 0) {
      return {};
    }

    const statsMap = {};

    allPubs.forEach((pub) => {
      const areaName = pub.area ? pub.area.trim() : '';
      if (!areaName) {
        return;
      }

      const lat = Number.parseFloat(pub.lat);
      const lon = Number.parseFloat(pub.lon);
      const boroughName =
        typeof pub.borough === 'string' && pub.borough.trim().length > 0
          ? pub.borough.trim()
          : null;

      const key = areaName.toLowerCase();

      let stats = statsMap[key];
      if (!stats) {
        stats = {
          totalPubs: 0,
          visitedPubs: 0,
          sumLat: 0,
          sumLon: 0,
          coordCount: 0,
          borough: boroughName,
          name: areaName,
        };
        statsMap[key] = stats;
      }

      stats.totalPubs += 1;
      if (pub.isVisited) {
        stats.visitedPubs += 1;
      }
      if (!stats.borough && boroughName) {
        stats.borough = boroughName;
      }

      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        stats.sumLat += lat;
        stats.sumLon += lon;
        stats.coordCount += 1;
      }
    });

    Object.entries(statsMap).forEach(([key, stats]) => {
      if (stats.coordCount > 0) {
        stats.center = {
          latitude: stats.sumLat / stats.coordCount,
          longitude: stats.sumLon / stats.coordCount,
        };
      } else {
        stats.center = null;
      }

      stats.completionPercentage =
        stats.totalPubs > 0 ? (stats.visitedPubs / stats.totalPubs) * 100 : 0;

      delete stats.sumLat;
      delete stats.sumLon;
      delete stats.coordCount;
    });

    return statsMap;
  }, [allPubs]);

  const allAreas = useMemo(() => {
    return Object.values(areaStatsMap)
      .map((stats) => stats.name || '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [areaStatsMap]);

  const calculateAreaStats = useCallback((areaName, pubsToAnalyze) => {
    const pubsInArea = pubsToAnalyze.filter(
      (pub) => pub.area && pub.area.trim().toLowerCase() === areaName.toLowerCase()
    );

    const totalPubs = pubsInArea.length;
    const visitedPubs = pubsInArea.filter((pub) => pub.isVisited).length;
    const completionPercentage = totalPubs > 0 ? (visitedPubs / totalPubs) * 100 : 0;

    return {
      totalPubs,
      visitedPubs,
      completionPercentage,
      pubs: pubsInArea,
    };
  }, []);

  return { areaStatsMap, allAreas, calculateAreaStats };
};

