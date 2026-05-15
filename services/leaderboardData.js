import { getFriendsLeaderboard, getPendingFriendRequests } from './FriendsService';
import { getUserLeagues, getLeagueLeaderboard } from './LeagueService';
import { cacheLeaderboardData, getCachedLeaderboardData } from './LeaderboardCache';

let inFlightPrefetch = null;

/**
 * Fetch friends board, pending requests, leagues, and the preferred (or first) league board.
 */
export async function fetchLeaderboardBundle(userId, preferredLeagueId = null) {
  const [friendsLeaderboard, pendingRequests, userLeagues] = await Promise.all([
    getFriendsLeaderboard(userId),
    getPendingFriendRequests(userId),
    getUserLeagues(userId),
  ]);

  let selectedLeague = null;
  if (userLeagues.length > 0) {
    if (preferredLeagueId && userLeagues.some((l) => l.id === preferredLeagueId)) {
      selectedLeague = userLeagues.find((l) => l.id === preferredLeagueId);
    } else {
      selectedLeague = userLeagues[0];
    }
  }

  const leagueLeaderboard = selectedLeague
    ? await getLeagueLeaderboard(selectedLeague.id)
    : [];

  return {
    friendsLeaderboard,
    pendingRequestsCount: pendingRequests.length,
    leagues: userLeagues,
    selectedLeagueId: selectedLeague?.id ?? null,
    selectedLeague,
    leagueLeaderboard,
  };
}

/** Warm leaderboard cache while the user is on other tabs (deduped). */
export function prefetchLeaderboardCache(userId, preferredLeagueId = null) {
  if (!userId) return Promise.resolve(null);
  if (inFlightPrefetch) return inFlightPrefetch;

  inFlightPrefetch = fetchLeaderboardBundle(userId, preferredLeagueId)
    .then((data) => {
      cacheLeaderboardData(data);
      return data;
    })
    .catch((err) => {
      console.error('Leaderboard prefetch failed:', err);
      return null;
    })
    .finally(() => {
      inFlightPrefetch = null;
    });

  return inFlightPrefetch;
}

export { getCachedLeaderboardData, cacheLeaderboardData };
