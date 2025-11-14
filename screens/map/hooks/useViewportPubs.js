import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLondonPubs } from '../../../services/PubService';

// Viewport padding factor (20% larger than visible area for prefetching)
const VIEWPORT_PADDING = 0.2;
// Debounce delay for viewport changes (ms)
const VIEWPORT_DEBOUNCE_MS = 400;
// Minimum viewport size to trigger load (prevents loading on tiny viewports)
const MIN_VIEWPORT_DELTA = 0.001;

/**
 * Convert map region to bounds format for API
 */
const regionToBounds = (region, padding = 0) => {
  if (!region || !Number.isFinite(region.latitude) || !Number.isFinite(region.longitude)) {
    return null;
  }

  const latDelta = region.latitudeDelta || 0;
  const lonDelta = region.longitudeDelta || 0;

  // Apply padding
  const paddedLatDelta = latDelta * (1 + padding);
  const paddedLonDelta = lonDelta * (1 + padding);

  return {
    north: region.latitude + paddedLatDelta / 2,
    south: region.latitude - paddedLatDelta / 2,
    east: region.longitude + paddedLonDelta / 2,
    west: region.longitude - paddedLonDelta / 2,
  };
};

/**
 * Check if two bounds are approximately equal (to avoid unnecessary reloads)
 */
const boundsAreEqual = (boundsA, boundsB, epsilon = 0.0001) => {
  if (!boundsA || !boundsB) return false;
  return (
    Math.abs(boundsA.north - boundsB.north) < epsilon &&
    Math.abs(boundsA.south - boundsB.south) < epsilon &&
    Math.abs(boundsA.east - boundsB.east) < epsilon &&
    Math.abs(boundsA.west - boundsB.west) < epsilon
  );
};

/**
 * Generate a cache key from bounds
 */
const boundsToKey = (bounds) => {
  if (!bounds) return null;
  // Round to 4 decimal places for cache key (roughly 10m precision)
  return `${bounds.north.toFixed(4)},${bounds.south.toFixed(4)},${bounds.east.toFixed(4)},${bounds.west.toFixed(4)}`;
};

/**
 * Hook for viewport-based pub loading
 * Only loads pubs visible in the current map viewport with intelligent caching
 */
export const useViewportPubs = (mapRegion, onPubsLoaded) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const loadedBoundsCache = useRef(new Set()); // Track which bounds we've loaded
  const lastLoadedBoundsRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  const isLoadingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const loadPubsForViewport = useCallback(
    async (bounds) => {
      if (!bounds) return;

      // Check if we've already loaded this viewport (with some tolerance)
      const cacheKey = boundsToKey(bounds);
      if (cacheKey && loadedBoundsCache.current.has(cacheKey)) {
        return; // Already loaded
      }

      // Check if bounds are too small (likely an error)
      const latSpan = bounds.north - bounds.south;
      const lonSpan = bounds.east - bounds.west;
      if (latSpan < MIN_VIEWPORT_DELTA || lonSpan < MIN_VIEWPORT_DELTA) {
        return;
      }

      // Prevent concurrent loads
      if (isLoadingRef.current) {
        return;
      }

      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const pubs = await fetchLondonPubs({ bounds });
        
        if (!isMountedRef.current) {
          return;
        }

        if (Array.isArray(pubs) && pubs.length > 0) {
          // Mark this bounds as loaded
          if (cacheKey) {
            loadedBoundsCache.current.add(cacheKey);
          }
          lastLoadedBoundsRef.current = bounds;

          // Call the callback to merge pubs
          if (onPubsLoaded) {
            onPubsLoaded(pubs);
          }
        }

        setError(null);
      } catch (err) {
        console.error('Error loading viewport pubs:', err);
        if (isMountedRef.current) {
          setError(err.message || 'Failed to load pubs');
        }
      } finally {
        if (isMountedRef.current) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [onPubsLoaded]
  );

  // Debounced viewport change handler
  useEffect(() => {
    if (!mapRegion) return; // Don't load if no region set yet

    // Clear any pending debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Convert region to bounds with padding
    const bounds = regionToBounds(mapRegion, VIEWPORT_PADDING);
    if (!bounds) return;

    // Check if bounds have changed significantly
    if (lastLoadedBoundsRef.current && boundsAreEqual(bounds, lastLoadedBoundsRef.current, 0.001)) {
      return; // No significant change
    }

    // Debounce the load (but shorter delay for initial load)
    const debounceDelay = lastLoadedBoundsRef.current ? VIEWPORT_DEBOUNCE_MS : 100; // Faster initial load
    debounceTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        loadPubsForViewport(bounds);
      }
    }, debounceDelay);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [mapRegion, loadPubsForViewport]);

  // Don't auto-load on mount - wait for region to be set (user location)
  // The debounced effect above will handle loading when region is set

  // Expose function to manually trigger load (for search, etc.)
  const loadPubsForRegion = useCallback(
    (region) => {
      const bounds = regionToBounds(region, VIEWPORT_PADDING);
      if (bounds) {
        loadPubsForViewport(bounds);
      }
    },
    [loadPubsForViewport]
  );

  return {
    isLoading,
    error,
    loadPubsForRegion,
  };
};

