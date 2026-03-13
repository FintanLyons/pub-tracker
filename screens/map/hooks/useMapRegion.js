import { useState, useRef, useCallback } from 'react';
import {
  MARKER_MODES,
  BOROUGH_ENTER_DELTA,
  BOROUGH_EXIT_DELTA,
  AREA_ENTER_DELTA,
  AREA_EXIT_DELTA,
  REGION_LATITUDE_EPSILON,
  REGION_LONGITUDE_EPSILON,
} from '../constants';

export function useMapRegion() {
  const [mapRegion, setMapRegion] = useState(null);
  const [markerMode, setMarkerMode] = useState(MARKER_MODES.BOROUGHS);
  const lastCommittedRegionRef = useRef(null);

  const updateMarkerMode = useCallback((region) => {
    if (!region) return;
    const latitudeDelta = typeof region.latitudeDelta === 'number' ? region.latitudeDelta : BOROUGH_ENTER_DELTA;
    const longitudeDelta = typeof region.longitudeDelta === 'number' ? region.longitudeDelta : latitudeDelta;
    const maxDelta = Math.max(latitudeDelta, longitudeDelta);

    setMarkerMode((current) => {
      if (current === MARKER_MODES.BOROUGHS) {
        return maxDelta < BOROUGH_EXIT_DELTA ? MARKER_MODES.AREAS : current;
      }
      if (current === MARKER_MODES.AREAS) {
        if (maxDelta > BOROUGH_ENTER_DELTA) return MARKER_MODES.BOROUGHS;
        if (maxDelta < AREA_EXIT_DELTA) return MARKER_MODES.PUBS;
        return current;
      }
      if (current === MARKER_MODES.PUBS && maxDelta > AREA_ENTER_DELTA) return MARKER_MODES.AREAS;
      return current;
    });
  }, []);

  const commitMapRegion = useCallback((region) => {
    if (!region) return;
    lastCommittedRegionRef.current = region;
    setMapRegion(region);
    updateMarkerMode(region);
  }, [updateMarkerMode]);

  const regionsAreApproximatelyEqual = useCallback((a, b) => {
    if (!a || !b) return false;
    return (
      Math.abs(a.latitude - b.latitude) < REGION_LATITUDE_EPSILON &&
      Math.abs(a.longitude - b.longitude) < REGION_LONGITUDE_EPSILON &&
      Math.abs((a.latitudeDelta || 0) - (b.latitudeDelta || 0)) < REGION_LATITUDE_EPSILON &&
      Math.abs((a.longitudeDelta || 0) - (b.longitudeDelta || 0)) < REGION_LONGITUDE_EPSILON
    );
  }, []);

  return {
    mapRegion,
    setMapRegion,
    markerMode,
    lastCommittedRegionRef,
    commitMapRegion,
    regionsAreApproximatelyEqual,
  };
}
