import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Animated, Alert, InteractionManager } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import PintGlassIcon from '../components/PintGlassIcon';
import { distanceKm } from '../utils/geo';
import { useUserStats } from '../contexts/UserStatsContext';
import { useUserLocation } from '../contexts/LocationContext';
import { COLORS } from '../constants/theme';

const SORT_MODES = {
  LOCATION: 'location',
  ALPHABETICAL: 'alphabetical',
  MOST_VISITED: 'most_visited',
  PERCENTAGE: 'percentage',
};

const VIEW_MODES = {
  AREA: 'area',
  BOROUGH: 'borough',
};

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { logout, user } = useAuth();
  const {
    areaStats: baseAreaStats,
    boroughStats: baseBoroughStats,
    totalVisited,
    totalPubs,
    loading: statsLoading,
    lastUpdated,
    refreshUserStats,
  } = useUserStats();
  const location = useUserLocation();
  const [areaStatsRaw, setAreaStatsRaw] = useState([]);
  const [boroughStatsRaw, setBoroughStatsRaw] = useState([]);
  const [sortMode, setSortMode] = useState(SORT_MODES.LOCATION);
  const [viewMode, setViewMode] = useState(VIEW_MODES.AREA);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);

  const handleAreaPress = useCallback((areaName) => {
    navigation.navigate('Map', { areaToSearch: areaName });
  }, [navigation]);

  const handleBoroughPress = useCallback((boroughName) => {
    if (!boroughName || boroughName === 'Unknown') {
      return;
    }
    navigation.navigate('Map', { boroughToSearch: boroughName });
  }, [navigation]);

  useEffect(() => {
    if (!baseAreaStats || baseAreaStats.length === 0) return;

    const areas = baseAreaStats.map((row) => ({
      area: row.area,
      borough: row.borough || null,
      total: Number(row.total),
      visited: Number(row.visited),
      percentage: row.percentage,
      centerLat: row.centerLat,
      centerLon: row.centerLon,
      distance: location && row.centerLat != null && row.centerLon != null
        ? distanceKm(location.latitude, location.longitude, row.centerLat, row.centerLon)
        : null,
    }));
    const boroughs = (baseBoroughStats || []).map((row) => ({
      borough: row.borough,
      total: Number(row.totalPubs),
      visited: Number(row.visitedPubs),
      percentage: row.percentage,
      totalAreas: Number(row.totalAreas),
      completedAreas: Number(row.completedAreas),
      centerLat: row.centerLat,
      centerLon: row.centerLon,
      distance: location && row.centerLat != null && row.centerLon != null
        ? distanceKm(location.latitude, location.longitude, row.centerLat, row.centerLon)
        : null,
    }));

    setAreaStatsRaw(areas);
    setBoroughStatsRaw(boroughs);
  }, [baseAreaStats, baseBoroughStats, location]);

  useFocusEffect(
    useCallback(() => {
      const isStale = !lastUpdated || (Date.now() - lastUpdated > 30000);
      if (!isStale && baseAreaStats.length > 0) return;
      InteractionManager.runAfterInteractions(() => {
        refreshUserStats().catch((error) => {
          console.error('Error refreshing profile stats:', error);
        });
      });
    }, [lastUpdated, baseAreaStats.length, refreshUserStats])
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
            const aName = type === VIEW_MODES.AREA ? a.area : a.borough;
            const bName = type === VIEW_MODES.AREA ? b.area : b.borough;
            return aName.localeCompare(bName);
          });
          break;
        case SORT_MODES.ALPHABETICAL:
          sorted.sort((a, b) => {
            const aName = type === VIEW_MODES.AREA ? a.area : a.borough;
            const bName = type === VIEW_MODES.AREA ? b.area : b.borough;
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

  const areaStats = useMemo(() => {
    return sortStats(areaStatsRaw, VIEW_MODES.AREA);
  }, [areaStatsRaw, sortStats]);

  const boroughStats = useMemo(() => {
    return sortStats(boroughStatsRaw, VIEW_MODES.BOROUGH);
  }, [boroughStatsRaw, sortStats]);

  const hasPrevView = viewMode !== VIEW_MODES.AREA;
  const hasNextView = viewMode !== VIEW_MODES.BOROUGH;

  const handlePrevView = useCallback(() => {
    if (viewMode === VIEW_MODES.BOROUGH) {
      setViewMode(VIEW_MODES.AREA);
    }
  }, [viewMode]);

  const handleNextView = useCallback(() => {
    if (viewMode === VIEW_MODES.AREA) {
      setViewMode(VIEW_MODES.BOROUGH);
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

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            // AuthContext will automatically update and show AuthScreen
          },
        },
      ]
    );
  };

  const progressPercentage = totalPubs > 0 ? Math.round((totalVisited / totalPubs) * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.headerContainer}>
        <View style={styles.spacer} />
      <View style={styles.header}>
        <PintGlassIcon size={48} color={COLORS.darkGrey} />
        <Text style={styles.title}>Pub Tracker</Text>
          {user && (
            <Text style={styles.username}>@{user.username}</Text>
          )}
        </View>
        {user && (
          <TouchableOpacity 
            onPress={handleLogout}
            style={styles.logoutButtonHeader}
          >
            <MaterialCommunityIcons name="logout" size={24} color="#F44336" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.statsCard}>
        <View style={styles.mainStat}>
          <Text style={styles.visitedNumber}>{totalVisited}</Text>
          <Text style={styles.totalNumber}>/ {totalPubs}</Text>
        </View>
        <Text style={styles.statLabel}>Pubs Visited</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View 
              style={[styles.progressBarFill, { width: `${progressPercentage}%` }]} 
            />
          </View>
          <Text style={styles.progressText}>{progressPercentage}%</Text>
        </View>
      </View>

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
            {viewMode === VIEW_MODES.AREA ? 'Sort by Area' : 'Sort by Borough'}
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
        {viewMode === VIEW_MODES.AREA ? (
          areaStats.length === 0 ? (
            <Text style={styles.emptyText}>No areas found</Text>
          ) : (
            areaStats.map((stat, index) => (
              <TouchableOpacity 
                key={`area-${index}`} 
                style={styles.areaCard}
                onPress={() => handleAreaPress(stat.area)}
                activeOpacity={0.7}
              >
                <View style={styles.areaHeader}>
                  <View style={styles.areaTitleRow}>
                    <Text style={styles.areaName} numberOfLines={1} ellipsizeMode="tail">
                      {stat.area}
                    </Text>
                    {stat.borough && (
                      <Text
                        style={styles.areaBoroughInline}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {stat.borough}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.areaCount}>
                    {stat.visited} / {stat.total}
                  </Text>
                </View>
                <View style={styles.areaProgressBarContainer}>
                  <View style={styles.areaProgressBarBackground}>
                    <View 
                      style={[
                        styles.areaProgressBarFill, 
                        { width: `${stat.percentage}%` }
                      ]} 
                    />
                  </View>
                  <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
                </View>
              </TouchableOpacity>
            ))
          )
        ) : boroughStats.length === 0 ? (
          <Text style={styles.emptyText}>No boroughs found</Text>
        ) : (
          boroughStats.map((stat, index) => {
            const isInteractive = stat.borough && stat.borough !== 'Unknown';
            return (
              <TouchableOpacity 
                key={`borough-${index}`} 
                style={styles.areaCard}
                onPress={() => handleBoroughPress(stat.borough)}
                activeOpacity={isInteractive ? 0.7 : 1}
                disabled={!isInteractive}
              >
                <View style={styles.areaHeader}>
                  <Text style={styles.areaName}>{stat.borough}</Text>
                  <Text style={styles.areaCount}>
                    {stat.visited} / {stat.total}
                  </Text>
                </View>
                <View style={styles.areaProgressBarContainer}>
                  <View style={styles.areaProgressBarBackground}>
                    <View 
                      style={[
                        styles.areaProgressBarFill, 
                        { width: `${stat.percentage}%` }
                      ]} 
                    />
                  </View>
                  <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
                </View>
                <View style={styles.boroughAreaSummary}>
                  <MaterialCommunityIcons name="map-marker-radius" size={16} color={COLORS.darkGrey} />
                  <Text style={styles.boroughAreaSummaryText}>
                    Areas complete: {stat.completedAreas} / {stat.totalAreas}
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
    marginTop: 12,
  },
  username: {
    fontSize: 16,
    color: COLORS.mediumGrey,
    marginTop: 4,
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
  mainStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  visitedNumber: {
    fontSize: 56,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  totalNumber: {
    fontSize: 32,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    marginLeft: 4,
  },
  statLabel: {
    fontSize: 16,
    color: COLORS.mediumGrey,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBarBackground: {
    flex: 1,
    height: 12,
    backgroundColor: '#E0E0E0',
    borderRadius: 6,
    overflow: 'hidden',
    marginRight: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.darkGrey,
    borderRadius: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    minWidth: 50,
    textAlign: 'right',
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
  },
  areaName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.darkGrey,
    flexShrink: 1,
  },
  areaBoroughInline: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.accentGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  areaCount: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.accentGrey,
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
  boroughAreaSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  boroughAreaSummaryText: {
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