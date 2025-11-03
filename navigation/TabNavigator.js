import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AchievementsScreen from '../screens/AchievementsScreen';
import { LoadingContext } from '../contexts/LoadingContext';

const Tab = createBottomTabNavigator();

const AMBER = '#D4A017';
const DARK_CHARCOAL = '#1C1C1C';

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  const [isLocationLoaded, setIsLocationLoaded] = useState(false);
  
  return (
    <LoadingContext.Provider value={{ isLocationLoaded, setIsLocationLoaded }}>
      <View style={styles.container}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: AMBER,
            tabBarInactiveTintColor: AMBER,
            tabBarStyle: {
              backgroundColor: DARK_CHARCOAL,
              borderTopColor: DARK_CHARCOAL,
              borderTopWidth: 1,
              height: 60 + insets.bottom,
              paddingBottom: Math.max(insets.bottom, 8),
              paddingTop: 8,
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
              color: AMBER,
            },
          }}
        >
          <Tab.Screen 
            name="Map" 
            component={MapScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="map-outline" size={size} color={color} />
              ),
            }}
          />
          <Tab.Screen 
            name="Achievements" 
            component={AchievementsScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="trophy-outline" size={size} color={color} />
              ),
            }}
          />
          <Tab.Screen 
            name="Profile" 
            component={ProfileScreen}
            options={{
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="account-outline" size={size} color={color} />
              ),
            }}
          />
        </Tab.Navigator>
        {!isLocationLoaded && (
          <View style={styles.loadingContainer}>
            <Image 
              source={require('../assets/pub_icon.png')} 
              style={styles.loadingLogo}
              resizeMode="contain"
            />
            <ActivityIndicator size="large" color={AMBER} style={styles.loadingSpinner} />
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
