import React, { useRef, useEffect, useState } from 'react';
import { 
  View, 
  Dimensions, 
  Animated, 
  PanResponder,
  TouchableOpacity,
  StyleSheet
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PubCardContent from './PubCardContent';

const MEDIUM_GREY = '#757575';

/**
 * DraggablePubCard - A bottom sheet card with three states: hidden, collapsed, expanded
 * 
 * Key design decisions:
 * - Uses a single Animated.Value for Y position (no setOffset/flattenOffset complexity)
 * - Tracks drag start position separately to calculate relative movement
 * - Snap behavior is based on velocity and distance thresholds
 * - All animations use native driver for smooth 60fps performance
 */
export default function DraggablePubCard({ 
  pub, 
  onClose, 
  onToggleVisited,
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
  const dragStartY = useRef(HIDDEN_Y); // Track where drag started
  const currentPosition = useRef(HIDDEN_Y); // Track current position
  
  /**
   * Pan responder handles all touch gestures
   * Simplified approach: track absolute positions, no offset/flatten
   */
  const panResponder = useRef(
    PanResponder.create({
      // Only activate on vertical movements
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const isDraggingVertically = Math.abs(gestureState.dy) > 5;
        const isMoreVerticalThanHorizontal = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
        return isDraggingVertically && isMoreVerticalThanHorizontal;
      },
      
      // Gesture started - record starting position
      onPanResponderGrant: () => {
        translateY.stopAnimation(value => {
          dragStartY.current = value;
          currentPosition.current = value;
        });
      },
      
      // Gesture moving - update position
      onPanResponderMove: (_, gestureState) => {
        // Calculate new position based on drag start + gesture delta
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
      
      // Gesture ended - snap to nearest position
      onPanResponderRelease: (_, gestureState) => {
        const velocity = gestureState.vy;
        const dragDistance = gestureState.dy;
        const finalPosition = currentPosition.current;
        
        // Determine target snap position
        let targetY = COLLAPSED_Y;
        let willBeExpanded = false;
        
        // High velocity swipe - use velocity to determine direction
        if (Math.abs(velocity) > 0.8) {
          if (velocity < 0) {
            // Fast swipe up - go to expanded
            targetY = EXPANDED_Y;
            willBeExpanded = true;
          } else {
            // Fast swipe down
            if (dragStartY.current < COLLAPSED_Y * 0.5) {
              // Swipe down from expanded area -> collapse
              targetY = COLLAPSED_Y;
              willBeExpanded = false;
            } else {
              // Swipe down from collapsed area -> hide
              targetY = HIDDEN_Y;
              willBeExpanded = false;
            }
          }
        } 
        // Slow drag - use distance and position to determine snap
        else {
          // Calculate which position we're closest to
          const distToExpanded = Math.abs(finalPosition - EXPANDED_Y);
          const distToCollapsed = Math.abs(finalPosition - COLLAPSED_Y);
          const distToHidden = Math.abs(finalPosition - HIDDEN_Y);
          
          const minDist = Math.min(distToExpanded, distToCollapsed, distToHidden);
          
          // Prefer not hiding unless explicitly dragged far down
          if (minDist === distToHidden && dragDistance > cardHeight * 0.3) {
            targetY = HIDDEN_Y;
            willBeExpanded = false;
          } else if (minDist === distToExpanded) {
            targetY = EXPANDED_Y;
            willBeExpanded = true;
          } else {
            targetY = COLLAPSED_Y;
            willBeExpanded = false;
          }
        }
        
        // Update state
        setIsExpanded(willBeExpanded);
        dragStartY.current = targetY;
        currentPosition.current = targetY;
        
        // Animate to target with spring physics
        Animated.spring(translateY, {
          toValue: targetY,
          velocity: velocity,
          tension: 68, // Bounciness
          friction: 12, // Speed
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && targetY === HIDDEN_Y) {
            // Card was dismissed
            onClose();
          }
        });
      },
      
      // Gesture cancelled by system - reset to last stable position
      onPanResponderTerminate: () => {
        const lastStablePosition = dragStartY.current;
        Animated.spring(translateY, {
          toValue: lastStablePosition,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;
  
  /**
   * Show/hide card when pub changes
   */
  useEffect(() => {
    if (pub) {
      // New pub selected - show in collapsed state
      setIsExpanded(false);
      dragStartY.current = COLLAPSED_Y;
      currentPosition.current = COLLAPSED_Y;
      
      translateY.stopAnimation();
      
      // Animate in from bottom
      Animated.spring(translateY, {
        toValue: COLLAPSED_Y,
        tension: 100,
        friction: 12,
        useNativeDriver: true,
      }).start();
    } else {
      // Pub cleared - animate out
      Animated.spring(translateY, {
        toValue: HIDDEN_Y,
        tension: 100,
        friction: 12,
        useNativeDriver: true,
      }).start(() => {
        dragStartY.current = HIDDEN_Y;
        currentPosition.current = HIDDEN_Y;
      });
    }
  }, [pub?.id]);
  
  /**
   * Close button handler
   */
  const handleClose = () => {
    setIsExpanded(false);
    translateY.stopAnimation();
    
    Animated.spring(translateY, {
      toValue: HIDDEN_Y,
      tension: 100,
      friction: 12,
      useNativeDriver: true,
    }).start(() => {
      dragStartY.current = HIDDEN_Y;
      currentPosition.current = HIDDEN_Y;
      onClose();
    });
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
      {/* Close button - positioned differently based on state */}
      {isExpanded ? (
        <TouchableOpacity
          style={[styles.closeButtonTop, { top: insets.top + 8 }]}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="close" size={24} color={MEDIUM_GREY} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="close" size={24} color={MEDIUM_GREY} />
        </TouchableOpacity>
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
