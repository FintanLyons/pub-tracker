import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import UserAvatar from './UserAvatar';
import { AppFeedbackOverlay } from './AppFeedbackModal';
import { getFriends } from '../services/FriendsService';
import { summonFriendsToPub } from '../services/NotificationSummonService';

const OVERLAY_VERTICAL_PADDING = 24;
const CARD_HEIGHT_CAP = 560;
const FRIEND_AVATAR_SIZE = 40;

function useSummonCardHeight() {
  const insets = useSafeAreaInsets();
  const windowHeight = Dimensions.get('window').height;
  const available =
    windowHeight - insets.top - insets.bottom - OVERLAY_VERTICAL_PADDING * 2;
  return Math.min(windowHeight * 0.82, CARD_HEIGHT_CAP, Math.max(available, 280));
}

function FriendRow({ friend, selected, onToggle }) {
  const label = friend.username || 'Friend';
  return (
    <TouchableOpacity
      style={styles.friendRow}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}, ${selected ? 'selected' : 'not selected'}`}
    >
      <UserAvatar avatarUrl={friend.avatar_url} size={FRIEND_AVATAR_SIZE} iconSize={22} />
      <Text style={styles.friendName} numberOfLines={1}>
        {label}
      </Text>
      <MaterialCommunityIcons
        name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={26}
        color={selected ? COLORS.amber : COLORS.mediumGrey}
      />
    </TouchableOpacity>
  );
}

export default function PubSummonTroopsModal({
  visible,
  onClose,
  pubId,
  pubName,
  pubAreaLabel,
  currentUserId,
}) {
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const insets = useSafeAreaInsets();
  const cardHeight = useSummonCardHeight();

  useEffect(() => {
    if (!visible) {
      setSelectedIds(new Set());
      setSending(false);
      setFeedback(null);
      return;
    }

    if (!currentUserId) {
      setFriends([]);
      return;
    }

    let cancelled = false;
    setFriendsLoading(true);
    getFriends(currentUserId)
      .then((list) => {
        if (!cancelled) setFriends(list || []);
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
      })
      .finally(() => {
        if (!cancelled) setFriendsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, currentUserId]);

  const toggleFriend = useCallback((friendId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  }, []);

  const allFriendsSelected =
    friends.length > 0 && friends.every((friend) => selectedIds.has(friend.id));
  const someFriendsSelected = selectedIds.size > 0 && !allFriendsSelected;

  const selectAllCheckboxIcon = allFriendsSelected
    ? 'checkbox-marked'
    : someFriendsSelected
      ? 'minus-box'
      : 'checkbox-blank-outline';

  const toggleSelectAll = useCallback(() => {
    if (allFriendsSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(friends.map((friend) => friend.id)));
  }, [allFriendsSelected, friends]);

  const dismissFeedback = useCallback(() => {
    const wasSuccess = feedback?.tone === 'success';
    setFeedback(null);
    if (wasSuccess) {
      setSelectedIds(new Set());
      onClose();
    }
  }, [feedback?.tone, onClose]);

  const handleSend = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setFeedback({
        title: 'Select friends',
        message: 'Choose at least one friend to summon.',
        tone: 'error',
      });
      return;
    }

    setSending(true);
    try {
      const count = await summonFriendsToPub({
        pubId,
        friendIds: ids,
        pubAreaLabel,
      });
      setFeedback({
        title: 'Troops summoned',
        message:
          count === 1
            ? 'Your friend has been notified.'
            : `${count} friends have been notified.`,
        tone: 'success',
      });
    } catch (e) {
      const message = e?.message || 'Could not send notifications. Try again.';
      setFeedback({
        title: 'Could not summon',
        message,
        tone: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  const selectedCount = selectedIds.size;
  const sendDisabled = sending || selectedCount === 0 || friendsLoading;

  const handleModalRequestClose = feedback ? dismissFeedback : onClose;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleModalRequestClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        {!feedback ? (
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close summon friends"
          accessibilityRole="button"
        />
        ) : null}
        <View style={[styles.card, { height: cardHeight, maxHeight: cardHeight }]}>
          <View style={styles.header}>
            <View style={styles.headerTextCol}>
              <Text style={styles.title}>Summon the Troops</Text>
              <Text style={styles.subtitle}>
                Send a notification to summon your friends to{' '}
                <Text style={styles.subtitlePubHighlight}>
                  {pubName || 'this pub'}
                  {pubAreaLabel ? `, ${pubAreaLabel}` : ''}
                </Text>
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="close" size={24} color={COLORS.darkGrey} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            {friendsLoading ? (
              <View style={styles.bodyCentered}>
                <ActivityIndicator size="small" color={COLORS.amber} />
              </View>
            ) : friends.length === 0 ? (
              <View style={styles.bodyCentered}>
                <Text style={styles.emptyText}>
                  You have no friends yet. Add friends from the leaderboard to summon them here.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.friendsScroll}
                contentContainerStyle={styles.friendsScrollContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {friends.map((friend, index) => (
                  <View
                    key={friend.id}
                    style={index < friends.length - 1 ? styles.friendRowBorder : null}
                  >
                    <FriendRow
                      friend={friend}
                      selected={selectedIds.has(friend.id)}
                      onToggle={() => toggleFriend(friend.id)}
                    />
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={[styles.footerBlock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.footerActions}>
              {!friendsLoading && friends.length > 0 ? (
                <TouchableOpacity
                  style={[styles.footerButton, styles.footerOutlined, styles.footerSelectAll]}
                  onPress={toggleSelectAll}
                  disabled={sending}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: allFriendsSelected ? true : someFriendsSelected ? 'mixed' : false,
                  }}
                  accessibilityLabel={`All friends, ${selectedIds.size} of ${friends.length} selected`}
                >
                  <MaterialCommunityIcons
                    name={selectAllCheckboxIcon}
                    size={22}
                    color={selectedIds.size > 0 ? COLORS.amber : COLORS.mediumGrey}
                  />
                  <Text style={styles.footerSelectAllLabel}>All</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.footerButton,
                  styles.footerSend,
                  !friendsLoading && friends.length > 0 && styles.footerButtonSpaced,
                  sendDisabled && styles.footerSendDisabled,
                ]}
                onPress={handleSend}
                disabled={sendDisabled}
                activeOpacity={0.7}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.footerSendText} numberOfLines={1}>
                    Send{selectedCount > 0 ? ` (${selectedCount})` : ''}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {feedback ? (
          <AppFeedbackOverlay
            title={feedback.title}
            message={feedback.message}
            tone={feedback.tone}
            onClose={dismissFeedback}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: OVERLAY_VERTICAL_PADDING,
  },
  overlayTouchable: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'column',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 16,
  },
  header: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.darkGrey,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginTop: 4,
    lineHeight: 20,
  },
  subtitlePubHighlight: {
    color: COLORS.amber,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  bodyCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textAlign: 'center',
    lineHeight: 20,
  },
  friendsScroll: {
    flex: 1,
  },
  friendsScrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  friendRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.lightGrey,
  },
  friendName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  footerBlock: {
    flexShrink: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.divider,
    backgroundColor: '#FFFFFF',
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  footerButton: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonSpaced: {
    marginLeft: 8,
  },
  footerOutlined: {
    borderWidth: 1,
    borderColor: COLORS.mediumGrey,
  },
  footerSelectAll: {
    flex: 1,
    flexBasis: 0,
    flexDirection: 'row',
  },
  footerSelectAllLabel: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  footerSend: {
    backgroundColor: COLORS.amber,
  },
  footerSendDisabled: {
    opacity: 0.45,
  },
  footerSendText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
