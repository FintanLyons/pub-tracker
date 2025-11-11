import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const AMBER = '#D4A017';

export default function LeagueActionsModal({
  visible,
  onClose,
  onSelectCreate,
  onSelectJoin,
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>League Options</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={DARK_GREY} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.optionButton}
            onPress={onSelectCreate}
            activeOpacity={0.8}
          >
            <View style={styles.optionIconContainer}>
              <MaterialCommunityIcons name="trophy" size={28} color="#FFFFFF" />
            </View>
            <View style={styles.optionTextContainer}>
              <Text style={styles.optionTitle}>Create a League</Text>
              <Text style={styles.optionSubtitle}>
                Start a new league and invite your friends with a unique code.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={MEDIUM_GREY} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.optionButton}
            onPress={onSelectJoin}
            activeOpacity={0.8}
          >
            <View style={[styles.optionIconContainer, styles.joinIcon]}>
              <MaterialCommunityIcons name="account-multiple-plus" size={28} color="#FFFFFF" />
            </View>
            <View style={styles.optionTextContainer}>
              <Text style={styles.optionTitle}>Join a League</Text>
              <Text style={styles.optionSubtitle}>
                Enter a league code shared by a friend to join their league.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={MEDIUM_GREY} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: DARK_GREY,
  },
  closeButton: {
    padding: 4,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_GREY,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  optionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: AMBER,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  joinIcon: {
    backgroundColor: DARK_GREY,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
    marginBottom: 4,
  },
  optionSubtitle: {
    fontSize: 14,
    color: MEDIUM_GREY,
  },
});

