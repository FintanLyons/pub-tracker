import { supabase } from '../config/supabase';

/**
 * Send a friend request
 */
export const sendFriendRequest = async (userId, friendId) => {
  // Check if friendship already exists (either direction)
  const { data: existing, error: checkErr } = await supabase
    .from('friendships')
    .select('id')
    .or(
      `and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`
    )
    .limit(1);

  if (checkErr) throw checkErr;
  if (existing && existing.length > 0) throw new Error('Friendship already exists');

  const { data, error } = await supabase
    .from('friendships')
    .insert({
      user_id: userId,
      friend_id: friendId,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select();

  if (error) throw error;
  return data;
};

/**
 * Accept a friend request
 */
export const acceptFriendRequest = async (friendshipId) => {
  const { data, error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId)
    .select();

  if (error) throw error;
  return data;
};

/**
 * Reject a friend request
 */
export const rejectFriendRequest = async (friendshipId) => {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);

  if (error) throw error;
  return true;
};

/**
 * Remove a friend
 */
export const removeFriend = async (userId, friendId) => {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(
      `and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`
    );

  if (error) throw error;
  return true;
};

/**
 * Get all friends for a user (accepted friendships only)
 */
const LEADERBOARD_USER_COLUMNS = 'id, username, avatar_url';
const LEADERBOARD_STATS_COLUMNS = 'user_id, pubs_visited, total_score, level, total_drinks';

export const getFriends = async (userId) => {
  const { data: friendships, error } = await supabase
    .from('friendships')
    .select('*')
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .eq('status', 'accepted');

  if (error) throw error;
  if (!friendships || friendships.length === 0) return [];

  const friendIds = friendships.map(f =>
    f.user_id === userId ? f.friend_id : f.user_id
  );

  const [{ data: users }, { data: stats }] = await Promise.all([
    supabase.from('users').select(LEADERBOARD_USER_COLUMNS).in('id', friendIds),
    supabase.from('user_stats').select(LEADERBOARD_STATS_COLUMNS).in('user_id', friendIds),
  ]);

  const statsMap = {};
  (stats || []).forEach(s => { statsMap[s.user_id] = s; });

  return (users || []).map(u => ({
    ...u,
    stats: statsMap[u.id] || { pubs_visited: 0, total_score: 0, level: 1, total_drinks: 0 },
  }));
};

/**
 * Get pending friend requests for a user (received requests)
 */
export const getPendingFriendRequests = async (userId) => {
  const { data: requests, error } = await supabase
    .from('friendships')
    .select('*')
    .eq('friend_id', userId)
    .eq('status', 'pending');

  if (error) throw error;
  if (!requests || requests.length === 0) return [];

  const requesterIds = requests.map(r => r.user_id);

  const { data: users } = await supabase
    .from('users')
    .select('*')
    .in('id', requesterIds);

  const usersMap = {};
  (users || []).forEach(u => { usersMap[u.id] = u; });

  return requests.map(r => ({
    ...r,
    requester: usersMap[r.user_id] || null,
  }));
};

/**
 * Get leaderboard of friends (sorted by score)
 */
export const getFriendsLeaderboard = async (userId) => {
  const [friends, { data: meArr }, { data: meStatsArr }] = await Promise.all([
    getFriends(userId),
    supabase.from('users').select(LEADERBOARD_USER_COLUMNS).eq('id', userId).limit(1),
    supabase.from('user_stats').select(LEADERBOARD_STATS_COLUMNS).eq('user_id', userId).limit(1),
  ]);

  const currentUser = {
    ...(meArr?.[0] || {}),
    stats: meStatsArr?.[0] || { pubs_visited: 0, total_score: 0, level: 1, total_drinks: 0 },
  };

  const allUsers = [currentUser, ...friends];
  allUsers.sort((a, b) => (b.stats?.total_score || 0) - (a.stats?.total_score || 0));

  return allUsers.map((user, index) => ({ ...user, rank: index + 1 }));
};
