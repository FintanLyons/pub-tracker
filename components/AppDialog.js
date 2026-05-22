import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

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
    maxHeight: '88%',
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
  scrollBody: {
    maxHeight: 320,
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
    gap: 10,
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
  secondaryButton: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
    alignSelf: 'stretch',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'center',
  },
});

function iconForTone(tone) {
  if (tone === 'success') {
    return { name: 'check-circle', color: COLORS.amber };
  }
  if (tone === 'error') {
    return { name: 'alert-circle-outline', color: COLORS.errorRed };
  }
  return { name: 'information-outline', color: COLORS.amber };
}

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.message
 * @param {'success' | 'error' | 'neutral'} [props.tone='neutral']
 * @param {() => void} props.onClose — dismisses the dialog (header X, backdrop tap, after footer button).
 * @param {{ text: string, onPress?: () => void, variant?: 'primary' | 'secondary' }[]} [props.buttons] — default one primary "OK".
 */
export function AppDialogCard({
  title,
  message,
  tone = 'neutral',
  onClose,
  buttons,
}) {
  const resolvedButtons =
    buttons && buttons.length > 0 ? buttons : [{ text: 'OK', variant: 'primary' }];

  const bodyText = message == null ? '' : String(message);
  const icon = iconForTone(tone);

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
        <MaterialCommunityIcons name={icon.name} size={48} color={icon.color} />
      </View>
      <ScrollView
        style={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={bodyText.length > 280}
      >
        <Text style={styles.body}>{bodyText}</Text>
      </ScrollView>
      <View style={styles.actions}>
        {resolvedButtons.map((btn, i) => {
          const variant = btn.variant === 'secondary' ? 'secondary' : 'primary';
          const isPrimary = variant === 'primary';
          return (
            <TouchableOpacity
              key={`${btn.text}-${i}`}
              style={isPrimary ? styles.primaryButton : styles.secondaryButton}
              onPress={() => {
                btn.onPress?.();
                onClose();
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={btn.text}
            >
              <Text style={isPrimary ? styles.primaryButtonText : styles.secondaryButtonText}>
                {btn.text}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Same card as AppDialogCard but used inside an existing Modal (iOS-safe stacking). */
export function AppDialogOverlay({
  title,
  message,
  tone = 'neutral',
  onClose,
  buttons,
}) {
  return (
    <View style={overlayStyles.layer} pointerEvents="box-none">
      <TouchableOpacity
        style={overlayStyles.backdrop}
        activeOpacity={1}
        onPress={onClose}
        accessibilityLabel="Dismiss"
      />
      <AppDialogCard
        title={title}
        message={message}
        tone={tone}
        onClose={onClose}
        buttons={buttons}
      />
    </View>
  );
}

/**
 * Standalone modal matching app chrome (charcoal / amber).
 * @param {object} props
 * @param {boolean} props.visible
 * @param {string} props.title
 * @param {string} props.message
 * @param {'success' | 'error' | 'neutral'} [props.tone='neutral']
 * @param {() => void} props.onClose
 * @param {{ text: string, onPress?: () => void, variant?: 'primary' | 'secondary' }[]} [props.buttons]
 */
export default function AppDialogModal({
  visible,
  title,
  message,
  tone = 'neutral',
  onClose,
  buttons,
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
        <AppDialogCard
          title={title}
          message={message}
          tone={tone}
          onClose={onClose}
          buttons={buttons}
        />
      </View>
    </Modal>
  );
}
