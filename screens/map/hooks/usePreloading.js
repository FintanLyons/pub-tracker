import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { fetchLondonPubs, fetchBoroughSummaries } from '../../../services/PubService';
import { getCurrentUserSecure } from '../../../services/SecureAuthService';
import { syncUserStats } from '../../../services/UserService';
import { getFriendsLeaderboard, getPendingFriendRequests } from '../../../services/FriendsService';
import { getUserLeagues, getLeagueLeaderboard } from '../../../services/LeagueService';
import { cacheLeaderboardData } from '../../../services/LeaderboardCache';
import { primeProfileStatsFromPubs } from '../../../services/ProfileStatsCache';
import { serializeBoroughSummaries } from '../utils';

export function usePreloading(setBoroughSummaries, setIsLoadingBoroughs) {
  useEffect(() => {
    let isCancelled = false;

    const loadBoroughSummaries = async () => {
      try {
        setIsLoadingBoroughs(true);
        const summaries = await fetchBoroughSummaries();
        if (!isCancelled) {
          setBoroughSummaries((prev) => {
            const nextArray = Array.isArray(summaries) ? summaries : [];
            if (serializeBoroughSummaries(prev) === serializeBoroughSummaries(nextArray)) return prev;
            return nextArray;
          });
        }
      } catch (error) {
        console.error('Error loading borough summaries:', error);
        if (!isCancelled) setBoroughSummaries([]);
      } finally {
        if (!isCancelled) setIsLoadingBoroughs(false);
      }
    };

    const loadAllPubsInBackground = async () => {
      try {
        InteractionManager.runAfterInteractions(async () => {
          if (isCancelled) return;
          const allPubsData = await fetchLondonPubs();
          if (!isCancelled && Array.isArray(allPubsData) && allPubsData.length > 0) {
            primeProfileStatsFromPubs(allPubsData);
          }
        });
      } catch (error) {
        console.error('Error loading all pubs in background:', error);
      }
    };

    const preloadLeaderboardData = async () => {
      try {
        InteractionManager.runAfterInteractions(async () => {
          if (isCancelled) return;
          try {
            const user = await getCurrentUserSecure();
            if (!user?.id) return;

            await syncUserStats(user.id);
            const [friends, pendingRequests, leagues] = await Promise.all([
              getFriendsLeaderboard(user.id),
              getPendingFriendRequests(user.id),
              getUserLeagues(user.id),
            ]);

            let leagueLeaderboard = [];
            if (leagues?.length > 0) {
              try { leagueLeaderboard = await getLeagueLeaderboard(leagues[0].id); } catch {}
            }

            cacheLeaderboardData({
              friendsLeaderboard: friends || [],
              pendingRequestsCount: pendingRequests?.length || 0,
              leagues: leagues || [],
              leagueLeaderboard: leagueLeaderboard || [],
              selectedLeagueId: leagues?.length > 0 ? leagues[0].id : null,
            });
          } catch (error) {
            console.warn('Error preloading leaderboard data:', error);
          }
        });
      } catch (error) {
        console.warn('Error setting up leaderboard preload:', error);
      }
    };

    loadBoroughSummaries();
    loadAllPubsInBackground();
    preloadLeaderboardData();

    return () => { isCancelled = true; };
  }, []);
}
