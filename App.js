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
import ChooseUsernameScreen from './screens/ChooseUsernameScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { UserStatsProvider } from './contexts/UserStatsContext';
import { LocationProvider } from './contexts/LocationContext';
import { COLORS } from './constants/theme';
import { isValidUsernameFormat } from './services/SecureAuthService';

function onboardingKeyForUser(userId) {
  return `hasSeenOnboarding:${userId}`;
}

/**
 * Choose username before onboarding/tabs when:
 * - New signup set app_username_chosen === false in auth metadata, or
 * - DB username missing/empty, or
 * - DB username is not a valid app handle (common trigger placeholders e.g. email local-part with dots).
 *
 * If metadata is still false but public.users already has a valid handle (e.g. metadata sync deferred),
 * do not block — avoids spinner after successful UPDATE.
 */
function needsUsername(user) {
  if (!user) return false;

  const raw = user.username;
  const trimmed = raw == null ? '' : String(raw).trim();
  const hasValidHandle = trimmed !== '' && isValidUsernameFormat(trimmed);

  if (user.appUsernameChosen === false) {
    if (hasValidHandle) return false;
    return true;
  }

  if (trimmed === '') return true;
  if (!isValidUsernameFormat(trimmed)) return true;
  return false;
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

  if (!user) {
    return (
      <PaperProvider>
        <View style={styles.appContainer}>
          <AuthScreen onAuthSuccess={refreshUser} />
          <OfflineOverlay />
        </View>
      </PaperProvider>
    );
  }

  if (needsUsername(user)) {
    return (
      <PaperProvider>
        <View style={styles.appContainer}>
          <ChooseUsernameScreen />
          <OfflineOverlay />
        </View>
      </PaperProvider>
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
          <LocationProvider>
            <UserStatsProvider userId={user.id}>
              <TabNavigator />
            </UserStatsProvider>
          </LocationProvider>
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
