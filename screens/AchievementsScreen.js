import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  InteractionManager, Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getLevelProgress } from '../utils/levelSystem';
import { getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';
import { useUserStats } from '../contexts/UserStatsContext';
import { COLORS } from '../constants/theme';
import { CORE_LONDON_AREAS } from '../constants/londonAreas';

const isLondonTrophy = (trophy) => {
  const id = typeof trophy.id === 'string' ? trophy.id : '';
  if (trophy.type === 'district' || trophy.type === 'area') {
    const m = id.match(/^district-([A-Z]+)/i);
    if (m) return CORE_LONDON_AREAS.has(m[1].toUpperCase());
  }
  if (trophy.type === 'postcode_area' || trophy.type === 'borough') {
    const m = id.match(/^(?:postcode[_-]?area|borough)-([A-Z]+)/i);
    if (m) return CORE_LONDON_AREAS.has(m[1].toUpperCase());
    return CORE_LONDON_AREAS.has(id.toUpperCase());
  }
  return true;
};

function SkeletonBlock({ width, height, style }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[{ width, height, backgroundColor: COLORS.divider, borderRadius: 8, opacity }, style]}
    />
  );
}

export default function AchievementsScreen() {
  const {
    achievements,
    statsLoading,
    lastUpdated,
    refreshUserStats,
  } = useUserStats();

  const [refreshing, setRefreshing] = useState(false);

  const currentScore = achievements?.totalScore || 0;

  const trophies = useMemo(() => {
    if (!achievements) return [];
    const all = [
      ...(achievements.districtTrophies || achievements.areaTrophies || []),
      ...(achievements.postcodeAreaTrophies || achievements.boroughTrophies || []),
      ...(achievements.pubAchievements || []),
    ].filter(isLondonTrophy);
    all.sort((a, b) => {
      if (a.isAchieved && !b.isAchieved) return -1;
      if (!a.isAchieved && b.isAchieved) return 1;
      return 0;
    });
    return all;
  }, [achievements]);

  useFocusEffect(
    useCallback(() => {
      const isStale = !lastUpdated || (Date.now() - lastUpdated > 30000);
      if (!isStale && achievements) return;
      InteractionManager.runAfterInteractions(() => {
        refreshUserStats().catch((error) => {
          console.error('Error refreshing achievements:', error);
        });
      });
    }, [lastUpdated, achievements, refreshUserStats])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refreshUserStats(); } catch { /* handled */ }
    setRefreshing(false);
  }, [refreshUserStats]);

  const levelProgress = getLevelProgress(currentScore);

  const trophyRows = [];
  for (let i = 0; i < trophies.length; i += 3) {
    trophyRows.push(trophies.slice(i, i + 3));
  }

  const getTrophyIcon = (trophy) => {
    switch (trophy.type) {
      case 'postcode_area':
      case 'borough':
        return trophy.isAchieved ? 'crown' : 'crown-outline';
      case 'achievement':
        return trophy.isAchieved ? 'medal' : 'medal-outline';
      case 'district':
      case 'area':
      default:
        return trophy.isAchieved ? 'trophy' : 'trophy-outline';
    }
  };

  const formatTrophyTitle = (trophy) => {
    if (!trophy?.title) return '';
    if (trophy.type === 'district' || trophy.type === 'area') {
      const rawId = typeof trophy.id === 'string' ? trophy.id : '';
      const m = rawId.match(/^district-(.+)$/i);
      if (m) {
        const code = m[1];
        const place = getPostcodeDistrictDisplayName(code);
        return `${place} Complete`;
      }
    }
    return trophy.title;
  };

  const getTrophyColor = (trophy) => {
    if (!trophy.isAchieved) return COLORS.mediumGrey;
    switch (trophy.type) {
      case 'postcode_area':
      case 'borough':
        return COLORS.burgundy;
      case 'achievement':
        return COLORS.sapphire;
      case 'district':
      case 'area':
      default:
        return COLORS.amber;
    }
  };

  const showSkeleton = statsLoading && !achievements;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.amber}
          colors={[COLORS.amber]}
        />
      }
    >
      <View style={styles.header}>
        <MaterialCommunityIcons name="trophy" size={48} color={COLORS.darkGrey} />
        <Text style={styles.title}>Achievements</Text>
      </View>

      {showSkeleton ? (
        <View style={styles.skeletonWrap}>
          <SkeletonBlock width="100%" height={120} style={{ marginBottom: 24 }} />
          <SkeletonBlock width={160} height={20} style={{ marginBottom: 16, alignSelf: 'flex-start' }} />
          <View style={styles.trophyRow}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.trophyContainer}>
                <SkeletonBlock width={80} height={80} style={{ borderRadius: 40 }} />
                <SkeletonBlock width={60} height={12} style={{ marginTop: 8 }} />
              </View>
            ))}
          </View>
          <View style={styles.trophyRow}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.trophyContainer}>
                <SkeletonBlock width={80} height={80} style={{ borderRadius: 40 }} />
                <SkeletonBlock width={60} height={12} style={{ marginTop: 8 }} />
              </View>
            ))}
          </View>
        </View>
      ) : (
        <>
          <View style={styles.statsCard}>
            <Text style={styles.levelLabel}>Level {levelProgress.level}</Text>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBackground}>
                <View
                  style={[styles.progressBarFill, { width: `${levelProgress.progressPercentage}%` }]}
                />
              </View>
            </View>
            <Text style={styles.scoreText}>Total Score: {currentScore}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trophy Collection</Text>
            {trophyRows.length === 0 ? (
              <View style={styles.emptyWrap}>
                <MaterialCommunityIcons name="trophy-outline" size={56} color={COLORS.divider} />
                <Text style={styles.emptyTitle}>No trophies yet</Text>
                <Text style={styles.emptySubtitle}>
                  Visit every pub in an area to earn your first trophy
                </Text>
              </View>
            ) : (
              trophyRows.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.trophyRow}>
                  {row.map((trophy) => (
                    <View key={trophy.id} style={styles.trophyContainer}>
                      <View style={[
                        styles.trophyIconContainer,
                        !trophy.isAchieved && styles.trophyIconContainerLocked
                      ]}>
                        <MaterialCommunityIcons
                          name={getTrophyIcon(trophy)}
                          size={48}
                          color={getTrophyColor(trophy)}
                        />
                      </View>
                      <Text
                        style={[styles.trophyTitle, !trophy.isAchieved && styles.trophyTitleLocked]}
                        numberOfLines={2}
                      >
                        {formatTrophyTitle(trophy)}
                      </Text>
                      <Text
                        style={[styles.trophyDescription, !trophy.isAchieved && styles.trophyDescriptionLocked]}
                        numberOfLines={1}
                      >
                        {trophy.description}
                      </Text>
                    </View>
                  ))}
                  {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, idx) => (
                    <View key={`empty-${idx}`} style={styles.trophyContainer} />
                  ))}
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  contentContainer: {
    padding: 20,
    paddingTop: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
    marginTop: 12,
  },
  skeletonWrap: {
    paddingTop: 8,
  },
  statsCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  levelLabel: {
    fontSize: 18,
    color: COLORS.mediumGrey,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  progressBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  scoreText: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textAlign: 'center',
  },
  progressBarBackground: {
    flex: 1,
    height: 12,
    backgroundColor: COLORS.divider,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.amber,
    borderRadius: 6,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
    marginBottom: 16,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.darkGrey,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 32,
    lineHeight: 20,
  },
  trophyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  trophyContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
    minWidth: 100,
  },
  trophyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.lightGrey,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  trophyIconContainerLocked: {
    backgroundColor: COLORS.surface,
    opacity: 0.5,
  },
  trophyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'center',
    marginBottom: 4,
  },
  trophyTitleLocked: {
    color: COLORS.mediumGrey,
    opacity: 0.6,
  },
  trophyDescription: {
    fontSize: 11,
    color: COLORS.accentGrey,
    textAlign: 'center',
  },
  trophyDescriptionLocked: {
    color: COLORS.mediumGrey,
    opacity: 0.5,
  },
});
