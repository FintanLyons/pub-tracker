import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

export default function LeagueActionsModal({
  visible,
  onClose,
  onSelectCreate,
  onSelectJoin,
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Dismiss"
        />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>League options</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button">
              <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <TouchableOpacity
              style={styles.optionButton}
              onPress={onSelectCreate}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <View style={styles.optionIconContainer}>
                <MaterialCommunityIcons name="trophy" size={28} color="#FFFFFF" />
              </View>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>Create a league</Text>
                <Text style={styles.optionSubtitle}>
                  Start a new league and invite your friends with a unique code.
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={COLORS.mediumGrey} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.optionButton, styles.optionButtonLast]}
              onPress={onSelectJoin}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <View style={[styles.optionIconContainer, styles.joinIcon]}>
                <MaterialCommunityIcons name="account-multiple-plus" size={28} color="#FFFFFF" />
              </View>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>Join a league</Text>
                <Text style={styles.optionSubtitle}>
                  Enter a league code shared by a friend to join their league.
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={COLORS.mediumGrey} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    paddingRight: 8,
  },
  closeButton: {
    padding: 6,
    marginRight: -2,
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 22,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  optionButtonLast: {
    marginBottom: 0,
  },
  optionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.amber,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  joinIcon: {
    backgroundColor: COLORS.darkGrey,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    marginBottom: 4,
  },
  optionSubtitle: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    lineHeight: 20,
  },
});
