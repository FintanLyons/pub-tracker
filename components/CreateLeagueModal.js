import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createLeague, addLeagueMember } from '../services/LeagueService';
import { getFriends } from '../services/FriendsService';
import { COLORS } from '../constants/theme';
import ShareLeagueModal from './ShareLeagueModal';
import UserAvatar from './UserAvatar';

export default function CreateLeagueModal({ visible, onClose, currentUserId, onLeagueCreated }) {
  const [leagueName, setLeagueName] = useState('');
  const [friends, setFriends] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1 = name, 2 = league exists: share + add friends + done
  const [createdLeague, setCreatedLeague] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);

  useEffect(() => {
    if (visible) {
      loadFriends();
    } else {
      setLeagueName('');
      setSelectedFriends([]);
      setStep(1);
      setCreatedLeague(null);
      setShowShareModal(false);
    }
  }, [visible]);

  const loadFriends = async () => {
    try {
      const friendsList = await getFriends(currentUserId);
      setFriends(friendsList);
    } catch (error) {
      console.error('Error loading friends:', error);
    }
  };

  const toggleFriendSelection = (friendId) => {
    setSelectedFriends((prev) =>
      prev.includes(friendId)
        ? prev.filter((id) => id !== friendId)
        : [...prev, friendId]
    );
  };

  /** Creates the league on the server so the invite code exists before the add-friends step. */
  const handleNext = async () => {
    if (!leagueName.trim()) {
      Alert.alert('Error', 'Please enter a league name');
      return;
    }

    try {
      setLoading(true);
      const league = await createLeague(currentUserId, leagueName.trim());
      setCreatedLeague(league);
      setStep(2);
      if (onLeagueCreated) onLeagueCreated();
    } catch (error) {
      console.error('Error creating league:', error);
      Alert.alert('Error', 'Failed to create league');
    } finally {
      setLoading(false);
    }
  };

  const handleDone = async () => {
    if (!createdLeague) return;

    setLoading(true);
    for (const friendId of selectedFriends) {
      try {
        await addLeagueMember(createdLeague.id, friendId);
      } catch (error) {
        console.error('Error adding friend to league:', error);
      }
    }
    if (onLeagueCreated) onLeagueCreated();
    setLoading(false);
    onClose();
  };

  const renderFriendItem = ({ item }) => {
    const isSelected = selectedFriends.includes(item.id);

    return (
      <TouchableOpacity
        style={[styles.friendItem, isSelected && styles.selectedFriendItem]}
        onPress={() => toggleFriendSelection(item.id)}
      >
        <UserAvatar avatarUrl={item.avatar_url} size={48} style={styles.userIcon} />
        <View style={styles.userInfo}>
          <Text style={styles.username}>{item.username}</Text>
          <Text style={styles.userStats}>
            Level {item.stats?.level || 1} • {item.stats?.total_score || 0} points
          </Text>
        </View>
        {isSelected && (
          <MaterialCommunityIcons name="check-circle" size={24} color={COLORS.amber} />
        )}
      </TouchableOpacity>
    );
  };

  const handleModalRequestClose = showShareModal
    ? () => setShowShareModal(false)
    : onClose;

  return (
      <Modal
        visible={visible}
        animationType="slide"
        transparent={true}
        onRequestClose={handleModalRequestClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create League</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>

            {step === 2 && createdLeague && (
              <View style={styles.shareUnderHeader}>
                <TouchableOpacity
                  style={styles.shareLeagueBanner}
                  onPress={() => setShowShareModal(true)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Share league"
                >
                  <MaterialCommunityIcons name="share-variant" size={22} color="#FFFFFF" />
                  <Text style={styles.shareLeagueBannerText}>Share league</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.modalDivider} />

            {step === 1 && (
              <View style={styles.stepContent}>
                <Text style={styles.label}>League Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter league name..."
                  value={leagueName}
                  onChangeText={setLeagueName}
                  maxLength={50}
                  autoFocus
                />
                <Text style={styles.hint}>
                  Choose a creative name for your league
                </Text>

                <TouchableOpacity
                  style={[styles.nextButton, loading && styles.disabledButton]}
                  onPress={handleNext}
                  disabled={!leagueName.trim() || loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Text style={styles.nextButtonText}>Next</Text>
                      <MaterialCommunityIcons name="arrow-right" size={20} color="#FFFFFF" />
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {step === 2 && createdLeague && (
              <View style={[styles.stepContent, styles.stepContentFinal]}>
                <Text style={styles.leagueSummaryName}>{createdLeague.name}</Text>
                <Text style={styles.leagueSummaryCodeLabel}>League code</Text>
                <Text style={styles.leagueSummaryCode}>
                  {String(createdLeague.code || '').toUpperCase()}
                </Text>

                <Text style={[styles.label, styles.friendsLabel]}>
                  Add friends ({selectedFriends.length} selected)
                </Text>

                {friends.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <MaterialCommunityIcons
                      name="account-group-outline"
                      size={64}
                      color={COLORS.mediumGrey}
                    />
                    <Text style={styles.emptyText}>No friends yet</Text>
                    <Text style={styles.emptySubtext}>
                      Use Share league to send your code, or add friends later from the leaderboard.
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={friends}
                    renderItem={renderFriendItem}
                    keyExtractor={(item) => item.id}
                    style={styles.friendsList}
                  />
                )}

                <TouchableOpacity
                  style={[
                    styles.nextButton,
                    styles.doneButton,
                    loading && styles.disabledButton,
                  ]}
                  onPress={handleDone}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.nextButtonText}>Done</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {showShareModal && createdLeague ? (
            <ShareLeagueModal
              embedded
              visible
              onClose={() => setShowShareModal(false)}
              leagueName={createdLeague.name}
              leagueCode={createdLeague.code}
            />
          ) : null}
        </View>
      </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGrey,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  closeButton: {
    padding: 4,
  },
  shareUnderHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  shareLeagueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.amber,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 10,
  },
  shareLeagueBannerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalDivider: {
    height: 1,
    marginVertical: 14,
    marginHorizontal: 20,
    backgroundColor: COLORS.lightGrey,
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  stepContentFinal: {
    paddingBottom: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    marginBottom: 8,
  },
  friendsLabel: {
    marginTop: 4,
    marginBottom: 12,
  },
  input: {
    height: 48,
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginBottom: 16,
  },
  leagueSummaryName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    marginBottom: 10,
  },
  leagueSummaryCodeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  leagueSummaryCode: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.darkGrey,
    letterSpacing: 2,
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.amber,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 16,
  },
  doneButton: {
    marginTop: 10,
    marginBottom: 6,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  disabledButton: {
    opacity: 0.6,
  },
  friendsList: {
    flex: 1,
    marginTop: 8,
    marginBottom: 8,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  selectedFriendItem: {
    backgroundColor: '#FFF8E1',
    borderWidth: 2,
    borderColor: COLORS.amber,
  },
  userIcon: {
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    marginBottom: 2,
  },
  userStats: {
    fontSize: 12,
    color: COLORS.mediumGrey,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    minHeight: 120,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.mediumGrey,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
