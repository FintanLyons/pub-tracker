import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Modal,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RangeSlider from '../components/RangeSlider';
import FavoritesFilterModal from '../components/FavoritesFilterModal';
import { COLORS } from '../constants/theme';
import { PUB_FEATURE_CHIPS } from '../constants/pubFeatureChips';

const CLOSING_TIME_OPTIONS = [
  { label: 'Open now', value: 'open_now', icon: 'clock-check-outline' },
  { label: 'Open past midnight', value: 'past_midnight', icon: 'weather-night' },
];

const RATING_FILTER_OPTIONS = [
  { label: '3.0', value: 3 },
  { label: '3.5', value: 3.5 },
  { label: '4.0', value: 4.0 },
  { label: '4.5', value: 4.5 },
];

/** Horizontal padding for filter chip sections; gap between chips in a row. */
const FILTER_SECTION_PAD = 12;
const FILTER_CHIP_GAP = 8;

const OWNERSHIP_GRID_ROWS = 3;
const OWNERSHIP_PER_PAGE = OWNERSHIP_GRID_ROWS * 2;
const FILTER_CHIP_MIN_H = 52;

const chunkOwnership = (items, pageSize) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += pageSize) {
    chunks.push(items.slice(i, i + pageSize));
  }
  return chunks;
};

