import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

/**
 * Shown when the user is signed in on this device but their profile could not be
 * loaded (offline on first launch after install/update). Never signs them out.
 */
export default function ConnectionErrorScreen({ onRetry }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="cloud-off-outline" size={48} color={COLORS.amber} />
      <Text style={styles.title}>Can't connect right now</Text>
      <Text style={styles.body}>
        You're still signed in. We'll carry on as soon as you're back online.
      </Text>
      <TouchableOpacity
        style={[styles.button, retrying && styles.buttonDisabled]}
        onPress={handleRetry}
        disabled={retrying}
        accessibilityRole="button"
      >
        {retrying ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.buttonText}>Try again</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: COLORS.surface,
  },
  title: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.mediumGrey,
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
    minWidth: 160,
    backgroundColor: COLORS.amber,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
