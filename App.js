import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Provider as PaperProvider } from 'react-native-paper';
import TabNavigator from './navigation/TabNavigator';

export default function App() {
  return (
    <NavigationContainer>
      <PaperProvider>
        <TabNavigator />
      </PaperProvider>
    </NavigationContainer>
  );
}