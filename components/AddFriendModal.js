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
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { searchUsers } from '../services/UserService';
import { sendFriendRequest, getPendingFriendRequests, acceptFriendRequest, rejectFriendRequest, getFriends, removeFriend } from '../services/FriendsService';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const AMBER = '#D4A017';

export default function AddFriendModal({ visible, onClose, currentUserId, onFriendAdded, initialTab = 'search' }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [friendsList, setFriendsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab); // 'search', 'requests', or 'friends'
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    if (visible) {
      loadPendingRequests();
      loadFriends();
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  // Auto-search as user types (debounced)
  useEffect(() => {
    if (activeTab === 'search' && searchQuery.trim()) {
      // Clear any existing timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      // Set new timeout to search after 500ms of no typing
      searchTimeoutRef.current = setTimeout(() => {
        handleSearch(searchQuery);
      }, 500);

      // Cleanup
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

  const handleSearch = useCallback(async (query) => {
    const searchText = query || searchQuery;
    
    if (!searchText.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setLoading(true);
      const results = await searchUsers(searchText.trim());
      // Filter out current user
      const filtered = results.filter(user => user.id !== currentUserId);
      setSearchResults(filtered);
    } catch (error) {
      console.error('Error searching users:', error);
      Alert.alert('Error', 'Failed to search users');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, currentUserId]);

  const handleSendRequest = async (friendId) => {
    try {
      await sendFriendRequest(currentUserId, friendId);
      Alert.alert('Success', 'Friend request sent!');
      setSearchQuery('');
      setSearchResults([]);
    } catch (error) {
      console.error('Error sending friend request:', error);
      if (error.message.includes('already exists')) {
        Alert.alert('Error', 'Friend request already sent or you are already friends');
      } else {
        Alert.alert('Error', 'Failed to send friend request');
      }
    }
  };

  const handleAcceptRequest = async (friendshipId) => {
    try {
      await acceptFriendRequest(friendshipId);
      Alert.alert('Success', 'Friend request accepted!');
      loadPendingRequests();
      if (onFriendAdded) onFriendAdded();
    } catch (error) {
      console.error('Error accepting friend request:', error);
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  const handleRejectRequest = async (friendshipId) => {
    try {
      await rejectFriendRequest(friendshipId);
      loadPendingRequests();
    } catch (error) {
      console.error('Error rejecting friend request:', error);
      Alert.alert('Error', 'Failed to reject friend request');
    }
  };

  const handleRemoveFriend = async (friendId, friendUsername) => {
    Alert.alert(
      'Remove Friend',
      `Remove ${friendUsername} from your friends?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFriend(currentUserId, friendId);
              Alert.alert('Success', 'Friend removed');
              loadFriends();
              if (onFriendAdded) onFriendAdded(); // Refresh leaderboard
            } catch (error) {
              console.error('Error removing friend:', error);
              Alert.alert('Error', 'Failed to remove friend');
            }
          }
        }
      ]
    );
  };

  const renderSearchResult = ({ item }) => (
    <View style={styles.resultItem}>
      <View style={styles.userIcon}>
        <MaterialCommunityIcons name="account" size={32} color={MEDIUM_GREY} />
      </View>
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
      <View style={styles.userIcon}>
        <MaterialCommunityIcons name="account" size={32} color={MEDIUM_GREY} />
      </View>
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
      <View style={styles.userIcon}>
        <MaterialCommunityIcons name="account" size={32} color={MEDIUM_GREY} />
      </View>
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Friends</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={DARK_GREY} />
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
                  <ActivityIndicator size="large" color={AMBER} />
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
                  <MaterialCommunityIcons name="account-search" size={64} color={MEDIUM_GREY} />
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
                  <MaterialCommunityIcons name="account-group" size={64} color={MEDIUM_GREY} />
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
                  <MaterialCommunityIcons name="account-clock" size={64} color={MEDIUM_GREY} />
                  <Text style={styles.emptyText}>No pending requests</Text>
                </View>
              )}
            </>
          )}
        </View>
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
    borderBottomColor: LIGHT_GREY,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  closeButton: {
    padding: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: LIGHT_GREY,
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
    color: MEDIUM_GREY,
  },
  activeTabText: {
    color: DARK_GREY,
  },
  badge: {
    fontSize: 12,
    fontWeight: 'bold',
    color: AMBER,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    height: 48,
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginRight: 8,
  },
  searchButton: {
    width: 48,
    height: 48,
    backgroundColor: AMBER,
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
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  requestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  userIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
    marginBottom: 2,
  },
  userDate: {
    fontSize: 12,
    color: MEDIUM_GREY,
  },
  addButton: {
    width: 40,
    height: 40,
    backgroundColor: AMBER,
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
    color: MEDIUM_GREY,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: MEDIUM_GREY,
    marginTop: 8,
    textAlign: 'center',
  },
});

