import React, {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  memo,
  startTransition,
} from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Modal,
  Animated,
  InteractionManager,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import AnimatedReanimated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
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
  AREA_COMPLETION_SIZE_TIERS,
  POSTCODE_AREA_COMPLETION_BONUS_POINTS,
  POINTS_NEW_PUB_REPORT,
  POINTS_PUB_CORRECTION_REPORT,
} from '../utils/levelSystem';
import { getAchievedTrophyIds } from '../utils/trophyUtils';
import { CORE_LONDON_AREAS } from '../constants/londonAreas';
import UserAchievementsPanel from '../components/UserAchievementsPanel';

const SORT_MODES = {
  LOCATION: 'location',
  ALPHABETICAL: 'alphabetical',
  MOST_VISITED: 'most_visited',
  PERCENTAGE: 'percentage',
  MOST_DRINKS: 'most_drinks',
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

/** Sub-views inside the single settings modal (nested RN Modals fail on iOS). */
const SETTINGS_PANEL = {
  MAIN: 'main',
  AVATAR: 'avatar',
  REMOVE_AVATAR: 'removeAvatar',
};

/** Map-return level bar + stat number timings (keep in sync). */
const MAP_RETURN_BAR_ONE_BAND_MS = 1700;
const MAP_RETURN_BAR_LEVEL_UP_FILL_MS = 600;
const MAP_RETURN_BAR_LEVEL_UP_SNAP_MS = 1;
const MAP_RETURN_BAR_LEVEL_UP_TAIL_MS = 1200;
const MAP_RETURN_BAR_CROSS_TOTAL_MS =
  MAP_RETURN_BAR_LEVEL_UP_FILL_MS +
  MAP_RETURN_BAR_LEVEL_UP_SNAP_MS +
  MAP_RETURN_BAR_LEVEL_UP_TAIL_MS;

/**
 * Comma-separated thousands (en-GB style). Used in UI-thread worklets — avoid
 * `toLocaleString` / Intl there; Android often has no usable Intl in worklets.
 */
function formatScoreThousandsWorklet(n) {
  'worklet';
  const rounded = Math.round(n);
  const neg = rounded < 0;
  const s = String(Math.abs(rounded));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const digit = s[s.length - 1 - i];
    if (i >= 3 && i % 3 === 0) {
      out = digit + ',' + out;
    } else {
      out = digit + out;
    }
  }
  return neg ? '-' + out : out;
}

const AnimatedStatTextInput =
  AnimatedReanimated.createAnimatedComponent(TextInput);

const DistrictStatRow = memo(function DistrictStatRow({ stat, drinks, onPress }) {
  return (
    <TouchableOpacity
      style={styles.areaCard}
      onPress={() => onPress(stat.district, stat.centerLat, stat.centerLon, stat.postcodeArea)}
      activeOpacity={0.7}
    >
      <View style={styles.areaHeader}>
        <View style={styles.areaTitleRow}>
          <Text style={styles.areaName} numberOfLines={1} ellipsizeMode="tail">
            {stat.districtDisplayName || stat.district}
          </Text>
          {stat.district && String(stat.district).toUpperCase() !== 'UNKNOWN' && (
            <Text style={styles.districtCodeInline} numberOfLines={1} ellipsizeMode="tail">
              {stat.district}
            </Text>
          )}
        </View>
        <View style={styles.areaCountRow}>
          {drinks > 0 && (
            <View style={styles.inlinePints}>
              <MaterialCommunityIcons name="beer-outline" size={13} color={COLORS.amber} />
              <Text style={styles.inlinePintsText}>{drinks}</Text>
            </View>
          )}
          <Text style={styles.areaCount}>
            {stat.visited} / {stat.total}
          </Text>
        </View>
      </View>
      <View style={styles.areaProgressBarContainer}>
        <View style={styles.areaProgressBarBackground}>
          <View style={[styles.areaProgressBarFill, { width: `${stat.percentage}%` }]} />
        </View>
        <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
      </View>
    </TouchableOpacity>
  );
});

