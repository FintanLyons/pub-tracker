import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getFriends } from '../services/FriendsService';

const OVERLAY_VERTICAL_PADDING = 24;
const CARD_HEIGHT_CAP = 560;
const ROW_AVATAR_SIZE = 40;

function usePickerCardHeight() {
  const insets = useSafeAreaInsets();
  const windowHeight = Dimensions.get('window').height;
  const available =
    windowHeight - insets.top - insets.bottom - OVERLAY_VERTICAL_PADDING * 2;
  return Math.min(windowHeight * 0.82, CARD_HEIGHT_CAP, Math.max(available, 280));
}

function PersonRow({ person, selected, onToggle }) {
  const label = person.isSelf
    ? person.username?.trim() || 'You'
    : person.username || 'Friend';
  return (
    <TouchableOpacity
      style={styles.personRow}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}, ${selected ? 'selected' : 'not selected'}`}
    >
      <UserAvatar avatarUrl={person.avatar_url} size={ROW_AVATAR_SIZE} iconSize={22} />
      <Text style={styles.personName} numberOfLines={1}>
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

/**
 * Pick whose favourite pubs to show on the map (you and/or friends).
 * Use embedded inside FilterScreen on iOS to avoid stacked Modal issues.
 */
export default function FavoritesFilterModal({
  visible,
  onClose,
  onApply,
  currentUserId,
  currentUser,
  initialSelectedIds = [],
  embedded = false,
}) {
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const insets = useSafeAreaInsets();
  const cardHeight = usePickerCardHeight();

  const selfPerson = useMemo(() => {
    if (!currentUserId) return null;
    return {
      id: currentUserId,
      username: currentUser?.username || 'You',
      avatar_url: currentUser?.avatar_url ?? null,
      isSelf: true,
    };
  }, [currentUserId, currentUser?.username, currentUser?.avatar_url]);

  const roster = useMemo(() => {
    const list = [];
    if (selfPerson) list.push(selfPerson);
    const sortedFriends = [...friends].sort((a, b) =>
      (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' })
    );
    return list.concat(sortedFriends);
  }, [selfPerson, friends]);

  useEffect(() => {
    if (!visible) return;
    setSelectedIds(new Set(initialSelectedIds || []));
  }, [visible, initialSelectedIds]);

  useEffect(() => {
    if (!visible) {
      setFriends([]);
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

  const togglePerson = useCallback((personId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }, []);

  const allSelected =
    roster.length > 0 && roster.every((person) => selectedIds.has(person.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const selectAllCheckboxIcon = allSelected
    ? 'checkbox-marked'
    : someSelected
      ? 'minus-box'
      : 'checkbox-blank-outline';

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(roster.map((person) => person.id)));
  }, [allSelected, roster]);

  const handleApply = () => {
    onApply?.([...selectedIds]);
    onClose?.();
  };

  const selectedCount = selectedIds.size;
  const applyDisabled = friendsLoading || !currentUserId;

  if (!visible) return null;

  const card = (
    <View style={[styles.card, { height: cardHeight, maxHeight: cardHeight }]}>
      <View style={styles.header}>
        <View style={styles.headerTextCol}>
          <Text style={styles.title}>Favourites filter</Text>
          <Text style={styles.subtitle}>
            Show pubs favourited by you, your friends, or both.
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
        {!currentUserId ? (
          <View style={styles.bodyCentered}>
            <Text style={styles.emptyText}>Sign in to filter by favourites.</Text>
          </View>
        ) : friendsLoading ? (
          <View style={styles.bodyCentered}>
            <ActivityIndicator size="small" color={COLORS.amber} />
          </View>
        ) : (
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listScrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {roster.map((person, index) => (
              <View
                key={person.id}
                style={index < roster.length - 1 ? styles.personRowBorder : null}
              >
                <PersonRow
                  person={person}
                  selected={selectedIds.has(person.id)}
                  onToggle={() => togglePerson(person.id)}
                />
              </View>
            ))}
            {friends.length === 0 && currentUserId ? (
              <Text style={styles.hintBelowList}>
                Add friends from the leaderboard to include their favourites too.
              </Text>
            ) : null}
          </ScrollView>
        )}
      </View>

      <View style={[styles.footerBlock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <View style={styles.footerActions}>
          {currentUserId && !friendsLoading && roster.length > 0 ? (
            <TouchableOpacity
              style={[styles.footerButton, styles.footerOutlined, styles.footerSelectAll]}
              onPress={toggleSelectAll}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: allSelected ? true : someSelected ? 'mixed' : false,
              }}
              accessibilityLabel={`Everyone, ${selectedIds.size} of ${roster.length} selected`}
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
              styles.footerApply,
              roster.length > 0 && styles.footerButtonSpaced,
              applyDisabled && styles.footerApplyDisabled,
            ]}
            onPress={handleApply}
            disabled={applyDisabled}
            activeOpacity={0.7}
          >
            <Text style={styles.footerApplyText} numberOfLines={1}>
              Apply{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (embedded) {
    return (
      <View style={embeddedStyles.layer} pointerEvents="box-none">
        <TouchableOpacity
          style={embeddedStyles.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Dismiss favourites filter"
        />
        {card}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Dismiss favourites filter"
          accessibilityRole="button"
        />
        {card}
      </View>
    </Modal>
  );
}

const embeddedStyles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: OVERLAY_VERTICAL_PADDING,
    zIndex: 20,
    elevation: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
});

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
  listScroll: {
    flex: 1,
  },
  listScrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    paddingBottom: 12,
  },
  hintBelowList: {
    fontSize: 13,
    color: COLORS.mediumGrey,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
    paddingHorizontal: 8,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  personRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.lightGrey,
  },
  personName: {
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
    flexDirection: 'row',
  },
  footerSelectAllLabel: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  footerApply: {
    backgroundColor: COLORS.amber,
  },
  footerApplyDisabled: {
    opacity: 0.45,
  },
  footerApplyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
