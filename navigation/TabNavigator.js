import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ErrorBoundary from '../components/ErrorBoundary';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import AchievementsScreen from '../screens/AchievementsScreen';
import { LoadingContext } from '../contexts/LoadingContext';
import { fetchBoroughSummaries } from '../services/PubService';
import { serializeBoroughSummaries } from '../screens/map/utils';
import { useAuth } from '../contexts/AuthContext';
import { COLORS } from '../constants/theme';

const withErrorBoundary = (Screen, message) => (props) => (
  <ErrorBoundary fallbackMessage={message}>
    <Screen {...props} />
  </ErrorBoundary>
);

const SafeMapScreen = withErrorBoundary(MapScreen, 'The map failed to load. Please try again.');
const SafeProfileScreen = withErrorBoundary(ProfileScreen, 'Your profile failed to load. Please try again.');
const SafeLeaderboardScreen = withErrorBoundary(LeaderboardScreen, 'The leaderboard failed to load. Please try again.');
const SafeAchievementsScreen = withErrorBoundary(AchievementsScreen, 'Achievements failed to load. Please try again.');

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [isLocationLoaded, setIsLocationLoaded] = useState(false);
  const [isInitialPubsLoaded, setIsInitialPubsLoaded] = useState(false);
  const [boroughSummaries, setBoroughSummaries] = useState([]);
  const [isLoadingBoroughs, setIsLoadingBoroughs] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const loadBoroughSummaries = async () => {
      try {
        setIsLoadingBoroughs(true);
        const summaries = await fetchBoroughSummaries(user?.id);
        if (!isCancelled) {
          setBoroughSummaries((prev) => {
            const nextArray = Array.isArray(summaries) ? summaries : [];
            if (serializeBoroughSummaries(prev) === serializeBoroughSummaries(nextArray)) return prev;
            return nextArray;
          });
        }
      } catch (error) {
        console.error('Error loading borough summaries:', error);
        if (!isCancelled) setBoroughSummaries([]);
      } finally {
        if (!isCancelled) setIsLoadingBoroughs(false);
      }
    };

    loadBoroughSummaries();

    return () => { isCancelled = true; };
  }, []);

  const isFullyLoaded = isLocationLoaded && isInitialPubsLoaded;
  
  return (
    <LoadingContext.Provider value={{
      isLocationLoaded,
      setIsLocationLoaded,
      isInitialPubsLoaded,
      setIsInitialPubsLoaded,
      boroughSummaries,
      isLoadingBoroughs,
    }}>
      <View style={styles.container}>
        <Tab.Navigator
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
            component={SafeMapScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="map-outline" size={size} color={color} />
              ),
            }}
          />
          <Tab.Screen 
            name="Profile" 
            component={SafeProfileScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="account-outline" size={size} color={color} />
              ),
            }}
          />
          <Tab.Screen 
            name="Leaderboard" 
            component={SafeLeaderboardScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="podium" size={size} color={color} />
              ),
            }}
          />
          <Tab.Screen 
            name="Achievements" 
            component={SafeAchievementsScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="trophy-outline" size={size} color={color} />
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
