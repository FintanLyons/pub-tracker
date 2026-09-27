import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import { SORT_MODES } from './constants';

const SORT_OPTIONS = [
  { mode: SORT_MODES.LOCATION, label: 'Location (Distance)' },
  { mode: SORT_MODES.ALPHABETICAL, label: 'Alphabetical' },
  { mode: SORT_MODES.MOST_VISITED, label: 'Most Pubs Visited' },
  { mode: SORT_MODES.PERCENTAGE, label: 'Percentage Visited' },
  { mode: SORT_MODES.MOST_DRINKS, label: 'Most drinks' },
];

/** Bottom sheet for sorting the Profile district / area list. */
export default function AreaSortModal({ visible, sortMode, onSelect, onClose }) {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);

  // Animate modal content slide
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (visible) {
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
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
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
              onPress={onClose}
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
            {SORT_OPTIONS.map(({ mode, label }) => {
              const selected = sortMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[styles.filterOption, selected && styles.filterOptionSelected]}
                  onPress={() => {
                    onSelect(mode);
                    onClose();
                  }}
                >
                  <Text style={[styles.filterOptionText, selected && styles.filterOptionTextSelected]}>
                    {label}
                  </Text>
                  {selected && (
                    <MaterialCommunityIcons name="check" size={20} color={COLORS.darkGrey} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
