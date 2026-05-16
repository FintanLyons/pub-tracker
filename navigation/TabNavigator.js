import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ErrorBoundary from '../components/ErrorBoundary';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import { LoadingContext } from '../contexts/LoadingContext';
import { fetchPostcodeAreaSummaries } from '../services/PubService';
import { prefetchLeaderboardCache } from '../services/leaderboardData';
import { serializePostcodeAreaSummaries } from '../screens/map/utils';
import { useAuth } from '../contexts/AuthContext';
import { useUserStats } from '../contexts/UserStatsContext';
import { COLORS } from '../constants/theme';

const withErrorBoundary = (Screen, message) => (props) => (
  <ErrorBoundary fallbackMessage={message}>
    <Screen {...props} />
  </ErrorBoundary>
);

function MapScreenWithBoundary() {
  return (
    <ErrorBoundary fallbackMessage="The map failed to load. Please try again.">
      <MapScreen />
    </ErrorBoundary>
  );
}

const SafeProfileScreen = withErrorBoundary(ProfileScreen, 'Your profile failed to load. Please try again.');
const SafeLeaderboardScreen = withErrorBoundary(LeaderboardScreen, 'The leaderboard failed to load. Please try again.');

const Tab = createBottomTabNavigator();

/** Minimum splash duration so the map can centre on GPS before first reveal. */
const MIN_SPLASH_MS = 850;

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { achievements, totalVisited, drinkStats } = useUserStats();
  const [isLocationLoaded, setIsLocationLoaded] = useState(false);
  const [isInitialPubsLoaded, setIsInitialPubsLoaded] = useState(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [postcodeAreaSummaries, setPostcodeAreaSummaries] = useState([]);
  const [isLoadingPostcodeAreas, setIsLoadingPostcodeAreas] = useState(true);
  const [mapReturnToProfile, setMapReturnToProfile] = useState({
    key: 0,
    baselineScore: 0,
    baselineVisited: 0,
    baselineDrinks: 0,
  });
  const lastFocusedRouteNameRef = useRef(null);
  const hasVisitedMapSinceLastProfileRef = useRef(false);
  const latestAchievementScoreRef = useRef(0);
  const latestTotalVisitedRef = useRef(0);
  const latestDrinksTotalRef = useRef(0);
  const mapTabFocusedScoreBaselineRef = useRef(0);
  const mapTabFocusedVisitedBaselineRef = useRef(0);
  const mapTabFocusedDrinksBaselineRef = useRef(0);

  useEffect(() => {
    latestAchievementScoreRef.current = achievements?.totalScore ?? 0;
  }, [achievements?.totalScore]);

  useEffect(() => {
    latestTotalVisitedRef.current = totalVisited;
  }, [totalVisited]);

  useEffect(() => {
    latestDrinksTotalRef.current = drinkStats?.total ?? 0;
  }, [drinkStats?.total]);

  useEffect(() => {
    let isCancelled = false;

    const loadPostcodeAreaSummaries = async () => {
      try {
        setIsLoadingPostcodeAreas(true);
        const summaries = await fetchPostcodeAreaSummaries(user?.id);
        if (!isCancelled) {
          setPostcodeAreaSummaries((prev) => {
            const nextArray = Array.isArray(summaries) ? summaries : [];
            if (serializePostcodeAreaSummaries(prev) === serializePostcodeAreaSummaries(nextArray)) return prev;
            return nextArray;
          });
        }
      } catch (error) {
        console.error('Error loading postcode area summaries:', error);
        if (!isCancelled) setPostcodeAreaSummaries([]);
      } finally {
        if (!isCancelled) setIsLoadingPostcodeAreas(false);
      }
    };

    loadPostcodeAreaSummaries();

    return () => { isCancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    prefetchLeaderboardCache(user.id);
  }, [user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  const isFullyLoaded = isLocationLoaded && isInitialPubsLoaded && minSplashElapsed;
  
  return (
    <LoadingContext.Provider value={{
      isLocationLoaded,
      setIsLocationLoaded,
      isInitialPubsLoaded,
      setIsInitialPubsLoaded,
      postcodeAreaSummaries,
      isLoadingPostcodeAreas,
    }}>
      <View style={styles.container}>
        <Tab.Navigator
          screenListeners={{
            state: (event) => {
              const state = event?.data?.state;
              if (!state?.routes || typeof state.index !== 'number') return;
              const currentRouteName = state.routes[state.index]?.name;
              if (!currentRouteName) return;

              const previousRouteName = lastFocusedRouteNameRef.current;

              if (currentRouteName === 'Map' && previousRouteName !== 'Map') {
                mapTabFocusedScoreBaselineRef.current = latestAchievementScoreRef.current;
                mapTabFocusedVisitedBaselineRef.current = latestTotalVisitedRef.current;
                mapTabFocusedDrinksBaselineRef.current = latestDrinksTotalRef.current;
                hasVisitedMapSinceLastProfileRef.current = true;
              }

              if (
                currentRouteName === 'Profile' &&
                hasVisitedMapSinceLastProfileRef.current &&
                previousRouteName !== 'Profile'
              ) {
                setMapReturnToProfile((prev) => ({
                  key: prev.key + 1,
                  baselineScore: mapTabFocusedScoreBaselineRef.current,
                  baselineVisited: mapTabFocusedVisitedBaselineRef.current,
                  baselineDrinks: mapTabFocusedDrinksBaselineRef.current,
                }));
                hasVisitedMapSinceLastProfileRef.current = false;
              }

              if (currentRouteName === 'Profile') {
                hasVisitedMapSinceLastProfileRef.current = false;
              }

              lastFocusedRouteNameRef.current = currentRouteName;
            },
          }}
          screenOptions={{
            headerShown: false,
            freezeOnBlur: true,
            tabBarActiveTintColor: COLORS.amber,
            tabBarInactiveTintColor: COLORS.amber,
            tabBarStyle: {
              backgroundColor: COLORS.charcoal,
              borderTopColor: COLORS.charcoal,
              borderTopWidth: 1,
              height: 60 + insets.bottom,
              paddingBottom: Math.max(insets.bottom, 8),
              paddingTop: 8,
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
              color: COLORS.amber,
            },
          }}
        >
          <Tab.Screen 
            name="Map" 
            component={MapScreenWithBoundary}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="map-outline" size={size} color={color} />
              ),
            }}
          />
          <Tab.Screen 
            name="Profile" 
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="account-circle-outline" size={size} color={color} />
              ),
            }}
          >
            {(props) => (
              <SafeProfileScreen
                {...props}
                mapReturnAnimationKey={mapReturnToProfile.key}
                mapReturnBaselineScore={mapReturnToProfile.baselineScore}
                mapReturnBaselineVisited={mapReturnToProfile.baselineVisited}
                mapReturnBaselineDrinks={mapReturnToProfile.baselineDrinks}
              />
            )}
          </Tab.Screen>
          <Tab.Screen 
            name="Leaderboard" 
            component={SafeLeaderboardScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="crown-outline" size={size} color={color} />
              ),
            }}
          />
        </Tab.Navigator>
        {!isFullyLoaded && (
          <View style={styles.loadingContainer}>
            <Image 
              source={require('../assets/pub_icon.png')} 
              style={styles.loadingLogo}
              resizeMode="contain"
            />
            <ActivityIndicator size="large" color={COLORS.amber} style={styles.loadingSpinner} />
          </View>
        )}
      </View>
    </LoadingContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingLogo: {
    width: 150,
    height: 150,
    marginBottom: 30,
  },
  loadingSpinner: {
    marginTop: 10,
  },
});
