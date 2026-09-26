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
  const [trackWidth, setTrackWidth] = useState(0);

  // Latest values/props for the gesture handlers, which are created once (recreating
  // PanResponders on every render made dragging jittery).
  const valuesRef = useRef({ min: minValue, max: maxValue });
  const propsRef = useRef({ min, max, step, onValueChange, trackWidth: 0 });
  propsRef.current = { min, max, step, onValueChange, trackWidth };
  /** Value of the dragged handle when the drag started. */
  const dragStartRef = useRef(0);

  useEffect(() => {
    setLocalMinValue(minValue);
    setLocalMaxValue(maxValue);
    valuesRef.current = { min: minValue, max: maxValue };
  }, [minValue, maxValue]);

  const trackY = (SLIDER_HEIGHT - TRACK_HEIGHT) / 2;
  const trackCenterY = trackY + TRACK_HEIGHT / 2;

  const getPositionFromValue = (value) => {
    if (trackWidth <= 0 || max <= min) return HANDLE_SIZE / 2;
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return HANDLE_SIZE / 2 + ratio * trackWidth;
  };

  /**
   * Drag handler for one handle. Uses the finger's distance moved (dx) rather than its
   * absolute position, so a stale measurement (e.g. taken mid slide-in animation) can't
   * make the handle jump. Only this component re-renders while dragging; the parent gets
   * the final range on release.
   */
  const makeResponder = (which) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      dragStartRef.current = valuesRef.current[which];
    },
    onPanResponderMove: (_evt, gesture) => {
      const { min: lo, max: hi, step: st, trackWidth: width } = propsRef.current;
      if (width <= 0 || hi <= lo) return;
      const raw = dragStartRef.current + (gesture.dx / width) * (hi - lo);
      const snapped = Math.round(raw / st) * st;
      const current = valuesRef.current;
      if (which === 'min') {
        const next = Math.max(lo, Math.min(snapped, current.max - st));
        if (next !== current.min) {
          valuesRef.current = { ...current, min: next };
          setLocalMinValue(next);
        }
      } else {
        const next = Math.min(hi, Math.max(snapped, current.min + st));
        if (next !== current.max) {
          valuesRef.current = { ...current, max: next };
          setLocalMaxValue(next);
        }
      }
    },
    onPanResponderRelease: () => propsRef.current.onValueChange?.({ ...valuesRef.current }),
    onPanResponderTerminate: () => propsRef.current.onValueChange?.({ ...valuesRef.current }),
  });

  // Lazy: build each responder once (useRef(makeResponder(...)) would rebuild it every render).
  const respondersRef = useRef(null);
  if (!respondersRef.current) {
    respondersRef.current = { min: makeResponder('min'), max: makeResponder('max') };
  }
  const minHandlePanResponder = respondersRef.current.min;
  const maxHandlePanResponder = respondersRef.current.max;

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
        onLayout={(e) => setTrackWidth(Math.max(0, e.nativeEvent.layout.width - HANDLE_SIZE))}
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
