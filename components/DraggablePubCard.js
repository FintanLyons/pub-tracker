import React, { useRef, useEffect, useState } from 'react';
import { 
  View, 
  Dimensions, 
  Animated, 
  PanResponder,
  TouchableOpacity,
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
  const cardHeight = screenHeight * 0.33;
  const fullHeight = screenHeight - insets.top;
  
  // Snap positions - these define where the card can rest
  const EXPANDED_Y = 0; // Full screen (top aligns with screen top, padding creates safe area)
  const COLLAPSED_Y = screenHeight - cardHeight; // Peek from bottom
  const HIDDEN_Y = screenHeight; // Completely hidden below screen
  
  // Single source of truth for card position
  const translateY = useRef(new Animated.Value(HIDDEN_Y)).current;
  
  // State management
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(false); // Ref for PanResponder to access current value
  const dragStartY = useRef(HIDDEN_Y); // Track where drag started
  const currentPosition = useRef(HIDDEN_Y); // Track current position
  const scrollY = useRef(0); // Track scroll position
  const [scrollEnabled, setScrollEnabled] = useState(true); // Control ScrollView scrolling
  const scrollEnabledRef = useRef(true); // Ref for PanResponder to access current value
  const [reportModalVisible, setReportModalVisible] = useState(false); // Control report modal visibility
  
  // Keep refs in sync with state
  useEffect(() => {
    isExpandedRef.current = isExpanded;
    scrollEnabledRef.current = scrollEnabled;
  }, [isExpanded, scrollEnabled]);
  
  // Handle scroll events - dynamically manage scroll enable/disable
  const handleScroll = (event) => {
    const newScrollY = event.nativeEvent.contentOffset.y;
    scrollY.current = newScrollY;
    
    // When at top, disable scrolling so parent can intercept downward drags
    if (isExpandedRef.current) {
      if (newScrollY <= 0 && scrollEnabled) {
        setScrollEnabled(false);
      } else if (newScrollY > 0 && !scrollEnabled) {
        setScrollEnabled(true);
      }
    }
  };

  // Pan responder - handles all touch gestures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        // When expanded, at top, and dragging down - intercept before ScrollView claims it
        const isDraggingVertically = Math.abs(gestureState.dy) > 5;
        const isDraggingDown = gestureState.dy > 5;
        return (
          isExpandedRef.current &&
          !scrollEnabledRef.current &&
          isDraggingDown &&
          isDraggingVertically
        );
      },
      
      onStartShouldSetPanResponder: () => false,
      
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Handle drags when collapsed
        const isDraggingVertically = Math.abs(gestureState.dy) > 5;
        const isMoreVerticalThanHorizontal = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
        return !isExpandedRef.current && isDraggingVertically && isMoreVerticalThanHorizontal;
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
        if (newY < EXPANDED_Y) {
          // Rubber band at top
          const overflow = EXPANDED_Y - newY;
          newY = EXPANDED_Y - overflow * 0.3; // Resistance factor
        } else if (newY > HIDDEN_Y) {
          // Rubber band at bottom
          const overflow = newY - HIDDEN_Y;
          newY = HIDDEN_Y + overflow * 0.3; // Resistance factor
        }
        
        currentPosition.current = newY;
        translateY.setValue(newY);
      },
      
      onPanResponderRelease: (_, gestureState) => {
        const velocity = gestureState.vy;
        const dragDistance = gestureState.dy;
        const finalPosition = currentPosition.current;
        
        let targetY = COLLAPSED_Y;
        let willBeExpanded = false;
        
        // High velocity swipe - use velocity to determine direction
        if (Math.abs(velocity) > 0.7) {
          if (velocity < 0) {
            targetY = EXPANDED_Y;
            willBeExpanded = true;
          } else {
            if (dragStartY.current < COLLAPSED_Y * 0.5) {
              targetY = COLLAPSED_Y;
            } else {
              targetY = HIDDEN_Y;
            }
          }
        } else {
          // Slow drag - snap to nearest position
          const distToExpanded = Math.abs(finalPosition - EXPANDED_Y);
          const distToCollapsed = Math.abs(finalPosition - COLLAPSED_Y);
          const distToHidden = Math.abs(finalPosition - HIDDEN_Y);
          const minDist = Math.min(distToExpanded, distToCollapsed, distToHidden);
          
          if (minDist === distToHidden && dragDistance > cardHeight * 0.3) {
            targetY = HIDDEN_Y;
          } else if (minDist === distToExpanded) {
            targetY = EXPANDED_Y;
            willBeExpanded = true;
          } else {
            targetY = COLLAPSED_Y;
          }
        }
        
        setIsExpanded(willBeExpanded);
        dragStartY.current = targetY;
        currentPosition.current = targetY;
        
        // Enable scrolling when expanding (auto-disabled when reaching top)
        if (willBeExpanded) {
          setScrollEnabled(true);
        }
        
        // Smoother, faster animation
        Animated.spring(translateY, {
          toValue: targetY,
          velocity: velocity,
          tension: 85,
          friction: 10,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && targetY === HIDDEN_Y) {
            onClose();
          }
        });
      },
      
      onPanResponderTerminationRequest: () => false,
      
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: dragStartY.current,
          tension: 85,
          friction: 10,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;
  
  // Show/hide card when pub changes
  useEffect(() => {
    if (pub) {
      setIsExpanded(false);
      dragStartY.current = COLLAPSED_Y;
      currentPosition.current = COLLAPSED_Y;
      scrollY.current = 0;
      setScrollEnabled(false);
      
      translateY.stopAnimation();
      Animated.spring(translateY, {
        toValue: COLLAPSED_Y,
        tension: 120,
        friction: 10,
        useNativeDriver: true,
      }).start();
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
    setIsExpanded(false);
    translateY.stopAnimation();
    
    Animated.spring(translateY, {
      toValue: HIDDEN_Y,
      tension: 120,
      friction: 10,
      useNativeDriver: true,
    }).start(() => {
      dragStartY.current = HIDDEN_Y;
      currentPosition.current = HIDDEN_Y;
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
      {/* Report, Favorite and Close buttons - positioned differently based on state */}
      {isExpanded ? (
        <>
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
      
      {/* Drag handle indicator */}
      <View style={styles.cardHandleContainer}>
        <View style={styles.cardHandle} />
      </View>

      {/* Invisible overlay to capture drags when collapsed (prevents content from intercepting) */}
      {!isExpanded && (
        <View 
          style={styles.draggableOverlay} 
          pointerEvents="box-only" 
        />
      )}

      {/* Card content */}
      <PubCardContent
        pub={pub}
        isExpanded={isExpanded}
        onToggleVisited={onToggleVisited}
        getImageSource={getImageSource}
        pointerEvents={!isExpanded ? 'none' : 'auto'}
        onScroll={handleScroll}
        scrollEnabled={scrollEnabled}
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
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 4,
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
    top: 12,
    right: 92,
    zIndex: 10,
    padding: 4,
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
    top: 12,
    right: 54,
    zIndex: 10,
    padding: 4,
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
    top: 12,
    right: 16,
    zIndex: 10,
    padding: 4,
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
    top: 40, // Below handle
    left: 0,
    right: 0,
    bottom: 50, // Above visited button area
    zIndex: 5,
    backgroundColor: 'transparent',
  },
});
