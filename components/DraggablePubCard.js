import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { 
  View, 
  Text,
  Dimensions, 
  Animated, 
  PanResponder,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Alert
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PubCardContent from './PubCardContent';
import ReportModal from './ReportModal';
import { submitReport } from '../services/ReportService';

const MEDIUM_GREY = '#757575';
const AMBER = '#D4A017';
const TOP_THRESHOLD = 2;
const POSITION_EPSILON = 0.5;

/**
 * DraggablePubCard - A bottom sheet card with three states: hidden, collapsed, expanded
 * Features Google Maps-style behavior: drag down to collapse from anywhere when scrolled to top
 */
export default function DraggablePubCard({ 
  pub, 
  onClose, 
  onToggleVisited,
  onToggleFavorite,
  getImageSource
}) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  
  // Memoize snap positions to ensure they never change - prevents position variance
  const snapPositions = useMemo(() => {
    const cardHeight = screenHeight * 0.33;
    return {
      EXPANDED_Y: 0, // Full screen (top aligns with screen top, padding creates safe area)
      COLLAPSED_Y: screenHeight - cardHeight, // Peek from bottom
      HIDDEN_Y: screenHeight, // Completely hidden below screen
    };
  }, [screenHeight]);
  
  const { EXPANDED_Y, COLLAPSED_Y, HIDDEN_Y } = snapPositions;
  const cardHeight = screenHeight * 0.33;
  const fullHeight = screenHeight - insets.top;
  
  // Single source of truth for card position
  const translateY = useRef(new Animated.Value(HIDDEN_Y)).current;
  
  // Refs for PanResponder to always access current snap positions
  const collapsedYRef = useRef(COLLAPSED_Y);
  const expandedYRef = useRef(EXPANDED_Y);
  const hiddenYRef = useRef(HIDDEN_Y);
  
  // Update refs when snap positions change
  useEffect(() => {
    collapsedYRef.current = COLLAPSED_Y;
    expandedYRef.current = EXPANDED_Y;
    hiddenYRef.current = HIDDEN_Y;
  }, [COLLAPSED_Y, EXPANDED_Y, HIDDEN_Y]);
  
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
      onStartShouldSetPanResponderCapture: (evt) => {
        // Never capture touches - let buttons and other interactive elements handle them first
        // This ensures buttons are immediately responsive
        return false;
      },
      
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        // When expanded, at top, and dragging down - intercept before ScrollView claims it
        const isDraggingVertically = Math.abs(gestureState.dy) > 5;
        const isDraggingDown = gestureState.dy > 5;
        const isDraggingUp = gestureState.dy < -5;
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
        const isDraggingVertically = Math.abs(gestureState.dy) > 10;
        if (isExpandedRef.current) {
          const isAtTop = scrollY.current <= TOP_THRESHOLD;
          const isDraggingDown = gestureState.dy > 10;
          if (isDraggingVertically && isDraggingDown && isAtTop) {
            updateScrollEnabled(false);
            return true;
          }

          const isDraggingUp = gestureState.dy < -6;
          if (isDraggingVertically && isDraggingUp && !scrollEnabledRef.current) {
            updateScrollEnabled(true);
          }
          return false;
        }

        // Handle drags when collapsed
        const isMoreVerticalThanHorizontal = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
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
          
          if (minDist === distToHidden && dragDistance > cardHeight * 0.3) {
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
        
        // Smoother, faster animation
        // When snapping to COLLAPSED_Y, don't use velocity to ensure exact positioning
        const useVelocity = targetY !== currentCollapsedY;
        Animated.spring(translateY, {
          toValue: targetY,
          velocity: useVelocity ? velocity : 0,
          tension: 85,
          friction: 10,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) {
            // Ensure exact position after animation completes
            if (targetY === currentCollapsedY) {
              translateY.setValue(currentCollapsedY);
              dragStartY.current = currentCollapsedY;
              currentPosition.current = currentCollapsedY;
            }
            if (targetY === currentHiddenY) {
            onClose();
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
          useNativeDriver: true,
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
      
      Animated.spring(translateY, {
        toValue: COLLAPSED_Y,
        velocity: 0, // No velocity to ensure exact positioning
        tension: 120,
        friction: 10,
        useNativeDriver: true,
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
        useNativeDriver: true,
      }).start(() => {
        dragStartY.current = HIDDEN_Y;
        currentPosition.current = HIDDEN_Y;
        scrollY.current = 0;
      });
    }
  }, [pub?.id]);
  
  const handleClose = () => {
    updateIsExpanded(false);
    translateY.stopAnimation();
    
    Animated.spring(translateY, {
      toValue: HIDDEN_Y,
      tension: 120,
      friction: 10,
      useNativeDriver: true,
    }).start(() => {
      dragStartY.current = HIDDEN_Y;
      currentPosition.current = HIDDEN_Y;
      scrollY.current = 0;
      updateScrollEnabled(false);
      onClose();
    });
  };

  const handleSendReport = async (reportText) => {
    try {
      await submitReport(pub.id, pub.name, pub.area, reportText);
      
      Alert.alert(
        'Report Submitted',
        'Thank you! Your report has been submitted successfully.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error submitting report:', error);
      
      Alert.alert(
        'Report Failed',
        'Failed to submit report. Please check your internet connection and try again.',
        [{ text: 'OK' }]
      );
    }
  };
  
  // Don't render if no pub (must be after all hooks)
  if (!pub) return null;
  
  return (
    <Animated.View 
      style={[
        styles.cardContainer, 
        { 
          height: fullHeight,
          paddingTop: isExpanded ? insets.top + 8 : 12,
          transform: [{ translateY }]
        }
      ]}
      {...panResponder.panHandlers}
    >
      {/* Report, Favorite, Visited and Close buttons - positioned differently based on state */}
      {isExpanded ? (
        <>
          <TouchableOpacity
            style={[
              styles.visitedButtonTop,
              { top: insets.top + 8 },
              pub.isVisited && styles.visitedButtonTopActive
            ]}
            onPress={() => onToggleVisited(pub.id)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.visitedButtonTopText,
              pub.isVisited && styles.visitedButtonTopTextActive
            ]}>
              {pub.isVisited ? 'Visited' : 'Not Visited'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reportButtonTop, { top: insets.top + 8 }]}
            onPress={() => setReportModalVisible(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons 
              name="flag-outline" 
              size={24} 
              color={MEDIUM_GREY} 
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.favoriteButtonTop, { top: insets.top + 8 }]}
            onPress={() => onToggleFavorite(pub.id)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons 
              name={pub.isFavorite ? "star" : "star-outline"} 
              size={24} 
              color={pub.isFavorite ? AMBER : MEDIUM_GREY} 
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.closeButtonTop, { top: insets.top + 8 }]}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="close" size={24} color={MEDIUM_GREY} />
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TouchableOpacity
            style={[
              styles.visitedButton,
              pub.isVisited && styles.visitedButtonActive
            ]}
            onPress={() => onToggleVisited(pub.id)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.visitedButtonText,
              pub.isVisited && styles.visitedButtonTextActive
            ]}>
              {pub.isVisited ? 'Visited' : 'Not Visited'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.reportButton}
            onPress={() => setReportModalVisible(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons 
              name="flag-outline" 
              size={24} 
              color={MEDIUM_GREY} 
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => onToggleFavorite(pub.id)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons 
              name={pub.isFavorite ? "star" : "star-outline"} 
              size={24} 
              color={pub.isFavorite ? AMBER : MEDIUM_GREY} 
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="close" size={24} color={MEDIUM_GREY} />
          </TouchableOpacity>
        </>
      )}
      
      {/* Invisible overlay to capture drags when collapsed (prevents content from intercepting) */}
      {!isExpanded && (
        <View 
          style={styles.draggableOverlay} 
          pointerEvents="box-only" 
        />
      )}

      {/* Drag handle indicator - positioned between buttons and title */}
      <View style={[
        styles.cardHandleContainer,
        isExpanded && { top: insets.top + 61 } // Keep same visual position as collapsed (12 + 53 = 65, so insets.top + 8 + 53 = insets.top + 61)
      ]}>
        <View style={styles.cardHandle} />
      </View>

      {/* Card content */}
      <PubCardContent
        pub={pub}
        isExpanded={isExpanded}
        getImageSource={getImageSource}
        pointerEvents={!isExpanded ? 'none' : 'auto'}
        onScroll={handleScroll}
        scrollEnabled={scrollEnabled}
        scrollRef={scrollViewRef}
      />

      {/* Report Modal */}
      <ReportModal
        visible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        onSend={handleSendReport}
        pubName={pub.name}
        pubArea={pub.area}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
    overflow: 'hidden',
    zIndex: 1000,
  },
  cardHandleContainer: {
    position: 'absolute',
    top: 65, // Moved higher up now that buttons have moved up (buttons at top ~12, height ~40)
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 8,
  },
  cardHandle: {
    width: 40,
    height: 4,
    backgroundColor: MEDIUM_GREY,
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
    elevation: 5,
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
    elevation: 5,
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
    elevation: 5,
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
    elevation: 5,
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
    elevation: 5,
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
    elevation: 5,
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
    elevation: 5,
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
