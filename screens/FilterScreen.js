import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  TouchableOpacity, 
  StyleSheet,
  Modal 
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RangeSlider from '../components/RangeSlider';

const AMBER = '#D4A017';
const DARK_CHARCOAL = '#1C1C1C';
const MEDIUM_GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';

// All possible features with their icons (in display order)
const ALL_FEATURES_WITH_ICONS = [
  { name: 'Pub garden', icon: 'tree' },
  { name: 'Live music', icon: 'music' },
  { name: 'Food available', icon: 'silverware-fork-knife' },
  { name: 'Dog friendly', icon: 'dog' },
  { name: 'Pool/darts', icon: 'billiards' },
  { name: 'Parking', icon: 'parking' },
  { name: 'Accommodation', icon: 'bed' },
  { name: 'Cask/real ale', icon: 'barrel' },
];

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
  onApply 
}) {
  const insets = useSafeAreaInsets();
  const defaultYearRange = { min: minYear || 1800, max: maxYear || 2025 };
  const [localSelectedFeatures, setLocalSelectedFeatures] = useState(new Set(selectedFeatures));
  const [localSelectedOwnerships, setLocalSelectedOwnerships] = useState(new Set(selectedOwnerships || []));
  const [localYearRange, setLocalYearRange] = useState(yearRange || defaultYearRange);
  const [localShowOnlyFavorites, setLocalShowOnlyFavorites] = useState(showOnlyFavorites || false);
  const [localShowOnlyAchievements, setLocalShowOnlyAchievements] = useState(showOnlyAchievements || false);

  useEffect(() => {
    setLocalSelectedFeatures(new Set(selectedFeatures));
    setLocalSelectedOwnerships(new Set(selectedOwnerships || []));
    setLocalYearRange(yearRange || defaultYearRange);
    setLocalShowOnlyFavorites(showOnlyFavorites || false);
    setLocalShowOnlyAchievements(showOnlyAchievements || false);
  }, [selectedFeatures, selectedOwnerships, yearRange, minYear, maxYear, showOnlyFavorites, showOnlyAchievements, visible]);

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
  };

  const handleYearRangeChange = (range) => {
    setLocalYearRange(range);
  };

  const handleApply = () => {
    // Only apply year filter if range is not the full range (user has actually filtered)
    const isFullRange = localYearRange.min === (minYear || 1800) && localYearRange.max === (maxYear || 2025);
    onApply({
      features: Array.from(localSelectedFeatures),
      ownerships: Array.from(localSelectedOwnerships),
      yearRange: isFullRange ? null : localYearRange,
      showOnlyFavorites: localShowOnlyFavorites,
      showOnlyAchievements: localShowOnlyAchievements
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
              <MaterialCommunityIcons name="close" size={24} color={AMBER} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {/* Quick Filters */}
            <View style={styles.quickFiltersGrid}>
              <TouchableOpacity
                style={[
                  styles.featureBox,
                  localShowOnlyFavorites && styles.featureBoxSelected
                ]}
                onPress={() => setLocalShowOnlyFavorites(!localShowOnlyFavorites)}
              >
                <Text style={[
                  styles.featureBoxText,
                  localShowOnlyFavorites && styles.featureBoxTextSelected
                ]}>
                  Favourite
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.featureBox,
                  localShowOnlyAchievements && styles.featureBoxSelected
                ]}
                onPress={() => setLocalShowOnlyAchievements(!localShowOnlyAchievements)}
              >
                <Text style={[
                  styles.featureBoxText,
                  localShowOnlyAchievements && styles.featureBoxTextSelected
                ]}>
                  Achievements
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Features</Text>
            <View style={styles.featuresGrid}>
              {ALL_FEATURES_WITH_ICONS.map((feature) => {
                const isSelected = localSelectedFeatures.has(feature.name);
                return (
                  <TouchableOpacity
                    key={feature.name}
                    style={[
                      styles.featureBox,
                      isSelected && styles.featureBoxSelected
                    ]}
                    onPress={() => toggleFeature(feature.name)}
                  >
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

            <Text style={styles.sectionTitle}>Ownership</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.ownershipScrollContainer}
              contentContainerStyle={styles.ownershipScrollContent}
            >
              <View style={styles.ownershipGrid}>
                {allOwnerships && allOwnerships.map((ownership) => {
                  const isSelected = localSelectedOwnerships.has(ownership);
                  return (
                    <TouchableOpacity
                      key={ownership}
                      style={[
                        styles.ownershipBox,
                        isSelected && styles.ownershipBoxSelected
                      ]}
                      onPress={() => toggleOwnership(ownership)}
                    >
                      <Text style={[
                        styles.ownershipBoxText,
                        isSelected && styles.ownershipBoxTextSelected
                      ]}>
                        {ownership}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.sectionTitle}>Founded Year</Text>
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
    borderBottomColor: LIGHT_GREY,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: DARK_CHARCOAL,
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  quickFiltersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    justifyContent: 'space-between',
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: DARK_CHARCOAL,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  featureBox: {
    width: '48%',
    backgroundColor: LIGHT_GREY,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  featureBoxSelected: {
    backgroundColor: '#FFF8E7',
    borderColor: AMBER,
  },
  featureBoxText: {
    fontSize: 11,
    color: DARK_CHARCOAL,
    textAlign: 'center',
    fontWeight: '500',
  },
  featureBoxTextSelected: {
    color: DARK_CHARCOAL,
    fontWeight: '700',
  },
  ownershipScrollContainer: {
    paddingLeft: 12,
    marginBottom: 0,
  },
  ownershipScrollContent: {
    paddingRight: 12,
  },
  ownershipGrid: {
    flexDirection: 'column', // Column direction to stack vertically
    flexWrap: 'wrap', // Wrap to create multiple columns
    height: 192, // 4 rows * ~48px per row (padding + text + border + margin)
  },
  ownershipBox: {
    width: 165, // Same as features boxes for consistency
    backgroundColor: LIGHT_GREY,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    marginRight: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  ownershipBoxSelected: {
    backgroundColor: '#FFF8E7',
    borderColor: AMBER,
  },
  ownershipBoxText: {
    fontSize: 11,
    color: DARK_CHARCOAL,
    textAlign: 'center',
    fontWeight: '500',
  },
  ownershipBoxTextSelected: {
    color: DARK_CHARCOAL,
    fontWeight: '700',
  },
  checkIcon: {
    marginLeft: 'auto',
  },
  buttonContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: LIGHT_GREY,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    backgroundColor: LIGHT_GREY,
    borderWidth: 2,
    borderColor: MEDIUM_GREY,
    marginRight: 12,
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_CHARCOAL,
  },
  applyButton: {
    backgroundColor: DARK_CHARCOAL,
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

