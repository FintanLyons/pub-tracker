import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getCurrentUserSecure, syncUserStats } from '../services/SecureAuthService';
import { getFriendsLeaderboard, getPendingFriendRequests } from '../services/FriendsService';
import { getUserLeagues, getLeagueLeaderboard, removeLeagueMember } from '../services/LeagueService';
import AddFriendModal from '../components/AddFriendModal';
import CreateLeagueModal from '../components/CreateLeagueModal';
import JoinLeagueModal from '../components/JoinLeagueModal';
import LeagueActionsModal from '../components/LeagueActionsModal';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const ACCENT_GREY = '#424242';
const AMBER = '#D4A017';

export default function LeaderboardScreen() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('friends'); // 'friends' or 'leagues'
  const [friendsLeaderboard, setFriendsLeaderboard] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [leagueLeaderboard, setLeagueLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showCreateLeagueModal, setShowCreateLeagueModal] = useState(false);
  const [showLeagueSelector, setShowLeagueSelector] = useState(false);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [openAddFriendOnRequests, setOpenAddFriendOnRequests] = useState(false);
  const [showLeagueActionsModal, setShowLeagueActionsModal] = useState(false);
  const [showJoinLeagueModal, setShowJoinLeagueModal] = useState(false);
  const [leavingLeague, setLeavingLeague] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const user = await getCurrentUserSecure();
      if (!user) {
        Alert.alert('Not Logged In', 'Please log in to view the leaderboard');
        return;
      }

      setCurrentUser(user);

      // Sync current user stats
      await syncUserStats(user.id);

      // Load friends leaderboard
      const friends = await getFriendsLeaderboard(user.id);
      setFriendsLeaderboard(friends);

      // Load pending friend requests count
      const pendingRequests = await getPendingFriendRequests(user.id);
      setPendingRequestsCount(pendingRequests.length);

      // Load user leagues
      const userLeagues = await getUserLeagues(user.id);
      setLeagues(userLeagues);

      // Load first league's leaderboard if available
      if (userLeagues.length > 0) {
        const firstLeague = userLeagues[0];
        setSelectedLeague(firstLeague);
        const leagueBoard = await getLeagueLeaderboard(firstLeague.id);
        setLeagueLeaderboard(leagueBoard);
      } else {
        setSelectedLeague(null);
        setLeagueLeaderboard([]);
      }
    } catch (error) {
      console.error('Error loading leaderboard data:', error);
      Alert.alert('Error', 'Failed to load leaderboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const handleLeagueSelect = async (league) => {
    try {
      setSelectedLeague(league);
      setShowLeagueSelector(false);
      setLoading(true);
      const leagueBoard = await getLeagueLeaderboard(league.id);
      setLeagueLeaderboard(leagueBoard);
    } catch (error) {
      console.error('Error loading league leaderboard:', error);
      Alert.alert('Error', 'Failed to load league leaderboard');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveLeague = () => {
    if (!selectedLeague || !currentUser || leavingLeague) {
      return;
    }

    const leagueName = selectedLeague.name;

    Alert.alert(
      'Leave League',
      `Are you sure you want to leave ${leagueName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              setLeavingLeague(true);
              setLoading(true);
              await removeLeagueMember(selectedLeague.id, currentUser.id);
              await loadData();
              Alert.alert('League Left', `You have left ${leagueName}.`);
            } catch (error) {
              console.error('Error leaving league:', error);
              Alert.alert(
                'Error',
                'Failed to leave league. Please try again.'
              );
            } finally {
              setLeavingLeague(false);
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const renderCurrentUserCard = (user) => {
    if (!user) return null;
    
    const rankColor = user.rank === 1 ? '#FFD700' : user.rank === 2 ? '#C0C0C0' : user.rank === 3 ? '#CD7F32' : ACCENT_GREY;
    const showAdminLabel = activeTab === 'leagues' && selectedLeague?.created_by === user.id;

    return (
      <>
        <View style={styles.currentUserCard}>
          <Text style={styles.currentUserLabel}>Your Position</Text>
          <View style={styles.currentUserRow}>
            <View style={styles.rankContainer}>
              <Text style={[styles.rankText, { color: rankColor }]}>
                {user.rank}
              </Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={[styles.username, styles.currentUserText]}>
                {user.username}
                {showAdminLabel && (
                  <Text style={styles.adminLabel}> - Admin</Text>
                )}
              </Text>
              <View style={styles.statsRow}>
                <Text style={styles.statText}>
                  Pubs: {user.stats?.pubs_visited || 0}
                </Text>
                <Text style={styles.statText}>
                  Level: {user.stats?.level || 1}
                </Text>
              </View>
            </View>
            <View style={styles.scoreContainer}>
              <Text style={[styles.scoreText, styles.currentUserText]}>
                {user.stats?.total_score || 0}
              </Text>
              <Text style={styles.scoreLabel}>Score</Text>
            </View>
          </View>
        </View>
        <View style={styles.separator} />
      </>
    );
  };

  const renderLeaderboardRow = (user, index) => {
    const isCurrentUser = user.id === currentUser?.id;
    const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : ACCENT_GREY;
    const showAdminLabel = activeTab === 'leagues' && selectedLeague?.created_by === user.id;

    return (
      <View
        key={user.id}
        style={styles.leaderboardRow}
      >
        <View style={styles.rankContainer}>
          <Text style={[styles.rankText, { color: rankColor }]}>
            {user.rank}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={[styles.username, isCurrentUser && styles.currentUserText]}>
            {user.username}
            {isCurrentUser && ' (You)'}
            {showAdminLabel && (
              <Text style={styles.adminLabel}> - Admin</Text>
            )}
          </Text>
          <View style={styles.statsRow}>
            <Text style={styles.statText}>
              Pubs: {user.stats?.pubs_visited || 0}
            </Text>
            <Text style={styles.statText}>
              Level: {user.stats?.level || 1}
            </Text>
          </View>
        </View>
        <View style={styles.scoreContainer}>
          <Text style={[styles.scoreText, isCurrentUser && styles.currentUserText]}>
            {user.stats?.total_score || 0}
          </Text>
          <Text style={styles.scoreLabel}>Score</Text>
        </View>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={AMBER} />
      </View>
    );
  }

  if (!currentUser) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="trophy" size={48} color={DARK_GREY} />
          <Text style={styles.title}>Leaderboard</Text>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Please log in to view the leaderboard</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[AMBER]} />
      }
    >
      <View style={styles.headerContainer}>
        <View style={styles.spacer} />
        <View style={styles.header}>
          <MaterialCommunityIcons name="trophy" size={48} color={DARK_GREY} />
          <Text style={styles.title}>Leaderboard</Text>
        </View>
        <TouchableOpacity
          style={styles.notificationButton}
          onPress={() => {
            setOpenAddFriendOnRequests(true);
            setShowAddFriendModal(true);
          }}
        >
          <MaterialCommunityIcons name="bell-outline" size={24} color={DARK_GREY} />
          {pendingRequestsCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {pendingRequestsCount > 9 ? '9+' : pendingRequestsCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
          onPress={() => setActiveTab('friends')}
        >
          <Text style={[styles.tabText, activeTab === 'friends' && styles.activeTabText]}>
            Friends
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'leagues' && styles.activeTab]}
          onPress={() => setActiveTab('leagues')}
        >
          <Text style={[styles.tabText, activeTab === 'leagues' && styles.activeTabText]}>
            Leagues
          </Text>
        </TouchableOpacity>
      </View>

      {/* Friends Tab */}
      {activeTab === 'friends' && (
        <View style={styles.tabContent}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Friends Leaderboard</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddFriendModal(true)}
            >
              <MaterialCommunityIcons name="account-plus" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {friendsLeaderboard.length === 0 ? (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="account-group-outline" size={64} color={MEDIUM_GREY} />
              <Text style={styles.emptyText}>No friends yet</Text>
              <Text style={styles.emptySubtext}>Add friends to compete with them!</Text>
            </View>
          ) : (
            <View style={styles.leaderboardContainer}>
              {renderCurrentUserCard(friendsLeaderboard.find(user => user.id === currentUser?.id))}
              {friendsLeaderboard.map((user, index) => renderLeaderboardRow(user, index))}
            </View>
          )}
        </View>
      )}

      {/* Leagues Tab */}
      {activeTab === 'leagues' && (
        <View style={styles.tabContent}>
          <View style={styles.sectionHeader}>
            <View style={styles.leagueTitleContainer}>
              <View style={styles.leagueNameRow}>
                <Text style={styles.sectionTitle}>
                  {selectedLeague ? selectedLeague.name : 'No League Selected'}
                </Text>
                {selectedLeague?.code && (
                  <Text style={styles.leagueCodeText}>{selectedLeague.code}</Text>
                )}
              </View>
              {leagues.length > 1 && (
                <TouchableOpacity
                  style={styles.switchLeagueButton}
                  onPress={() => setShowLeagueSelector(!showLeagueSelector)}
                >
                  <MaterialCommunityIcons name="swap-horizontal" size={20} color={DARK_GREY} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.leagueActions}>
              {selectedLeague && (
                <TouchableOpacity
                  style={[
                    styles.leaveLeagueButton,
                    (leavingLeague || loading) && styles.leaveLeagueButtonDisabled,
                  ]}
                  onPress={handleLeaveLeague}
                  disabled={leavingLeague || loading}
                >
                  <Text style={styles.leaveLeagueButtonText}>-</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowLeagueActionsModal(true)}
              >
                <MaterialCommunityIcons name="plus" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* League Selector */}
          {showLeagueSelector && leagues.length > 0 && (
            <View style={styles.leagueSelector}>
              {leagues.map((league) => (
                <TouchableOpacity
                  key={league.id}
                  style={[
                    styles.leagueOption,
                    selectedLeague?.id === league.id && styles.selectedLeagueOption,
                  ]}
                  onPress={() => handleLeagueSelect(league)}
                >
                  <View style={styles.leagueOptionContent}>
                    <Text
                      style={[
                        styles.leagueOptionText,
                        selectedLeague?.id === league.id && styles.selectedLeagueOptionText,
                      ]}
                    >
                      {league.name}
                    </Text>
                    {league.code && (
                      <Text style={styles.leagueOptionCode}>{league.code}</Text>
                    )}
                  </View>
                  {selectedLeague?.id === league.id && (
                    <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!selectedLeague ? (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="trophy-outline" size={64} color={MEDIUM_GREY} />
              <Text style={styles.emptyText}>No leagues yet</Text>
              <Text style={styles.emptySubtext}>Create a league to compete with friends!</Text>
            </View>
          ) : leagueLeaderboard.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No members in this league</Text>
            </View>
          ) : (
            <View style={styles.leaderboardContainer}>
              {renderCurrentUserCard(leagueLeaderboard.find(user => user.id === currentUser?.id))}
              {leagueLeaderboard.map((user, index) => renderLeaderboardRow(user, index))}
            </View>
          )}
        </View>
      )}

      {/* Modals */}
      <AddFriendModal
        visible={showAddFriendModal}
        onClose={() => {
          setShowAddFriendModal(false);
          setOpenAddFriendOnRequests(false);
        }}
        currentUserId={currentUser?.id}
        onFriendAdded={loadData}
        initialTab={openAddFriendOnRequests ? 'requests' : 'search'}
      />
      <CreateLeagueModal
        visible={showCreateLeagueModal}
        onClose={() => setShowCreateLeagueModal(false)}
        currentUserId={currentUser?.id}
        onLeagueCreated={loadData}
      />
      <JoinLeagueModal
        visible={showJoinLeagueModal}
        onClose={() => setShowJoinLeagueModal(false)}
        currentUserId={currentUser?.id}
        onJoined={loadData}
      />
      <LeagueActionsModal
        visible={showLeagueActionsModal}
        onClose={() => setShowLeagueActionsModal(false)}
        onSelectCreate={() => {
          setShowLeagueActionsModal(false);
          setTimeout(() => setShowCreateLeagueModal(true), 150);
        }}
        onSelectJoin={() => {
          setShowLeagueActionsModal(false);
          setTimeout(() => setShowJoinLeagueModal(true), 150);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    padding: 20,
    paddingTop: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  spacer: {
    width: 40,
  },
  header: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginTop: 12,
  },
  notificationButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: LIGHT_GREY,
    marginTop: 8,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#F44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
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
  tabContent: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  leagueTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  leagueNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  leagueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  leagueCodeText: {
    fontSize: 16,
    color: MEDIUM_GREY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  leaveLeagueButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: MEDIUM_GREY,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  leaveLeagueButtonText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#D32F2F',
    lineHeight: 24,
  },
  leaveLeagueButtonDisabled: {
    opacity: 0.6,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  switchLeagueButton: {
    marginLeft: 12,
    padding: 4,
  },
  addButton: {
    backgroundColor: AMBER,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  leagueSelector: {
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 8,
    marginBottom: 16,
  },
  leagueOptionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leagueOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  selectedLeagueOption: {
    backgroundColor: '#FFFFFF',
  },
  leagueOptionText: {
    fontSize: 16,
    color: DARK_GREY,
  },
  leagueOptionCode: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  selectedLeagueOptionText: {
    fontWeight: '600',
  },
  leaderboardContainer: {
    marginTop: 8,
  },
  currentUserCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: AMBER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  currentUserLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: AMBER,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  currentUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  separator: {
    height: 2,
    backgroundColor: LIGHT_GREY,
    marginVertical: 16,
    borderRadius: 1,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  rankContainer: {
    width: 40,
    alignItems: 'center',
    marginRight: 12,
  },
  rankText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    color: DARK_GREY,
    marginBottom: 4,
  },
  adminLabel: {
    fontSize: 14,
    color: MEDIUM_GREY,
    letterSpacing: 0.5,
  },
  currentUserText: {
    color: AMBER,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statText: {
    fontSize: 14,
    color: MEDIUM_GREY,
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  scoreText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  scoreLabel: {
    fontSize: 12,
    color: MEDIUM_GREY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
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

