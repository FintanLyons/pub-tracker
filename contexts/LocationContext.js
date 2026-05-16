import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { registerPushNotificationsForUser } from '../services/PushNotificationService';

const LocationContext = createContext({ location: null, isReady: false });

export function LocationProvider({ children, userId }) {
  const [location, setLocation] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const hasFreshFix = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setIsReady(false);
    setLocation(null);
    hasFreshFix.current = false;

    const resolve = async () => {
      try {
        const locationPromise = Location.requestForegroundPermissionsAsync().catch((err) => {
          console.warn('LocationContext: location permission failed', err?.message);
          return { status: null };
        });

        const pushPromise =
          userId && !cancelled
            ? registerPushNotificationsForUser(userId).catch((err) => {
                console.warn('LocationContext: push registration failed', err?.message);
              })
            : Promise.resolve();

        const [loc] = await Promise.all([locationPromise, pushPromise]);
        const locationStatus = loc?.status ?? null;

        if (locationStatus !== 'granted' || cancelled) return;

        try {
          const last = await Location.getLastKnownPositionAsync();
          if (last && !cancelled && !hasFreshFix.current) {
            setLocation({
              latitude: last.coords.latitude,
              longitude: last.coords.longitude,
            });
          }

          const fresh = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) {
            hasFreshFix.current = true;
            setLocation({
              latitude: fresh.coords.latitude,
              longitude: fresh.coords.longitude,
            });
          }
        } catch (err) {
          console.warn('LocationContext: failed to resolve position', err?.message);
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
