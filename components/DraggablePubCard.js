import React, { useRef, useEffect, useMemo } from 'react';
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

const TAB_BAR_HEIGHT = 0; // Base height of tab bar (without safe area)

export default function DraggablePubCard({ 
  pub, 
  onClose, 
  onToggleVisited,
  getImageSource,
  onCardStateChange 
}) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  // Tab bar height is just the base height - React Navigation handles safe area
  const tabBarHeight = TAB_BAR_HEIGHT;
  const cardHeight = screenHeight * 0.33;
  const fullHeight = screenHeight - insets.top;
  
  // Animation values
  const translateY = useRef(new Animated.Value(cardHeight)).current;
  const panY = useRef(new Animated.Value(0)).current;
  
  // Card state: 'hidden', 'collapsed', 'expanded'
  const [cardState, setCardState] = React.useState('hidden');
  const cardStateRef = useRef('hidden');
  
  // Reset animation when pub changes
  useEffect(() => {
    if (pub) {
      setCardState('collapsed');
      cardStateRef.current = 'collapsed';
      panY.setValue(0);
      translateY.setValue(cardHeight);
      
      if (onCardStateChange) {
        onCardStateChange(false);
      }
      
      // Use a small delay to ensure smooth animation
      const timeoutId = setTimeout(() => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }).start();
      }, 10);
      
      return () => clearTimeout(timeoutId);
    } else {
      setCardState('hidden');
      cardStateRef.current = 'hidden';
      translateY.setValue(cardHeight);
      panY.setValue(0);
      
      if (onCardStateChange) {
        onCardStateChange(false);
      }
    }
  }, [pub?.id]);
  
  // Pan responder for drag gestures
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        },
        onPanResponderGrant: () => {
          panY.setOffset(translateY._value);
          panY.setValue(0);
        },
        onPanResponderMove: (_, gestureState) => {
          panY.setValue(gestureState.dy);
        },
        onPanResponderRelease: (_, gestureState) => {
          panY.flattenOffset();
          
          const currentY = translateY._value + gestureState.dy;
          const velocity = gestureState.vy;
          
          // Snap points - collapsed and expanded both at 0 (no translation needed)
          // hidden position pushes card below visible area
          const collapsedY = 0;
          const expandedY = 0;
          const hiddenY = cardHeight + tabBarHeight + insets.bottom;
          
          let targetY;
          let newState;
          
          // Use velocity to determine direction if significant
          if (Math.abs(velocity) > 0.5) {
            if (velocity < 0) {
              // Swiping up - expand
              targetY = expandedY;
              newState = 'expanded';
            } else {
              // Swiping down
              if (cardStateRef.current === 'expanded') {
                targetY = collapsedY;
                newState = 'collapsed';
              } else {
                targetY = hiddenY;
                newState = 'hidden';
              }
            }
          } else {
            // Use position to determine snap point
            const midPoint = (collapsedY + expandedY) / 2;
            if (currentY < midPoint) {
              targetY = expandedY;
              newState = 'expanded';
            } else if (currentY < collapsedY + 50) {
              targetY = collapsedY;
              newState = 'collapsed';
            } else {
              targetY = hiddenY;
              newState = 'hidden';
            }
          }
          
        setCardState(newState);
        cardStateRef.current = newState;
        
        // Notify parent of state change
        if (onCardStateChange) {
          onCardStateChange(newState === 'expanded');
        }
        
        Animated.spring(translateY, {
          toValue: targetY,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }).start(() => {
          if (newState === 'hidden') {
            onClose();
          }
        });
        },
      }),
    [tabBarHeight, cardHeight, onClose]
  );
  
  const handleClose = () => {
    const newState = 'hidden';
    setCardState(newState);
    cardStateRef.current = newState;
    Animated.spring(translateY, {
      toValue: cardHeight + tabBarHeight + insets.bottom,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start(() => {
      onClose();
    });
  };
  
  if (!pub) return null;
  
  const isExpanded = cardState === 'expanded';
  const currentHeight = isExpanded ? fullHeight : cardHeight;
  
  return (
    <Animated.View 
      style={[
        styles.cardContainer, 
        { 
          height: currentHeight,
          paddingTop: isExpanded ? insets.top + 8 : 12,
          bottom: tabBarHeight, // Position above tab bar
          transform: [
            {
              translateY: Animated.add(translateY, panY)
            }
          ]
        }
      ]}
      {...panResponder.panHandlers}
    >
      {/* Close button in top gap when expanded */}
      {isExpanded && (
        <TouchableOpacity 
          style={[styles.closeButtonTop, { top: insets.top + 8 }]} 
          onPress={handleClose}
        >
          <MaterialCommunityIcons name="close" size={24} color={MEDIUM_GREY} />
        </TouchableOpacity>
      )}
      
      <View style={styles.cardHandleContainer}>
        <View style={styles.cardHandle} />
      </View>
      
      {/* Close button for collapsed state */}
      {!isExpanded && (
        <TouchableOpacity 
          style={styles.closeButton} 
          onPress={handleClose}
        >
          <MaterialCommunityIcons name="close" size={24} color={MEDIUM_GREY} />
        </TouchableOpacity>
      )}
      
      <PubCardContent 
        pub={pub}
        isExpanded={isExpanded}
        onToggleVisited={onToggleVisited}
        getImageSource={getImageSource}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
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
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 1,
    padding: 4,
  },
  closeButtonTop: {
    position: 'absolute',
    right: 16,
    zIndex: 1,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
});

