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

// Feature icon mapping (reused from PubCardContent)
const getFeatureIcon = (feature) => {
  const featureLower = feature.toLowerCase();
  const iconMap = {
    'live music': 'music',
    'beer garden': 'tree',
    'dog friendly': 'dog',
    'food': 'food',
    'wifi': 'wifi',
    'parking': 'parking',
    'quiz': 'book-open-variant',
    'sports': 'soccer',
    'pool': 'pool',
    'darts': 'target',
    'outdoor seating': 'table-chair',
    'wheelchair accessible': 'wheelchair-accessibility',
  };
  
  if (iconMap[featureLower]) {
    return iconMap[featureLower];
  }
  
  for (const [key, icon] of Object.entries(iconMap)) {
    if (featureLower.includes(key) || key.includes(featureLower)) {
      return icon;
    }
  }
  
  return 'star';
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
  onApply 
}) {
  const insets = useSafeAreaInsets();
  const defaultYearRange = { min: minYear || 1800, max: maxYear || 2025 };
  const [localSelectedFeatures, setLocalSelectedFeatures] = useState(new Set(selectedFeatures));
  const [localSelectedOwnerships, setLocalSelectedOwnerships] = useState(new Set(selectedOwnerships || []));
  const [localYearRange, setLocalYearRange] = useState(yearRange || defaultYearRange);

  useEffect(() => {
    setLocalSelectedFeatures(new Set(selectedFeatures));
    setLocalSelectedOwnerships(new Set(selectedOwnerships || []));
    setLocalYearRange(yearRange || defaultYearRange);
  }, [selectedFeatures, selectedOwnerships, yearRange, minYear, maxYear, visible]);

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
      yearRange: isFullRange ? null : localYearRange
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
            <Text style={styles.sectionTitle}>Features</Text>
            <View style={styles.featuresList}>
              {allFeatures.map((feature) => {
                const isSelected = localSelectedFeatures.has(feature);
                return (
                  <TouchableOpacity
                    key={feature}
                    style={[
                      styles.featureItem,
                      isSelected && styles.featureItemSelected
                    ]}
                    onPress={() => toggleFeature(feature)}
                  >
                    <MaterialCommunityIcons 
                      name={getFeatureIcon(feature)} 
                      size={20} 
                      color={isSelected ? AMBER : MEDIUM_GREY} 
                    />
                    <Text style={[
                      styles.featureText,
                      isSelected && styles.featureTextSelected
                    ]}>
                      {feature}
                    </Text>
                    <MaterialCommunityIcons 
                      name={isSelected ? 'check-circle' : 'checkbox-blank-circle-outline'} 
                      size={24} 
                      color={isSelected ? AMBER : MEDIUM_GREY} 
                      style={styles.checkIcon}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>Ownership</Text>
            <View style={styles.featuresList}>
              {allOwnerships && allOwnerships.map((ownership) => {
                const isSelected = localSelectedOwnerships.has(ownership);
                return (
                  <TouchableOpacity
                    key={ownership}
                    style={[
                      styles.featureItem,
                      isSelected && styles.featureItemSelected
                    ]}
                    onPress={() => toggleOwnership(ownership)}
                  >
                    <MaterialCommunityIcons 
                      name="office-building" 
                      size={20} 
                      color={isSelected ? AMBER : MEDIUM_GREY} 
                    />
                    <Text style={[
                      styles.featureText,
                      isSelected && styles.featureTextSelected
                    ]}>
                      {ownership}
                    </Text>
                    <MaterialCommunityIcons 
                      name={isSelected ? 'check-circle' : 'checkbox-blank-circle-outline'} 
                      size={24} 
                      color={isSelected ? AMBER : MEDIUM_GREY} 
                      style={styles.checkIcon}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: DARK_CHARCOAL,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
  },
  featuresList: {
    paddingHorizontal: 20,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  featureItemSelected: {
    backgroundColor: '#FFF8E7',
    borderColor: AMBER,
  },
  featureText: {
    fontSize: 16,
    color: DARK_CHARCOAL,
    marginLeft: 12,
    flex: 1,
  },
  featureTextSelected: {
    color: DARK_CHARCOAL,
    fontWeight: '600',
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

