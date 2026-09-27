import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuth } from '../../contexts/AuthContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { updatePublicAvatarUrl } from '../../services/SecureAuthService';
import { presignAndPutImage } from '../../services/r2Upload';
import {
  pickNormalizedAvatarUri,
  AVATAR_LIBRARY_PERMISSION_ALERT,
} from '../../utils/avatarImagePrep';
import { COLORS } from '../../constants/theme';
import {
  POINTS_PER_LEVEL,
  DEFAULT_PUB_VISIT_POINTS,
  POINTS_PER_DRINK,
  AREA_COMPLETION_SIZE_TIERS,
  POSTCODE_AREA_COMPLETION_BONUS_POINTS,
  POINTS_NEW_PUB_REPORT,
  POINTS_PUB_CORRECTION_REPORT,
} from '../../utils/levelSystem';
import floatingCardStyles from './floatingCardStyles';

/** Sub-views inside the single settings modal (nested RN Modals fail on iOS). */
const SETTINGS_PANEL = {
  MAIN: 'main',
  AVATAR: 'avatar',
  REMOVE_AVATAR: 'removeAvatar',
};

/**
 * Settings pop-up: username + profile photo, scoring explainer, sign out, delete account.
 * Photo change / remove happen here; sign out and delete are handed back to the screen.
 */
