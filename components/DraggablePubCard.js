import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Dimensions,
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Platform,
} from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PubCardContent from './PubCardContent';
import PubReportFormModal from './PubReportFormModal';
import AppFeedbackModal from './AppFeedbackModal';
import { submitPubReport } from '../services/ReportService';
import { COLORS } from '../constants/theme';

/** Native driver for sheet translateY; header actions use RNGH Pressable for Android hit-testing. */
const SHEET_USE_NATIVE_DRIVER = true;

/**
 * Header chrome buttons — RNGH Pressable aligns touches with native-driver translateY on Android.
 * @param {'icon' | 'pill'} variant — icon: ripple on Android; pill (Visited): scale only.
 */
function SheetActionPressable({ style, onPress, children, variant = 'icon' }) {
  const androidRipple =
    variant === 'icon' && Platform.OS === 'android'
      ? { color: 'rgba(28, 28, 28, 0.1)' }
      : undefined;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      android_ripple={androidRipple}
      style={({ pressed }) => [
        style,
        pressed && variant === 'pill' && styles.sheetPillPressed,
      ]}
    >
      {children}
    </Pressable>
  );
}
const TOP_THRESHOLD = 2;
const POSITION_EPSILON = 0.5;
/** Sheet drag must be clearly vertical — avoids stealing horizontal photo swipes. */
const SHEET_DRAG_MIN_DY = 16;
const SHEET_DRAG_AXIS_RATIO = 2.0;
const SHEET_CAPTURE_MIN_DY = 10;
/** Space between safe-area inset (status bar / notch) and the expanded header row */
const EXPANDED_TOP_GAP = 8;
/** Approx. height of expanded visited + icon row (minHeight + vertical padding) */
const EXPANDED_ACTION_ROW_HEIGHT = 60;
const EXPANDED_HANDLE_GAP = 8;

/**
 * DraggablePubCard - A bottom sheet card with three states: hidden, collapsed, expanded
 * Features Google Maps-style behavior: drag down to collapse from anywhere when scrolled to top
 */