const PostcodeAreaStatRow = memo(function PostcodeAreaStatRow({ stat, drinks, onPress }) {
  const isInteractive = stat.postcodeArea && stat.postcodeArea !== 'Unknown';
  return (
    <TouchableOpacity
      style={styles.areaCard}
      onPress={() => onPress(stat.postcodeArea)}
      activeOpacity={isInteractive ? 0.7 : 1}
      disabled={!isInteractive}
    >
      <View style={styles.areaHeader}>
        <Text style={styles.areaName}>{stat.postcodeArea}</Text>
        <View style={styles.areaCountRow}>
          {drinks > 0 && (
            <View style={styles.inlinePints}>
              <MaterialCommunityIcons name="beer-outline" size={13} color={COLORS.amber} />
              <Text style={styles.inlinePintsText}>{drinks}</Text>
            </View>
          )}
          <Text style={styles.areaCount}>
            {stat.visited} / {stat.total}
          </Text>
        </View>
      </View>
      <View style={styles.areaProgressBarContainer}>
        <View style={styles.areaProgressBarBackground}>
          <View style={[styles.areaProgressBarFill, { width: `${stat.percentage}%` }]} />
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
});

export default function ProfileScreen({
  navigation,
  mapReturnAnimationKey = 0,
  mapReturnBaselineScore = 0,
  /** Snapshotted when Map tab is focused (same moment as score baseline). */
  mapReturnBaselineVisited = 0,
  mapReturnBaselineDrinks = 0,
}) {
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
  const [unseenTrophyCount, setUnseenTrophyCount] = useState(0);
  const seenAchievedTrophyIdsRef = useRef(null);
  const [deleteModal, setDeleteModal] = useState(DELETE_MODAL.NONE);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState(SETTINGS_PANEL.MAIN);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);
  const levelBarProgress = useSharedValue(0);
  const mapReturnDisplayScoreSV = useSharedValue(0);
  const mapReturnDisplayPubsSV = useSharedValue(0);
  const mapReturnDisplayDrinksSV = useSharedValue(0);
  /** Baseline/target for map-return; pubs & drinks display tracks score progress between these. */
  const mapReturnAnimBaselineScoreSV = useSharedValue(0);
  const mapReturnAnimTargetScoreSV = useSharedValue(0);
  const mapReturnAnimBaselinePubsSV = useSharedValue(0);
  const mapReturnAnimTargetPubsSV = useSharedValue(0);
  const mapReturnAnimBaselineDrinksSV = useSharedValue(0);
  const mapReturnAnimTargetDrinksSV = useSharedValue(0);
  const reduceMotionEnabled = useReducedMotion();
  const lastLayoutMapReturnKeyRef = useRef(mapReturnAnimationKey);
  const lastDataMapReturnKeyRef = useRef(mapReturnAnimationKey);
  const mapReturnBaselineScoreRef = useRef(0);
  const mapReturnBaselinePubsRef = useRef(0);
  const mapReturnBaselineDrinksRef = useRef(0);
  const mapReturnSequenceActiveRef = useRef(false);
  const mapReturnAwaitingCommitRef = useRef(false);
  const lastProcessedMapReturnCommitRef = useRef(0);
  const latestTotalScoreRef = useRef(0);
  const latestTotalVisitedRef = useRef(0);
  const latestDrinksTotalRef = useRef(0);
  const latestMapReturnAnimationKeyRef = useRef(mapReturnAnimationKey);
  const skipNextProfileFocusRefreshRef = useRef(false);
  const [mapReturnRefreshCommit, setMapReturnRefreshCommit] = useState(0);

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
    if (!showSettingsModal) {
      setSettingsPanel(SETTINGS_PANEL.MAIN);
    }
  }, [showSettingsModal]);

  const closeSettingsModal = useCallback(() => {
    if (avatarBusy) return;
    setShowSettingsModal(false);
    setSettingsPanel(SETTINGS_PANEL.MAIN);
  }, [avatarBusy]);

  const goToSettingsMainPanel = useCallback(() => {
    if (avatarBusy) return;
    setSettingsPanel(SETTINGS_PANEL.MAIN);
  }, [avatarBusy]);

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
      (row) => CORE_LONDON_AREAS.has(row.postcodeArea),
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
        {viewMode === VIEW_MODES.DISTRICT ? 'No areas found' : 'No regions found'}
      </Text>
    ),
    [viewMode],
  );

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
    setSettingsPanel(SETTINGS_PANEL.REMOVE_AVATAR);
  }, [user?.id, user?.avatar_url, avatarBusy]);

  const handleAvatarOptionsChangePhoto = useCallback(() => {
    setSettingsPanel(SETTINGS_PANEL.MAIN);
    handlePickProfilePhoto();
  }, [handlePickProfilePhoto]);

  const handleAvatarOptionsRemove = useCallback(() => {
    handleRemoveProfilePhoto();
  }, [handleRemoveProfilePhoto]);

  const confirmRemoveProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    setSettingsPanel(SETTINGS_PANEL.MAIN);
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
  latestTotalScoreRef.current = totalScore;
  latestTotalVisitedRef.current = totalVisited;
  latestDrinksTotalRef.current = drinkStats.total;
  latestMapReturnAnimationKeyRef.current = mapReturnAnimationKey;
  const levelProgress = useMemo(() => getLevelProgress(totalScore), [totalScore]);
  const levelBarWidth = Math.min(100, Math.max(0, levelProgress.progressPercentage));
  const levelBarProgressTarget = levelBarWidth / 100;

  const animatedLevelBarStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: Math.min(1, Math.max(0.001, levelBarProgress.value)) },
    ],
  }));

  const mapReturnDrinksAnimatedProps = useAnimatedProps(() => {
    'worklet';
    const bS = mapReturnAnimBaselineScoreSV.value;
    const nS = mapReturnAnimTargetScoreSV.value;
    const s = mapReturnDisplayScoreSV.value;
    const bD = mapReturnAnimBaselineDrinksSV.value;
    const nD = mapReturnAnimTargetDrinksSV.value;
    const dS = nS - bS;
    let prog = 1;
    if (Math.abs(dS) >= 1e-6) {
      prog = (s - bS) / dS;
      if (prog < 0) prog = 0;
      if (prog > 1) prog = 1;
    }
    const raw = bD + prog * (nD - bD);
    const display = nD >= bD ? Math.floor(raw + 1e-6) : Math.ceil(raw - 1e-6);
    const t = String(Math.max(0, display));
    return { text: t, defaultValue: t };
  });

  const mapReturnPubsAnimatedProps = useAnimatedProps(() => {
    'worklet';
    const bS = mapReturnAnimBaselineScoreSV.value;
    const nS = mapReturnAnimTargetScoreSV.value;
    const s = mapReturnDisplayScoreSV.value;
    const bP = mapReturnAnimBaselinePubsSV.value;
    const nP = mapReturnAnimTargetPubsSV.value;
    const dS = nS - bS;
    let prog = 1;
    if (Math.abs(dS) >= 1e-6) {
      prog = (s - bS) / dS;
      if (prog < 0) prog = 0;
      if (prog > 1) prog = 1;
    }
    const raw = bP + prog * (nP - bP);
    const display = nP >= bP ? Math.floor(raw + 1e-6) : Math.ceil(raw - 1e-6);
    const t = String(Math.max(0, display));
    return { text: t, defaultValue: t };
  });

  const mapReturnScoreAnimatedProps = useAnimatedProps(() => {
    'worklet';
    const text = formatScoreThousandsWorklet(mapReturnDisplayScoreSV.value);
    return { text, defaultValue: text };
  });

  const mapReturnLevelAnimatedProps = useAnimatedProps(() => {
    'worklet';
    const score = Math.max(0, mapReturnDisplayScoreSV.value);
    const lvl = Math.floor(score / POINTS_PER_LEVEL) + 1;
    const t = String(lvl);
    return { text: t, defaultValue: t };
  });

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

  useLayoutEffect(() => {
    if (mapReturnAnimationKey === lastLayoutMapReturnKeyRef.current) return;

    lastLayoutMapReturnKeyRef.current = mapReturnAnimationKey;
    mapReturnBaselineScoreRef.current = mapReturnBaselineScore;
    mapReturnAwaitingCommitRef.current = true;
    skipNextProfileFocusRefreshRef.current = true;

    cancelAnimation(levelBarProgress);
    cancelAnimation(mapReturnDisplayScoreSV);
    cancelAnimation(mapReturnDisplayPubsSV);
    cancelAnimation(mapReturnDisplayDrinksSV);

    mapReturnBaselinePubsRef.current = mapReturnBaselineVisited;
    mapReturnBaselineDrinksRef.current = mapReturnBaselineDrinks;

    mapReturnDisplayScoreSV.value = mapReturnBaselineScore;
    mapReturnDisplayPubsSV.value = mapReturnBaselineVisited;
    mapReturnDisplayDrinksSV.value = mapReturnBaselineDrinks;

    mapReturnAnimBaselineScoreSV.value = mapReturnBaselineScore;
    mapReturnAnimTargetScoreSV.value = mapReturnBaselineScore;
    mapReturnAnimBaselinePubsSV.value = mapReturnBaselineVisited;
    mapReturnAnimTargetPubsSV.value = mapReturnBaselineVisited;
    mapReturnAnimBaselineDrinksSV.value = mapReturnBaselineDrinks;
    mapReturnAnimTargetDrinksSV.value = mapReturnBaselineDrinks;

    const startPct = Math.min(
      100,
      Math.max(0, getLevelProgress(mapReturnBaselineScore).progressPercentage)
    );
    levelBarProgress.value = Math.min(1, Math.max(0.001, startPct / 100));
  }, [
    drinkStats.total,
    mapReturnAnimationKey,
    mapReturnBaselineDrinks,
    mapReturnBaselineScore,
    mapReturnBaselineVisited,
    levelBarProgress,
    mapReturnAnimBaselineDrinksSV,
    mapReturnAnimBaselinePubsSV,
    mapReturnAnimBaselineScoreSV,
    mapReturnAnimTargetDrinksSV,
    mapReturnAnimTargetPubsSV,
    mapReturnAnimTargetScoreSV,
    mapReturnDisplayDrinksSV,
    mapReturnDisplayPubsSV,
    mapReturnDisplayScoreSV,
    totalVisited,
  ]);

  useEffect(() => {
    if (mapReturnAnimationKey === lastDataMapReturnKeyRef.current) return;
    lastDataMapReturnKeyRef.current = mapReturnAnimationKey;

    const baseline = mapReturnBaselineScoreRef.current;
    const current = latestTotalScoreRef.current;
    const dataKeyForThisRun = mapReturnAnimationKey;

    if (current > baseline) {
      setMapReturnRefreshCommit((c) => c + 1);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        await refreshUserStats();
      } catch (error) {
        console.error('Error refreshing profile stats after map return:', error);
      } finally {
        if (!cancelled) {
          setMapReturnRefreshCommit((c) => c + 1);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (dataKeyForThisRun === latestMapReturnAnimationKeyRef.current) {
        mapReturnAwaitingCommitRef.current = false;
      }
    };
  }, [mapReturnAnimationKey, refreshUserStats]);

  const finishMapReturnBarSequence = useCallback(() => {
    mapReturnSequenceActiveRef.current = false;
  }, []);

  useEffect(() => {
    if (mapReturnRefreshCommit === 0) return;
    if (mapReturnRefreshCommit <= lastProcessedMapReturnCommitRef.current) {
      return;
    }
    lastProcessedMapReturnCommitRef.current = mapReturnRefreshCommit;
    mapReturnAwaitingCommitRef.current = false;

    const baselineScore = mapReturnBaselineScoreRef.current;
    const baselinePubs = mapReturnBaselinePubsRef.current;
    const baselineDrinks = mapReturnBaselineDrinksRef.current;
    const nextScore = latestTotalScoreRef.current;
    const nextPubs = latestTotalVisitedRef.current;
    const nextDrinks = latestDrinksTotalRef.current;

    mapReturnAnimBaselineScoreSV.value = baselineScore;
    mapReturnAnimTargetScoreSV.value = nextScore;
    mapReturnAnimBaselinePubsSV.value = baselinePubs;
    mapReturnAnimTargetPubsSV.value = nextPubs;
    mapReturnAnimBaselineDrinksSV.value = baselineDrinks;
    mapReturnAnimTargetDrinksSV.value = nextDrinks;
    const startProgress =
      Math.min(100, Math.max(0, getLevelProgress(baselineScore).progressPercentage)) / 100;
    const endProgress =
      Math.min(100, Math.max(0, getLevelProgress(nextScore).progressPercentage)) / 100;

    cancelAnimation(levelBarProgress);
    cancelAnimation(mapReturnDisplayScoreSV);
    cancelAnimation(mapReturnDisplayPubsSV);
    cancelAnimation(mapReturnDisplayDrinksSV);

    if (reduceMotionEnabled || nextScore <= baselineScore) {
      levelBarProgress.value = endProgress;
      mapReturnDisplayScoreSV.value = nextScore;
      mapReturnDisplayPubsSV.value = nextPubs;
      mapReturnDisplayDrinksSV.value = nextDrinks;
      mapReturnSequenceActiveRef.current = false;
      return;
    }

    mapReturnSequenceActiveRef.current = true;
    levelBarProgress.value = startProgress;
    mapReturnDisplayScoreSV.value = baselineScore;
    mapReturnDisplayPubsSV.value = baselinePubs;
    mapReturnDisplayDrinksSV.value = baselineDrinks;

    const oneBandTiming = {
      duration: MAP_RETURN_BAR_ONE_BAND_MS,
      easing: Easing.out(Easing.cubic),
    };
    const crossNumberTiming = {
      duration: MAP_RETURN_BAR_CROSS_TOTAL_MS,
      easing: Easing.out(Easing.cubic),
    };

    if (endProgress >= startProgress) {
      mapReturnDisplayScoreSV.value = withTiming(nextScore, oneBandTiming);
      levelBarProgress.value = withTiming(
        endProgress,
        oneBandTiming,
        (finished) => {
          'worklet';
          if (finished) runOnJS(finishMapReturnBarSequence)();
        }
      );
    } else {
      mapReturnDisplayScoreSV.value = withTiming(nextScore, crossNumberTiming);
      levelBarProgress.value = withSequence(
        withTiming(1, {
          duration: MAP_RETURN_BAR_LEVEL_UP_FILL_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
        withTiming(0, { duration: MAP_RETURN_BAR_LEVEL_UP_SNAP_MS }),
        withTiming(endProgress, {
          duration: MAP_RETURN_BAR_LEVEL_UP_TAIL_MS,
          easing: Easing.out(Easing.cubic),
        }, (finished) => {
          'worklet';
          if (finished) runOnJS(finishMapReturnBarSequence)();
        })
      );
    }
  }, [
    finishMapReturnBarSequence,
    levelBarProgress,
    mapReturnAnimBaselineDrinksSV,
    mapReturnAnimBaselinePubsSV,
    mapReturnAnimBaselineScoreSV,
    mapReturnAnimTargetDrinksSV,
    mapReturnAnimTargetPubsSV,
    mapReturnAnimTargetScoreSV,
    mapReturnDisplayScoreSV,
    mapReturnRefreshCommit,
    reduceMotionEnabled,
  ]);

  useEffect(() => {
    if (mapReturnAwaitingCommitRef.current) return;
    if (mapReturnSequenceActiveRef.current) return;
    cancelAnimation(levelBarProgress);
    cancelAnimation(mapReturnDisplayScoreSV);
    cancelAnimation(mapReturnDisplayPubsSV);
    cancelAnimation(mapReturnDisplayDrinksSV);
    levelBarProgress.value = levelBarProgressTarget;
    mapReturnDisplayScoreSV.value = totalScore;
    mapReturnDisplayPubsSV.value = totalVisited;
    mapReturnDisplayDrinksSV.value = drinkStats.total;
    mapReturnAnimBaselineScoreSV.value = totalScore;
    mapReturnAnimTargetScoreSV.value = totalScore;
    mapReturnAnimBaselinePubsSV.value = totalVisited;
    mapReturnAnimTargetPubsSV.value = totalVisited;
    mapReturnAnimBaselineDrinksSV.value = drinkStats.total;
    mapReturnAnimTargetDrinksSV.value = drinkStats.total;
  }, [
    drinkStats.total,
    levelBarProgress,
    levelBarProgressTarget,
    mapReturnAnimBaselineDrinksSV,
    mapReturnAnimBaselinePubsSV,
    mapReturnAnimBaselineScoreSV,
    mapReturnAnimTargetDrinksSV,
    mapReturnAnimTargetPubsSV,
    mapReturnAnimTargetScoreSV,
    mapReturnDisplayDrinksSV,
    mapReturnDisplayPubsSV,
    mapReturnDisplayScoreSV,
    totalScore,
    totalVisited,
  ]);

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

      {/* ── Primary stats card: Drinks | Pubs ─────────────────────── */}
      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <AnimatedStatTextInput
              animatedProps={mapReturnDrinksAnimatedProps}
              style={styles.statNumberInput}
              editable={false}
              showSoftInputOnFocus={false}
              underlineColorAndroid="transparent"
              importantForAccessibility="no"
            />
            <Text style={styles.statItemLabel}>Drinks</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <AnimatedStatTextInput
              animatedProps={mapReturnPubsAnimatedProps}
              style={styles.statNumberInput}
              editable={false}
              showSoftInputOnFocus={false}
              underlineColorAndroid="transparent"
              importantForAccessibility="no"
            />
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
            <AnimatedStatTextInput
              animatedProps={mapReturnLevelAnimatedProps}
              style={styles.statNumberSmallInput}
              editable={false}
              showSoftInputOnFocus={false}
              underlineColorAndroid="transparent"
              importantForAccessibility="no"
            />
            <Text style={styles.statItemLabelSmall}>Level</Text>
          </View>
          <View style={styles.statDividerSmall} />
          <View style={styles.statItem}>
            <AnimatedStatTextInput
              animatedProps={mapReturnScoreAnimatedProps}
              style={[styles.statNumberSmallInput, styles.statScoreAnimatedInput]}
              editable={false}
              showSoftInputOnFocus={false}
              underlineColorAndroid="transparent"
              numberOfLines={1}
              {...(Platform.OS === 'ios'
                ? { adjustsFontSizeToFit: true, minimumFontScale: 0.65 }
                : {})}
              importantForAccessibility="no"
            />
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
          <View
            style={styles.levelBarTrack}
            importantForAccessibility="no"
            collapsable={false}
            {...(Platform.OS === 'android' ? { renderToHardwareTextureAndroid: true } : {})}
          >
            <AnimatedReanimated.View
              pointerEvents="none"
              style={[styles.levelBarFill, animatedLevelBarStyle]}
            />
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
              accessibilityLabel="Sort and filter areas"
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

            <ScrollView
              style={styles.filterModalScroll}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
            <Text style={styles.filterSectionLabel}>Sort by</Text>
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

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.MOST_DRINKS && styles.filterOptionSelected,
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.MOST_DRINKS);
                setShowFilterModal(false);
              }}
            >
              <Text
                style={[
                  styles.filterOptionText,
                  sortMode === SORT_MODES.MOST_DRINKS && styles.filterOptionTextSelected,
                ]}
              >
                Most drinks
              </Text>
              {sortMode === SORT_MODES.MOST_DRINKS && (
                <MaterialCommunityIcons name="check" size={20} color={COLORS.darkGrey} />
              )}
            </TouchableOpacity>

            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={showSettingsModal}
        animationType="fade"
        transparent
        onRequestClose={closeSettingsModal}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeSettingsModal}
            accessibilityLabel="Dismiss settings"
          />
          <View style={styles.floatingCard} onStartShouldSetResponder={() => true}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>
                {settingsPanel === SETTINGS_PANEL.AVATAR
                  ? 'Profile photo'
                  : settingsPanel === SETTINGS_PANEL.REMOVE_AVATAR
                    ? 'Remove profile photo?'
                    : 'Settings'}
              </Text>
              <TouchableOpacity
                onPress={
                  settingsPanel === SETTINGS_PANEL.MAIN
                    ? closeSettingsModal
                    : goToSettingsMainPanel
                }
                style={styles.floatingCardClose}
                accessibilityLabel={
                  settingsPanel === SETTINGS_PANEL.MAIN ? 'Close settings' : 'Back'
                }
                accessibilityRole="button"
                disabled={avatarBusy}
              >
                <MaterialCommunityIcons
                  name={settingsPanel === SETTINGS_PANEL.MAIN ? 'close' : 'arrow-left'}
                  size={22}
                  color={COLORS.darkGrey}
                />
              </TouchableOpacity>
            </View>

            {settingsPanel === SETTINGS_PANEL.AVATAR ? (
              <View style={styles.floatingCardPickerBody}>
                <TouchableOpacity
                  style={[
                    styles.settingsActionCard,
                    styles.settingsActionCardNeutral,
                    styles.avatarPickerAction,
                  ]}
                  onPress={handleAvatarOptionsChangePhoto}
                  activeOpacity={0.75}
                  disabled={avatarBusy || !user?.id}
                  accessibilityLabel="Change profile photo"
                  accessibilityRole="button"
                >
                  <View style={styles.settingsActionIconSlot}>
                    <MaterialCommunityIcons name="camera-outline" size={22} color={COLORS.darkGrey} />
                  </View>
                  <Text style={styles.settingsActionLabel}>Change photo</Text>
                </TouchableOpacity>
                {user?.avatar_url ? (
                  <TouchableOpacity
                    style={[styles.settingsActionCard, styles.settingsActionCardDanger]}
                    onPress={handleAvatarOptionsRemove}
                    activeOpacity={0.75}
                    disabled={avatarBusy}
                    accessibilityLabel="Remove profile photo"
                    accessibilityRole="button"
                  >
                    <View style={styles.settingsActionIconSlot}>
                      <MaterialCommunityIcons name="trash-can-outline" size={22} color={COLORS.errorRed} />
                    </View>
                    <Text style={styles.settingsActionLabelDanger}>Remove photo</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {settingsPanel === SETTINGS_PANEL.REMOVE_AVATAR ? (
              <>
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
                    onPress={goToSettingsMainPanel}
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
              </>
            ) : null}

            {settingsPanel === SETTINGS_PANEL.MAIN ? (
            <View style={styles.settingsBody}>
              <View style={styles.settingsUserCard}>
                <View style={styles.settingsUserTopRow}>
                  <View style={styles.settingsUserTextCol}>
                    <Text style={styles.settingsUserLabel}>Username</Text>
                    <Text
                      style={[
                        styles.settingsUserValue,
                        !user?.username && styles.settingsUserValueMuted,
                      ]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {user?.username?.trim() ? user.username : 'Not set yet'}
                    </Text>
                  </View>
                  <View style={styles.settingsUserRightCol}>
                    <View style={styles.settingsAvatarTapWrap}>
                      <TouchableOpacity
                        onPress={() => !avatarBusy && user?.id && setSettingsPanel(SETTINGS_PANEL.AVATAR)}
                        disabled={avatarBusy || !user?.id}
                        activeOpacity={0.82}
                        accessibilityLabel="Profile photo — change or remove"
                        accessibilityRole="button"
                        style={styles.settingsAvatarTouchable}
                      >
                        <View style={styles.settingsAvatarWrap}>
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
                      </TouchableOpacity>
                      {avatarBusy ? (
                        <View style={styles.settingsAvatarBusyOverlay} pointerEvents="none">
                          <ActivityIndicator color={COLORS.amber} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.settingsScoringCard}>
                <Text style={styles.settingsScoringLabel}>Scoring</Text>

                <View style={styles.scoringVisualRow}>
                  <View style={styles.scoringVisualHalf}>
                    <Text style={styles.scoringVisualWord}>Pub</Text>
                    <MaterialCommunityIcons
                      name="arrow-right"
                      size={16}
                      color={COLORS.mediumGrey}
                      style={styles.scoringVisualArrow}
                    />
                    <Text style={styles.scoringVisualPoints}>
                      +{DEFAULT_PUB_VISIT_POINTS}
                    </Text>
                  </View>
                  <View style={styles.scoringVisualHalf}>
                    <Text style={styles.scoringVisualWord}>Drinks</Text>
                    <MaterialCommunityIcons
                      name="arrow-right"
                      size={16}
                      color={COLORS.mediumGrey}
                      style={styles.scoringVisualArrow}
                    />
                    <Text style={styles.scoringVisualPoints}>+{POINTS_PER_DRINK}</Text>
                  </View>
                </View>

                <Text style={styles.scoringSectionTitle}>Area</Text>

                <View style={styles.scoringGridRow}>
                  {AREA_COMPLETION_SIZE_TIERS.map((tier) => (
                    <View key={tier.key} style={styles.scoringGridCell}>
                      <Text style={styles.scoringGridLabel}>{tier.key}</Text>
                    </View>
                  ))}
                  <View style={styles.scoringGridCell}>
                    <Text style={styles.scoringGridLabel}>Region</Text>
                  </View>
                </View>

                <View style={[styles.scoringGridRow, styles.scoringGridRowPoints]}>
                  {AREA_COMPLETION_SIZE_TIERS.map((tier) => (
                    <View key={tier.key} style={styles.scoringGridCell}>
                      <Text style={styles.scoringGridPoints}>+{tier.points}</Text>
                    </View>
                  ))}
                  <View style={styles.scoringGridCell}>
                    <Text style={styles.scoringGridPoints}>
                      +{POSTCODE_AREA_COMPLETION_BONUS_POINTS}
                    </Text>
                  </View>
                </View>

                <Text style={styles.scoringSectionTitle}>Corrections</Text>

                <View style={styles.scoringCorrectionsBlock}>
                  <View style={[styles.scoringCorrectionRow, styles.scoringCorrectionRowFirst]}>
                    <Text style={styles.scoringCorrectionLabel}>Missing Pub Corrected</Text>
                    <MaterialCommunityIcons
                      name="arrow-right"
                      size={16}
                      color={COLORS.mediumGrey}
                      style={styles.scoringCorrectionArrow}
                    />
                    <Text style={styles.scoringCorrectionPoints}>
                      +{POINTS_NEW_PUB_REPORT}
                    </Text>
                  </View>
                  <View style={styles.scoringCorrectionRow}>
                    <Text style={styles.scoringCorrectionLabel}>Pub Attribute Corrected</Text>
                    <MaterialCommunityIcons
                      name="arrow-right"
                      size={16}
                      color={COLORS.mediumGrey}
                      style={styles.scoringCorrectionArrow}
                    />
                    <Text style={styles.scoringCorrectionPoints}>
                      +{POINTS_PUB_CORRECTION_REPORT}
                    </Text>
                  </View>
                </View>

                <View style={styles.scoringLevelRow}>
                  <Text style={styles.scoringLevelPoints}>+{POINTS_PER_LEVEL}</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={16}
                    color={COLORS.mediumGrey}
                    style={styles.scoringVisualArrow}
                  />
                  <Text style={styles.scoringLevelOutcome}>+1 Level</Text>
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
            ) : null}
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
  floatingCardPickerBody: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 22,
    gap: 10,
  },
  avatarPickerAction: {
    marginBottom: 0,
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
  settingsUserTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsUserTextCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  settingsUserRightCol: {
    width: 88,
    flexShrink: 0,
    alignItems: 'center',
  },
  settingsAvatarTapWrap: {
    position: 'relative',
  },
  settingsAvatarTouchable: {
    borderRadius: 44,
    overflow: 'hidden',
  },
  settingsAvatarBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 44,
    backgroundColor: 'rgba(247, 247, 247, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsAvatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
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
  scoringVisualRow: {
    flexDirection: 'row',
    marginTop: 4,
    marginBottom: 16,
  },
  scoringVisualHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  scoringVisualWord: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  scoringVisualArrow: {
    marginHorizontal: 6,
  },
  scoringVisualPoints: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.amber,
  },
  scoringGridRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoringGridRowPoints: {
    marginTop: 6,
    marginBottom: 16,
  },
  scoringGridCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  scoringGridLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
  },
  scoringGridPoints: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.amber,
    textAlign: 'center',
  },
  scoringSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
    marginBottom: 10,
  },
  scoringCorrectionsBlock: {
    marginBottom: 14,
  },
  scoringCorrectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  scoringCorrectionRowFirst: {
    marginTop: 0,
  },
  scoringCorrectionLabel: {
    flex: 1,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.accentGrey,
    marginRight: 4,
  },
  scoringCorrectionArrow: {
    marginHorizontal: 6,
    flexShrink: 0,
  },
  scoringCorrectionPoints: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.amber,
    flexShrink: 0,
    minWidth: 36,
    textAlign: 'right',
  },
  scoringLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  scoringLevelPoints: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.amber,
  },
  scoringLevelOutcome: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.burgundy,
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
  statNumberInput: {
    fontSize: 42,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
    textAlign: 'center',
    padding: 0,
    margin: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    minWidth: 56,
    includeFontPadding: false,
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
  statNumberSmallInput: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
    textAlign: 'center',
    padding: 0,
    margin: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    minWidth: 40,
    includeFontPadding: false,
  },
  statScoreAnimatedInput: {
    width: '100%',
    maxWidth: '100%',
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
    position: 'relative',
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.divider,
    overflow: 'hidden',
  },
  levelBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    borderRadius: 5,
    backgroundColor: COLORS.amber,
    transformOrigin: 'left',
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
  filterModalScroll: {
    maxHeight: 420,
  },
  filterSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
});