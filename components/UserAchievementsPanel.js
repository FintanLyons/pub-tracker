import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';
import { useUserStats } from '../contexts/UserStatsContext';
import { COLORS } from '../constants/theme';
import { getAreaTrophies, getMilestoneTrophies } from '../utils/trophyUtils';

const TROPHY_TABS = {
  AREAS: 'areas',
  MILESTONES: 'milestones',
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

function TrophyGrid({ trophies }) {
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
    if (trophy.type === 'achievement') {
      return trophy.description || trophy.title;
    }
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

  const formatTrophyDescription = (trophy) => {
    if (trophy.type === 'achievement') {
      return trophy.title || '';
    }
    return trophy.description || '';
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

  if (trophyRows.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      {trophyRows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.trophyRow}>
          {row.map((trophy) => (
            <View key={trophy.id} style={styles.trophyContainer}>
              <View
                style={[
                  styles.trophyIconContainer,
                  !trophy.isAchieved && styles.trophyIconContainerLocked,
                ]}
              >
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
                style={[
                  styles.trophyDescription,
                  !trophy.isAchieved && styles.trophyDescriptionLocked,
                ]}
                numberOfLines={trophy.type === 'achievement' ? 2 : 1}
              >
                {formatTrophyDescription(trophy)}
              </Text>
            </View>
          ))}
          {row.length < 3
            && Array.from({ length: 3 - row.length }).map((_, idx) => (
              <View key={`empty-${idx}`} style={styles.trophyContainer} />
            ))}
        </View>
      ))}
    </View>
  );
}

function TrophyEmpty({ icon, title, subtitle }) {
  return (
    <View style={styles.emptyWrap}>
      <MaterialCommunityIcons name={icon} size={56} color={COLORS.divider} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

/**
 * Trophy collection only (no level bar). Used inside ProfileScreen modal.
 */
export default function UserAchievementsPanel() {
  const { achievements, statsLoading, refreshUserStats } = useUserStats();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState(TROPHY_TABS.AREAS);

  const areaTrophies = useMemo(() => getAreaTrophies(achievements), [achievements]);
  const milestoneTrophies = useMemo(() => getMilestoneTrophies(achievements), [achievements]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshUserStats();
    } catch {
      /* handled in context */
    }
    setRefreshing(false);
  }, [refreshUserStats]);

  const showSkeleton = statsLoading && !achievements;
  const activeTrophies = activeTab === TROPHY_TABS.AREAS ? areaTrophies : milestoneTrophies;

  return (
    <View style={styles.container}>
      <View style={styles.tabChrome}>
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === TROPHY_TABS.AREAS && styles.activeTab]}
            onPress={() => setActiveTab(TROPHY_TABS.AREAS)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === TROPHY_TABS.AREAS }}
          >
            <Text style={[styles.tabText, activeTab === TROPHY_TABS.AREAS && styles.activeTabText]}>
              Areas
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TROPHY_TABS.MILESTONES && styles.activeTab]}
            onPress={() => setActiveTab(TROPHY_TABS.MILESTONES)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === TROPHY_TABS.MILESTONES }}
          >
            <Text
              style={[styles.tabText, activeTab === TROPHY_TABS.MILESTONES && styles.activeTabText]}
            >
              Milestones
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.amber}
            colors={[COLORS.amber]}
          />
        }
      >
      {showSkeleton ? (
        <>
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
        </>
      ) : activeTab === TROPHY_TABS.AREAS ? (
        activeTrophies.length === 0 ? (
          <TrophyEmpty
            icon="trophy-outline"
            title="No area trophies yet"
            subtitle="Visit every pub in a district or region to earn your first trophy"
          />
        ) : (
          <TrophyGrid trophies={activeTrophies} />
        )
      ) : activeTrophies.length === 0 ? (
        <TrophyEmpty
          icon="medal-outline"
          title="No milestones yet"
          subtitle="Special pub visits and other challenges will appear here"
        />
      ) : (
        <TrophyGrid trophies={activeTrophies} />
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  tabChrome: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  activeTabText: {
    color: COLORS.darkGrey,
  },
  section: {
    marginBottom: 20,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 24,
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
