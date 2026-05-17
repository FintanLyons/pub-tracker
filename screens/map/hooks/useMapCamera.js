import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useLocationReady, useUserLocation } from '../../../contexts/LocationContext';
import { DEFAULT_CAMERA, getFeatureBounds, ZOOM_LEVELS } from '../layerUtils';

/** Throttle watch callbacks so the map dot only moves after this many metres. */
const MAP_LOCATION_DISTANCE_INTERVAL_M = 20;

/** Location button: animated pan + zoom (ms). */
const LOCATE_ANIM_MS = 1000;
const LOCATE_REFINE_MS = 650;

export function useMapCamera({ setIsLocationLoaded, isMapFocused = false, onInitialCameraReady }) {
  const contextLocation = useUserLocation();
  const isLocationReady = useLocationReady();
  const [localLocation, setLocalLocation] = useState(null);

  const cameraRef = useRef(null);
  const mapZoomRef = useRef(DEFAULT_CAMERA.zoom);
  const initialCameraSetRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const currentLocationRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

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

  const handleMapLoaded = useCallback(() => {
    setMapReady(true);
  }, []);

  const notifyInitialCameraReady = useCallback((latitude, longitude) => {
    mapZoomRef.current = ZOOM_LEVELS.PUBS_MIN;
    onInitialCameraReady?.({
      latitude,
      longitude,
      zoom: ZOOM_LEVELS.PUBS_MIN,
    });
  }, [mapZoomRef, onInitialCameraReady]);

  useEffect(() => {
    if (!isLocationReady || !mapReady) return undefined;

    if (initialCameraSetRef.current || hasUserInteractedRef.current) {
      setIsLocationLoaded?.(true);
      return undefined;
    }

    let cancelled = false;

    const finishInitialCamera = (latitude, longitude) => {
      if (cancelled) return;
      initialCameraSetRef.current = true;
      setIsLocationLoaded?.(true);
      notifyInitialCameraReady(latitude, longitude);
    };

    const trySetCamera = (center, latitude, longitude) => {
      if (cancelled || !cameraRef.current) return false;
      try {
        cameraRef.current.jumpTo({
          center,
          zoom: ZOOM_LEVELS.PUBS_MIN,
        });
        finishInitialCamera(latitude, longitude);
        return true;
      } catch (err) {
        console.warn('useMapCamera: initial jumpTo failed', err?.message);
        return false;
      }
    };

    if (!contextLocation) {
      const [lon, lat] = DEFAULT_CAMERA.center;
      if (trySetCamera(DEFAULT_CAMERA.center, lat, lon)) {
        return () => { cancelled = true; };
      }
    } else if (
      trySetCamera(
        [contextLocation.longitude, contextLocation.latitude],
        contextLocation.latitude,
        contextLocation.longitude,
      )
    ) {
      return () => { cancelled = true; };
    }

    let frameId;
    const retry = () => {
      if (cancelled) return;
      if (!contextLocation) {
        const [lon, lat] = DEFAULT_CAMERA.center;
        if (trySetCamera(DEFAULT_CAMERA.center, lat, lon)) return;
      } else if (
        trySetCamera(
          [contextLocation.longitude, contextLocation.latitude],
          contextLocation.latitude,
          contextLocation.longitude,
        )
      ) {
        return;
      }
      frameId = requestAnimationFrame(retry);
    };
    frameId = requestAnimationFrame(retry);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [contextLocation, isLocationReady, mapReady, notifyInitialCameraReady, setIsLocationLoaded]);

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
    handleCurrentLocation,
    handleMapLoaded,
  };
}
