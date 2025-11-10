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

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const AMBER = '#D4A017';

export default function CreateLeagueModal({ visible, onClose, currentUserId, onLeagueCreated }) {
  const [leagueName, setLeagueName] = useState('');
  const [friends, setFriends] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1 = name, 2 = add friends

  useEffect(() => {
    if (visible) {
      loadFriends();
    } else {
      // Reset state when modal closes
      setLeagueName('');
      setSelectedFriends([]);
      setStep(1);
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

  const handleNext = () => {
    if (!leagueName.trim()) {
      Alert.alert('Error', 'Please enter a league name');
      return;
    }
    setStep(2);
  };

  const handleCreate = async () => {
    if (!leagueName.trim()) {
      Alert.alert('Error', 'Please enter a league name');
      return;
    }

    try {
      setLoading(true);

      // Create the league
      const league = await createLeague(currentUserId, leagueName);

      // Add selected friends to the league
      for (const friendId of selectedFriends) {
        try {
          await addLeagueMember(league.id, friendId);
        } catch (error) {
          console.error('Error adding friend to league:', error);
        }
      }

      Alert.alert('Success', 'League created successfully!');
      if (onLeagueCreated) onLeagueCreated();
      onClose();
    } catch (error) {
      console.error('Error creating league:', error);
      Alert.alert('Error', 'Failed to create league');
    } finally {
      setLoading(false);
    }
  };

  const renderFriendItem = ({ item }) => {
    const isSelected = selectedFriends.includes(item.id);

    return (
      <TouchableOpacity
        style={[styles.friendItem, isSelected && styles.selectedFriendItem]}
        onPress={() => toggleFriendSelection(item.id)}
      >
        <View style={styles.userIcon}>
          <MaterialCommunityIcons name="account" size={32} color={MEDIUM_GREY} />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.username}>{item.username}</Text>
          <Text style={styles.userStats}>
            Level {item.stats?.level || 1} • {item.stats?.total_score || 0} points
          </Text>
        </View>
        {isSelected && (
          <MaterialCommunityIcons name="check-circle" size={24} color={AMBER} />
        )}
      </TouchableOpacity>
    );
  };

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
            <Text style={styles.modalTitle}>
              {step === 1 ? 'Create League' : 'Add Friends'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={DARK_GREY} />
            </TouchableOpacity>
          </View>

          {/* Step Indicator */}
          <View style={styles.stepIndicator}>
            <View style={[styles.stepDot, styles.activeDot]} />
            <View style={[styles.stepLine, step === 2 && styles.activeStepLine]} />
            <View style={[styles.stepDot, step === 2 && styles.activeDot]} />
          </View>

          {/* Step 1: League Name */}
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
                style={styles.nextButton}
                onPress={handleNext}
                disabled={!leagueName.trim()}
              >
                <Text style={styles.nextButtonText}>Next</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: Add Friends */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.label}>
                Add Friends ({selectedFriends.length} selected)
              </Text>
              <Text style={styles.hint}>
                Select friends to invite to your league (optional)
              </Text>

              {friends.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <MaterialCommunityIcons
                    name="account-group-outline"
                    size={64}
                    color={MEDIUM_GREY}
                  />
                  <Text style={styles.emptyText}>No friends yet</Text>
                  <Text style={styles.emptySubtext}>
                    You can add friends later and invite them to the league
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

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => setStep(1)}
                >
                  <MaterialCommunityIcons name="arrow-left" size={20} color={DARK_GREY} />
                  <Text style={styles.backButtonText}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.createButton, loading && styles.disabledButton]}
                  onPress={handleCreate}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="check" size={20} color="#FFFFFF" />
                      <Text style={styles.createButtonText}>Create</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
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
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: LIGHT_GREY,
  },
  activeDot: {
    backgroundColor: AMBER,
  },
  stepLine: {
    width: 60,
    height: 2,
    backgroundColor: LIGHT_GREY,
    marginHorizontal: 8,
  },
  activeStepLine: {
    backgroundColor: AMBER,
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
    marginBottom: 8,
  },
  input: {
    height: 48,
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: MEDIUM_GREY,
    marginBottom: 24,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AMBER,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  friendsList: {
    flex: 1,
    marginTop: 12,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  selectedFriendItem: {
    backgroundColor: '#FFF8E1',
    borderWidth: 2,
    borderColor: AMBER,
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
  userStats: {
    fontSize: 12,
    color: MEDIUM_GREY,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  backButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_GREY,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
  },
  createButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AMBER,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
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
    paddingHorizontal: 40,
  },
});

