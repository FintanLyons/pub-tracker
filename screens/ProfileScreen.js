import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  startTransition,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  InteractionManager,
  RefreshControl,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { distanceKm } from '../utils/geo';
import { useUserStats } from '../contexts/UserStatsContext';
import { useUserLocation } from '../contexts/LocationContext';
import { useNetworkStatus } from '../contexts/NetworkContext';
import { COLORS } from '../constants/theme';
import { getAchievedTrophyIds } from '../utils/trophyUtils';
import { SUPPORTED_POSTCODE_AREAS } from '../constants/londonAreas';
import { SORT_MODES, VIEW_MODES } from './profile/constants';
import { DistrictStatRow, PostcodeAreaStatRow } from './profile/AreaStatRows';
import ProfileStatsCards from './profile/ProfileStatsCards';
import AreaSortModal from './profile/AreaSortModal';
import ProfileSettingsModal from './profile/ProfileSettingsModal';
import DeleteAccountModals, { DELETE_MODAL } from './profile/DeleteAccountModals';
import TrophiesModal from './profile/TrophiesModal';

export default function ProfileScreen({
  navigation,
  mapReturnAnimationKey = 0,
  mapReturnBaselineScore = 0,
  /** Snapshotted when Map tab is focused (same moment as score baseline). */
  mapReturnBaselineVisited = 0,
  mapReturnBaselineDrinks = 0,
}) {
  const { logout, user, deleteAccount } = useAuth();
  const {
    districtStats: baseDistrictStats,
    postcodeAreaStats: basePostcodeAreaStats,
    totalVisited,
    achievements,
    drinkStats,
    lastUpdated,
    error: statsError,
    refreshUserStats,
  } = useUserStats();
  const location = useUserLocation();
  const { isConnected } = useNetworkStatus();
  const [districtStatsRaw, setDistrictStatsRaw] = useState([]);
  const [postcodeAreaStatsRaw, setPostcodeAreaStatsRaw] = useState([]);
  const [sortMode, setSortMode] = useState(SORT_MODES.LOCATION);
  const [viewMode, setViewMode] = useState(VIEW_MODES.DISTRICT);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTrophiesModal, setShowTrophiesModal] = useState(false);
  const [unseenTrophyCount, setUnseenTrophyCount] = useState(0);
  const seenAchievedTrophyIdsRef = useRef(null);
  const [deleteModal, setDeleteModal] = useState(DELETE_MODAL.NONE);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const skipNextProfileFocusRefreshRef = useRef(false);

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
      if (skipNextProfileFocusRefreshRef.current) {
        skipNextProfileFocusRefreshRef.current = false;
        return;
      }
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

  const getStatDrinkCount = useCallback(
    (stat, type) => {
      if (type === VIEW_MODES.DISTRICT) {
        return drinkStats.byDistrict[stat.district] || 0;
      }
      return drinkStats.byPostcodeArea[stat.postcodeArea] || 0;
    },
    [drinkStats.byDistrict, drinkStats.byPostcodeArea],
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
        case SORT_MODES.MOST_DRINKS:
          sorted.sort(
            (a, b) =>
              getStatDrinkCount(b, type) - getStatDrinkCount(a, type) ||
              (b.visited || 0) - (a.visited || 0)
          );
          break;
        default:
          break;
      }
      return sorted;
    },
    [sortMode, getStatDrinkCount],
  );

  const sortedDistrictStats = useMemo(() => {
    return sortStats(districtStatsRaw, VIEW_MODES.DISTRICT);
  }, [districtStatsRaw, sortStats]);

  const sortedPostcodeAreaStats = useMemo(() => {
    const londonOnly = postcodeAreaStatsRaw.filter(
      (row) => SUPPORTED_POSTCODE_AREAS.has(row.postcodeArea),
    );
    return sortStats(londonOnly, VIEW_MODES.POSTCODE_AREA);
  }, [postcodeAreaStatsRaw, sortStats]);

  const hasPrevView = viewMode !== VIEW_MODES.DISTRICT;
  const hasNextView = viewMode !== VIEW_MODES.POSTCODE_AREA;

  const handlePrevView = useCallback(() => {
    if (viewMode === VIEW_MODES.POSTCODE_AREA) {
      startTransition(() => {
        setViewMode(VIEW_MODES.DISTRICT);
      });
    }
  }, [viewMode]);

  const handleNextView = useCallback(() => {
    if (viewMode === VIEW_MODES.DISTRICT) {
      startTransition(() => {
        setViewMode(VIEW_MODES.POSTCODE_AREA);
      });
    }
  }, [viewMode]);


  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshUserStats();
    } catch (error) {
      console.error('Error refreshing profile stats:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshUserStats]);

  const areasRefreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={COLORS.amber}
        colors={[COLORS.amber]}
      />
    ),
    [refreshing, onRefresh],
  );

  const areasListData = useMemo(
    () => (viewMode === VIEW_MODES.DISTRICT ? sortedDistrictStats : sortedPostcodeAreaStats),
    [viewMode, sortedDistrictStats, sortedPostcodeAreaStats],
  );

  const renderAreaItem = useCallback(
    ({ item: stat }) => {
      if (viewMode === VIEW_MODES.DISTRICT) {
        return (
          <DistrictStatRow
            stat={stat}
            drinks={drinkStats.byDistrict[stat.district] || 0}
            onPress={handleDistrictPress}
          />
        );
      }
      return (
        <PostcodeAreaStatRow
          stat={stat}
          drinks={drinkStats.byPostcodeArea[stat.postcodeArea] || 0}
          onPress={handlePostcodeAreaPress}
        />
      );
    },
    [viewMode, drinkStats.byDistrict, drinkStats.byPostcodeArea, handleDistrictPress, handlePostcodeAreaPress],
  );

  const areasKeyExtractor = useCallback(
    (item) => (viewMode === VIEW_MODES.DISTRICT ? item.district : item.postcodeArea),
    [viewMode],
  );

  const areasListEmpty = useMemo(
    () => (
      <Text style={styles.emptyText}>
        {viewMode === VIEW_MODES.DISTRICT ? 'No districts found' : 'No areas found'}
      </Text>
    ),
    [viewMode],
  );


  const closeDeleteFlow = useCallback(() => {
    setDeleteModal(DELETE_MODAL.NONE);
    setDeleteErrorMessage('');
  }, []);

  const handleSignOutFromSettings = useCallback(async () => {
    setShowSettingsModal(false);
    await logout();
  }, [logout]);

  const handleDeleteFromSettings = useCallback(() => {
    setShowSettingsModal(false);
    setDeleteModal(DELETE_MODAL.CONFIRM);
  }, []);

  const handleDeleteAccountConfirm = useCallback(async () => {
    try {
      await deleteAccount();
      closeDeleteFlow();
    } catch (e) {
      setDeleteErrorMessage(
        e?.message ||
          'Could not delete your account. If the problem persists, contact support.'
      );
      setDeleteModal(DELETE_MODAL.ERROR);
    }
  }, [deleteAccount, closeDeleteFlow]);

  const completedAreas = districtStatsRaw.filter(d => d.percentage >= 100).length;
  const totalScore = achievements?.totalScore ?? 0;
  // Back online after a failed refresh: retry instead of asking the user to pull down.
  useEffect(() => {
    if (!isConnected || statsError == null) return;
    refreshUserStats().catch((error) => {
      console.error('Error refreshing profile stats after reconnect:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const handleMapReturnStart = useCallback(() => {
    skipNextProfileFocusRefreshRef.current = true;
  }, []);

  useEffect(() => {
    if (!achievements) return;
    const achieved = getAchievedTrophyIds(achievements);
    if (seenAchievedTrophyIdsRef.current === null) {
      seenAchievedTrophyIdsRef.current = achieved;
      return;
    }
    const seen = seenAchievedTrophyIdsRef.current;
    setUnseenTrophyCount([...achieved].filter((id) => !seen.has(id)).length);
  }, [achievements]);

  const openTrophiesModal = useCallback(() => {
    if (achievements) {
      seenAchievedTrophyIdsRef.current = getAchievedTrophyIds(achievements);
    }
    setUnseenTrophyCount(0);
    setShowTrophiesModal(true);
  }, [achievements]);

  useEffect(() => {
    if (!showTrophiesModal) return;
    const isStale = !lastUpdated || (Date.now() - lastUpdated > 30000);
    if (!isStale && achievements) return;
    InteractionManager.runAfterInteractions(() => {
      refreshUserStats().catch((error) => {
        console.error('Error refreshing trophies data:', error);
      });
    });
  }, [showTrophiesModal, lastUpdated, achievements, refreshUserStats]);

  return (
    <>
    <View style={styles.container}>
      <View style={styles.fixedChrome}>
      <View style={styles.headerContainer}>
        <TouchableOpacity
          onPress={openTrophiesModal}
          style={styles.trophyHeaderButton}
          activeOpacity={0.7}
          accessibilityLabel={
            unseenTrophyCount > 0
              ? `View trophies, ${unseenTrophyCount} new`
              : 'View trophies'
          }
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="trophy"
            size={22}
            color={unseenTrophyCount > 0 ? COLORS.amber : COLORS.darkGrey}
          />
          {unseenTrophyCount > 0 && (
            <View style={styles.trophyBadge}>
              <Text style={styles.trophyBadgeText}>
                {unseenTrophyCount > 9 ? '9+' : unseenTrophyCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.headerUsernameWrap}>
          {user?.username ? (
            <Text
              style={styles.headerUsername}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {user.username}
            </Text>
          ) : null}
        </View>
        {user && (
          <TouchableOpacity
            onPress={() => setShowSettingsModal(true)}
            style={styles.settingsButtonHeader}
            accessibilityLabel="Open settings"
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="cog-outline" size={24} color={COLORS.darkGrey} />
          </TouchableOpacity>
        )}
      </View>

      <ProfileStatsCards
        totalScore={totalScore}
        totalVisited={totalVisited}
        drinksTotal={drinkStats.total}
        completedAreas={completedAreas}
        refreshUserStats={refreshUserStats}
        mapReturnAnimationKey={mapReturnAnimationKey}
        mapReturnBaselineScore={mapReturnBaselineScore}
        mapReturnBaselineVisited={mapReturnBaselineVisited}
        mapReturnBaselineDrinks={mapReturnBaselineDrinks}
        onMapReturnStart={handleMapReturnStart}
      />


      {/* Offline: the offline banner already explains why stats can't refresh. */}
      {statsError != null && isConnected && (
        <View style={styles.statsErrorBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#C62828" />
          <Text style={styles.statsErrorText}>
            Couldn't load your stats. Pull down to try again.
          </Text>
        </View>
      )}

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
            {viewMode === VIEW_MODES.DISTRICT ? 'By district' : 'By area'}
          </Text>
          <View style={styles.sectionRightControls}>
            <TouchableOpacity 
              onPress={() => setShowFilterModal(true)}
              style={styles.filterButton}
              activeOpacity={0.8}
              accessibilityLabel="Sort list"
              accessibilityRole="button"
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
      </View>

      <FlatList
        data={areasListData}
        keyExtractor={areasKeyExtractor}
        renderItem={renderAreaItem}
        extraData={viewMode}
        ListEmptyComponent={areasListEmpty}
        style={styles.areasScroll}
        contentContainerStyle={styles.areasScrollContent}
        refreshControl={areasRefreshControl}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        nestedScrollEnabled
      />
    </View>

      <AreaSortModal
        visible={showFilterModal}
        sortMode={sortMode}
        onSelect={setSortMode}
        onClose={() => setShowFilterModal(false)}
      />

      <ProfileSettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onSignOut={handleSignOutFromSettings}
        onDeleteAccount={handleDeleteFromSettings}
      />

      <DeleteAccountModals
        mode={deleteModal}
        errorMessage={deleteErrorMessage}
        onConfirm={handleDeleteAccountConfirm}
        onClose={closeDeleteFlow}
      />

      <TrophiesModal visible={showTrophiesModal} onClose={() => setShowTrophiesModal(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  fixedChrome: {
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  areasScroll: {
    flex: 1,
  },
  areasScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trophyHeaderButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGrey,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trophyBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#F44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  trophyBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  headerUsernameWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    minHeight: 40,
  },
  headerUsername: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
    width: '100%',
  },
  settingsButtonHeader: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGrey,
    justifyContent: 'center',
    alignItems: 'center',
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
});
