import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, PanResponder } from 'react-native';
import { COLORS } from '../constants/theme';

const HANDLE_SIZE = 32;
const TRACK_HEIGHT = 4;
const HIT_AREA = 44;
const SLIDER_HEIGHT = 50;

export default function RangeSlider({ min, max, minValue, maxValue, onValueChange, step = 1 }) {
  const [localMinValue, setLocalMinValue] = useState(minValue);
  const [localMaxValue, setLocalMaxValue] = useState(maxValue);
  const sliderRef = useRef(null);
  const [sliderLayout, setSliderLayout] = useState({ width: 0, x: 0 });

  useEffect(() => {
    setLocalMinValue(minValue);
    setLocalMaxValue(maxValue);
  }, [minValue, maxValue]);

  const trackY = (SLIDER_HEIGHT - TRACK_HEIGHT) / 2;
  const trackCenterY = trackY + TRACK_HEIGHT / 2;

  const getValueFromPageX = (pageX) => {
    const trackWidth = sliderLayout.width - HANDLE_SIZE;
    if (trackWidth <= 0) return min;

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

  const minHandlePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (evt) => {
      if (sliderLayout.width === 0) return;
      const newValue = getValueFromPageX(evt.nativeEvent.pageX);
      const clampedValue = Math.max(min, Math.min(max, newValue));
      const newMin = Math.min(clampedValue, localMaxValue - step);

      if (newMin !== localMinValue) {
        setLocalMinValue(newMin);
        onValueChange({ min: newMin, max: localMaxValue });
      }
    },
  });

  const maxHandlePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (evt) => {
      if (sliderLayout.width === 0) return;
      const newValue = getValueFromPageX(evt.nativeEvent.pageX);
      const clampedValue = Math.max(min, Math.min(max, newValue));
      const newMax = Math.max(clampedValue, localMinValue + step);

      if (newMax !== localMaxValue) {
        setLocalMaxValue(newMax);
        onValueChange({ min: localMinValue, max: newMax });
      }
    },
  });

  const minPosition = getPositionFromValue(localMinValue);
  const maxPosition = getPositionFromValue(localMaxValue);
  const activeTrackWidth = maxPosition - minPosition;

  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Text style={styles.label}>{localMinValue}</Text>
        <Text style={styles.label}>{localMaxValue}</Text>
      </View>

      <View
        style={styles.sliderContainer}
        ref={sliderRef}
        onLayout={() => {
          sliderRef.current?.measure((fx, fy, fwidth, fheight, px, py) => {
            setSliderLayout({ width: fwidth, x: px });
          });
        }}
      >
        <View
          style={[
            styles.trackBackground,
            { top: trackY },
          ]}
        />

        <View
          style={[
            styles.trackActive,
            {
              left: minPosition,
              width: activeTrackWidth,
              top: trackY,
            },
          ]}
        />

        <View
          style={[
            styles.handleTouchTarget,
            {
              left: minPosition - HIT_AREA / 2,
              top: trackCenterY - HIT_AREA / 2,
            },
          ]}
          {...minHandlePanResponder.panHandlers}
        >
          <View style={styles.handleVisual}>
            <View style={styles.handleInner} />
          </View>
        </View>

        <View
          style={[
            styles.handleTouchTarget,
            {
              left: maxPosition - HIT_AREA / 2,
              top: trackCenterY - HIT_AREA / 2,
            },
          ]}
          {...maxHandlePanResponder.panHandlers}
        >
          <View style={styles.handleVisual}>
            <View style={styles.handleInner} />
          </View>
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
    color: COLORS.charcoal,
  },
  sliderContainer: {
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBackground: {
    position: 'absolute',
    left: HANDLE_SIZE / 2,
    right: HANDLE_SIZE / 2,
    height: TRACK_HEIGHT,
    backgroundColor: COLORS.lightGrey,
    borderRadius: TRACK_HEIGHT / 2,
  },
  trackActive: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    backgroundColor: COLORS.amber,
    borderRadius: TRACK_HEIGHT / 2,
  },
  handleTouchTarget: {
    position: 'absolute',
    width: HIT_AREA,
    height: HIT_AREA,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handleVisual: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: COLORS.amber,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  handleInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.amber,
  },
});
