import React from 'react';
import { Image, StyleSheet } from 'react-native';

export default function PintGlassIcon({ size = 24, color = '#2C2C2C', style }) {
  return (
    <Image 
      source={require('../assets/pub_icon.png')}
      style={[
        styles.icon,
        { 
          width: size, 
          height: size,
          tintColor: color
        },
        style
      ]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  icon: {
    // Additional styling if needed
  },
});