export default function FilterScreen({ 
  visible, 
  onClose, 
  selectedFeatures,
  allOwnerships,
  selectedOwnerships,
  yearRange,
  minYear,
  maxYear,
  favoritesFilterUserIds,
  currentUserId,
  currentUser,
  showOnlyAchievements,
  closingTimeMin,
  minRating,
  onApply 
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const sheetTranslateY = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    if (visible) {
      sheetTranslateY.setValue(windowHeight);
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
    } else {
      sheetTranslateY.setValue(windowHeight);
    }
  }, [visible, sheetTranslateY, windowHeight]);
  const filterChipWidth =
    Math.floor((windowWidth - FILTER_SECTION_PAD * 2 - FILTER_CHIP_GAP) / 2);
  const defaultYearRange = { min: minYear || 1800, max: maxYear || 2025 };
  const [localSelectedFeatures, setLocalSelectedFeatures] = useState(new Set(selectedFeatures));
  const [localSelectedOwnerships, setLocalSelectedOwnerships] = useState(new Set(selectedOwnerships || []));
  const [localYearRange, setLocalYearRange] = useState(yearRange || defaultYearRange);
  const [localFavoritesFilterUserIds, setLocalFavoritesFilterUserIds] = useState(
    favoritesFilterUserIds || []
  );
  const [favoritesPickerVisible, setFavoritesPickerVisible] = useState(false);
  const [localShowOnlyAchievements, setLocalShowOnlyAchievements] = useState(showOnlyAchievements || false);
  const [localClosingTimeMin, setLocalClosingTimeMin] = useState(closingTimeMin || null);
  const [localMinRating, setLocalMinRating] = useState(minRating ?? null);

  useEffect(() => {
    setLocalSelectedFeatures(new Set(selectedFeatures));
    setLocalSelectedOwnerships(new Set(selectedOwnerships || []));
    setLocalYearRange(yearRange || defaultYearRange);
    setLocalFavoritesFilterUserIds(favoritesFilterUserIds || []);
    setLocalShowOnlyAchievements(showOnlyAchievements || false);
    setLocalClosingTimeMin(closingTimeMin || null);
    setLocalMinRating(minRating ?? null);
    if (!visible) setFavoritesPickerVisible(false);
  }, [
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    minYear,
    maxYear,
    favoritesFilterUserIds,
    showOnlyAchievements,
    closingTimeMin,
    minRating,
    visible,
  ]);

  const allFeatureNames = PUB_FEATURE_CHIPS.map((f) => f.name);
  const allFeaturesSelected = allFeatureNames.every((n) => localSelectedFeatures.has(n));

  const toggleFeature = (feature) => {
    const newSet = new Set(localSelectedFeatures);
    if (newSet.has(feature)) {
      newSet.delete(feature);
    } else {
      newSet.add(feature);
    }
    setLocalSelectedFeatures(newSet);
  };

  const toggleAllFeatures = () => {
    if (allFeaturesSelected) {
      setLocalSelectedFeatures(new Set());
    } else {
      setLocalSelectedFeatures(new Set(allFeatureNames));
    }
  };

  const toggleOwnership = (ownership) => {
    const newSet = new Set(localSelectedOwnerships);
    if (newSet.has(ownership)) {
      newSet.delete(ownership);
    } else {
      newSet.add(ownership);
    }
    setLocalSelectedOwnerships(newSet);
  };

  const handleClear = () => {
    setLocalSelectedFeatures(new Set());
    setLocalSelectedOwnerships(new Set());
    setLocalYearRange(defaultYearRange);
    setLocalFavoritesFilterUserIds([]);
    setLocalShowOnlyAchievements(false);
    setLocalClosingTimeMin(null);
    setLocalMinRating(null);
  };

  const handleYearRangeChange = (range) => {
    setLocalYearRange(range);
  };

  const ownershipPanels = useMemo(
    () => chunkOwnership(allOwnerships || [], OWNERSHIP_PER_PAGE),
    [allOwnerships],
  );

  const ownershipPanelWidth = filterChipWidth * 2 + FILTER_CHIP_GAP;
  const ownershipStripHeight =
    FILTER_CHIP_MIN_H * OWNERSHIP_GRID_ROWS + FILTER_CHIP_GAP * (OWNERSHIP_GRID_ROWS - 1);

  const favoritesFilterActive = localFavoritesFilterUserIds.length > 0;

  const handleFavoritesPickerApply = (userIds) => {
    setLocalFavoritesFilterUserIds(userIds);
    setFavoritesPickerVisible(false);
  };

  const handleApply = () => {
    const isFullRange = localYearRange.min === (minYear || 1800) && localYearRange.max === (maxYear || 2025);
    onApply({
      features: Array.from(localSelectedFeatures),
      ownerships: Array.from(localSelectedOwnerships),
      yearRange: isFullRange ? null : localYearRange,
      favoritesFilterUserIds: localFavoritesFilterUserIds,
      showOnlyAchievements: localShowOnlyAchievements,
      closingTimeMin: localClosingTimeMin,
      minRating: localMinRating,
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={onClose}
          accessibilityLabel="Dismiss filters"
          accessibilityRole="button"
        />
        <Animated.View
          style={[
            styles.modalContent,
            { transform: [{ translateY: sheetTranslateY }] },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Filter Pubs</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={COLORS.amber} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {/* Quick Filters */}
            <View style={[styles.filterRowSection, styles.filterSectionFirst]}>
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  { width: filterChipWidth },
                  favoritesFilterActive && styles.featureBoxSelected
                ]}
                onPress={() => setFavoritesPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Filter by favourites"
                accessibilityState={{ selected: favoritesFilterActive }}
              >
                <MaterialCommunityIcons
                  name="heart"
                  size={18}
                  color={favoritesFilterActive ? COLORS.amber : COLORS.mediumGrey}
                  style={styles.filterIconInline}
                />
                <Text style={[
                  styles.featureBoxText,
                  favoritesFilterActive && styles.featureBoxTextSelected
                ]}>
                  Favourites
                  {favoritesFilterActive ? ` (${localFavoritesFilterUserIds.length})` : ''}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterChip,
                  { width: filterChipWidth },
                  localShowOnlyAchievements && styles.featureBoxSelected
                ]}
                onPress={() => setLocalShowOnlyAchievements(!localShowOnlyAchievements)}
                accessibilityRole="button"
                accessibilityLabel="Show only notable pubs"
                accessibilityState={{ selected: localShowOnlyAchievements }}
              >
                <MaterialCommunityIcons
                  name="trophy"
                  size={18}
                  color={localShowOnlyAchievements ? COLORS.amber : COLORS.mediumGrey}
                  style={styles.filterIconInline}
                />
                <Text style={[
                  styles.featureBoxText,
                  localShowOnlyAchievements && styles.featureBoxTextSelected
                ]}>
                  Notable
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Rating</Text>
            <View style={styles.ratingFilterRow}>
              {RATING_FILTER_OPTIONS.map((opt) => {
                const isActive = localMinRating === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[
                      styles.ratingFilterChip,
                      isActive && styles.featureBoxSelected,
                    ]}
                    onPress={() => setLocalMinRating(isActive ? null : opt.value)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`At least ${opt.label} stars`}
                  >
                    <View style={styles.ratingFilterValueRow}>
                      <Text
                        style={[
                          styles.ratingFilterText,
                          isActive && styles.featureBoxTextSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <MaterialCommunityIcons
                        name="star"
                        size={14}
                        color={isActive ? COLORS.amber : COLORS.mediumGrey}
                      />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>Features</Text>
            <View style={styles.filterRowSection}>
              {PUB_FEATURE_CHIPS.map((feature) => {
                const isSelected = localSelectedFeatures.has(feature.name);
                return (
                  <TouchableOpacity
                    key={feature.name}
                    style={[
                      styles.filterChip,
                      { width: filterChipWidth },
                      isSelected && styles.featureBoxSelected,
                    ]}
                    onPress={() => toggleFeature(feature.name)}
                  >
                    <MaterialCommunityIcons
                      name={feature.icon}
                      size={18}
                      color={isSelected ? COLORS.amber : COLORS.mediumGrey}
                      style={styles.filterIconInline}
                    />
                    <Text style={[
                      styles.featureBoxText,
                      isSelected && styles.featureBoxTextSelected
                    ]}>
                      {feature.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  { width: filterChipWidth },
                  allFeaturesSelected && styles.featureBoxSelected,
                ]}
                onPress={toggleAllFeatures}
              >
                <MaterialCommunityIcons
                  name="check-all"
                  size={18}
                  color={allFeaturesSelected ? COLORS.amber : COLORS.mediumGrey}
                  style={styles.filterIconInline}
                />
                <Text style={[
                  styles.featureBoxText,
                  allFeaturesSelected && styles.featureBoxTextSelected,
                ]}>
                  All
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Closing Time</Text>
            <View style={styles.filterRowSection}>
              {CLOSING_TIME_OPTIONS.map((opt) => {
                const isActive = localClosingTimeMin === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.filterChip,
                      { width: filterChipWidth },
                      isActive && styles.featureBoxSelected,
                    ]}
                    onPress={() => setLocalClosingTimeMin(isActive ? null : opt.value)}
                  >
                    <MaterialCommunityIcons
                      name={opt.icon}
                      size={18}
                      color={isActive ? COLORS.amber : COLORS.mediumGrey}
                      style={styles.filterIconInline}
                    />
                    <Text
                      style={[styles.featureBoxText, isActive && styles.featureBoxTextSelected]}
                      numberOfLines={2}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>Ownership</Text>
            {allOwnerships && allOwnerships.length > 0 ? (
              <View style={styles.ownershipStripOuter}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  nestedScrollEnabled
                  style={[styles.ownershipScroll, { height: ownershipStripHeight }]}
                  contentContainerStyle={[
                    styles.ownershipScrollContent,
                    { paddingRight: FILTER_SECTION_PAD },
                  ]}
                >
                  {ownershipPanels.map((panel, panelIndex) => (
                    <View
                      key={panelIndex}
                      style={[
                        styles.ownershipPanel,
                        {
                          width: ownershipPanelWidth,
                          minHeight: ownershipStripHeight,
                          marginRight:
                            panelIndex < ownershipPanels.length - 1 ? FILTER_CHIP_GAP : 0,
                        },
                      ]}
                    >
                      {panel.map((ownership) => {
                        const isSelected = localSelectedOwnerships.has(ownership);
                        return (
                          <TouchableOpacity
                            key={ownership}
                            style={[
                              styles.filterChip,
                              { width: filterChipWidth },
                              isSelected && styles.featureBoxSelected,
                            ]}
                            onPress={() => toggleOwnership(ownership)}
                          >
                            <Text
                              style={[
                                styles.featureBoxText,
                                isSelected && styles.featureBoxTextSelected,
                              ]}
                              numberOfLines={2}
                            >
                              {ownership}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
                {ownershipPanels.length > 1 && (
                  <View pointerEvents="none" style={styles.ownershipScrollHint}>
                    <View style={styles.ownershipScrollHintFade} />
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={22}
                      color={COLORS.charcoal}
                      style={styles.ownershipScrollHintIcon}
                    />
                  </View>
                )}
              </View>
            ) : (
              <Text style={styles.ownershipEmpty}>No ownership types in loaded pubs</Text>
            )}

            <Text style={[styles.sectionTitle, styles.sectionTitleTight]}>Founded Year</Text>
            <RangeSlider
              min={minYear || 1800}
              max={maxYear || 2025}
              minValue={localYearRange.min}
              maxValue={localYearRange.max}
              onValueChange={handleYearRangeChange}
              step={1}
            />
          </ScrollView>

          <View style={[styles.buttonContainer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity 
              style={[styles.button, styles.clearButton]} 
              onPress={handleClear}
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.button, styles.applyButton]} 
              onPress={handleApply}
            >
              <Text style={styles.applyButtonText}>Apply Changes</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <FavoritesFilterModal
          embedded
          visible={favoritesPickerVisible}
          onClose={() => setFavoritesPickerVisible(false)}
          onApply={handleFavoritesPickerApply}
          currentUserId={currentUserId}
          currentUser={currentUser}
          initialSelectedIds={localFavoritesFilterUserIds}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGrey,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.charcoal,
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  filterRowSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: FILTER_SECTION_PAD,
    gap: FILTER_CHIP_GAP,
    marginBottom: FILTER_CHIP_GAP,
  },
  filterSectionFirst: {
    paddingTop: 16,
  },
  ratingFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: FILTER_SECTION_PAD,
    gap: FILTER_CHIP_GAP,
    marginBottom: FILTER_CHIP_GAP,
  },
  ratingFilterChip: {
    flex: 1,
    minWidth: 0,
    minHeight: FILTER_CHIP_MIN_H,
    flexDirection: 'row',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  ratingFilterValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingFilterText: {
    fontSize: 13,
    color: COLORS.charcoal,
    fontWeight: '600',
  },
  filterChip: {
    minHeight: FILTER_CHIP_MIN_H,
    flexDirection: 'row',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  filterIconInline: {
    marginRight: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.charcoal,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
  },
  sectionTitleTight: {
    marginBottom: -8,
  },
  ownershipStripOuter: {
    position: 'relative',
    marginBottom: FILTER_CHIP_GAP,
  },
  ownershipScroll: {
    marginLeft: FILTER_SECTION_PAD,
  },
  ownershipScrollContent: {
    paddingRight: 0,
    alignItems: 'flex-start',
  },
  ownershipPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: FILTER_CHIP_GAP,
    alignContent: 'flex-start',
  },
  ownershipScrollHint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ownershipScrollHintFade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    opacity: 0.34,
  },
  ownershipScrollHintIcon: {
    opacity: 0.26,
    marginLeft: 4,
  },
  featureBoxSelected: {
    backgroundColor: '#FFF8E7',
    borderColor: COLORS.amber,
  },
  featureBoxText: {
    fontSize: 13,
    color: COLORS.charcoal,
    textAlign: 'center',
    fontWeight: '500',
  },
  featureBoxTextSelected: {
    color: COLORS.charcoal,
    fontWeight: '700',
  },
  ownershipEmpty: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    paddingHorizontal: FILTER_SECTION_PAD,
    paddingVertical: 8,
    marginBottom: FILTER_CHIP_GAP,
    fontStyle: 'italic',
  },
  buttonContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.lightGrey,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    backgroundColor: COLORS.lightGrey,
    borderWidth: 2,
    borderColor: COLORS.mediumGrey,
    marginRight: 12,
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.charcoal,
  },
  applyButton: {
    backgroundColor: COLORS.charcoal,
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

