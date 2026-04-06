import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Animated,
  InteractionManager,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuth } from '../contexts/AuthContext';
import { updatePublicAvatarUrl } from '../services/SecureAuthService';
import { presignAndPutImage } from '../services/r2Upload';
import {
  pickNormalizedAvatarUri,
  AVATAR_LIBRARY_PERMISSION_ALERT,
} from '../utils/avatarImagePrep';
import { distanceKm } from '../utils/geo';
import { useUserStats } from '../contexts/UserStatsContext';
import { useUserLocation } from '../contexts/LocationContext';
import { COLORS } from '../constants/theme';
import {
  getLevelProgress,
  POINTS_PER_LEVEL,
  DEFAULT_PUB_VISIT_POINTS,
  POINTS_PER_DRINK,
  DISTRICT_COMPLETION_BONUS_POINTS,
  POSTCODE_AREA_COMPLETION_BONUS_POINTS,
} from '../utils/levelSystem';
import { CORE_LONDON_AREAS } from '../constants/londonAreas';
import UserAchievementsPanel from '../components/UserAchievementsPanel';

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

const DELETE_MODAL = {
  NONE: 'none',
  CONFIRM: 'confirm',
  ERROR: 'error',
};

export default function ProfileScreen({ navigation }) {
  const { logout, user, deleteAccount, applyUserProfileRow } = useAuth();
  const {
    districtStats: baseDistrictStats,
    postcodeAreaStats: basePostcodeAreaStats,
    totalVisited,
    totalPubs,
    achievements,
    drinkStats,
    loading: statsLoading,
    lastUpdated,
    error: statsError,
    refreshUserStats,
  } = useUserStats();
  const location = useUserLocation();
  const [districtStatsRaw, setDistrictStatsRaw] = useState([]);
  const [postcodeAreaStatsRaw, setPostcodeAreaStatsRaw] = useState([]);
  const [sortMode, setSortMode] = useState(SORT_MODES.LOCATION);
  const [viewMode, setViewMode] = useState(VIEW_MODES.DISTRICT);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTrophiesModal, setShowTrophiesModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(DELETE_MODAL.NONE);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [showRemoveAvatarConfirm, setShowRemoveAvatarConfirm] = useState(false);
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

  const handlePickProfilePhoto = useCallback(async () => {
    if (!user?.id || avatarBusy) return;
    const res = await pickNormalizedAvatarUri();
    if (!res.ok) {
      if (res.reason === 'denied') {
        Alert.alert(AVATAR_LIBRARY_PERMISSION_ALERT.title, AVATAR_LIBRARY_PERMISSION_ALERT.message);
      } else if (res.reason === 'processing') {
        Alert.alert('Error', res.message || 'Could not process photo.');
      }
      return;
    }
    setAvatarBusy(true);
    try {
      const publicUrl = await presignAndPutImage(res.uri, { purpose: 'avatar' });
      const row = await updatePublicAvatarUrl(user.id, publicUrl);
      applyUserProfileRow(row);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not update profile photo.');
    } finally {
      setAvatarBusy(false);
    }
  }, [user?.id, avatarBusy, applyUserProfileRow]);

  const handleRemoveProfilePhoto = useCallback(() => {
    if (!user?.id || !user?.avatar_url || avatarBusy) return;
    setShowRemoveAvatarConfirm(true);
  }, [user?.id, user?.avatar_url, avatarBusy]);

  const confirmRemoveProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    setShowRemoveAvatarConfirm(false);
    setAvatarBusy(true);
    try {
      const row = await updatePublicAvatarUrl(user.id, null);
      applyUserProfileRow(row);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not remove photo.');
    } finally {
      setAvatarBusy(false);
    }
  }, [user?.id, applyUserProfileRow]);

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
  const levelProgress = useMemo(() => getLevelProgress(totalScore), [totalScore]);
  const levelBarWidth = Math.min(100, Math.max(0, levelProgress.progressPercentage));

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
        <TouchableOpacity
          onPress={() => setShowTrophiesModal(true)}
          style={styles.trophyHeaderButton}
          activeOpacity={0.7}
          accessibilityLabel="View trophies"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="trophy" size={22} color={COLORS.amber} />
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

      {/* ── Primary stats card: Drinks | Pubs ─────────────────────── */}
      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{drinkStats.total}</Text>
            <Text style={styles.statItemLabel}>Drinks</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{totalVisited}</Text>
            <Text style={styles.statItemLabel}>Pubs</Text>
          </View>
        </View>
      </View>

      {/* ── Secondary stats card: Areas | Level | Score + level progress bar ─ */}
      <View style={[styles.statsCard, styles.statsCardSecondary]}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNumberSmall}>{completedAreas}</Text>
            <Text style={styles.statItemLabelSmall}>Areas</Text>
          </View>
          <View style={styles.statDividerSmall} />
          <View style={styles.statItem}>
            <Text style={styles.statNumberSmall}>{levelProgress.level}</Text>
            <Text style={styles.statItemLabelSmall}>Level</Text>
          </View>
          <View style={styles.statDividerSmall} />
          <View style={styles.statItem}>
            <Text
              style={styles.statNumberSmall}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              {totalScore.toLocaleString()}
            </Text>
            <Text style={styles.statItemLabelSmall}>Score</Text>
          </View>
        </View>
        <View
          style={styles.levelBarSection}
          accessible
          accessibilityLabel={`Toward next level. Bar shows how far through your current level you are: ${levelProgress.pointsInCurrentLevel} of ${levelProgress.pointsNeededForLevel} points toward level ${levelProgress.level + 1}.`}
          accessibilityValue={{
            min: 0,
            max: levelProgress.pointsNeededForLevel,
            now: levelProgress.pointsInCurrentLevel,
          }}
        >
          <View style={styles.levelBarLabelRow} importantForAccessibility="no">
            <MaterialCommunityIcons name="stairs-up" size={18} color={COLORS.mediumGrey} />
            <Text style={styles.levelBarHeaderText}>Toward next level</Text>
          </View>
          <View style={styles.levelBarTrack} importantForAccessibility="no">
            <View style={[styles.levelBarFill, { width: `${levelBarWidth}%` }]} />
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

      <Modal
        visible={showSettingsModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowSettingsModal(false)}
            accessibilityLabel="Dismiss settings"
          />
          <View style={styles.floatingCard}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>Settings</Text>
              <TouchableOpacity
                onPress={() => setShowSettingsModal(false)}
                style={styles.floatingCardClose}
                accessibilityLabel="Close settings"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>

            <View style={styles.settingsBody}>
              <View style={styles.settingsUserCard}>
                <Text style={styles.settingsUserLabel}>Username</Text>
                <Text
                  style={[
                    styles.settingsUserValue,
                    !user?.username && styles.settingsUserValueMuted,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {user?.username?.trim() ? user.username : 'Not set yet'}
                </Text>

                <Text style={styles.settingsPhotoLabel}>Profile photo</Text>
                <View style={styles.settingsAvatarRow}>
                  {user?.avatar_url ? (
                    <Image
                      source={{ uri: user.avatar_url }}
                      style={styles.settingsAvatarImage}
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <View style={styles.settingsAvatarPlaceholder}>
                      <MaterialCommunityIcons
                        name="account-outline"
                        size={36}
                        color={COLORS.mediumGrey}
                      />
                    </View>
                  )}
                </View>
                {avatarBusy ? (
                  <ActivityIndicator style={styles.settingsAvatarSpinner} color={COLORS.amber} />
                ) : null}
                <View style={styles.settingsPhotoActionsRow}>
                  <TouchableOpacity
                    style={[
                      styles.settingsPhotoActionBtn,
                      styles.settingsPhotoActionBtnPrimary,
                      (avatarBusy || !user?.id) && styles.settingsPhotoActionBtnDisabled,
                    ]}
                    onPress={handlePickProfilePhoto}
                    disabled={avatarBusy || !user?.id}
                    activeOpacity={0.75}
                    accessibilityLabel="Change profile photo"
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons name="camera-outline" size={18} color={COLORS.darkGrey} />
                    <Text style={styles.settingsPhotoActionBtnText}>Change photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.settingsPhotoActionBtn,
                      styles.settingsPhotoActionBtnMuted,
                      (avatarBusy || !user?.avatar_url) && styles.settingsPhotoActionBtnDisabled,
                    ]}
                    onPress={handleRemoveProfilePhoto}
                    disabled={avatarBusy || !user?.avatar_url}
                    activeOpacity={0.75}
                    accessibilityLabel="Remove profile photo"
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={18}
                      color={user?.avatar_url && !avatarBusy ? COLORS.darkGrey : COLORS.mediumGrey}
                    />
                    <Text
                      style={[
                        styles.settingsPhotoActionBtnTextMuted,
                        (!user?.avatar_url || avatarBusy) && styles.settingsPhotoActionBtnTextDisabled,
                      ]}
                    >
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.settingsScoringCard}>
                <Text style={styles.settingsScoringLabel}>Scoring</Text>
                <View style={[styles.scoringRuleRow, styles.scoringRuleRowFirst]}>
                  <Text style={styles.scoringRuleLeft}>A pub visit</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={COLORS.mediumGrey}
                    style={styles.scoringRuleArrow}
                  />
                  <Text style={styles.scoringRuleValue}>+{DEFAULT_PUB_VISIT_POINTS}</Text>
                </View>
                <Text style={styles.scoringRuleHint}>Default visit; some pubs award more</Text>
                <View style={styles.scoringRuleRow}>
                  <Text style={styles.scoringRuleLeft}>Each drink logged</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={COLORS.mediumGrey}
                    style={styles.scoringRuleArrow}
                  />
                  <Text style={styles.scoringRuleValue}>+{POINTS_PER_DRINK}</Text>
                </View>
                <View style={styles.scoringRuleRow}>
                  <Text style={styles.scoringRuleLeft}>Area finished</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={COLORS.mediumGrey}
                    style={styles.scoringRuleArrow}
                  />
                  <Text style={styles.scoringRuleValue}>+{DISTRICT_COMPLETION_BONUS_POINTS}</Text>
                </View>
                <View style={[styles.scoringRuleRow, styles.scoringRuleRowTight]}>
                  <Text style={styles.scoringRuleLeft}>Region finished</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={COLORS.mediumGrey}
                    style={styles.scoringRuleArrow}
                  />
                  <Text style={styles.scoringRuleValue}>
                    +{POSTCODE_AREA_COMPLETION_BONUS_POINTS}
                  </Text>
                </View>
                <View style={styles.scoringRulesDivider} />
                <View style={styles.scoringRuleRow}>
                  <Text style={styles.scoringRuleLeft}>Every {POINTS_PER_LEVEL} points</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={COLORS.mediumGrey}
                    style={styles.scoringRuleArrow}
                  />
                  <Text style={styles.scoringRuleValue}>+1 level</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.settingsActionCard, styles.settingsActionCardNeutral]}
                onPress={handleSignOutFromSettings}
                activeOpacity={0.7}
                accessibilityLabel="Sign out"
                accessibilityRole="button"
              >
                <View style={styles.settingsActionIconSlot}>
                  <MaterialCommunityIcons name="logout-variant" size={22} color={COLORS.darkGrey} />
                </View>
                <Text style={styles.settingsActionLabel}>Sign out</Text>
                <View style={styles.settingsActionChevronSlot}>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.mediumGrey} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.settingsActionCard, styles.settingsActionCardDanger]}
                onPress={handleDeleteFromSettings}
                activeOpacity={0.7}
                accessibilityLabel="Delete account"
                accessibilityRole="button"
              >
                <View style={styles.settingsActionIconSlot}>
                  <MaterialCommunityIcons name="delete-outline" size={22} color={COLORS.errorRed} />
                </View>
                <Text style={styles.settingsActionLabelDanger}>Delete account</Text>
                <View style={styles.settingsActionChevronSlot}>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.errorRed} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRemoveAvatarConfirm}
        animationType="fade"
        transparent
        onRequestClose={() => !avatarBusy && setShowRemoveAvatarConfirm(false)}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => !avatarBusy && setShowRemoveAvatarConfirm(false)}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.floatingCard}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>Remove profile photo?</Text>
              <TouchableOpacity
                onPress={() => !avatarBusy && setShowRemoveAvatarConfirm(false)}
                style={styles.floatingCardClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
                disabled={avatarBusy}
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>
            <Text style={styles.floatingCardBody}>
              Your profile will show the default outline on the leaderboard and in settings.
            </Text>
            <View style={styles.floatingCardActions}>
              <TouchableOpacity
                style={[
                  styles.floatingActionBtn,
                  styles.floatingActionBtnHalf,
                  styles.floatingActionBtnSecondary,
                ]}
                onPress={() => !avatarBusy && setShowRemoveAvatarConfirm(false)}
                activeOpacity={0.75}
                disabled={avatarBusy}
              >
                <Text style={styles.floatingActionBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.floatingActionBtn,
                  styles.floatingActionBtnHalf,
                  styles.floatingActionBtnDangerOutline,
                ]}
                onPress={confirmRemoveProfilePhoto}
                activeOpacity={0.75}
                disabled={avatarBusy}
              >
                <Text style={styles.floatingActionBtnTextDanger}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteModal === DELETE_MODAL.CONFIRM}
        animationType="fade"
        transparent
        onRequestClose={closeDeleteFlow}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeDeleteFlow}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.floatingCard}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>Delete account?</Text>
              <TouchableOpacity
                onPress={closeDeleteFlow}
                style={styles.floatingCardClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>
            <Text style={styles.floatingCardBody}>
              Your profile, visits, favourites, friends, and league memberships will be removed
              permanently. This cannot be undone.
            </Text>
            <View style={styles.floatingCardActions}>
              <TouchableOpacity
                style={[
                  styles.floatingActionBtn,
                  styles.floatingActionBtnHalf,
                  styles.floatingActionBtnSecondary,
                ]}
                onPress={closeDeleteFlow}
                activeOpacity={0.75}
              >
                <Text style={styles.floatingActionBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.floatingActionBtn,
                  styles.floatingActionBtnHalf,
                  styles.floatingActionBtnDangerFill,
                ]}
                onPress={handleDeleteAccountConfirm}
                activeOpacity={0.75}
              >
                <Text style={styles.floatingActionBtnTextOnDanger}>Delete account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteModal === DELETE_MODAL.ERROR}
        animationType="fade"
        transparent
        onRequestClose={closeDeleteFlow}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeDeleteFlow}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.floatingCard}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>Something went wrong</Text>
              <TouchableOpacity
                onPress={closeDeleteFlow}
                style={styles.floatingCardClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>
            <Text style={styles.floatingCardBody}>{deleteErrorMessage}</Text>
            <View style={styles.floatingCardActionsSingle}>
              <TouchableOpacity
                style={[
                  styles.floatingActionBtn,
                  styles.floatingActionBtnStretch,
                  styles.floatingActionBtnPrimary,
                ]}
                onPress={closeDeleteFlow}
                activeOpacity={0.75}
              >
                <Text style={styles.floatingActionBtnTextPrimary}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>

    <Modal
      visible={showTrophiesModal}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => setShowTrophiesModal(false)}
    >
      <SafeAreaView style={styles.trophiesModalRoot} edges={['top', 'left', 'right']}>
        <View style={styles.trophiesModalHeader}>
          <Text style={styles.trophiesModalTitle}>Trophies</Text>
          <TouchableOpacity
            onPress={() => setShowTrophiesModal(false)}
            style={styles.trophiesModalClose}
            accessibilityLabel="Close trophies"
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="close" size={28} color={COLORS.darkGrey} />
          </TouchableOpacity>
        </View>
        <UserAchievementsPanel />
      </SafeAreaView>
    </Modal>
    </>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trophyHeaderButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGrey,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trophiesModalRoot: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  trophiesModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  trophiesModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  trophiesModalClose: {
    padding: 8,
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
  floatingModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  floatingCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  floatingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  floatingCardTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'left',
    paddingRight: 8,
  },
  floatingCardClose: {
    padding: 6,
    marginRight: -2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingCardBody: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 20,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: COLORS.accentGrey,
    textAlign: 'left',
  },
  floatingCardActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 22,
    paddingBottom: 22,
    gap: 12,
  },
  floatingCardActionsSingle: {
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  floatingActionBtn: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingActionBtnHalf: {
    flex: 1,
  },
  floatingActionBtnStretch: {
    alignSelf: 'stretch',
  },
  floatingActionBtnSecondary: {
    backgroundColor: COLORS.lightGrey,
  },
  floatingActionBtnDangerOutline: {
    backgroundColor: COLORS.errorLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.errorRed,
  },
  floatingActionBtnDangerFill: {
    backgroundColor: COLORS.errorRed,
  },
  floatingActionBtnPrimary: {
    backgroundColor: COLORS.amber,
  },
  floatingActionBtnTextSecondary: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'center',
  },
  floatingActionBtnTextDanger: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.errorRed,
    textAlign: 'center',
  },
  floatingActionBtnTextOnDanger: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
    textAlign: 'center',
  },
  floatingActionBtnTextPrimary: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.charcoal,
    textAlign: 'center',
  },
  settingsBody: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 22,
  },
  settingsUserCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsUserLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.mediumGrey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    textAlign: 'left',
  },
  settingsUserValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'left',
  },
  settingsUserValueMuted: {
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  settingsPhotoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.mediumGrey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 10,
    textAlign: 'left',
  },
  settingsAvatarRow: {
    alignItems: 'center',
    marginBottom: 4,
  },
  settingsAvatarImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.lightGrey,
  },
  settingsAvatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsAvatarSpinner: {
    marginBottom: 8,
  },
  settingsPhotoActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 10,
    gap: 10,
  },
  settingsPhotoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  settingsPhotoActionBtnPrimary: {
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsPhotoActionBtnMuted: {
    backgroundColor: COLORS.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsPhotoActionBtnDisabled: {
    opacity: 0.45,
  },
  settingsPhotoActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  settingsPhotoActionBtnTextMuted: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  settingsPhotoActionBtnTextDisabled: {
    color: COLORS.mediumGrey,
  },
  settingsScoringCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsScoringLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.mediumGrey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'left',
  },
  scoringRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  scoringRuleRowFirst: {
    marginTop: 4,
  },
  scoringRuleRowTight: {
    marginTop: 8,
  },
  scoringRuleLeft: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  scoringRuleArrow: {
    marginHorizontal: 6,
  },
  scoringRuleValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.amber,
    minWidth: 52,
    textAlign: 'right',
  },
  scoringRuleHint: {
    marginTop: 4,
    marginBottom: 2,
    fontSize: 11,
    lineHeight: 15,
    color: COLORS.mediumGrey,
  },
  scoringRulesDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.divider,
    marginTop: 12,
    marginBottom: 4,
  },
  settingsActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  settingsActionCardNeutral: {
    backgroundColor: COLORS.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsActionCardDanger: {
    backgroundColor: COLORS.errorLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFCDD2',
    marginBottom: 0,
  },
  settingsActionIconSlot: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsActionChevronSlot: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsActionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'left',
    marginLeft: 4,
    marginRight: 4,
  },
  settingsActionLabelDanger: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.errorRed,
    textAlign: 'left',
    marginLeft: 4,
    marginRight: 4,
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
    alignSelf: 'stretch',
    minHeight: 40,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 6,
  },
  levelBarSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.divider,
  },
  levelBarLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  levelBarHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    letterSpacing: 0.3,
  },
  levelBarTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.divider,
    overflow: 'hidden',
  },
  levelBarFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: COLORS.amber,
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