import React from 'react';
import { Image, StyleSheet } from 'react-native';

export default function AreaIcon({ size = 32, color = '#757575', style }) {
  return (
    <Image 
      source={require('../assets/area_icon.png')}
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

