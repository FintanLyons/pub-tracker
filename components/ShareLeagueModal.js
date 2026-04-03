import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Share,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../constants/theme';

const ANDROID_PACKAGE =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.fintanlyons.pubtracker';

const PLAY_STORE_LISTING_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

function buildInviteMessage(leagueName, leagueCode) {
  const code = (leagueCode || '').toUpperCase();
  return `Join my league "${leagueName}" on Pub Tracker! League code: ${code}\n\nGet the app on Google Play:\n${PLAY_STORE_LISTING_URL}`;
}

export default function ShareLeagueModal({
  visible,
  onClose,
  leagueName,
  leagueCode,
}) {
  const [phase, setPhase] = useState('menu'); // 'menu' | 'copied' | 'copyError'

  const code = (leagueCode || '').toUpperCase();

  useEffect(() => {
    if (!visible) {
      setPhase('menu');
    }
  }, [visible]);

  const dismissFully = () => {
    setPhase('menu');
    onClose();
  };

  const handleShareInvite = async () => {
    try {
      await Share.share({
        message: buildInviteMessage(leagueName || 'Pub Tracker league', code),
      });
    } catch (e) {
      console.warn('Share failed', e);
    }
  };

  const handleCopyCode = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setPhase('copied');
    } catch (e) {
      console.warn('Copy failed', e);
      setPhase('copyError');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={dismissFully}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={dismissFully}
          accessibilityLabel="Dismiss"
        />
        <View style={styles.card}>
          {phase === 'menu' && (
            <>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Share league</Text>
                <TouchableOpacity
                  onPress={dismissFully}
                  style={styles.cardClose}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
                </TouchableOpacity>
              </View>

              <View style={styles.codeBlock}>
                <Text style={styles.codeLabel}>League code</Text>
                <Text style={styles.codeValue} selectable>
                  {code}
                </Text>
              </View>

              <View style={styles.body}>
                <TouchableOpacity
                  style={[styles.actionRow, styles.actionRowNeutral]}
                  onPress={handleShareInvite}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Share invite message"
                >
                  <View style={styles.actionIconSlot}>
                    <MaterialCommunityIcons name="share-variant" size={22} color={COLORS.darkGrey} />
                  </View>
                  <Text style={styles.actionLabel}>Share invite message</Text>
                  <View style={styles.actionChevronSlot}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.mediumGrey} />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionRow, styles.actionRowNeutral, styles.actionRowLast]}
                  onPress={handleCopyCode}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Copy league code"
                >
                  <View style={styles.actionIconSlot}>
                    <MaterialCommunityIcons name="content-copy" size={22} color={COLORS.darkGrey} />
                  </View>
                  <Text style={styles.actionLabel}>Copy league code</Text>
                  <View style={styles.actionChevronSlot}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.mediumGrey} />
                  </View>
                </TouchableOpacity>
              </View>
            </>
          )}

          {phase === 'copied' && (
            <>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Copied</Text>
                <TouchableOpacity
                  onPress={dismissFully}
                  style={styles.cardClose}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
                </TouchableOpacity>
              </View>
              <View style={styles.feedbackIconWrap}>
                <MaterialCommunityIcons name="check-circle" size={48} color={COLORS.amber} />
              </View>
              <Text style={styles.feedbackBody}>
                League code copied to clipboard.
              </Text>
              <View style={styles.feedbackActions}>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.primaryButtonStretch]}
                  onPress={dismissFully}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="OK"
                >
                  <Text style={styles.primaryButtonText}>OK</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {phase === 'copyError' && (
            <>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Couldn't copy</Text>
                <TouchableOpacity
                  onPress={dismissFully}
                  style={styles.cardClose}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
                </TouchableOpacity>
              </View>
              <Text style={styles.feedbackBody}>
                Something went wrong. Try sharing the invite message instead.
              </Text>
              <View style={styles.feedbackActions}>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.primaryButtonStretch]}
                  onPress={dismissFully}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="OK"
                >
                  <Text style={styles.primaryButtonText}>OK</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  cardTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'left',
    paddingRight: 8,
  },
  cardClose: {
    padding: 6,
    marginRight: -2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  codeBlock: {
    marginHorizontal: 22,
    marginTop: 16,
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.mediumGrey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  codeValue: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.darkGrey,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 22,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  actionRowLast: {
    marginBottom: 0,
  },
  actionRowNeutral: {
    backgroundColor: COLORS.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  actionIconSlot: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionChevronSlot: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'left',
    marginLeft: 4,
    marginRight: 4,
  },
  feedbackIconWrap: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 8,
  },
  feedbackBody: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 20,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: COLORS.accentGrey,
    textAlign: 'center',
  },
  feedbackActions: {
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
  },
  primaryButtonStretch: {
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.charcoal,
    textAlign: 'center',
  },
});
