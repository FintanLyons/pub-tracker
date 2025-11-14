// Cache for leaderboard data to avoid loading delays
let cachedLeaderboardData = null;

export const getCachedLeaderboardData = () => cachedLeaderboardData;

export const cacheLeaderboardData = (data) => {
  cachedLeaderboardData = data ? {
    ...data,
    timestamp: Date.now(),
  } : null;
};

export const clearLeaderboardCache = () => {
  cachedLeaderboardData = null;
};

