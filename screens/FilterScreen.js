import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  TouchableOpacity, 
  StyleSheet,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RangeSlider from '../components/RangeSlider';
import { COLORS } from '../constants/theme';

const ALL_FEATURES_WITH_ICONS = [
  { name: 'Pub garden', icon: 'tree' },
  { name: 'Live music', icon: 'music' },
  { name: 'Food available', icon: 'silverware-fork-knife' },
  { name: 'Dog friendly', icon: 'dog' },
  { name: 'Pool/darts', icon: 'billiards' },
  { name: 'Accommodation', icon: 'bed' },
];

const CLOSING_TIME_OPTIONS = [
  { label: 'Open now', value: 'open_now', icon: 'clock-check-outline' },
  { label: 'Open past midnight', value: 'past_midnight', icon: 'weather-night' },
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
  allFeatures, 
  selectedFeatures,
  allOwnerships,
  selectedOwnerships,
  yearRange,
  minYear,
  maxYear,
  showOnlyFavorites,
  showOnlyAchievements,
  closingTimeMin,
  onApply 
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const filterChipWidth =
    Math.floor((windowWidth - FILTER_SECTION_PAD * 2 - FILTER_CHIP_GAP) / 2);
  const defaultYearRange = { min: minYear || 1800, max: maxYear || 2025 };
  const [localSelectedFeatures, setLocalSelectedFeatures] = useState(new Set(selectedFeatures));
  const [localSelectedOwnerships, setLocalSelectedOwnerships] = useState(new Set(selectedOwnerships || []));
  const [localYearRange, setLocalYearRange] = useState(yearRange || defaultYearRange);
  const [localShowOnlyFavorites, setLocalShowOnlyFavorites] = useState(showOnlyFavorites || false);
  const [localShowOnlyAchievements, setLocalShowOnlyAchievements] = useState(showOnlyAchievements || false);
  const [localClosingTimeMin, setLocalClosingTimeMin] = useState(closingTimeMin || null);

  useEffect(() => {
    setLocalSelectedFeatures(new Set(selectedFeatures));
    setLocalSelectedOwnerships(new Set(selectedOwnerships || []));
    setLocalYearRange(yearRange || defaultYearRange);
    setLocalShowOnlyFavorites(showOnlyFavorites || false);
    setLocalShowOnlyAchievements(showOnlyAchievements || false);
    setLocalClosingTimeMin(closingTimeMin || null);
  }, [selectedFeatures, selectedOwnerships, yearRange, minYear, maxYear, showOnlyFavorites, showOnlyAchievements, closingTimeMin, visible]);

  const toggleFeature = (feature) => {
    const newSet = new Set(localSelectedFeatures);
    if (newSet.has(feature)) {
      newSet.delete(feature);
    } else {
      newSet.add(feature);
    }
    setLocalSelectedFeatures(newSet);
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
    setLocalShowOnlyFavorites(false);
    setLocalShowOnlyAchievements(false);
    setLocalClosingTimeMin(null);
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

  const handleApply = () => {
    const isFullRange = localYearRange.min === (minYear || 1800) && localYearRange.max === (maxYear || 2025);
    onApply({
      features: Array.from(localSelectedFeatures),
      ownerships: Array.from(localSelectedOwnerships),
      yearRange: isFullRange ? null : localYearRange,
      showOnlyFavorites: localShowOnlyFavorites,
      showOnlyAchievements: localShowOnlyAchievements,
      closingTimeMin: localClosingTimeMin,
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
        <View style={styles.modalContent}>
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
                  localShowOnlyFavorites && styles.featureBoxSelected
                ]}
                onPress={() => setLocalShowOnlyFavorites(!localShowOnlyFavorites)}
              >
                <MaterialCommunityIcons
                  name="heart"
                  size={18}
                  color={localShowOnlyFavorites ? COLORS.amber : COLORS.mediumGrey}
                  style={styles.filterIconInline}
                />
                <Text style={[
                  styles.featureBoxText,
                  localShowOnlyFavorites && styles.featureBoxTextSelected
                ]}>
                  Favourites
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterChip,
                  { width: filterChipWidth },
                  localShowOnlyAchievements && styles.featureBoxSelected
                ]}
                onPress={() => setLocalShowOnlyAchievements(!localShowOnlyAchievements)}
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
                  Achievements
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Features</Text>
            <View style={styles.filterRowSection}>
              {ALL_FEATURES_WITH_ICONS.map((feature) => {
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
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

