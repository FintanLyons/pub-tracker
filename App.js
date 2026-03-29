import React, { useEffect, useState, useCallback } from 'react';
import { Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider } from 'react-native-paper';
import * as NavigationBar from 'expo-navigation-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ErrorBoundary from './components/ErrorBoundary';
import OfflineOverlay from './components/OfflineOverlay';
import TabNavigator from './navigation/TabNavigator';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { UserStatsProvider } from './contexts/UserStatsContext';
import { LocationProvider } from './contexts/LocationContext';
import { COLORS } from './constants/theme';

function onboardingKeyForUser(userId) {
  return `hasSeenOnboarding:${userId}`;
}

function AppContent() {
  const { user, loading, refreshUser } = useAuth();
  /** null = still reading storage; true/false = done for current user */
  const [userOnboardingDone, setUserOnboardingDone] = useState(null);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync(COLORS.charcoal);
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setUserOnboardingDone(null);
      return;
    }
    const uid = user.id;
    const key = onboardingKeyForUser(uid);
    AsyncStorage.getItem(key).then((v) => {
      setUserOnboardingDone(v === 'true');
    });
  }, [user?.id]);

  const completeOnboarding = useCallback(async () => {
    if (!user?.id) return;
    const key = onboardingKeyForUser(user.id);
    await AsyncStorage.setItem(key, 'true');
    setUserOnboardingDone(true);
  }, [user?.id]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.amber} />
      </View>
    );
  }

  const showUserOnboarding =
    user && userOnboardingDone === false;

  if (user && userOnboardingDone === null) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.amber} />
      </View>
    );
  }

  if (showUserOnboarding) {
    return <OnboardingScreen onComplete={completeOnboarding} />;
  }

  return (
    <NavigationContainer>
      <PaperProvider>
        <View style={styles.appContainer}>
          {user ? (
            <LocationProvider>
              <UserStatsProvider userId={user.id}>
                <TabNavigator />
              </UserStatsProvider>
            </LocationProvider>
          ) : (
            <AuthScreen onAuthSuccess={refreshUser} />
          )}
          <OfflineOverlay />
        </View>
      </PaperProvider>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary fallbackMessage="The app encountered an unexpected error. Please restart.">
        <NetworkProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </NetworkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
});
