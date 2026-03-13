import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';

const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const [location, setLocation] = useState(null);
  const hasFreshFix = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;

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
    };

    resolve();
    return () => { cancelled = true; };
  }, []);

  return (
    <LocationContext.Provider value={location}>
      {children}
    </LocationContext.Provider>
  );
}

export function useUserLocation() {
  return useContext(LocationContext);
}
