import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useUserLocation } from '../../../contexts/LocationContext';
import { DEFAULT_CAMERA, getFeatureBounds, ZOOM_LEVELS } from '../layerUtils';

/** Throttle watch callbacks so the map dot only moves after this many metres. */
const MAP_LOCATION_DISTANCE_INTERVAL_M = 20;

/** Location button: animated pan + zoom (ms). */
const LOCATE_ANIM_MS = 1000;
const LOCATE_REFINE_MS = 650;

export function useMapCamera({ setIsLocationLoaded, isMapFocused = false }) {
  const contextLocation = useUserLocation();
  const [localLocation, setLocalLocation] = useState(null);

  const cameraRef = useRef(null);
  const mapZoomRef = useRef(DEFAULT_CAMERA.zoom);
  const initialCameraSetRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const currentLocationRef = useRef(null);

  const currentLocation = localLocation || contextLocation;

  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  useEffect(() => {
    if (!isMapFocused) return undefined;

    let cancelled = false;
    let subscription = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: MAP_LOCATION_DISTANCE_INTERVAL_M,
          },
          (loc) => {
            if (cancelled) return;
            setLocalLocation({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
          }
        );

        if (cancelled) {
          sub.remove();
          return;
        }
        subscription = sub;
      } catch (err) {
        if (!cancelled) {
          console.warn('useMapCamera: location watch failed', err?.message);
        }
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [isMapFocused]);

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
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const zoom = Math.max(mapZoomRef.current, ZOOM_LEVELS.CURRENT_LOCATION_MIN);
      const seed = currentLocationRef.current;
      let hasAnimatedThisPress = false;
      const animateTo = (lat, lon, duration) => {
        if (!cameraRef.current) return;
        cameraRef.current.easeTo({
          center: [lon, lat],
          zoom,
          duration,
          easing: 'ease',
        });
        hasAnimatedThisPress = true;
      };

      if (seed && cameraRef.current) {
        animateTo(seed.latitude, seed.longitude, LOCATE_ANIM_MS);
      }

      const last = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
      if (last) {
        const fromCache = {
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
        };
        setLocalLocation(fromCache);
        animateTo(
          fromCache.latitude,
          fromCache.longitude,
          hasAnimatedThisPress ? LOCATE_REFINE_MS : LOCATE_ANIM_MS,
        );
      }

      try {
        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
        });
        const nextLocation = {
          latitude: fresh.coords.latitude,
          longitude: fresh.coords.longitude,
        };
        setLocalLocation(nextLocation);
        animateTo(
          nextLocation.latitude,
          nextLocation.longitude,
          hasAnimatedThisPress ? LOCATE_REFINE_MS : LOCATE_ANIM_MS,
        );
      } catch (fineErr) {
        if (!last && !seed) {
          console.warn('useMapCamera: no quick location, trying balanced fix', fineErr?.message);
          const fallback = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const nextLocation = {
            latitude: fallback.coords.latitude,
            longitude: fallback.coords.longitude,
          };
          setLocalLocation(nextLocation);
          animateTo(nextLocation.latitude, nextLocation.longitude, LOCATE_ANIM_MS);
        }
      }
    } catch (error) {
      console.error('Error getting current location:', error);
    }
  }, []);

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
