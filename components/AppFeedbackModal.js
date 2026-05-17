import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

/**
 * Feedback card UI (no Modal). Use inside an existing modal on iOS to avoid
 * stacked Modal issues.
 */
export function AppFeedbackCard({ title, message, tone = 'success', onClose }) {
  const isSuccess = tone === 'success';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeButton}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
        </TouchableOpacity>
      </View>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons
          name={isSuccess ? 'check-circle' : 'alert-circle-outline'}
          size={48}
          color={isSuccess ? COLORS.amber : COLORS.errorRed}
        />
      </View>
      <Text style={styles.body}>{message}</Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onClose}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="OK"
        >
          <Text style={styles.primaryButtonText}>OK</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Success/error overlay for use inside an existing Modal (iOS-safe).
 */
export function AppFeedbackOverlay({ title, message, tone = 'success', onClose }) {
  return (
    <View style={overlayStyles.layer} pointerEvents="box-none">
      <TouchableOpacity
        style={overlayStyles.backdrop}
        activeOpacity={1}
        onPress={onClose}
        accessibilityLabel="Dismiss"
      />
      <AppFeedbackCard title={title} message={message} tone={tone} onClose={onClose} />
    </View>
  );
}

/**
 * Standalone success/error popup (use when no other Modal is open).
 */
export default function AppFeedbackModal({
  visible,
  title,
  message,
  tone = 'success',
  onClose,
}) {
  if (!visible) return null;

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
        <AppFeedbackCard
          title={title}
          message={message}
          tone={tone}
          onClose={onClose}
        />
      </View>
    </Modal>
  );
}

const overlayStyles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 10,
    elevation: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});

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
  iconWrap: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 8,
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 20,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: COLORS.accentGrey,
    textAlign: 'center',
  },
  actions: {
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  primaryButton: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.amber,
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.charcoal,
    textAlign: 'center',
  },
});
