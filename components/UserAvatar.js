import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

export default function UserAvatar({ avatarUrl, size = 48, iconSize = 28, style }) {
  const radius = size / 2;

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: COLORS.lightGrey,
          },
          style,
        ]}
        contentFit="cover"
        transition={120}
      />
    );
  }

  return (
    <View
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius: radius },
        style,
      ]}
    >
      <MaterialCommunityIcons name="account-outline" size={iconSize} color={COLORS.mediumGrey} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
