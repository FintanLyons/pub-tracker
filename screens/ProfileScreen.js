import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Animated,
  Alert,
  InteractionManager,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { distanceKm } from '../utils/geo';
import { useUserStats } from '../contexts/UserStatsContext';
import { useUserLocation } from '../contexts/LocationContext';
import { COLORS } from '../constants/theme';
import { getDrinkStats } from '../services/ReviewService';
import { getLevelProgress } from '../utils/levelSystem';
import { CORE_LONDON_AREAS } from '../constants/londonAreas';

const SORT_MODES = {
  LOCATION: 'location',
  ALPHABETICAL: 'alphabetical',
  MOST_VISITED: 'most_visited',
  PERCENTAGE: 'percentage',
};

const VIEW_MODES = {
  DISTRICT: 'area',
  POSTCODE_AREA: 'region',
};

export default function ProfileScreen({ navigation }) {
  const { logout, user, deleteAccount } = useAuth();
  const userId = user?.id ?? null;
  const {
    districtStats: baseDistrictStats,
    postcodeAreaStats: basePostcodeAreaStats,
    totalVisited,
    totalPubs,
    achievements,
    loading: statsLoading,
    lastUpdated,
    error: statsError,
    refreshUserStats,
  } = useUserStats();
  const location = useUserLocation();
  const [districtStatsRaw, setDistrictStatsRaw] = useState([]);
  const [postcodeAreaStatsRaw, setPostcodeAreaStatsRaw] = useState([]);
  const [drinkStats, setDrinkStats] = useState({ total: 0, byDistrict: {}, byPostcodeArea: {} });
  const [sortMode, setSortMode] = useState(SORT_MODES.LOCATION);
  const [viewMode, setViewMode] = useState(VIEW_MODES.DISTRICT);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);

  const handleDistrictPress = useCallback(
    (districtName, centerLat = null, centerLon = null, postcodeArea = null) => {
      navigation.navigate('Map', {
        districtToSearch: districtName,
        districtCenterLat: centerLat,
        districtCenterLon: centerLon,
        districtPostcodeArea: postcodeArea,
      });
    },
    [navigation]
  );

  const handlePostcodeAreaPress = useCallback((postcodeAreaName) => {
    if (!postcodeAreaName || postcodeAreaName === 'Unknown') {
      return;
    }
    navigation.navigate('Map', { postcodeAreaToSearch: postcodeAreaName });
  }, [navigation]);

  useEffect(() => {
    if (!baseDistrictStats?.length) {
      setDistrictStatsRaw([]);
      return;
    }
    const districts = baseDistrictStats.map((row) => ({
      district: row.district,
      districtDisplayName: row.districtDisplayName || row.district,
      postcodeArea: row.postcodeArea || null,
      total: Number(row.total),
      visited: Number(row.visited),
      percentage: row.percentage,
      centerLat: row.centerLat,
      centerLon: row.centerLon,
      distance:
        location && row.centerLat != null && row.centerLon != null
          ? distanceKm(location.latitude, location.longitude, row.centerLat, row.centerLon)
          : null,
    }));
    setDistrictStatsRaw(districts);
  }, [baseDistrictStats, location]);

  useEffect(() => {
    if (!basePostcodeAreaStats?.length) {
      setPostcodeAreaStatsRaw([]);
      return;
    }
    const postcodeAreas = basePostcodeAreaStats.map((row) => ({
      postcodeArea: row.postcodeArea,
      total: Number(row.totalPubs),
      visited: Number(row.visitedPubs),
      percentage: row.percentage,
      totalDistricts: Number(row.totalDistricts),
      completedDistricts: Number(row.completedDistricts),
      centerLat: row.centerLat,
      centerLon: row.centerLon,
      distance:
        location && row.centerLat != null && row.centerLon != null
          ? distanceKm(location.latitude, location.longitude, row.centerLat, row.centerLon)
          : null,
    }));
    setPostcodeAreaStatsRaw(postcodeAreas);
  }, [basePostcodeAreaStats, location]);

  useFocusEffect(
    useCallback(() => {
      const isStale = !lastUpdated || (Date.now() - lastUpdated > 30000);
      const hasAnyStats =
        baseDistrictStats.length > 0 || basePostcodeAreaStats.length > 0;
      if (!isStale && hasAnyStats) return;
      InteractionManager.runAfterInteractions(() => {
        refreshUserStats().catch((error) => {
          console.error('Error refreshing profile stats:', error);
        });
      });
    }, [
      lastUpdated,
      baseDistrictStats.length,
      basePostcodeAreaStats.length,
      refreshUserStats,
    ])
  );

  // Refresh drink stats whenever the screen is focused
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      getDrinkStats(userId)
        .then(setDrinkStats)
        .catch((err) => console.error('Error fetching drink stats:', err));
    }, [userId])
  );

  const sortStats = useCallback(
    (stats, type) => {
      const sorted = [...stats];
      switch (sortMode) {
        case SORT_MODES.LOCATION:
          sorted.sort((a, b) => {
            const aHasDistance = a.distance !== null && a.distance !== undefined;
            const bHasDistance = b.distance !== null && b.distance !== undefined;
            if (aHasDistance && bHasDistance) {
              return a.distance - b.distance;
            }
            if (aHasDistance && !bHasDistance) return -1;
            if (!aHasDistance && bHasDistance) return 1;
            const aName = type === VIEW_MODES.DISTRICT ? (a.districtDisplayName || a.district) : a.postcodeArea;
            const bName = type === VIEW_MODES.DISTRICT ? (b.districtDisplayName || b.district) : b.postcodeArea;
            return aName.localeCompare(bName);
          });
          break;
        case SORT_MODES.ALPHABETICAL:
          sorted.sort((a, b) => {
            const aName = type === VIEW_MODES.DISTRICT ? (a.districtDisplayName || a.district) : a.postcodeArea;
            const bName = type === VIEW_MODES.DISTRICT ? (b.districtDisplayName || b.district) : b.postcodeArea;
            return aName.localeCompare(bName);
          });
          break;
        case SORT_MODES.MOST_VISITED:
          sorted.sort(
            (a, b) =>
              b.visited - a.visited ||
              (b.total || 0) - (a.total || 0)
          );
          break;
        case SORT_MODES.PERCENTAGE:
          sorted.sort(
            (a, b) =>
              b.percentage - a.percentage ||
              (b.visited || 0) - (a.visited || 0)
          );
          break;
        default:
          break;
      }
      return sorted;
    },
    [sortMode]
  );

  const sortedDistrictStats = useMemo(() => {
    return sortStats(districtStatsRaw, VIEW_MODES.DISTRICT);
  }, [districtStatsRaw, sortStats]);

  const sortedPostcodeAreaStats = useMemo(() => {
    const filtered = postcodeAreaStatsRaw.filter(
      (row) => CORE_LONDON_AREAS.has(row.postcodeArea)
    );
    return sortStats(filtered, VIEW_MODES.POSTCODE_AREA);
  }, [postcodeAreaStatsRaw, sortStats]);

  const hasPrevView = viewMode !== VIEW_MODES.DISTRICT;
  const hasNextView = viewMode !== VIEW_MODES.POSTCODE_AREA;

  const handlePrevView = useCallback(() => {
    if (viewMode === VIEW_MODES.POSTCODE_AREA) {
      setViewMode(VIEW_MODES.DISTRICT);
    }
  }, [viewMode]);

  const handleNextView = useCallback(() => {
    if (viewMode === VIEW_MODES.DISTRICT) {
      setViewMode(VIEW_MODES.POSTCODE_AREA);
    }
  }, [viewMode]);

  // Animate modal content slide
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    
    if (showFilterModal) {
      // Reset to bottom position and animate up
      slideAnim.setValue(300);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      // Animate down when closing
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilterModal]);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'Your profile, visits, favourites, friends, and league memberships will be removed permanently.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Last step',
              'Are you sure? You will not be able to recover this account.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete account',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteAccount();
                    } catch (e) {
                      Alert.alert(
                        'Something went wrong',
                        e?.message ||
                          'Could not delete your account. If the problem persists, contact support.'
                      );
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [deleteAccount]);

  const handleAccountMenu = useCallback(() => {
    Alert.alert(
      'Account',
      'Sign out of this device, or permanently delete your account and all data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          onPress: async () => {
            await logout();
          },
        },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: handleDeleteAccount,
        },
      ]
    );
  }, [logout, handleDeleteAccount]);

  const completedAreas = districtStatsRaw.filter(d => d.percentage >= 100).length;
  const currentLevel = getLevelProgress(achievements?.totalScore || 0).level;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshUserStats();
      if (userId) {
        const nextDrinks = await getDrinkStats(userId);
        setDrinkStats(nextDrinks);
      }
    } catch (error) {
      console.error('Error refreshing profile stats:', error);
    } finally {
      setRefreshing(false);
    }
  }, [userId, refreshUserStats]);

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
      <View style={styles.headerContainer}>
        <View style={styles.spacer} />
        <View style={styles.header}>
          <MaterialCommunityIcons name="poll" size={40} color={COLORS.darkGrey} />
          <Text style={styles.title}>Statistics</Text>
        </View>
        {user && (
          <TouchableOpacity
            onPress={handleAccountMenu}
            style={styles.logoutButtonHeader}
            accessibilityLabel="Account: sign out or delete account"
          >
            <MaterialCommunityIcons name="logout" size={24} color="#F44336" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Primary stats card: Drinks | Pubs Visited ─────────────────────── */}
      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{drinkStats.total}</Text>
            <Text style={styles.statItemLabel}>Total Drinks</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{totalVisited}</Text>
            <Text style={styles.statItemLabel}>Pubs Visited</Text>
          </View>
        </View>
      </View>

      {/* ── Secondary stats card: Areas Completed | Level ──────────────────── */}
      <View style={[styles.statsCard, styles.statsCardSecondary]}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNumberSmall}>{completedAreas}</Text>
            <Text style={styles.statItemLabelSmall}>Areas Completed</Text>
          </View>
          <View style={styles.statDividerSmall} />
          <View style={styles.statItem}>
            <Text style={styles.statNumberSmall}>{currentLevel}</Text>
            <Text style={styles.statItemLabelSmall}>Current Level</Text>
          </View>
        </View>
      </View>

      {statsError != null && (
        <View style={styles.statsErrorBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#C62828" />
          <Text style={styles.statsErrorText}>
            Could not load area stats. Pull to refresh or check your connection.
            {typeof statsError?.message === 'string' && statsError.message
              ? `\n${statsError.message}`
              : ''}
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionTitleContainer}>
          <TouchableOpacity
            onPress={handlePrevView}
            disabled={!hasPrevView}
            style={[
              styles.switchButton,
              styles.switchButtonLeft,
              !hasPrevView && styles.switchButtonDisabled,
            ]}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="chevron-left"
              size={24}
              color={hasPrevView ? COLORS.darkGrey : '#D9D9D9'}
            />
          </TouchableOpacity>
          <Text style={[styles.sectionTitle, styles.sectionTitleLeft]} numberOfLines={1}>
            {viewMode === VIEW_MODES.DISTRICT ? 'By area' : 'By region'}
          </Text>
          <View style={styles.sectionRightControls}>
            <TouchableOpacity 
              onPress={() => setShowFilterModal(true)}
              style={styles.filterButton}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="filter-variant" size={20} color={COLORS.darkGrey} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleNextView}
              disabled={!hasNextView}
              style={[
                styles.switchButton,
                styles.switchButtonRight,
                !hasNextView && styles.switchButtonDisabled,
              ]}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={hasNextView ? COLORS.darkGrey : '#D9D9D9'}
              />
            </TouchableOpacity>
          </View>
        </View>
        {viewMode === VIEW_MODES.DISTRICT ? (
          sortedDistrictStats.length === 0 ? (
            <Text style={styles.emptyText}>No areas found</Text>
          ) : (
            sortedDistrictStats.map((stat, index) => (
              <TouchableOpacity
                key={`district-${index}`}
                style={styles.areaCard}
                onPress={() =>
                  handleDistrictPress(stat.district, stat.centerLat, stat.centerLon, stat.postcodeArea)
                }
                activeOpacity={0.7}
              >
                <View style={styles.areaHeader}>
                  <View style={styles.areaTitleRow}>
                    <Text style={styles.areaName} numberOfLines={1} ellipsizeMode="tail">
                      {stat.districtDisplayName || stat.district}
                    </Text>
                    {stat.district && String(stat.district).toUpperCase() !== 'UNKNOWN' && (
                      <Text
                        style={styles.districtCodeInline}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {stat.district}
                      </Text>
                    )}
                  </View>
                  <View style={styles.areaCountRow}>
                    {drinkStats.byDistrict[stat.district] > 0 && (
                      <View style={styles.inlinePints}>
                        <MaterialCommunityIcons name="beer-outline" size={13} color={COLORS.amber} />
                        <Text style={styles.inlinePintsText}>{drinkStats.byDistrict[stat.district]}</Text>
                      </View>
                    )}
                    <Text style={styles.areaCount}>
                      {stat.visited} / {stat.total}
                    </Text>
                  </View>
                </View>
                <View style={styles.areaProgressBarContainer}>
                  <View style={styles.areaProgressBarBackground}>
                    <View
                      style={[styles.areaProgressBarFill, { width: `${stat.percentage}%` }]}
                    />
                  </View>
                  <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
                </View>
              </TouchableOpacity>
            ))
          )
        ) : sortedPostcodeAreaStats.length === 0 ? (
          <Text style={styles.emptyText}>No regions found</Text>
        ) : (
          sortedPostcodeAreaStats.map((stat, index) => {
            const isInteractive = stat.postcodeArea && stat.postcodeArea !== 'Unknown';
            return (
              <TouchableOpacity
                key={`postcode-area-${index}`}
                style={styles.areaCard}
                onPress={() => handlePostcodeAreaPress(stat.postcodeArea)}
                activeOpacity={isInteractive ? 0.7 : 1}
                disabled={!isInteractive}
              >
                <View style={styles.areaHeader}>
                  <Text style={styles.areaName}>{stat.postcodeArea}</Text>
                  <View style={styles.areaCountRow}>
                    {drinkStats.byPostcodeArea[stat.postcodeArea] > 0 && (
                      <View style={styles.inlinePints}>
                        <MaterialCommunityIcons name="beer-outline" size={13} color={COLORS.amber} />
                        <Text style={styles.inlinePintsText}>{drinkStats.byPostcodeArea[stat.postcodeArea]}</Text>
                      </View>
                    )}
                    <Text style={styles.areaCount}>
                      {stat.visited} / {stat.total}
                    </Text>
                  </View>
                </View>
                <View style={styles.areaProgressBarContainer}>
                  <View style={styles.areaProgressBarBackground}>
                    <View
                      style={[styles.areaProgressBarFill, { width: `${stat.percentage}%` }]}
                    />
                  </View>
                  <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
                </View>
                <View style={styles.districtCompletionSummary}>
                  <MaterialCommunityIcons name="map-marker-radius" size={16} color={COLORS.darkGrey} />
                  <Text style={styles.districtCompletionSummaryText}>
                    Areas complete: {stat.completedDistricts} / {stat.totalDistricts}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      <Modal
        visible={showFilterModal}
        animationType="none"
        transparent={true}
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowFilterModal(false)}
          />
          <Animated.View 
            style={[
              styles.modalContent,
              {
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sort by</Text>
              <TouchableOpacity 
                onPress={() => setShowFilterModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.LOCATION && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.LOCATION);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.LOCATION && styles.filterOptionTextSelected
              ]}>
                Location (Distance)
              </Text>
              {sortMode === SORT_MODES.LOCATION && (
                <MaterialCommunityIcons name="check" size={20} color={COLORS.darkGrey} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.ALPHABETICAL && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.ALPHABETICAL);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.ALPHABETICAL && styles.filterOptionTextSelected
              ]}>
                Alphabetical
              </Text>
              {sortMode === SORT_MODES.ALPHABETICAL && (
                <MaterialCommunityIcons name="check" size={20} color={COLORS.darkGrey} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.MOST_VISITED && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.MOST_VISITED);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.MOST_VISITED && styles.filterOptionTextSelected
              ]}>
                Most Pubs Visited
              </Text>
              {sortMode === SORT_MODES.MOST_VISITED && (
                <MaterialCommunityIcons name="check" size={20} color={COLORS.darkGrey} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.PERCENTAGE && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.PERCENTAGE);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.PERCENTAGE && styles.filterOptionTextSelected
              ]}>
                Percentage Visited
              </Text>
              {sortMode === SORT_MODES.PERCENTAGE && (
                <MaterialCommunityIcons name="check" size={20} color={COLORS.darkGrey} />
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    padding: 20,
    paddingTop: 40,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  spacer: {
    width: 40,
  },
  header: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  logoutButtonHeader: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.lightGrey,
    marginTop: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  statsCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    padding: 24,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statsCardSecondary: {
    padding: 14,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  statNumber: {
    fontSize: 42,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  statItemLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  statNumberSmall: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  statItemLabelSmall: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 64,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 8,
  },
  statDividerSmall: {
    width: 1,
    height: 40,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 8,
  },
  areaCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlinePints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 32,
  },
  inlinePintsText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.amber,
  },
  statsErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFEBEE',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  statsErrorText: {
    flex: 1,
    fontSize: 14,
    color: '#B71C1C',
    lineHeight: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
    flex: 1,
    textAlign: 'center',
  },
  sectionTitleLeft: {
    textAlign: 'left',
  },
  sectionRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  switchButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  switchButtonLeft: {
    marginRight: 12,
  },
  switchButtonRight: {
    marginLeft: 12,
  },
  switchButtonDisabled: {
    backgroundColor: '#F5F5F5',
    borderColor: '#F5F5F5',
  },
  filterButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.lightGrey,
    marginRight: 12,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textAlign: 'center',
    paddingVertical: 20,
  },
  areaCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  areaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  areaTitleRow: {
    flex: 1,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  areaName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.darkGrey,
    flexShrink: 1,
  },
  districtCodeInline: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    letterSpacing: 0.3,
  },
  areaCount: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.accentGrey,
    minWidth: 56,
    textAlign: 'right',
  },
  areaProgressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  areaProgressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  areaProgressBarFill: {
    height: '100%',
    backgroundColor: COLORS.darkGrey,
    borderRadius: 4,
  },
  areaPercentage: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    minWidth: 45,
    textAlign: 'right',
  },
  districtCompletionSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  districtCompletionSummaryText: {
    marginLeft: 6,
    fontSize: 14,
    color: COLORS.darkGrey,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGrey,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  modalCloseButton: {
    padding: 4,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGrey,
  },
  filterOptionSelected: {
    backgroundColor: COLORS.lightGrey,
  },
  filterOptionText: {
    fontSize: 16,
    color: COLORS.darkGrey,
  },
  filterOptionTextSelected: {
    fontWeight: '600',
  },
});