import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import UserAchievementsPanel from '../../components/UserAchievementsPanel';

/** Full-screen trophy grid opened from the Profile header. */
export default function TrophiesModal({ visible, onClose }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.trophiesModalRoot} edges={['top', 'left', 'right']}>
        <View style={styles.trophiesModalHeader}>
          <Text style={styles.trophiesModalTitle}>Trophies</Text>
          <TouchableOpacity
            onPress={onClose}
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
  );
}

const styles = StyleSheet.create({
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
});
