import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useUserLocation } from '../../../contexts/LocationContext';
import { DEFAULT_CAMERA, getFeatureBounds, ZOOM_LEVELS } from '../layerUtils';

export function useMapCamera({ setIsLocationLoaded }) {
  const contextLocation = useUserLocation();
  const [localLocation, setLocalLocation] = useState(null);

  const cameraRef = useRef(null);
  const mapZoomRef = useRef(DEFAULT_CAMERA.zoom);
  const initialCameraSetRef = useRef(false);
  const hasUserInteractedRef = useRef(false);

  const currentLocation = localLocation || contextLocation;

  useEffect(() => {
    if (contextLocation && !initialCameraSetRef.current && !hasUserInteractedRef.current && cameraRef.current) {
      initialCameraSetRef.current = true;
      cameraRef.current.jumpTo({
        center: [contextLocation.longitude, contextLocation.latitude],
        zoom: ZOOM_LEVELS.PUBS_MIN,
      });
    }
    setIsLocationLoaded?.(true);
  }, [contextLocation, setIsLocationLoaded]);

  const fitBoundsObject = useCallback((b, animationDuration = 800) => {
    if (!b || !cameraRef.current) return;
    const { north, south, east, west } = b;
    if (![north, south, east, west].every(Number.isFinite)) return;
    cameraRef.current.fitBounds([west, south, east, north], {
      padding: { top: 140, right: 48, bottom: 180, left: 48 },
      duration: animationDuration,
      easing: 'ease',
    });
  }, []);

  const fitFeature = useCallback((feature, animationDuration = 800) => {
    const bounds = getFeatureBounds(feature);
    if (!bounds || !cameraRef.current) return;
    cameraRef.current.fitBounds(bounds, {
      padding: { top: 140, right: 48, bottom: 180, left: 48 },
      duration: animationDuration,
      easing: 'ease',
    });
  }, []);

  const centerOnPub = useCallback((pub) => {
    if (!cameraRef.current || !Number.isFinite(pub?.lon) || !Number.isFinite(pub?.lat)) return;
    cameraRef.current.easeTo({
      center: [pub.lon, pub.lat],
      zoom: 15.2,
      duration: 700,
    });
  }, []);

  const handleCurrentLocation = useCallback(async () => {
    try {
      hasUserInteractedRef.current = true;
      let nextLocation = currentLocation;

      if (!nextLocation) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        nextLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setLocalLocation(nextLocation);
      }

      if (!nextLocation) return;
      cameraRef.current?.easeTo({
        center: [nextLocation.longitude, nextLocation.latitude],
        zoom: Math.max(mapZoomRef.current, 14.5),
        duration: 700,
      });
    } catch (error) {
      console.error('Error getting current location:', error);
    }
  }, [currentLocation]);

  const currentLocationShape = useMemo(() => {
    if (!currentLocation) return null;
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [currentLocation.longitude, currentLocation.latitude] },
      }],
    };
  }, [currentLocation]);

  return {
    cameraRef,
    mapZoomRef,
    initialCameraSetRef,
    hasUserInteractedRef,
    currentLocation,
    currentLocationShape,
    fitFeature,
    fitBoundsObject,
    centerOnPub,
    handleCurrentLocation,
  };
}