export default function ProfileSettingsModal({ visible, onClose, onSignOut, onDeleteAccount }) {
  const { showAppAlert } = useAppAlert();
  const { user, applyUserProfileRow } = useAuth();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState(SETTINGS_PANEL.MAIN);

  useEffect(() => {
    if (!visible) {
      setSettingsPanel(SETTINGS_PANEL.MAIN);
    }
  }, [visible]);

  const closeSettingsModal = useCallback(() => {
    if (avatarBusy) return;
    onClose();
    setSettingsPanel(SETTINGS_PANEL.MAIN);
  }, [avatarBusy, onClose]);

  const goToSettingsMainPanel = useCallback(() => {
    if (avatarBusy) return;
    setSettingsPanel(SETTINGS_PANEL.MAIN);
  }, [avatarBusy]);

  const handlePickProfilePhoto = useCallback(async () => {
    if (!user?.id || avatarBusy) return;
    const res = await pickNormalizedAvatarUri();
    if (!res.ok) {
      if (res.reason === 'denied') {
        showAppAlert({
          title: AVATAR_LIBRARY_PERMISSION_ALERT.title,
          message: AVATAR_LIBRARY_PERMISSION_ALERT.message,
          tone: 'neutral',
        });
      } else if (res.reason === 'processing') {
        showAppAlert({
          title: 'Error',
          message: res.message || 'Could not process photo.',
          tone: 'error',
        });
      }
      return;
    }
    setAvatarBusy(true);
    try {
      const publicUrl = await presignAndPutImage(res.uri, { purpose: 'avatar' });
      const row = await updatePublicAvatarUrl(user.id, publicUrl);
      applyUserProfileRow(row);
    } catch (e) {
      showAppAlert({
        title: 'Error',
        message: e?.message || 'Could not update profile photo.',
        tone: 'error',
      });
    } finally {
      setAvatarBusy(false);
    }
  }, [user?.id, avatarBusy, applyUserProfileRow]);

  const handleRemoveProfilePhoto = useCallback(() => {
    if (!user?.id || !user?.avatar_url || avatarBusy) return;
    setSettingsPanel(SETTINGS_PANEL.REMOVE_AVATAR);
  }, [user?.id, user?.avatar_url, avatarBusy]);

  const handleAvatarOptionsChangePhoto = useCallback(() => {
    setSettingsPanel(SETTINGS_PANEL.MAIN);
    handlePickProfilePhoto();
  }, [handlePickProfilePhoto]);

  const handleAvatarOptionsRemove = useCallback(() => {
    handleRemoveProfilePhoto();
  }, [handleRemoveProfilePhoto]);

  const confirmRemoveProfilePhoto = useCallback(async () => {
    if (!user?.id) return;
    setSettingsPanel(SETTINGS_PANEL.MAIN);
    setAvatarBusy(true);
    try {
      const row = await updatePublicAvatarUrl(user.id, null);
      applyUserProfileRow(row);
    } catch (e) {
      showAppAlert({
        title: 'Error',
        message: e?.message || 'Could not remove photo.',
        tone: 'error',
      });
    } finally {
      setAvatarBusy(false);
    }
  }, [user?.id, applyUserProfileRow]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={closeSettingsModal}
    >
      <View style={styles.floatingModalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={closeSettingsModal}
          accessibilityLabel="Dismiss settings"
        />
        <View style={styles.floatingCard} onStartShouldSetResponder={() => true}>
          <View style={styles.floatingCardHeader}>
            <Text style={styles.floatingCardTitle}>
              {settingsPanel === SETTINGS_PANEL.AVATAR
                ? 'Profile photo'
                : settingsPanel === SETTINGS_PANEL.REMOVE_AVATAR
                  ? 'Remove profile photo?'
                  : 'Settings'}
            </Text>
            <TouchableOpacity
              onPress={
                settingsPanel === SETTINGS_PANEL.MAIN
                  ? closeSettingsModal
                  : goToSettingsMainPanel
              }
              style={styles.floatingCardClose}
              accessibilityLabel={
                settingsPanel === SETTINGS_PANEL.MAIN ? 'Close settings' : 'Back'
              }
              accessibilityRole="button"
              disabled={avatarBusy}
            >
              <MaterialCommunityIcons
                name={settingsPanel === SETTINGS_PANEL.MAIN ? 'close' : 'arrow-left'}
                size={22}
                color={COLORS.darkGrey}
              />
            </TouchableOpacity>
          </View>

          {settingsPanel === SETTINGS_PANEL.AVATAR ? (
            <View style={styles.floatingCardPickerBody}>
              <TouchableOpacity
                style={[
                  styles.settingsActionCard,
                  styles.settingsActionCardNeutral,
                  styles.avatarPickerAction,
                ]}
                onPress={handleAvatarOptionsChangePhoto}
                activeOpacity={0.75}
                disabled={avatarBusy || !user?.id}
                accessibilityLabel="Change profile photo"
                accessibilityRole="button"
              >
                <View style={styles.settingsActionIconSlot}>
                  <MaterialCommunityIcons name="camera-outline" size={22} color={COLORS.darkGrey} />
                </View>
                <Text style={styles.settingsActionLabel}>Change photo</Text>
              </TouchableOpacity>
              {user?.avatar_url ? (
                <TouchableOpacity
                  style={[styles.settingsActionCard, styles.settingsActionCardDanger]}
                  onPress={handleAvatarOptionsRemove}
                  activeOpacity={0.75}
                  disabled={avatarBusy}
                  accessibilityLabel="Remove profile photo"
                  accessibilityRole="button"
                >
                  <View style={styles.settingsActionIconSlot}>
                    <MaterialCommunityIcons name="trash-can-outline" size={22} color={COLORS.errorRed} />
                  </View>
                  <Text style={styles.settingsActionLabelDanger}>Remove photo</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {settingsPanel === SETTINGS_PANEL.REMOVE_AVATAR ? (
            <>
              <Text style={styles.floatingCardBody}>
                Your profile will show the default outline on the leaderboard and in settings.
              </Text>
              <View style={styles.floatingCardActions}>
                <TouchableOpacity
                  style={[
                    styles.floatingActionBtn,
                    styles.floatingActionBtnHalf,
                    styles.floatingActionBtnSecondary,
                  ]}
                  onPress={goToSettingsMainPanel}
                  activeOpacity={0.75}
                  disabled={avatarBusy}
                >
                  <Text style={styles.floatingActionBtnTextSecondary}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.floatingActionBtn,
                    styles.floatingActionBtnHalf,
                    styles.floatingActionBtnDangerOutline,
                  ]}
                  onPress={confirmRemoveProfilePhoto}
                  activeOpacity={0.75}
                  disabled={avatarBusy}
                >
                  <Text style={styles.floatingActionBtnTextDanger}>Remove</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          {settingsPanel === SETTINGS_PANEL.MAIN ? (
          <View style={styles.settingsBody}>
            <View style={styles.settingsUserCard}>
              <View style={styles.settingsUserTopRow}>
                <View style={styles.settingsUserTextCol}>
                  <Text style={styles.settingsUserLabel}>Username</Text>
                  <Text
                    style={[
                      styles.settingsUserValue,
                      !user?.username && styles.settingsUserValueMuted,
                    ]}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {user?.username?.trim() ? user.username : 'Not set yet'}
                  </Text>
                </View>
                <View style={styles.settingsUserRightCol}>
                  <View style={styles.settingsAvatarTapWrap}>
                    <TouchableOpacity
                      onPress={() => !avatarBusy && user?.id && setSettingsPanel(SETTINGS_PANEL.AVATAR)}
                      disabled={avatarBusy || !user?.id}
                      activeOpacity={0.82}
                      accessibilityLabel="Profile photo — change or remove"
                      accessibilityRole="button"
                      style={styles.settingsAvatarTouchable}
                    >
                      <View style={styles.settingsAvatarWrap}>
                        {user?.avatar_url ? (
                          <Image
                            source={{ uri: user.avatar_url }}
                            style={styles.settingsAvatarImage}
                            contentFit="cover"
                            transition={120}
                          />
                        ) : (
                          <View style={styles.settingsAvatarPlaceholder}>
                            <MaterialCommunityIcons
                              name="account-outline"
                              size={36}
                              color={COLORS.mediumGrey}
                            />
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                    {avatarBusy ? (
                      <View style={styles.settingsAvatarBusyOverlay} pointerEvents="none">
                        <ActivityIndicator color={COLORS.amber} />
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.settingsScoringCard}>
              <Text style={styles.settingsScoringLabel}>Scoring</Text>

              <View style={styles.scoringVisualRow}>
                <View style={styles.scoringVisualHalf}>
                  <Text style={styles.scoringVisualWord}>Pub</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={16}
                    color={COLORS.mediumGrey}
                    style={styles.scoringVisualArrow}
                  />
                  <Text style={styles.scoringVisualPoints}>
                    +{DEFAULT_PUB_VISIT_POINTS}
                  </Text>
                </View>
                <View style={styles.scoringVisualHalf}>
                  <Text style={styles.scoringVisualWord}>Drinks</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={16}
                    color={COLORS.mediumGrey}
                    style={styles.scoringVisualArrow}
                  />
                  <Text style={styles.scoringVisualPoints}>+{POINTS_PER_DRINK}</Text>
                </View>
              </View>

              <Text style={styles.scoringSectionTitle}>Completion bonuses</Text>

              <View style={styles.scoringGridRow}>
                {AREA_COMPLETION_SIZE_TIERS.map((tier) => (
                  <View key={tier.key} style={styles.scoringGridCell}>
                    <Text style={styles.scoringGridLabel}>{tier.key}</Text>
                  </View>
                ))}
                <View style={styles.scoringGridCell}>
                  <Text style={styles.scoringGridLabel}>Area</Text>
                </View>
              </View>

              <View style={[styles.scoringGridRow, styles.scoringGridRowPoints]}>
                {AREA_COMPLETION_SIZE_TIERS.map((tier) => (
                  <View key={tier.key} style={styles.scoringGridCell}>
                    <Text style={styles.scoringGridPoints}>+{tier.points}</Text>
                  </View>
                ))}
                <View style={styles.scoringGridCell}>
                  <Text style={styles.scoringGridPoints}>
                    +{POSTCODE_AREA_COMPLETION_BONUS_POINTS}
                  </Text>
                </View>
              </View>

              <Text style={styles.scoringExplainer}>
                District bonus when you've visited every pub in a district, by its size: S under 10 pubs · M 10–19 · L 20–29 · XL 30 or more.
                {'\n'}Area bonus when you've visited every pub in an area, e.g. all of SW.
                {'\n'}Some pubs also carry extra points for awards and milestones — see Trophies.
              </Text>

              <Text style={styles.scoringSectionTitle}>Corrections (when accepted)</Text>

              <View style={styles.scoringCorrectionsBlock}>
                <View style={[styles.scoringCorrectionRow, styles.scoringCorrectionRowFirst]}>
                  <Text style={styles.scoringCorrectionLabel}>Missing pub added</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={16}
                    color={COLORS.mediumGrey}
                    style={styles.scoringCorrectionArrow}
                  />
                  <Text style={styles.scoringCorrectionPoints}>
                    +{POINTS_NEW_PUB_REPORT}
                  </Text>
                </View>
                <View style={styles.scoringCorrectionRow}>
                  <Text style={styles.scoringCorrectionLabel}>Pub details corrected</Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={16}
                    color={COLORS.mediumGrey}
                    style={styles.scoringCorrectionArrow}
                  />
                  <Text style={styles.scoringCorrectionPoints}>
                    +{POINTS_PUB_CORRECTION_REPORT}
                  </Text>
                </View>
              </View>

              <View style={styles.scoringLevelRow}>
                <Text style={styles.scoringLevelPoints}>+{POINTS_PER_LEVEL}</Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={16}
                  color={COLORS.mediumGrey}
                  style={styles.scoringVisualArrow}
                />
                <Text style={styles.scoringLevelOutcome}>+1 Level</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.settingsActionCard, styles.settingsActionCardNeutral]}
              onPress={onSignOut}
              activeOpacity={0.7}
              accessibilityLabel="Sign out"
              accessibilityRole="button"
            >
              <View style={styles.settingsActionIconSlot}>
                <MaterialCommunityIcons name="logout-variant" size={22} color={COLORS.darkGrey} />
              </View>
              <Text style={styles.settingsActionLabel}>Sign out</Text>
              <View style={styles.settingsActionChevronSlot}>
                <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.mediumGrey} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingsActionCard, styles.settingsActionCardDanger]}
              onPress={onDeleteAccount}
              activeOpacity={0.7}
              accessibilityLabel="Delete account"
              accessibilityRole="button"
            >
              <View style={styles.settingsActionIconSlot}>
                <MaterialCommunityIcons name="delete-outline" size={22} color={COLORS.errorRed} />
              </View>
              <Text style={styles.settingsActionLabelDanger}>Delete account</Text>
              <View style={styles.settingsActionChevronSlot}>
                <MaterialCommunityIcons name="chevron-right" size={22} color={COLORS.errorRed} />
              </View>
            </TouchableOpacity>
          </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const ownStyles = StyleSheet.create({
  floatingCardPickerBody: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 22,
    gap: 10,
  },
  avatarPickerAction: {
    marginBottom: 0,
  },
  floatingActionBtnDangerOutline: {
    backgroundColor: COLORS.errorLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.errorRed,
  },
  floatingActionBtnTextDanger: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.errorRed,
    textAlign: 'center',
  },
  settingsBody: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 22,
  },
  settingsUserCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsUserLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.mediumGrey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    textAlign: 'left',
  },
  settingsUserValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'left',
  },
  settingsUserValueMuted: {
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  settingsUserTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsUserTextCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  settingsUserRightCol: {
    width: 88,
    flexShrink: 0,
    alignItems: 'center',
  },
  settingsAvatarTapWrap: {
    position: 'relative',
  },
  settingsAvatarTouchable: {
    borderRadius: 44,
    overflow: 'hidden',
  },
  settingsAvatarBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 44,
    backgroundColor: 'rgba(247, 247, 247, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsAvatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsAvatarImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.lightGrey,
  },
  settingsAvatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsScoringCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsScoringLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.mediumGrey,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'left',
  },
  scoringVisualRow: {
    flexDirection: 'row',
    marginTop: 4,
    marginBottom: 16,
  },
  scoringVisualHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  scoringVisualWord: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  scoringVisualArrow: {
    marginHorizontal: 6,
  },
  scoringVisualPoints: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.amber,
  },
  scoringGridRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoringGridRowPoints: {
    marginTop: 6,
    marginBottom: 16,
  },
  scoringGridCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  scoringGridLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
  },
  scoringGridPoints: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.amber,
    textAlign: 'center',
  },
  scoringExplainer: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.mediumGrey,
    marginTop: 8,
    marginBottom: 14,
  },
  scoringSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
    marginBottom: 10,
  },
  scoringCorrectionsBlock: {
    marginBottom: 14,
  },
  scoringCorrectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  scoringCorrectionRowFirst: {
    marginTop: 0,
  },
  scoringCorrectionLabel: {
    flex: 1,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.accentGrey,
    marginRight: 4,
  },
  scoringCorrectionArrow: {
    marginHorizontal: 6,
    flexShrink: 0,
  },
  scoringCorrectionPoints: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.amber,
    flexShrink: 0,
    minWidth: 36,
    textAlign: 'right',
  },
  scoringLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  scoringLevelPoints: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.amber,
  },
  scoringLevelOutcome: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.burgundy,
  },
  settingsActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  settingsActionCardNeutral: {
    backgroundColor: COLORS.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  settingsActionCardDanger: {
    backgroundColor: COLORS.errorLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFCDD2',
    marginBottom: 0,
  },
  settingsActionIconSlot: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsActionChevronSlot: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsActionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'left',
    marginLeft: 4,
    marginRight: 4,
  },
  settingsActionLabelDanger: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.errorRed,
    textAlign: 'left',
    marginLeft: 4,
    marginRight: 4,
  },
});

const styles = { ...floatingCardStyles, ...ownStyles };
