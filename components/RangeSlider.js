import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, PanResponder, Dimensions } from 'react-native';

const AMBER = '#D4A017';
const DARK_CHARCOAL = '#1C1C1C';
const MEDIUM_GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';

const HANDLE_SIZE = 32;
const TRACK_HEIGHT = 4;
const HIT_AREA = 44; // Larger touch area for easier dragging

export default function RangeSlider({ min, max, minValue, maxValue, onValueChange, step = 1 }) {
  const [localMinValue, setLocalMinValue] = useState(minValue);
  const [localMaxValue, setLocalMaxValue] = useState(maxValue);
  const sliderRef = useRef(null);
  const [sliderLayout, setSliderLayout] = useState({ width: 0, x: 0 });

  useEffect(() => {
    setLocalMinValue(minValue);
    setLocalMaxValue(maxValue);
  }, [minValue, maxValue]);

  const getValueFromPageX = (pageX) => {
    const trackWidth = sliderLayout.width - HANDLE_SIZE;
    if (trackWidth <= 0) return min;
    
    // Calculate position relative to slider container
    const relativeX = pageX - sliderLayout.x - HANDLE_SIZE / 2;
    const adjustedX = Math.max(0, Math.min(trackWidth, relativeX));
    const ratio = adjustedX / trackWidth;
    const value = min + (max - min) * ratio;
    return Math.round(value / step) * step;
  };

  const getPositionFromValue = (value) => {
    const trackWidth = sliderLayout.width - HANDLE_SIZE;
    if (trackWidth <= 0) return HANDLE_SIZE / 2;
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return HANDLE_SIZE / 2 + ratio * trackWidth;
  };

  // PanResponder for min handle
  const minHandlePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      // Min handle is active
    },
    onPanResponderMove: (evt, gestureState) => {
      if (sliderLayout.width === 0) return;
      const newValue = getValueFromPageX(evt.nativeEvent.pageX);
      const clampedValue = Math.max(min, Math.min(max, newValue));
      const newMin = Math.min(clampedValue, localMaxValue - step);
      
      if (newMin !== localMinValue) {
        setLocalMinValue(newMin);
        onValueChange({ min: newMin, max: localMaxValue });
      }
    },
    onPanResponderRelease: () => {
      // Handle release
    },
  });

  // PanResponder for max handle
  const maxHandlePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      // Max handle is active
    },
    onPanResponderMove: (evt, gestureState) => {
      if (sliderLayout.width === 0) return;
      const newValue = getValueFromPageX(evt.nativeEvent.pageX);
      const clampedValue = Math.max(min, Math.min(max, newValue));
      const newMax = Math.max(clampedValue, localMinValue + step);
      
      if (newMax !== localMaxValue) {
        setLocalMaxValue(newMax);
        onValueChange({ min: localMinValue, max: newMax });
      }
    },
    onPanResponderRelease: () => {
      // Handle release
    },
  });

  const minPosition = getPositionFromValue(localMinValue);
  const maxPosition = getPositionFromValue(localMaxValue);
  const trackWidth = maxPosition - minPosition;

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{localMinValue}</Text>
        <Text style={styles.label}>{localMaxValue}</Text>
      </View>
      
      <View
        style={styles.sliderContainer}
        ref={sliderRef}
        onLayout={(event) => {
          sliderRef.current?.measure((fx, fy, fwidth, fheight, px, py) => {
            setSliderLayout({ width: fwidth, x: px });
          });
        }}
      >
        {/* Track background */}
        <View style={styles.trackBackground} />
        
        {/* Active track */}
        <View
          style={[
            styles.trackActive,
            {
              left: minPosition,
              width: trackWidth,
            },
          ]}
        />
        
        {/* Min handle with its own PanResponder */}
        <View
          style={[
            styles.handle,
            styles.handleHitArea,
            {
              left: minPosition - HANDLE_SIZE / 2,
            },
          ]}
          {...minHandlePanResponder.panHandlers}
        >
          <View style={styles.handleInner} />
        </View>
        
        {/* Max handle with its own PanResponder */}
        <View
          style={[
            styles.handle,
            styles.handleHitArea,
            {
              left: maxPosition - HANDLE_SIZE / 2,
            },
          ]}
          {...maxHandlePanResponder.panHandlers}
        >
          <View style={styles.handleInner} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_CHARCOAL,
  },
  sliderContainer: {
    height: 50,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBackground: {
    position: 'absolute',
    left: HANDLE_SIZE / 2,
    right: HANDLE_SIZE / 2,
    top: (50 - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    backgroundColor: LIGHT_GREY,
    borderRadius: TRACK_HEIGHT / 2,
  },
  trackActive: {
    position: 'absolute',
    top: (50 - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    backgroundColor: AMBER,
    borderRadius: TRACK_HEIGHT / 2,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: AMBER,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    top: (50 - HANDLE_SIZE) / 2,
  },
  handleHitArea: {
    // Expand touch area without visual change
    paddingHorizontal: (HIT_AREA - HANDLE_SIZE) / 2,
    paddingVertical: (HIT_AREA - HANDLE_SIZE) / 2,
    marginHorizontal: -(HIT_AREA - HANDLE_SIZE) / 2,
    marginVertical: -(HIT_AREA - HANDLE_SIZE) / 2,
  },
  handleInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: AMBER,
  },
});

