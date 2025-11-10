import React, { useEffect } from 'react';
import { Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider } from 'react-native-paper';
import * as NavigationBar from 'expo-navigation-bar';
import TabNavigator from './navigation/TabNavigator';
import AuthScreen from './screens/AuthScreen';
import { AuthProvider, useAuth } from './contexts/AuthContext';

const DARK_CHARCOAL = '#1C1C1C';
const AMBER = '#D4A017';

function AppContent() {
  const { user, loading, refreshUser } = useAuth();

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync(DARK_CHARCOAL);
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={AMBER} />
      </View>
    );
  }

  return (
      <NavigationContainer>
        <PaperProvider>
        {user ? (
          <TabNavigator />
        ) : (
          <AuthScreen onAuthSuccess={refreshUser} />
        )}
        </PaperProvider>
      </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
});