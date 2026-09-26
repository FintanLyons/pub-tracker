import { useState, useMemo, useCallback, useEffect } from 'react';
import { fetchFilterOptions } from '../../../services/PubService';
import { parseFoundedYear } from '../../../utils/foundedYear';

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

  /** Options from every active pub (server); loaded pubs are only a fallback until they arrive. */
  const [serverOptions, setServerOptions] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchFilterOptions()
      .then((options) => {
        if (!cancelled) setServerOptions(options);
      })
      .catch((err) => console.warn('useFilterState: filter options failed', err?.message ?? err));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadedOwnerships = useMemo(() => {
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

  const allOwnerships = serverOptions?.ownerships?.length ? serverOptions.ownerships : loadedOwnerships;

  const availableYearRange = useMemo(() => {
    // Upper end is always this year, so the slider reaches "today" even if no pub is that new.
    const currentYear = new Date().getFullYear();
    if (serverOptions?.yearRange) return { min: serverOptions.yearRange.min, max: currentYear };
    const years = [];
    allPubs.forEach(pub => {
      if (pub.founded) {
        const year = parseFoundedYear(pub.founded);
        if (year != null) years.push(year);
      }
    });
    if (years.length === 0) return { min: 1800, max: currentYear };
    return { min: Math.min(...years), max: currentYear };
  }, [allPubs, serverOptions]);

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
  };
}