export default function DraggablePubCard({ 
  pub, 
  containerHeight,
  translateY,
  collapseRequest = 0,
  onCloseStart,
  onClose,
  onToggleVisited,
  onToggleFavorite,
  getImageSource
}) {
  const insets = useSafeAreaInsets();
  // Sheet is positioned inside the map tab, not the full window — using window height
  // made the card taller than its parent so the top sat under the status bar / camera cutout.
  const parentHeight = containerHeight > 0 ? containerHeight : Dimensions.get('window').height;
  
  // Memoize snap positions to ensure they never change - prevents position variance
  const snapPositions = useMemo(() => {
    const peek = parentHeight * 0.33;
    // Full parent height so the sheet background covers the map; content inset uses EXPANDED_TOP_GAP + insets.
    const fullH = Math.max(parentHeight, peek + 1);
    return {
      EXPANDED_Y: 0,
      COLLAPSED_Y: fullH - peek,
      HIDDEN_Y: fullH,
      fullHeight: fullH,
      peekHeight: peek,
    };
  }, [parentHeight]);
  
  const { EXPANDED_Y, COLLAPSED_Y, HIDDEN_Y, fullHeight, peekHeight } = snapPositions;
  
  // Refs for PanResponder to always access current snap positions
  const collapsedYRef = useRef(COLLAPSED_Y);
  const expandedYRef = useRef(EXPANDED_Y);
  const hiddenYRef = useRef(HIDDEN_Y);
  const peekHeightRef = useRef(peekHeight);
  
  // Update refs when snap positions change
  useEffect(() => {
    collapsedYRef.current = COLLAPSED_Y;
    expandedYRef.current = EXPANDED_Y;
    hiddenYRef.current = HIDDEN_Y;
    peekHeightRef.current = peekHeight;
  }, [COLLAPSED_Y, EXPANDED_Y, HIDDEN_Y, peekHeight]);
  
  // State management
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(false); // Ref for PanResponder to access current value
  const dragStartY = useRef(HIDDEN_Y); // Track where drag started
  const currentPosition = useRef(HIDDEN_Y); // Track current position
  const scrollY = useRef(0); // Track scroll position
  const [scrollEnabled, setScrollEnabled] = useState(false); // Control ScrollView scrolling
  const scrollEnabledRef = useRef(false); // Ref for PanResponder to access current value
  const scrollViewRef = useRef(null);
  const [reportModalVisible, setReportModalVisible] = useState(false); // Control report modal visibility
  const [reportSubmittedVisible, setReportSubmittedVisible] = useState(false);
  const [blockingOverlayOpen, setBlockingOverlayOpen] = useState(false);
  const blockingOverlayOpenRef = useRef(false);
  useEffect(() => {
    blockingOverlayOpenRef.current = blockingOverlayOpen;
  }, [blockingOverlayOpen]);

  /** PanResponder is created once; keep latest pub id for close callbacks. */
  const pubIdRef = useRef(pub?.id);
  const onCloseStartRef = useRef(onCloseStart);
  useEffect(() => {
    pubIdRef.current = pub?.id;
  }, [pub?.id]);
  useEffect(() => {
    onCloseStartRef.current = onCloseStart;
  }, [onCloseStart]);

  const updateIsExpanded = useCallback((value) => {
    if (isExpandedRef.current !== value) {
      isExpandedRef.current = value;
      setIsExpanded(value);
    }
  }, [setIsExpanded]);

  const updateScrollEnabled = useCallback((value) => {
    if (scrollEnabledRef.current !== value) {
      if (scrollViewRef.current) {
        scrollViewRef.current.setNativeProps({ scrollEnabled: value });
      }
      scrollEnabledRef.current = value;
      setScrollEnabled(value);
    }
  }, [setScrollEnabled]);

  // Keep refs in sync with state changes that bypass the helpers (safety net)
  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  useEffect(() => {
    scrollEnabledRef.current = scrollEnabled;
  }, [scrollEnabled]);
  
  // Handle scroll events - dynamically manage scroll enable/disable
  const handleScroll = useCallback((event) => {
    const newScrollY = event.nativeEvent.contentOffset.y;
    scrollY.current = newScrollY;

    // When at top, disable scrolling so parent can intercept downward drags
    if (isExpandedRef.current) {
      if (newScrollY <= TOP_THRESHOLD) {
        updateScrollEnabled(false);
      } else {
        updateScrollEnabled(true);
      }
    }
  }, [updateScrollEnabled]);

  // Pan responder - handles all touch gestures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        if (blockingOverlayOpenRef.current) return false;
        return false;
      },

      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        if (blockingOverlayOpenRef.current) return false;
        const ax = Math.abs(gestureState.dx);
        const ay = Math.abs(gestureState.dy);
        const isHorizontalDominant = ax > ay * SHEET_DRAG_AXIS_RATIO && ax > 12;

        if (isHorizontalDominant) return false;

        const isDraggingVertically = ay > SHEET_CAPTURE_MIN_DY;
        const isDraggingDown = gestureState.dy > SHEET_CAPTURE_MIN_DY;
        const isDraggingUp = gestureState.dy < -SHEET_CAPTURE_MIN_DY;
        const isAtTop = scrollY.current <= TOP_THRESHOLD;

        if (
          isExpandedRef.current &&
          !scrollEnabledRef.current &&
          isDraggingUp &&
          isDraggingVertically
        ) {
          updateScrollEnabled(true);
          return false;
        }

        return (
          isExpandedRef.current &&
          (isAtTop || !scrollEnabledRef.current) &&
          isDraggingDown &&
          isDraggingVertically
        );
      },
      
      onStartShouldSetPanResponder: (evt) => {
        // Never start responder on initial touch - let buttons handle it
        return false;
      },
      
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (blockingOverlayOpenRef.current) return false;
        const ax = Math.abs(gestureState.dx);
        const ay = Math.abs(gestureState.dy);
        const isHorizontalDominant = ax > ay * SHEET_DRAG_AXIS_RATIO && ax > 12;

        if (isHorizontalDominant) return false;

        const isDraggingVertically = ay > SHEET_DRAG_MIN_DY;
        if (isExpandedRef.current) {
          const isAtTop = scrollY.current <= TOP_THRESHOLD;
          const isDraggingDown = gestureState.dy > SHEET_DRAG_MIN_DY;
          if (isDraggingVertically && isDraggingDown && isAtTop) {
            updateScrollEnabled(false);
            return true;
          }

          const isDraggingUp = gestureState.dy < -SHEET_DRAG_MIN_DY;
          if (isDraggingVertically && isDraggingUp && !scrollEnabledRef.current) {
            updateScrollEnabled(true);
          }
          return false;
        }

        // Handle drags when collapsed
        const isMoreVerticalThanHorizontal = ay > ax * SHEET_DRAG_AXIS_RATIO;
        return isDraggingVertically && isMoreVerticalThanHorizontal;
      },
      
      onPanResponderGrant: () => {
        translateY.stopAnimation(value => {
          dragStartY.current = value;
          currentPosition.current = value;
        });
      },
      
      onPanResponderMove: (_, gestureState) => {
        let newY = dragStartY.current + gestureState.dy;
        
        // Clamp to valid range with rubber-band effect at edges
        const currentExpandedY = expandedYRef.current;
        const currentHiddenY = hiddenYRef.current;
        if (newY < currentExpandedY) {
          // Rubber band at top
          const overflow = currentExpandedY - newY;
          newY = currentExpandedY - overflow * 0.3; // Resistance factor
        } else if (newY > currentHiddenY) {
          // Rubber band at bottom
          const overflow = newY - currentHiddenY;
          newY = currentHiddenY + overflow * 0.3; // Resistance factor
        }

        if (Math.abs(newY - currentPosition.current) < POSITION_EPSILON) {
          return;
        }
        
        currentPosition.current = newY;
        translateY.setValue(newY);
      },
      
      onPanResponderRelease: (_, gestureState) => {
        const velocity = gestureState.vy;
        const dragDistance = gestureState.dy;
        const finalPosition = currentPosition.current;
        
        // Use refs to ensure we always have current snap positions
        const currentCollapsedY = collapsedYRef.current;
        const currentExpandedY = expandedYRef.current;
        const currentHiddenY = hiddenYRef.current;
        
        let targetY = currentCollapsedY;
        let willBeExpanded = false;
        
        // High velocity swipe - use velocity to determine direction
        if (Math.abs(velocity) > 0.7) {
          if (velocity < 0) {
            targetY = currentExpandedY;
            willBeExpanded = true;
          } else {
            if (dragStartY.current < currentCollapsedY * 0.5) {
              targetY = currentCollapsedY;
            } else {
              targetY = currentHiddenY;
            }
          }
        } else {
          // Slow drag - snap to nearest position
          const distToExpanded = Math.abs(finalPosition - currentExpandedY);
          const distToCollapsed = Math.abs(finalPosition - currentCollapsedY);
          const distToHidden = Math.abs(finalPosition - currentHiddenY);
          const minDist = Math.min(distToExpanded, distToCollapsed, distToHidden);
          
          if (minDist === distToHidden && dragDistance > peekHeightRef.current * 0.3) {
            targetY = currentHiddenY;
          } else if (minDist === distToExpanded) {
            targetY = currentExpandedY;
            willBeExpanded = true;
          } else {
            targetY = currentCollapsedY;
          }
        }
        
        updateIsExpanded(willBeExpanded);
        dragStartY.current = targetY;
        currentPosition.current = targetY;
        
        // Enable scrolling when expanding (auto-disabled when reaching top)
        if (willBeExpanded) {
          updateScrollEnabled(scrollY.current > 0);
        } else {
          updateScrollEnabled(false);
          scrollY.current = 0;
        }
        
        if (targetY === currentHiddenY) {
          onCloseStartRef.current?.(pubIdRef.current);
        }

        // Smoother, faster animation
        // When snapping to COLLAPSED_Y, don't use velocity to ensure exact positioning
        const useVelocity = targetY !== currentCollapsedY;
        Animated.spring(translateY, {
          toValue: targetY,
          velocity: useVelocity ? velocity : 0,
          tension: 85,
          friction: 10,
          useNativeDriver: SHEET_USE_NATIVE_DRIVER,
        }).start(({ finished }) => {
          if (finished) {
            // Ensure exact position after animation completes
            if (targetY === currentCollapsedY) {
              translateY.setValue(currentCollapsedY);
              dragStartY.current = currentCollapsedY;
              currentPosition.current = currentCollapsedY;
            }
            if (targetY === currentHiddenY) {
              onClose(pubIdRef.current);
            }
          }
        });
      },
      
      onPanResponderTerminationRequest: () => false,
      
      onPanResponderTerminate: () => {
        const snapBackY = dragStartY.current;
        const currentCollapsedY = collapsedYRef.current;
        Animated.spring(translateY, {
          toValue: snapBackY,
          velocity: snapBackY === currentCollapsedY ? 0 : undefined, // No velocity for COLLAPSED_Y
          tension: 85,
          friction: 10,
          useNativeDriver: SHEET_USE_NATIVE_DRIVER,
        }).start(({ finished }) => {
          if (finished && snapBackY === currentCollapsedY) {
            // Ensure exact position after animation completes
            translateY.setValue(currentCollapsedY);
            dragStartY.current = currentCollapsedY;
            currentPosition.current = currentCollapsedY;
          }
        });
      },
    })
  ).current;
  
  // Show/hide card when pub changes
  useEffect(() => {
    if (pub) {
      updateIsExpanded(false);
      dragStartY.current = COLLAPSED_Y;
      currentPosition.current = COLLAPSED_Y;
      scrollY.current = 0;
      updateScrollEnabled(false);
      
      translateY.stopAnimation();
      
      Animated.timing(translateY, {
        toValue: COLLAPSED_Y,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: SHEET_USE_NATIVE_DRIVER,
      }).start(({ finished }) => {
        if (finished) {
          // Ensure exact position after animation completes
          translateY.setValue(COLLAPSED_Y);
          dragStartY.current = COLLAPSED_Y;
          currentPosition.current = COLLAPSED_Y;
        }
      });
    } else {
      Animated.spring(translateY, {
        toValue: HIDDEN_Y,
        tension: 120,
        friction: 10,
        useNativeDriver: SHEET_USE_NATIVE_DRIVER,
      }).start(() => {
        dragStartY.current = HIDDEN_Y;
        currentPosition.current = HIDDEN_Y;
        scrollY.current = 0;
      });
    }
  }, [pub?.id]);

  // External request to collapse sheet should use the same internal state transition
  // as gesture snaps (expanded chrome -> collapsed chrome + correct layout metrics).
  useEffect(() => {
    if (!pub || !isExpandedRef.current) return;
    const currentCollapsedY = collapsedYRef.current;
    translateY.stopAnimation();
    updateIsExpanded(false);
    updateScrollEnabled(false);
    scrollY.current = 0;
    Animated.timing(translateY, {
      toValue: currentCollapsedY,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: SHEET_USE_NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (!finished) return;
      translateY.setValue(currentCollapsedY);
      dragStartY.current = currentCollapsedY;
      currentPosition.current = currentCollapsedY;
    });
  // `pub` intentionally excluded — using `pub?.id` so property-only changes (isVisited, isFavorite)
  // do not re-trigger this collapse effect; only a different pub identity should.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseRequest, pub?.id, translateY, updateIsExpanded, updateScrollEnabled]);
  
  const handleClose = () => {
    const closingPubId = pub?.id;
    onCloseStartRef.current?.(closingPubId);
    translateY.stopAnimation();

    Animated.spring(translateY, {
      toValue: HIDDEN_Y,
      tension: 120,
      friction: 10,
      useNativeDriver: SHEET_USE_NATIVE_DRIVER,
    }).start(() => {
      dragStartY.current = HIDDEN_Y;
      currentPosition.current = HIDDEN_Y;
      scrollY.current = 0;
      updateScrollEnabled(false);
      // Reset expansion only after the sheet is off-screen. Doing this at the start of handleClose
      // swapped expanded → collapsed chrome immediately, unmounting the X you tapped and often
      // cancelling the press / making a second tap on the peek close feel necessary.
      updateIsExpanded(false);
      onClose(closingPubId);
    });
  };

  const handlePubCorrectionSubmit = useCallback(
    async (payload) => {
      await submitPubReport({
        reportType: 'pub_correction',
        pubId: pub.id,
        pubName: payload.pubName,
        pubArea: pub.area || 'Unknown Area',
        chainOrIndependent: payload.chainOrIndependent,
        founded: payload.founded,
        address: payload.address,
        website: payload.website,
        phone: payload.phone,
        closingTime: payload.closingTime,
        history: payload.history,
        features: payload.features,
        imageUris: payload.imageUris,
        stillOperating: payload.stillOperating,
      });
    },
    [pub]
  );

  // Don't render if no pub (must be after all hooks)
  if (!pub) return null;

  // RN positions `absolute` children vs the parent's border, not below padding — use explicit insets.
  const expandedHeaderTop = insets.top + EXPANDED_TOP_GAP;
  const expandedHandleTop = expandedHeaderTop + EXPANDED_ACTION_ROW_HEIGHT + EXPANDED_HANDLE_GAP;
  
  return (
    <Animated.View
      collapsable={false}
      // Android: cache this subtree as a GPU texture while translateY updates (cheap compositing).
      // iOS: keep transform on this layer with minimal non-animated props for Core Animation.
      renderToHardwareTextureAndroid
      style={[
        styles.cardSheet,
        {
          height: fullHeight,
          transform: [{ translateY }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <View
        style={[
          styles.cardChrome,
          {
            paddingTop: isExpanded ? expandedHeaderTop : 12,
            borderTopLeftRadius: isExpanded ? 0 : 20,
            borderTopRightRadius: isExpanded ? 0 : 20,
          },
        ]}
      >
      {/* Report, Favorite, Visited and Close buttons - positioned differently based on state */}
      {isExpanded ? (
        <>
          <SheetActionPressable
            variant="pill"
            style={[
              styles.visitedButtonTop,
              { top: expandedHeaderTop },
              pub.isVisited && styles.visitedButtonTopActive
            ]}
            onPress={() => onToggleVisited(pub.id)}
          >
            <Text style={[
              styles.visitedButtonTopText,
              pub.isVisited && styles.visitedButtonTopTextActive
            ]}>
              {pub.isVisited ? 'Visited' : 'Not Visited'}
            </Text>
          </SheetActionPressable>
          <SheetActionPressable
            style={[styles.reportButtonTop, { top: expandedHeaderTop }]}
            onPress={() => setReportModalVisible(true)}
          >
            <MaterialCommunityIcons 
              name="flag-outline" 
              size={24} 
              color={COLORS.mediumGrey} 
            />
          </SheetActionPressable>
          <SheetActionPressable
            style={[styles.favoriteButtonTop, { top: expandedHeaderTop }]}
            onPress={() => onToggleFavorite(pub.id)}
          >
            <MaterialCommunityIcons 
              name={pub.isFavorite ? "star" : "star-outline"} 
              size={24} 
              color={pub.isFavorite ? COLORS.amber : COLORS.mediumGrey} 
            />
          </SheetActionPressable>
          <SheetActionPressable
            style={[styles.closeButtonTop, { top: expandedHeaderTop }]}
            onPress={handleClose}
          >
            <MaterialCommunityIcons name="close" size={24} color={COLORS.mediumGrey} />
          </SheetActionPressable>
        </>
      ) : (
        <>
          <SheetActionPressable
            variant="pill"
            style={[
              styles.visitedButton,
              pub.isVisited && styles.visitedButtonActive
            ]}
            onPress={() => onToggleVisited(pub.id)}
          >
            <Text style={[
              styles.visitedButtonText,
              pub.isVisited && styles.visitedButtonTextActive
            ]}>
              {pub.isVisited ? 'Visited' : 'Not Visited'}
            </Text>
          </SheetActionPressable>
          <SheetActionPressable
            style={styles.reportButton}
            onPress={() => setReportModalVisible(true)}
          >
            <MaterialCommunityIcons 
              name="flag-outline" 
              size={24} 
              color={COLORS.mediumGrey} 
            />
          </SheetActionPressable>
          <SheetActionPressable
            style={styles.favoriteButton}
            onPress={() => onToggleFavorite(pub.id)}
          >
            <MaterialCommunityIcons 
              name={pub.isFavorite ? "star" : "star-outline"} 
              size={24} 
              color={pub.isFavorite ? COLORS.amber : COLORS.mediumGrey} 
            />
          </SheetActionPressable>
          <SheetActionPressable
            style={styles.closeButton}
            onPress={handleClose}
          >
            <MaterialCommunityIcons name="close" size={24} color={COLORS.mediumGrey} />
          </SheetActionPressable>
        </>
      )}
      
      {/* Invisible overlay to capture drags when collapsed (prevents content from intercepting) */}
      {!isExpanded && !blockingOverlayOpen && (
        <View 
          style={styles.draggableOverlay} 
          pointerEvents="box-only" 
        />
      )}

      {/* Drag handle indicator - positioned between buttons and title */}
      <View style={[styles.cardHandleContainer, isExpanded && { top: expandedHandleTop }]}>
        <View style={styles.cardHandle} />
      </View>

      {/* Card content */}
      <PubCardContent
        pub={pub}
        isExpanded={isExpanded}
        getImageSource={getImageSource}
        pointerEvents={blockingOverlayOpen || !isExpanded ? 'none' : 'auto'}
        onScroll={handleScroll}
        scrollEnabled={scrollEnabled && !blockingOverlayOpen}
        scrollRef={scrollViewRef}
        onToggleVisited={onToggleVisited}
        onBlockingOverlayVisibleChange={setBlockingOverlayOpen}
      />

      {blockingOverlayOpen && (
        <View style={styles.modalBlockOverlay} pointerEvents="box-only" />
      )}

      <PubReportFormModal
        visible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        mode="pub_correction"
        initialPub={pub}
        onSubmit={handlePubCorrectionSubmit}
        onSuccess={() => setReportSubmittedVisible(true)}
      />
      <AppFeedbackModal
        visible={reportSubmittedVisible}
        title="Report submitted"
        message="Thank you! Your report has been submitted."
        onClose={() => setReportSubmittedVisible(false)}
      />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheetPillPressed: {
    transform: [{ scale: 0.98 }],
  },
  modalBlockOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 500,
    elevation: 500,
    backgroundColor: 'transparent',
  },
  /** Outer sheet: transform + size only — avoids mixing layout props with GPU translate. */
  cardSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1100,
  },
  /** Inner chrome: shadows / elevation stay off the transform layer for better compositing. */
  cardChrome: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    ...Platform.select({
      android: { elevation: 8 },
      default: {},
    }),
    paddingHorizontal: 16,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  cardHandleContainer: {
    position: 'absolute',
    top: 65, // Collapsed: below button row (~12 + ~40 + gap)
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 8,
  },
  cardHandle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.mediumGrey,
    borderRadius: 2,
    opacity: 0.5,
  },
  reportButton: {
    position: 'absolute',
    top: 12, // Moved closer to top
    right: 112, // Match expanded position
    zIndex: 10,
    padding: 8, // Match expanded padding
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Match expanded styling
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 0,
  },
  reportButtonTop: {
    position: 'absolute',
    right: 112,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 0,
  },
  favoriteButton: {
    position: 'absolute',
    top: 12, // Moved closer to top
    right: 64, // Match expanded position
    zIndex: 10,
    padding: 8, // Match expanded padding
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Match expanded styling
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 0,
  },
  favoriteButtonTop: {
    position: 'absolute',
    right: 64,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 0,
  },
  closeButton: {
    position: 'absolute',
    top: 12, // Moved closer to top
    right: 16,
    zIndex: 10,
    padding: 8, // Match expanded padding
    backgroundColor: 'rgba(255, 255, 255, 0.9)', // Match expanded styling
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 0,
  },
  closeButtonTop: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 0,
  },
  draggableOverlay: {
    position: 'absolute',
    top: 80, // Below handle and buttons (increased to accommodate larger button area)
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    backgroundColor: 'transparent',
  },
  visitedButton: {
    position: 'absolute',
    top: 12, // Moved closer to top
    left: 16, // Start from left margin
    right: 160, // End with 48px gap from report button (112 + 48 = 160)
    zIndex: 10,
    paddingVertical: 10, // Increased from 6
    paddingHorizontal: 16,
    backgroundColor: '#F5F5F5',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#2C2C2C',
    minHeight: 40, // Ensure minimum height
    justifyContent: 'center', // Center content vertically
    alignItems: 'center', // Center content horizontally
  },
  visitedButtonActive: {
    backgroundColor: '#2C2C2C',
    borderColor: '#2C2C2C',
  },
  visitedButtonText: {
    fontSize: 16, // Increased from 14
    fontWeight: '600',
    color: '#2C2C2C',
    textAlign: 'center', // Center text horizontally
  },
  visitedButtonTextActive: {
    color: '#FFFFFF',
  },
  visitedButtonTop: {
    position: 'absolute',
    left: 16, // Start from left margin
    right: 160, // End with 48px gap from report button (112 + 48 = 160)
    zIndex: 10,
    paddingVertical: 10, // Increased from 6
    paddingHorizontal: 16,
    backgroundColor: '#F5F5F5',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#2C2C2C',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 0,
    minHeight: 40, // Ensure minimum height
    justifyContent: 'center', // Center content vertically
    alignItems: 'center', // Center content horizontally
  },
  visitedButtonTopActive: {
    backgroundColor: '#2C2C2C',
    borderColor: '#2C2C2C',
  },
  visitedButtonTopText: {
    fontSize: 16, // Increased from 14
    fontWeight: '600',
    color: '#2C2C2C',
    textAlign: 'center', // Center text horizontally
  },
  visitedButtonTopTextActive: {
    color: '#FFFFFF',
  },
});
