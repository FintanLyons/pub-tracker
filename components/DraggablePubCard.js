import React, { useRef, useEffect, useMemo } from 'react';
import { 
  View, 
  Dimensions, 
  Animated, 
  PanResponder,
  TouchableOpacity,
  StyleSheet,
  Easing
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PubCardContent from './PubCardContent';

const MEDIUM_GREY = '#757575';

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
  
  const translateY = useRef(new Animated.Value(cardHeight)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const [cardState, setCardState] = React.useState('hidden');
  const cardStateRef = useRef('hidden');
  const animationRef = useRef(null);
  
  // Stop any ongoing animations
  const stopAnimation = () => {
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
    translateY.stopAnimation();
  };
  
  useEffect(() => {
    if (pub) {
      stopAnimation();
      setCardState('collapsed');
      cardStateRef.current = 'collapsed';
      panY.setValue(0);
      panY.setOffset(0);
      translateY.setValue(cardHeight);
      
      animationRef.current = Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 30,
      });
      animationRef.current.start(() => {
        animationRef.current = null;
      });
    } else {
      stopAnimation();
      setCardState('hidden');
      cardStateRef.current = 'hidden';
      panY.setValue(0);
      panY.setOffset(0);
      translateY.setValue(cardHeight);
    }
  }, [pub?.id, cardHeight]);
  
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        },
        onPanResponderGrant: () => {
          // Stop any ongoing animations before starting gesture
          stopAnimation();
          // Get the current animated value and set it as offset
          translateY.stopAnimation((value) => {
            panY.setOffset(value);
            panY.setValue(0);
          });
        },
        onPanResponderMove: (_, gestureState) => {
          panY.setValue(gestureState.dy);
        },
        onPanResponderRelease: (_, gestureState) => {
          const velocity = gestureState.vy;
          
          // Get current positions before flattening
          const panOffset = panY._offset || 0;
          const panValue = panY._value || 0;
          const currentPanY = panOffset + panValue;
          
          // Flatten offset and synchronize values properly
          panY.flattenOffset();
          translateY.stopAnimation((translateValue) => {
            const currentY = translateValue + currentPanY;
            
            // Update translateY to the actual current position
            translateY.setValue(currentY);
            panY.setValue(0);
            panY.setOffset(0);
          
            const collapsedY = 0;
            const expandedY = 0;
            const hiddenY = cardHeight + insets.bottom;
            
            let targetY;
            let newState;
            
            if (Math.abs(velocity) > 0.5) {
              if (velocity < 0) {
                targetY = expandedY;
                newState = 'expanded';
              } else {
                if (cardStateRef.current === 'expanded') {
                  targetY = collapsedY;
                  newState = 'collapsed';
                } else {
                  targetY = hiddenY;
                  newState = 'hidden';
                }
              }
            } else {
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
            
            animationRef.current = Animated.spring(translateY, {
              toValue: targetY,
              useNativeDriver: true,
              tension: 120,
              friction: 60,
            });
            animationRef.current.start((finished) => {
              animationRef.current = null;
              if (finished && newState === 'hidden') {
                onClose();
              }
            });
          });
        },
        onPanResponderTerminate: () => {
          // Handle interruption (e.g., incoming call)
          panY.flattenOffset();
          translateY.stopAnimation((value) => {
            translateY.setValue(value);
            panY.setValue(0);
            panY.setOffset(0);
          });
        },
      }),
    [cardHeight, insets.bottom, onClose]
  );
  
  const handleClose = () => {
    // Stop any ongoing animations and gestures immediately
    stopAnimation();
    
    // Get current position values synchronously
    const panOffset = panY._offset || 0;
    const panValue = panY._value || 0;
    const currentPanY = panOffset + panValue;
    const currentTranslateY = translateY._value || 0;
    const currentY = currentTranslateY + currentPanY;
    
    // Flatten and reset pan values
    panY.flattenOffset();
    panY.setValue(0);
    panY.setOffset(0);
    
    // Update translateY to current position to prevent jump
    translateY.setValue(currentY);
    
    // Update state immediately for UI responsiveness
    setCardState('hidden');
    cardStateRef.current = 'hidden';
    
    const targetY = cardHeight + insets.bottom;
    
    // Use timing animation for faster, smoother closing
    // Reduced duration and optimized easing for snappy feel
    animationRef.current = Animated.timing(translateY, {
      toValue: targetY,
      duration: 150, // Fast and responsive
      easing: Easing.out(Easing.quad), // Smooth but quick deceleration
      useNativeDriver: true,
    });
    
    animationRef.current.start((finished) => {
      animationRef.current = null;
      if (finished) {
        onClose();
      }
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
          bottom: 0,
          transform: [
            {
              translateY: Animated.add(translateY, panY)
            }
          ]
        }
      ]}
      {...panResponder.panHandlers}
    >
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

