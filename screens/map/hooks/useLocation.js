import { useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { Keyboard, Dimensions } from 'react-native';
import {
  LOCATION_MIN_DISTANCE_METERS,
  LOCATION_UPDATE_MIN_INTERVAL_MS,
  LOCATION_HEADING_EPSILON_DEGREES,
  LOCATION_WATCH_DISTANCE_METERS,
} from '../constants';
import { calculateDistanceMeters } from '../utils';

export function useLocation(commitMapRegion, mapRef, setIsLocationLoaded) {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [heading, setHeading] = useState(0);
  const [hasSetInitialRegion, setHasSetInitialRegion] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState(0);

  const locationSubscriptionRef = useRef(null);
  const isNavigatingRef = useRef(false);
  const lastLocationUpdateRef = useRef(0);
  const regionChangeTimeoutRef = useRef(null);
  const lastLocationRef = useRef(null);
  const lastHeadingRef = useRef(null);

  useEffect(() => {
    const setupLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Lowest,
            maximumAge: 60000,
          });
          const userLocation = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setCurrentLocation(userLocation);
          lastLocationUpdateRef.current = Date.now();
          lastLocationRef.current = userLocation;
          const initialHeading = location.coords.heading;
          if (typeof initialHeading === 'number' && !Number.isNaN(initialHeading)) {
            lastHeadingRef.current = initialHeading;
            setHeading(initialHeading);
          }

          const initialRegion = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          };

          commitMapRegion(initialRegion);
          setHasSetInitialRegion(true);

          isNavigatingRef.current = true;
          if (mapRef.current) {
            mapRef.current.animateToRegion(initialRegion, 0);
          }
          setTimeout(() => { isNavigatingRef.current = false; }, 200);

          setIsLocationLoaded(true);

          locationSubscriptionRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: LOCATION_UPDATE_MIN_INTERVAL_MS,
              distanceInterval: LOCATION_WATCH_DISTANCE_METERS,
            },
            (loc) => {
              const now = Date.now();
              if (now - lastLocationUpdateRef.current < LOCATION_UPDATE_MIN_INTERVAL_MS) return;

              const nextLocation = {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              };
              const distanceMoved = calculateDistanceMeters(lastLocationRef.current, nextLocation);
              if (lastLocationRef.current && distanceMoved < LOCATION_MIN_DISTANCE_METERS) return;

              lastLocationUpdateRef.current = now;
              lastLocationRef.current = nextLocation;
              setCurrentLocation(nextLocation);

              const hv = loc.coords.heading;
              if (
                typeof hv === 'number' &&
                !Number.isNaN(hv) &&
                (lastHeadingRef.current == null ||
                  Math.abs(hv - lastHeadingRef.current) >= LOCATION_HEADING_EPSILON_DEGREES)
              ) {
                lastHeadingRef.current = hv;
                setHeading(hv);
              }
            },
          );
        } else {
          setIsLocationLoaded(true);
          if (!hasSetInitialRegion) {
            const fallback = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.02, longitudeDelta: 0.02 };
            commitMapRegion(fallback);
            setHasSetInitialRegion(true);
            if (mapRef.current) mapRef.current.animateToRegion(fallback, 0);
          }
        }
      } catch (error) {
        console.error('Location setup error:', error);
        setIsLocationLoaded(true);
        if (!hasSetInitialRegion) {
          const fallback = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.02, longitudeDelta: 0.02 };
          commitMapRegion(fallback);
          setHasSetInitialRegion(true);
          if (mapRef.current) mapRef.current.animateToRegion(fallback, 0);
        }
      }
    };

    setupLocation();

    const kbShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      const top = e.endCoordinates.screenY !== undefined
        ? e.endCoordinates.screenY
        : Dimensions.get('window').height - e.endCoordinates.height;
      setKeyboardTop(top);
    });
    const kbHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      setKeyboardTop(0);
    });

    return () => {
      locationSubscriptionRef.current?.remove();
      kbShow.remove();
      kbHide.remove();
      if (regionChangeTimeoutRef.current) clearTimeout(regionChangeTimeoutRef.current);
    };
  }, [commitMapRegion]);

  const handleCurrentLocation = useCallback(async (loadPubsForViewportRegion) => {
    if (currentLocation) {
      isNavigatingRef.current = true;
      const newRegion = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      commitMapRegion(newRegion);
      if (mapRef.current) mapRef.current.animateToRegion(newRegion, 1000);
      setTimeout(() => {
        isNavigatingRef.current = false;
        loadPubsForViewportRegion?.(newRegion);
      }, 1050);
      return;
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      isNavigatingRef.current = true;
      commitMapRegion(newRegion);
      const latestLocation = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      lastLocationRef.current = latestLocation;
      lastLocationUpdateRef.current = Date.now();
      setCurrentLocation(latestLocation);
      const hv = location.coords.heading;
      if (typeof hv === 'number' && !Number.isNaN(hv) &&
          (lastHeadingRef.current == null || Math.abs(hv - lastHeadingRef.current) >= LOCATION_HEADING_EPSILON_DEGREES)) {
        lastHeadingRef.current = hv;
        setHeading(hv);
      }
      if (mapRef.current) mapRef.current.animateToRegion(newRegion, 1000);
      setTimeout(() => {
        isNavigatingRef.current = false;
        loadPubsForViewportRegion?.(newRegion);
      }, 1050);
    } catch (error) {
      console.error('Error getting location:', error);
      isNavigatingRef.current = false;
    }
  }, [currentLocation, commitMapRegion]);

  return {
    currentLocation,
    heading,
    keyboardHeight,
    keyboardTop,
    isNavigatingRef,
    regionChangeTimeoutRef,
    handleCurrentLocation,
  };
}
