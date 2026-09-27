import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { COLORS } from '../../constants/theme';
import { getLevelProgress, POINTS_PER_LEVEL } from '../../utils/levelSystem';

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

/**
 * Drinks / Pubs and Districts / Level / Score cards with the level bar.
 * When `mapReturnAnimationKey` changes (coming back from the Map tab), the numbers
 * and bar animate from the baseline snapshot to the refreshed stats.
 * `onMapReturnStart` fires synchronously at that moment (the screen skips its own
 * focus refresh because this component refreshes).
 */
export default function ProfileStatsCards({
  totalScore,
  totalVisited,
  drinksTotal,
  completedAreas,
  refreshUserStats,
  mapReturnAnimationKey = 0,
  mapReturnBaselineScore = 0,
  mapReturnBaselineVisited = 0,
  mapReturnBaselineDrinks = 0,
  onMapReturnStart,
}) {
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
  const [mapReturnRefreshCommit, setMapReturnRefreshCommit] = useState(0);

  latestTotalScoreRef.current = totalScore;
  latestTotalVisitedRef.current = totalVisited;
  latestDrinksTotalRef.current = drinksTotal;
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

  useLayoutEffect(() => {
    if (mapReturnAnimationKey === lastLayoutMapReturnKeyRef.current) return;

    lastLayoutMapReturnKeyRef.current = mapReturnAnimationKey;
    mapReturnBaselineScoreRef.current = mapReturnBaselineScore;
    mapReturnAwaitingCommitRef.current = true;
    onMapReturnStart?.();

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
    drinksTotal,
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
    mapReturnDisplayDrinksSV.value = drinksTotal;
    mapReturnAnimBaselineScoreSV.value = totalScore;
    mapReturnAnimTargetScoreSV.value = totalScore;
    mapReturnAnimBaselinePubsSV.value = totalVisited;
    mapReturnAnimTargetPubsSV.value = totalVisited;
    mapReturnAnimBaselineDrinksSV.value = drinksTotal;
    mapReturnAnimTargetDrinksSV.value = drinksTotal;
  }, [
    drinksTotal,
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
    {/* ── Primary stats card: Drinks | Pubs ─────────────────────── */}
    <View style={styles.statsCard}>
      <View style={styles.statsRow}>
        <View style={styles.statItem} accessible accessibilityLabel={`${drinksTotal} drinks`}>
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
        <View style={styles.statItem} accessible accessibilityLabel={`${totalVisited} pubs visited`}>
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
        <View style={styles.statItem} accessible accessibilityLabel={`${completedAreas} districts completed`}>
          <Text style={styles.statNumberSmall}>{completedAreas}</Text>
          <Text style={styles.statItemLabelSmall}>Districts</Text>
        </View>
        <View style={styles.statDividerSmall} />
        <View style={styles.statItem} accessible accessibilityLabel={`Level ${levelProgress.level}`}>
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
        <View style={styles.statItem} accessible accessibilityLabel={`Score ${totalScore}`}>
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
    </>
  );
}

const styles = StyleSheet.create({
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
});
