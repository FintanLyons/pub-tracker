import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function PintGlassIcon({ size = 24, color = '#2C2C2C', style }) {
  // Using glass-pint-outline from MaterialCommunityIcons
  return (
    <MaterialCommunityIcons 
      name="glass-pint-outline" 
      size={size} 
      color={color} 
      style={style}
    />
  );
}
