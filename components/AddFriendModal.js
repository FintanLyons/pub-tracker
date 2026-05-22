import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Share,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { searchUsers } from '../services/UserService';
import { sendFriendRequest, getPendingFriendRequests, acceptFriendRequest, rejectFriendRequest, getFriends, removeFriend } from '../services/FriendsService';
import { COLORS } from '../constants/theme';
import { APP_DISPLAY_NAME, buildFriendInviteMessage } from '../constants/app';
import UserAvatar from './UserAvatar';
import { AppFeedbackOverlay } from './AppFeedbackModal';
import { useAppAlert } from '../contexts/AppAlertContext';

export default function AddFriendModal({
  visible,
  onClose,
  currentUserId,
  currentUsername,
  onFriendAdded,
  onFriendRemoved,
  initialTab = 'search',
}) {
  const { showAppAlert } = useAppAlert();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [friendsList, setFriendsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab); // 'search', 'requests', or 'friends'
  const [feedback, setFeedback] = useState(null); // { title, message, tone: 'success' | 'error' }
  const [removeConfirm, setRemoveConfirm] = useState(null); // { friendId, friendUsername }
  const [removingFriend, setRemovingFriend] = useState(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    if (visible) {
      loadPendingRequests();
      loadFriends();
      setActiveTab(initialTab);
    } else {
      setFeedback(null);
      setRemoveConfirm(null);
      setRemovingFriend(false);
    }
  }, [visible, initialTab]);

  const dismissFeedback = () => setFeedback(null);

  const showFeedback = (title, message, tone = 'success') => {
    setFeedback({ title, message, tone });
  };

  const handleSearch = useCallback(async (query) => {
    const searchText = query || searchQuery;

    if (!searchText.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setLoading(true);
      const results = await searchUsers(searchText.trim());
      const filtered = results.filter((user) => user.id !== currentUserId);
      setSearchResults(filtered);
    } catch (error) {
      console.error('Error searching users:', error);
      showAppAlert({ title: 'Error', message: 'Failed to search users', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [searchQuery, currentUserId]);

  // Auto-search as user types (debounced)
  useEffect(() => {
    if (activeTab === 'search' && searchQuery.trim()) {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(() => {
        handleSearch(searchQuery);
      }, 500);

      return () => {
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
      };
    }
  }, [searchQuery, activeTab, handleSearch]);

  const loadPendingRequests = async () => {
    try {
      const requests = await getPendingFriendRequests(currentUserId);
      setPendingRequests(requests);
    } catch (error) {
      console.error('Error loading pending requests:', error);
    }
  };

  const loadFriends = async () => {
    try {
      const friends = await getFriends(currentUserId);
      setFriendsList(friends);
    } catch (error) {
      console.error('Error loading friends:', error);
    }
  };

  const handleSendRequest = async (friendId) => {
    try {
      const result = await sendFriendRequest(currentUserId, friendId);
      if (result?.alreadyExists) {
        showFeedback(
          'Already connected',
          'A request already exists or you are already friends.',
        );
      } else {
        showFeedback('Request sent', 'Your friend request was sent.');
      }
      setSearchQuery('');
      setSearchResults([]);
    } catch (error) {
      console.error('Error sending friend request:', error);
      showFeedback('Could not send', 'Failed to send friend request. Please try again.', 'error');
    }
  };

  const handleAcceptRequest = async (friendshipId) => {
    try {
      await acceptFriendRequest(friendshipId);
      showFeedback("You're friends now", 'Friend request accepted.');
      loadPendingRequests();
      if (onFriendAdded) onFriendAdded();
    } catch (error) {
      console.error('Error accepting friend request:', error);
      showFeedback('Could not accept', 'Failed to accept friend request. Please try again.', 'error');
    }
  };

  const handleRejectRequest = async (friendshipId) => {
    try {
      await rejectFriendRequest(friendshipId);
      showFeedback('Request declined', 'You declined this friend request.');
      loadPendingRequests();
    } catch (error) {
      console.error('Error rejecting friend request:', error);
      showFeedback('Could not decline', 'Failed to decline friend request. Please try again.', 'error');
    }
  };

  const handleInviteNonUser = async () => {
    try {
      await Share.share({
        message: buildFriendInviteMessage(currentUsername),
      });
    } catch (e) {
      console.warn('Share invite failed', e);
    }
  };

  const handleRemoveFriend = (friendId, friendUsername) => {
    setRemoveConfirm({ friendId, friendUsername });
  };

  const cancelRemoveFriend = () => {
    if (!removingFriend) setRemoveConfirm(null);
  };

  const confirmRemoveFriend = async () => {
    if (!removeConfirm || !currentUserId || removingFriend) return;

    const { friendId, friendUsername } = removeConfirm;
    setRemovingFriend(true);
    try {
      await removeFriend(currentUserId, friendId);
      setRemoveConfirm(null);
      loadFriends();
      if (onFriendRemoved) {
        onFriendRemoved(friendUsername);
      } else {
        showFeedback(
          'Friend removed',
          `${friendUsername} was removed from your friends.`,
        );
      }
    } catch (error) {
      console.error('Error removing friend:', error);
      setRemoveConfirm(null);
      showFeedback(
        'Could not remove',
        'Failed to remove friend. Please try again.',
        'error',
      );
    } finally {
      setRemovingFriend(false);
    }
  };

  const renderSearchResult = ({ item }) => (
    <View style={styles.resultItem}>
      <UserAvatar avatarUrl={item.avatar_url} size={48} style={styles.userIcon} />
      <View style={styles.userInfo}>
        <Text style={styles.username}>{item.username}</Text>
        <Text style={styles.userDate}>
          Joined {new Date(item.created_at).toLocaleDateString()}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => handleSendRequest(item.id)}
      >
        <MaterialCommunityIcons name="account-plus" size={24} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );

  const renderPendingRequest = ({ item }) => (
    <View style={styles.requestItem}>
      <UserAvatar avatarUrl={item.requester?.avatar_url} size={48} style={styles.userIcon} />
      <View style={styles.userInfo}>
        <Text style={styles.username}>{item.requester.username}</Text>
        <Text style={styles.userDate}>
          {new Date(item.created_at).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={() => handleAcceptRequest(item.id)}
        >
          <MaterialCommunityIcons name="check" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rejectButton}
          onPress={() => handleRejectRequest(item.id)}
        >
          <MaterialCommunityIcons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderFriend = ({ item }) => (
    <View style={styles.friendItem}>
      <UserAvatar avatarUrl={item.avatar_url} size={48} style={styles.userIcon} />
      <View style={styles.userInfo}>
        <Text style={styles.username}>{item.username}</Text>
        <Text style={styles.userDate}>
          Level {item.stats?.level || 1} • {item.stats?.pubs_visited || 0} pubs
        </Text>
      </View>
      <TouchableOpacity
        style={styles.removeButton}
        onPress={() => handleRemoveFriend(item.id, item.username)}
      >
        <MaterialCommunityIcons name="minus-circle" size={28} color="#F44336" />
      </TouchableOpacity>
    </View>
  );

  const handleModalRequestClose = () => {
    if (feedback) dismissFeedback();
    else if (removeConfirm) cancelRemoveFriend();
    else onClose();
  };

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
            <Text style={styles.modalTitle}>Add Friends</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={COLORS.darkGrey} />
            </TouchableOpacity>
          </View>

          {/* Tab Selector */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'search' && styles.activeTab]}
              onPress={() => setActiveTab('search')}
            >
              <Text style={[styles.tabText, activeTab === 'search' && styles.activeTabText]}>
                Search
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
              onPress={() => setActiveTab('friends')}
            >
              <Text style={[styles.tabText, activeTab === 'friends' && styles.activeTabText]}>
                Friends
                {friendsList.length > 0 && (
                  <Text style={styles.badge}> {friendsList.length}</Text>
                )}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'requests' && styles.activeTab]}
              onPress={() => setActiveTab('requests')}
            >
              <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
                Requests
                {pendingRequests.length > 0 && (
                  <Text style={styles.badge}> {pendingRequests.length}</Text>
                )}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search Tab */}
          {activeTab === 'search' && (
            <>
              <View style={styles.inviteOutsiderRow}>
                <View style={styles.inviteOutsiderTextCol}>
                  <Text style={styles.inviteOutsiderTitle}>Not on the app yet?</Text>
                  <Text style={styles.inviteOutsiderSub}>
                    Send an invite so they can install {APP_DISPLAY_NAME} and add you as a friend.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.inviteOutsiderButton}
                  onPress={handleInviteNonUser}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Invite someone to the app"
                >
                  <MaterialCommunityIcons name="share-variant" size={20} color={COLORS.charcoal} />
                  <Text style={styles.inviteOutsiderButtonText}>Invite</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by username..."
                  value={searchQuery}
                  onChangeText={(text) => {
                    setSearchQuery(text);
                    // Clear results when user clears the search
                    if (!text.trim()) {
                      setSearchResults([]);
                    }
                  }}
                  onSubmitEditing={() => handleSearch(searchQuery)}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                <TouchableOpacity 
                  style={styles.searchButton} 
                  onPress={() => handleSearch(searchQuery)}
                >
                  <MaterialCommunityIcons name="magnify" size={24} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={COLORS.amber} />
                </View>
              ) : searchResults.length > 0 ? (
                <FlatList
                  data={searchResults}
                  renderItem={renderSearchResult}
                  keyExtractor={(item) => item.id}
                  style={styles.resultsList}
                />
              ) : searchQuery.trim() ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No users found</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <MaterialCommunityIcons name="account-search" size={64} color={COLORS.mediumGrey} />
                  <Text style={styles.emptyText}>Search for friends</Text>
                </View>
              )}
            </>
          )}

          {/* Friends Tab */}
          {activeTab === 'friends' && (
            <>
              {friendsList.length > 0 ? (
                <FlatList
                  data={friendsList}
                  renderItem={renderFriend}
                  keyExtractor={(item) => item.id}
                  style={styles.resultsList}
                />
              ) : (
                <View style={styles.emptyContainer}>
                  <MaterialCommunityIcons name="account-group" size={64} color={COLORS.mediumGrey} />
                  <Text style={styles.emptyText}>No friends yet</Text>
                  <Text style={styles.emptySubtext}>
                    Search for users and send friend requests
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Requests Tab */}
          {activeTab === 'requests' && (
            <>
              {pendingRequests.length > 0 ? (
                <FlatList
                  data={pendingRequests}
                  renderItem={renderPendingRequest}
                  keyExtractor={(item) => item.id}
                  style={styles.resultsList}
                />
              ) : (
                <View style={styles.emptyContainer}>
                  <MaterialCommunityIcons name="account-clock" size={64} color={COLORS.mediumGrey} />
                  <Text style={styles.emptyText}>No pending requests</Text>
                </View>
              )}
            </>
          )}
        </View>

        {removeConfirm && !feedback ? (
          <View style={styles.confirmLayer} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.confirmBackdrop}
              activeOpacity={1}
              onPress={cancelRemoveFriend}
              accessibilityLabel="Dismiss"
            />
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>Remove friend?</Text>
              <Text style={styles.confirmBody}>
                Remove {removeConfirm.friendUsername} from your friends?
              </Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnSecondary]}
                  onPress={cancelRemoveFriend}
                  disabled={removingFriend}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmBtnTextSecondary}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnDanger]}
                  onPress={confirmRemoveFriend}
                  disabled={removingFriend}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                >
                  {removingFriend ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmBtnTextDanger}>Remove</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  confirmLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 10,
    elevation: 24,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  confirmCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
    marginBottom: 10,
  },
  confirmBody: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.accentGrey,
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmActions: {
    flexDirection: 'row',
  },
  confirmBtn: {
    flex: 1,
    minHeight: 48,
    marginHorizontal: 5,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  confirmBtnSecondary: {
    backgroundColor: COLORS.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  confirmBtnDanger: {
    backgroundColor: COLORS.errorRed,
  },
  confirmBtnTextSecondary: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  confirmBtnTextDanger: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
    paddingBottom: 20,
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
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightGrey,
    margin: 20,
    marginBottom: 16,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  activeTabText: {
    color: COLORS.darkGrey,
  },
  badge: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.amber,
  },
  inviteOutsiderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
    gap: 12,
  },
  inviteOutsiderTextCol: {
    flex: 1,
  },
  inviteOutsiderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.darkGrey,
    marginBottom: 4,
  },
  inviteOutsiderSub: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.mediumGrey,
  },
  inviteOutsiderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.amber,
    borderRadius: 10,
  },
  inviteOutsiderButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.charcoal,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    height: 48,
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginRight: 8,
  },
  searchButton: {
    width: 48,
    height: 48,
    backgroundColor: COLORS.amber,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsList: {
    flex: 1,
    paddingHorizontal: 20,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  requestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
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
  userDate: {
    fontSize: 12,
    color: COLORS.mediumGrey,
  },
  addButton: {
    width: 40,
    height: 40,
    backgroundColor: COLORS.amber,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    width: 40,
    height: 40,
    backgroundColor: '#4CAF50',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButton: {
    width: 40,
    height: 40,
    backgroundColor: '#F44336',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
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
  },
});

