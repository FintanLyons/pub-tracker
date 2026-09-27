import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import floatingCardStyles from './floatingCardStyles';

export const DELETE_MODAL = {
  NONE: 'none',
  CONFIRM: 'confirm',
  ERROR: 'error',
};

/** Confirm + error pop-ups for account deletion. `mode` is a DELETE_MODAL value. */
export default function DeleteAccountModals({ mode, errorMessage, onConfirm, onClose }) {
  return (
    <>
      <Modal
        visible={mode === DELETE_MODAL.CONFIRM}
        animationType="fade"
        transparent
        onRequestClose={onClose}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.floatingCard}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>Delete account?</Text>
              <TouchableOpacity
                onPress={onClose}
                style={styles.floatingCardClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>
            <Text style={styles.floatingCardBody}>
              This permanently deletes your profile, visits, drinks, reviews, favourites and friends.
              Leagues you own pass to their longest-standing member. Pub reports you've sent stay,
              but no longer show your username. This can't be undone.
            </Text>
            <View style={styles.floatingCardActions}>
              <TouchableOpacity
                style={[
                  styles.floatingActionBtn,
                  styles.floatingActionBtnHalf,
                  styles.floatingActionBtnSecondary,
                ]}
                onPress={onClose}
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
                onPress={onConfirm}
                activeOpacity={0.75}
              >
                <Text style={styles.floatingActionBtnTextOnDanger}>Delete account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={mode === DELETE_MODAL.ERROR}
        animationType="fade"
        transparent
        onRequestClose={onClose}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.floatingCard}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>Something went wrong</Text>
              <TouchableOpacity
                onPress={onClose}
                style={styles.floatingCardClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>
            <Text style={styles.floatingCardBody}>{errorMessage}</Text>
            <View style={styles.floatingCardActionsSingle}>
              <TouchableOpacity
                style={[
                  styles.floatingActionBtn,
                  styles.floatingActionBtnStretch,
                  styles.floatingActionBtnPrimary,
                ]}
                onPress={onClose}
                activeOpacity={0.75}
              >
                <Text style={styles.floatingActionBtnTextPrimary}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const ownStyles = StyleSheet.create({
  floatingCardActionsSingle: {
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  floatingActionBtnStretch: {
    alignSelf: 'stretch',
  },
  floatingActionBtnDangerFill: {
    backgroundColor: COLORS.errorRed,
  },
  floatingActionBtnPrimary: {
    backgroundColor: COLORS.amber,
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
});

const styles = { ...floatingCardStyles, ...ownStyles };
