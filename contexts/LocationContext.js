import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';

const LocationContext = createContext({ location: null, isReady: false });

/** Accept cached fixes up to 5 minutes old for instant map centre on cold start. */
const LAST_KNOWN_MAX_AGE_MS = 300000;

/**
 * `onPermissionAnswered` runs once the location prompt has been answered (or skipped
 * because it was answered before) — App uses it to ask for notifications next, so the
 * two system prompts come one after the other rather than on top of each other.
 */
export function LocationProvider({ children, userId, onPermissionAnswered }) {
  const [location, setLocation] = useState(null);
  const onPermissionAnsweredRef = useRef(onPermissionAnswered);
  onPermissionAnsweredRef.current = onPermissionAnswered;
  const [isReady, setIsReady] = useState(false);
  const hasFreshFix = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setIsReady(false);
    setLocation(null);
    hasFreshFix.current = false;

    const resolve = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync().catch((err) => {
          console.warn('LocationContext: location permission failed', err?.message);
          return { status: null };
        });

        if (!cancelled) onPermissionAnsweredRef.current?.();

        if (status !== 'granted' || cancelled) return;

        try {
          const last = await Location.getLastKnownPositionAsync({
            maxAge: LAST_KNOWN_MAX_AGE_MS,
          });
          if (last && !cancelled && !hasFreshFix.current) {
            setLocation({
              latitude: last.coords.latitude,
              longitude: last.coords.longitude,
            });
          }
        } catch (err) {
          console.warn('LocationContext: getLastKnownPosition failed', err?.message);
        }

        // Do not block map launch on a fresh Balanced GPS fix — refine in background.
        if (!cancelled) setIsReady(true);

        if (cancelled) return;

        try {
          const fresh = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          });
          if (!cancelled) {
            hasFreshFix.current = true;
            setLocation({
              latitude: fresh.coords.latitude,
              longitude: fresh.coords.longitude,
            });
          }
        } catch (err) {
          console.warn('LocationContext: background position refine failed', err?.message);
        }
      } finally {
        if (!cancelled) setIsReady(true);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <LocationContext.Provider value={{ location, isReady }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useUserLocation() {
  return useContext(LocationContext).location;
}

export function useLocationReady() {
  return useContext(LocationContext).isReady;
}
