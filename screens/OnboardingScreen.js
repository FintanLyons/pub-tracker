import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Dimensions,
  TouchableOpacity, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PAGES = [
  {
    key: 'discover',
    image: require('../assets/onboarding-discover-pubs.png'),
    icon: 'map-search',
    headline: 'Discover new Pubs',
    body: 'Explore London on the map, search by area, and find your next pint.',
  },
  {
    key: 'track',
    image: require('../assets/onboarding-track-visits.png'),
    icon: 'star-circle',
    headline: 'Earn points and track visits',
    body: 'Mark pubs visited, log drinks, level up, and complete areas for bonus points.',
  },
  {
    key: 'compete',
    image: require('../assets/onboarding-compete-friends.png'),
    icon: 'crown',
    headline: 'Compete against Friends',
    body: 'Add friends, join leagues, and climb the leaderboard.',
  },
];

export default function OnboardingScreen({ onComplete }) {
  const flatListRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const goNext = useCallback(() => {
    if (currentIndex < PAGES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      onComplete();
    }
  }, [currentIndex, onComplete]);

  const renderPage = useCallback(({ item }) => (
    <View style={styles.page}>
      <View style={styles.imageWrap}>
        <Image source={item.image} style={styles.screenshot} resizeMode="contain" />
      </View>
      <View style={styles.textWrap}>
        <MaterialCommunityIcons name={item.icon} size={32} color={COLORS.amber} />
        <Text style={styles.headline}>{item.headline}</Text>
        <Text style={styles.body}>{item.body}</Text>
      </View>
    </View>
  ), []);

  const isLast = currentIndex === PAGES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.skipRow}>
        {!isLast ? (
          <TouchableOpacity onPress={onComplete} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={PAGES}
        renderItem={renderPage}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        bounces={false}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
          ))}
        </View>

        <TouchableOpacity style={styles.nextBtn} onPress={goNext} activeOpacity={0.8}>
          <Text style={styles.nextBtnText}>{isLast ? 'Get Started' : 'Next'}</Text>
          {!isLast && (
            <MaterialCommunityIcons name="arrow-right" size={18} color={COLORS.white} style={{ marginLeft: 4 }} />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    height: 36,
  },
  skipText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
    paddingHorizontal: 28,
  },
  imageWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
  },
  screenshot: {
    width: SCREEN_WIDTH * 0.65,
    height: '100%',
    borderRadius: 16,
  },
  textWrap: {
    alignItems: 'center',
    paddingBottom: 8,
    minHeight: 150,
    justifyContent: 'center',
  },
  headline: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.darkGrey,
    marginTop: 10,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: COLORS.mediumGrey,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 20,
    alignItems: 'center',
    gap: 20,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.divider,
  },
  dotActive: {
    backgroundColor: COLORS.amber,
    width: 24,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.amber,
    paddingVertical: 15,
    borderRadius: 12,
    width: '100%',
    shadowColor: COLORS.amber,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  nextBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
