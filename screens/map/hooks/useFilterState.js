import { useState, useMemo, useCallback } from 'react';

export function useFilterState(allPubs) {
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [selectedOwnerships, setSelectedOwnerships] = useState([]);
  const [yearRange, setYearRange] = useState(null);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [showOnlyAchievements, setShowOnlyAchievements] = useState(false);
  const [closingTimeMin, setClosingTimeMin] = useState(null);
  const [showFilterScreen, setShowFilterScreen] = useState(false);

  const allFeatures = useMemo(() => {
    const featureSet = new Set();
    allPubs.forEach(pub => {
      if (pub.features && Array.isArray(pub.features)) {
        pub.features.forEach(f => featureSet.add(f));
      }
    });
    return Array.from(featureSet).sort();
  }, [allPubs]);

  const allOwnerships = useMemo(() => {
    const counts = {};
    allPubs.forEach(pub => {
      if (pub.ownership && pub.ownership.trim()) {
        counts[pub.ownership] = (counts[pub.ownership] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]))
      .map(([ownership]) => ownership);
  }, [allPubs]);

  const availableYearRange = useMemo(() => {
    const years = [];
    allPubs.forEach(pub => {
      if (pub.founded) {
        const year = parseInt(pub.founded, 10);
        if (!isNaN(year)) years.push(year);
      }
    });
    if (years.length === 0) return { min: 1800, max: 2025 };
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [allPubs]);

  const handleFilterApply = useCallback((filters) => {
    setSelectedFeatures(filters.features || []);
    setSelectedOwnerships(filters.ownerships || []);
    setYearRange(filters.yearRange || null);
    setShowOnlyFavorites(filters.showOnlyFavorites || false);
    setShowOnlyAchievements(filters.showOnlyAchievements || false);
    setClosingTimeMin(filters.closingTimeMin ?? null);
  }, []);

  const handleFilterPress = useCallback(() => setShowFilterScreen(true), []);
  const handleFilterClose = useCallback(() => setShowFilterScreen(false), []);

  return {
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    showOnlyFavorites,
    showOnlyAchievements,
    closingTimeMin,
    showFilterScreen,
    allFeatures,
    allOwnerships,
    availableYearRange,
    handleFilterApply,
    handleFilterPress,
    handleFilterClose,
    setSelectedArea: null, // placeholder; area filter lives in MapScreen
  };
}
