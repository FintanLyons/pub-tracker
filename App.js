import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider } from 'react-native-paper';
import TabNavigator from './navigation/TabNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <PaperProvider>
          <TabNavigator />
        </PaperProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}