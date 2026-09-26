/** In-memory leaderboard bundle for the signed-in user only (cleared on sign-out). */
let cached = null;

/** Cached bundle for `userId`, or null if nothing is cached for that user. */
export const getCachedLeaderboardData = (userId) =>
  cached && userId && cached.userId === userId ? cached.data : null;

export const cacheLeaderboardData = (userId, data) => {
  cached = userId && data ? { userId, data } : null;
};

export const clearLeaderboardCache = () => {
  cached = null;
};
