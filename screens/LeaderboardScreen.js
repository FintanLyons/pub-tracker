import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getCurrentUserSecure } from '../services/SecureAuthService';
import { getFriendsLeaderboard, getPendingFriendRequests } from '../services/FriendsService';
import { getUserLeagues, getLeagueLeaderboard, removeLeagueMember } from '../services/LeagueService';
import { getCachedLeaderboardData } from '../services/LeaderboardCache';
import AddFriendModal from '../components/AddFriendModal';
import CreateLeagueModal from '../components/CreateLeagueModal';
import JoinLeagueModal from '../components/JoinLeagueModal';
import LeagueActionsModal from '../components/LeagueActionsModal';
import ShareLeagueModal from '../components/ShareLeagueModal';
import { COLORS } from '../constants/theme';

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
  const [showShareLeagueModal, setShowShareLeagueModal] = useState(false);
  const [showLeaveLeagueModal, setShowLeaveLeagueModal] = useState(false);
  const selectedLeagueIdRef = useRef(null);

  useEffect(() => {
    selectedLeagueIdRef.current = selectedLeague?.id ?? null;
  }, [selectedLeague?.id]);

  const loadData = useCallback(async () => {
    try {
      const user = await getCurrentUserSecure();
      if (!user) {
        Alert.alert('Not Logged In', 'Please log in to view the leaderboard');
        return;
      }

      setCurrentUser(user);

      // Try to use cached leaderboard data first (loaded at app startup)
      const cachedData = getCachedLeaderboardData();
      if (cachedData) {
        // Use cached data for instant display
        setFriendsLeaderboard(cachedData.friendsLeaderboard || []);
        setPendingRequestsCount(cachedData.pendingRequestsCount || 0);
        setLeagues(cachedData.leagues || []);
        
        if (cachedData.selectedLeagueId && cachedData.leagues) {
          const cachedLeague = cachedData.leagues.find(l => l.id === cachedData.selectedLeagueId);
          if (cachedLeague) {
            setSelectedLeague(cachedLeague);
            setLeagueLeaderboard(cachedData.leagueLeaderboard || []);
          }
        } else {
          setSelectedLeague(null);
          setLeagueLeaderboard([]);
        }
        
        setLoading(false);
        setRefreshing(false);
      }

      // Refresh data in background (non-blocking)
      try {
        const [friends, pendingRequests, userLeagues] = await Promise.all([
          getFriendsLeaderboard(user.id),
          getPendingFriendRequests(user.id),
          getUserLeagues(user.id),
        ]);

        setFriendsLeaderboard(friends);
        setPendingRequestsCount(pendingRequests.length);
        setLeagues(userLeagues);

        const preferId = selectedLeagueIdRef.current;
        let nextLeague = null;
        if (userLeagues.length > 0) {
          if (preferId && userLeagues.some((l) => l.id === preferId)) {
            nextLeague = userLeagues.find((l) => l.id === preferId);
          } else {
            nextLeague = userLeagues[0];
          }
          setSelectedLeague(nextLeague);
          const leagueBoard = await getLeagueLeaderboard(nextLeague.id);
          setLeagueLeaderboard(leagueBoard);
        } else {
          setSelectedLeague(null);
          setLeagueLeaderboard([]);
        }
      } catch (refreshError) {
        console.error('Error refreshing leaderboard data:', refreshError);
        // Don't show alert if we have cached data - just log the error
        const hasCachedData = !!getCachedLeaderboardData();
        if (!hasCachedData) {
          Alert.alert('Error', 'Failed to load leaderboard data');
        }
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

  const confirmLeaveLeague = async () => {
    if (!selectedLeague || !currentUser || leavingLeague) {
      return;
    }

    const leagueName = selectedLeague.name;
    const leagueId = selectedLeague.id;

    try {
      setLeavingLeague(true);
      setLoading(true);
      await removeLeagueMember(leagueId, currentUser.id);
      setShowLeaveLeagueModal(false);
      await loadData();
      Alert.alert('League Left', `You have left ${leagueName}.`);
    } catch (error) {
      console.error('Error leaving league:', error);
      Alert.alert('Error', 'Failed to leave league. Please try again.');
    } finally {
      setLeavingLeague(false);
      setLoading(false);
    }
  };

  const renderLeaderboardRow = (user) => {
    const isCurrentUser = user.id === currentUser?.id;
    const r = user.rank ?? 0;
    const rankColor =
      r === 1 ? '#FFD700' : r === 2 ? '#C0C0C0' : r === 3 ? '#CD7F32' : COLORS.accentGrey;
    const showAdminLabel = activeTab === 'leagues' && selectedLeague?.created_by === user.id;

    return (
      <View
        key={user.id}
        style={[styles.leaderboardRow, isCurrentUser && styles.leaderboardRowSelf]}
      >
        <View style={styles.rankContainer}>
          <Text style={[styles.rankText, { color: rankColor }]}>
            {user.rank}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.username}>
            {user.username}
            {showAdminLabel && (
              <Text style={styles.adminLabel}> - Admin</Text>
            )}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Pubs</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {user.stats?.pubs_visited || 0}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Drinks</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {user.stats?.total_drinks ?? 0}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>Level</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {user.stats?.level || 1}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>
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
        <ActivityIndicator size="large" color={COLORS.amber} />
      </View>
    );
  }

  if (!currentUser) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainerLoggedOut}>
          <View style={styles.headerContainer}>
            <View style={styles.headerSideSlot} />
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>Leaderboard</Text>
            </View>
            <View style={styles.headerSideSlot} />
          </View>
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Please log in to view the leaderboard</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.amber} colors={[COLORS.amber]} />
      }
    >
      <View style={styles.headerContainer}>
        <View style={styles.headerSideSlot} />
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Leaderboard</Text>
        </View>
        <TouchableOpacity
          style={styles.notificationButton}
          onPress={() => {
            setOpenAddFriendOnRequests(true);
            setShowAddFriendModal(true);
          }}
          accessibilityLabel="Friend requests and notifications"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="bell-outline" size={24} color={COLORS.darkGrey} />
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
              <MaterialCommunityIcons name="account-group-outline" size={64} color={COLORS.mediumGrey} />
              <Text style={styles.emptyText}>No friends yet</Text>
              <Text style={styles.emptySubtext}>Add friends to compete with them!</Text>
            </View>
          ) : (
            <View style={styles.leaderboardContainer}>
              {friendsLeaderboard.map((user) => renderLeaderboardRow(user))}
            </View>
          )}
        </View>
      )}

      {/* Leagues Tab */}
      {activeTab === 'leagues' && (
        <View style={styles.tabContent}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>League</Text>
            <View style={styles.leagueHeaderRight}>
              {leagues.length > 1 ? (
                <TouchableOpacity
                  style={styles.leagueListButton}
                  onPress={() => setShowLeagueSelector(!showLeagueSelector)}
                  accessibilityLabel="Choose league"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons name="format-list-bulleted" size={22} color={COLORS.darkGrey} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowLeagueActionsModal(true)}
                accessibilityLabel="Create or join league"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="plus" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

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
                    <MaterialCommunityIcons name="check" size={20} color={COLORS.darkGrey} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.leagueCurrentCard}>
            {selectedLeague ? (
              <View style={styles.leagueCurrentRow}>
                <View style={styles.leagueCurrentMain}>
                  <Text style={styles.leagueCurrentName}>{selectedLeague.name}</Text>
                  {selectedLeague.code ? (
                    <Text style={styles.leagueCurrentCode}>
                      {String(selectedLeague.code).toUpperCase()}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.leagueCurrentActions}>
                  <TouchableOpacity
                    style={styles.leagueInlineIconButton}
                    onPress={() => setShowShareLeagueModal(true)}
                    accessibilityLabel="Share league"
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons name="share-variant" size={22} color={COLORS.darkGrey} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.leagueLeaveIconButton,
                      (leavingLeague || loading) && styles.leagueLeaveIconButtonDisabled,
                    ]}
                    onPress={() => setShowLeaveLeagueModal(true)}
                    disabled={leavingLeague || loading}
                    accessibilityLabel="Leave league"
                    accessibilityRole="button"
                  >
                    <Text style={styles.leagueLeaveMinus}>-</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.leagueEmptyCardInner}>
                <MaterialCommunityIcons name="trophy-outline" size={36} color={COLORS.mediumGrey} />
                <Text style={styles.leagueEmptyTitle}>No league yet</Text>
                <Text style={styles.leagueEmptySubtext}>
                  Tap + to create a league or join with a code.
                </Text>
              </View>
            )}
          </View>

          {selectedLeague ? (
            leagueLeaderboard.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No members in this league</Text>
              </View>
            ) : (
              <View style={styles.leaderboardContainer}>
                {leagueLeaderboard.map((user) => renderLeaderboardRow(user))}
              </View>
            )
          ) : null}
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

      <ShareLeagueModal
        visible={showShareLeagueModal}
        onClose={() => setShowShareLeagueModal(false)}
        leagueName={selectedLeague?.name}
        leagueCode={selectedLeague?.code}
      />

      <Modal
        visible={showLeaveLeagueModal}
        animationType="fade"
        transparent
        onRequestClose={() => {
          if (!leavingLeague) setShowLeaveLeagueModal(false);
        }}
      >
        <View style={styles.floatingModalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              if (!leavingLeague) setShowLeaveLeagueModal(false);
            }}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.floatingCard}>
            <View style={styles.floatingCardHeader}>
              <Text style={styles.floatingCardTitle}>Leave league</Text>
              <TouchableOpacity
                onPress={() => {
                  if (!leavingLeague) setShowLeaveLeagueModal(false);
                }}
                style={styles.floatingCardClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>

            <View style={styles.leaveLeagueIconWrap}>
              {leavingLeague ? (
                <ActivityIndicator size="large" color={COLORS.amber} />
              ) : (
                <View style={styles.leaveLeagueIconCircle}>
                  <MaterialCommunityIcons name="exit-run" size={36} color={COLORS.errorRed} />
                </View>
              )}
            </View>

            <Text style={styles.leaveLeagueBody}>
              {selectedLeague
                ? `You will leave "${selectedLeague.name}" and disappear from its leaderboard until you join again.`
                : ''}
            </Text>

            <View style={styles.leaveLeagueActions}>
              <TouchableOpacity
                style={[
                  styles.leaveLeagueBtn,
                  styles.leaveLeagueBtnHalf,
                  styles.leaveLeagueBtnSecondary,
                ]}
                onPress={() => setShowLeaveLeagueModal(false)}
                disabled={leavingLeague}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Text style={styles.leaveLeagueBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.leaveLeagueBtn,
                  styles.leaveLeagueBtnHalf,
                  styles.leaveLeagueBtnDanger,
                  leavingLeague && styles.leaveLeagueBtnDisabled,
                ]}
                onPress={confirmLeaveLeague}
                disabled={leavingLeague}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Text style={styles.leaveLeagueBtnTextDanger}>
                  {leavingLeague ? 'Leaving…' : 'Leave'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  contentContainerLoggedOut: {
    padding: 20,
    paddingTop: 40,
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerSideSlot: {
    width: 40,
    height: 40,
  },
  headerTitleWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    minHeight: 40,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'center',
    width: '100%',
  },
  notificationButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.lightGrey,
    position: 'relative',
    minWidth: 40,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: COLORS.lightGrey,
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
    color: COLORS.mediumGrey,
  },
  activeTabText: {
    color: COLORS.darkGrey,
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
  leagueHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  leagueListButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.lightGrey,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leagueCurrentCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  leagueCurrentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leagueCurrentMain: {
    flex: 1,
    paddingRight: 12,
  },
  leagueCurrentName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    marginBottom: 6,
  },
  leagueCurrentCode: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.mediumGrey,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
  },
  leagueCurrentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leagueInlineIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  leagueLeaveIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  leagueLeaveIconButtonDisabled: {
    opacity: 0.5,
  },
  leagueLeaveMinus: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.errorRed,
    lineHeight: 28,
  },
  leagueEmptyCardInner: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  leagueEmptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    marginTop: 10,
    marginBottom: 6,
  },
  leagueEmptySubtext: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    lineHeight: 20,
    textAlign: 'center',
  },
  floatingModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  floatingCard: {
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
  floatingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  floatingCardTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'left',
    paddingRight: 8,
  },
  floatingCardClose: {
    padding: 6,
    marginRight: -2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveLeagueIconWrap: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 8,
    minHeight: 88,
    justifyContent: 'center',
  },
  leaveLeagueIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.errorLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveLeagueBody: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 20,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: COLORS.accentGrey,
    textAlign: 'center',
  },
  leaveLeagueActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 22,
    paddingBottom: 22,
    gap: 12,
  },
  leaveLeagueBtn: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveLeagueBtnHalf: {
    flex: 1,
  },
  leaveLeagueBtnSecondary: {
    backgroundColor: COLORS.lightGrey,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  leaveLeagueBtnDanger: {
    backgroundColor: COLORS.errorRed,
  },
  leaveLeagueBtnDisabled: {
    opacity: 0.65,
  },
  leaveLeagueBtnTextSecondary: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'center',
  },
  leaveLeagueBtnTextDanger: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  addButton: {
    backgroundColor: COLORS.amber,
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
    backgroundColor: COLORS.lightGrey,
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
    color: COLORS.darkGrey,
  },
  leagueOptionCode: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  selectedLeagueOptionText: {
    fontWeight: '600',
  },
  leaderboardContainer: {
    marginTop: 8,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  leaderboardRowSelf: {
    borderColor: COLORS.amber,
  },
  rankContainer: {
    width: 32,
    alignItems: 'center',
    marginRight: 8,
  },
  rankText: {
    fontSize: 21,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.darkGrey,
    marginBottom: 4,
  },
  adminLabel: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 2,
  },
  statCell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 2,
    gap: 6,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.mediumGrey,
    flexShrink: 0,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.accentGrey,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.divider,
    alignSelf: 'stretch',
    marginVertical: 1,
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  scoreText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
  },
  scoreLabel: {
    fontSize: 12,
    color: COLORS.mediumGrey,
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

