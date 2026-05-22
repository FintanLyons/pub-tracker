import { useState, useMemo, useCallback } from 'react';

export function useFilterState(allPubs) {
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [selectedOwnerships, setSelectedOwnerships] = useState([]);
  const [yearRange, setYearRange] = useState(null);
  /** User ids whose favourite pubs are shown on the map; empty = favourites filter off. */
  const [favoritesFilterUserIds, setFavoritesFilterUserIds] = useState([]);
  const [showOnlyAchievements, setShowOnlyAchievements] = useState(false);
  const [closingTimeMin, setClosingTimeMin] = useState(null);
  const [minRating, setMinRating] = useState(null);
  const [showFilterScreen, setShowFilterScreen] = useState(false);

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
    setFavoritesFilterUserIds(
      Array.isArray(filters.favoritesFilterUserIds) ? filters.favoritesFilterUserIds : []
    );
    setShowOnlyAchievements(filters.showOnlyAchievements || false);
    setClosingTimeMin(filters.closingTimeMin ?? null);
    setMinRating(filters.minRating ?? null);
  }, []);

  const handleFilterPress = useCallback(() => setShowFilterScreen(true), []);
  const handleFilterClose = useCallback(() => setShowFilterScreen(false), []);

  return {
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    favoritesFilterUserIds,
    showOnlyAchievements,
    closingTimeMin,
    minRating,
    showFilterScreen,
    allOwnerships,
    availableYearRange,
    handleFilterApply,
    handleFilterPress,
    handleFilterClose,
    setSelectedArea: null, // placeholder; area filter lives in MapScreen
  };
}
