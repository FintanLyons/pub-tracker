import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseUrl, getSupabaseHeaders } from '../config/supabase';

/**
 * Helper to get authenticated headers
 */
const getAuthHeaders = async () => {
  const sessionJson = await AsyncStorage.getItem('supabase_session');
  const session = sessionJson ? JSON.parse(sessionJson) : null;
  const accessToken = session?.access_token;
  return getSupabaseHeaders(accessToken);
};

/**
 * Send a friend request
 */
export const sendFriendRequest = async (userId, friendId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Check if friendship already exists
    const checkResponse = await fetch(
      `${supabaseUrl}/friendships?or=(and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId}))`,
      { headers }
    );

    if (!checkResponse.ok) {
      throw new Error('Failed to check existing friendship');
    }

    const existingFriendships = await checkResponse.json();
    if (existingFriendships.length > 0) {
      throw new Error('Friendship already exists');
    }

    // Create friendship request
    const friendshipData = {
      user_id: userId,
      friend_id: friendId,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const response = await fetch(`${supabaseUrl}/friendships`, {
      method: 'POST',
      headers,
      body: JSON.stringify(friendshipData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send friend request: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending friend request:', error);
    throw error;
  }
};

/**
 * Accept a friend request
 */
export const acceptFriendRequest = async (friendshipId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const response = await fetch(
      `${supabaseUrl}/friendships?id=eq.${friendshipId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'accepted' }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to accept friend request: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error accepting friend request:', error);
    throw error;
  }
};

/**
 * Reject a friend request
 */
export const rejectFriendRequest = async (friendshipId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const response = await fetch(
      `${supabaseUrl}/friendships?id=eq.${friendshipId}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to reject friend request: ${errorText}`);
    }

    return true;
  } catch (error) {
    console.error('Error rejecting friend request:', error);
    throw error;
  }
};

/**
 * Remove a friend
 */
export const removeFriend = async (userId, friendId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Delete friendship in both directions
    const response = await fetch(
      `${supabaseUrl}/friendships?or=(and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId}))`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to remove friend: ${errorText}`);
    }

    return true;
  } catch (error) {
    console.error('Error removing friend:', error);
    throw error;
  }
};

/**
 * Get all friends for a user (accepted friendships only)
 */
export const getFriends = async (userId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Get friendships where user is either sender or receiver
    const response = await fetch(
      `${supabaseUrl}/friendships?or=(user_id.eq.${userId},friend_id.eq.${userId})&status=eq.accepted&select=*`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch friends');
    }

    const friendships = await response.json();

    // Extract friend IDs
    const friendIds = friendships.map(f => 
      f.user_id === userId ? f.friend_id : f.user_id
    );

    if (friendIds.length === 0) {
      return [];
    }

    // Fetch user details and stats for all friends
    const friendsPromises = friendIds.map(async (friendId) => {
      const userResponse = await fetch(
        `${supabaseUrl}/users?id=eq.${friendId}`,
        { headers }
      );
      const statsResponse = await fetch(
        `${supabaseUrl}/user_stats?user_id=eq.${friendId}`,
        { headers }
      );

      const users = await userResponse.json();
      const stats = await statsResponse.json();

      return {
        ...users[0],
        stats: stats.length > 0 ? stats[0] : { pubs_visited: 0, total_score: 0, level: 1 },
      };
    });

    return await Promise.all(friendsPromises);
  } catch (error) {
    console.error('Error getting friends:', error);
    throw error;
  }
};

/**
 * Get pending friend requests for a user (received requests)
 */
export const getPendingFriendRequests = async (userId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Get pending requests where user is the recipient
    const response = await fetch(
      `${supabaseUrl}/friendships?friend_id=eq.${userId}&status=eq.pending&select=*`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch pending requests');
    }

    const requests = await response.json();

    // Fetch user details for each requester
    const requestsWithUsers = await Promise.all(
      requests.map(async (request) => {
        const userResponse = await fetch(
          `${supabaseUrl}/users?id=eq.${request.user_id}`,
          { headers }
        );
        const users = await userResponse.json();
        return {
          ...request,
          requester: users[0],
        };
      })
    );

    return requestsWithUsers;
  } catch (error) {
    console.error('Error getting pending requests:', error);
    throw error;
  }
};

/**
 * Get leaderboard of friends (sorted by score)
 */
export const getFriendsLeaderboard = async (userId) => {
  try {
    const friends = await getFriends(userId);
    
    // Get current user stats
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const userResponse = await fetch(
      `${supabaseUrl}/users?id=eq.${userId}`,
      { headers }
    );
    const statsResponse = await fetch(
      `${supabaseUrl}/user_stats?user_id=eq.${userId}`,
      { headers }
    );

    const users = await userResponse.json();
    const stats = await statsResponse.json();

    const currentUser = {
      ...users[0],
      stats: stats.length > 0 ? stats[0] : { pubs_visited: 0, total_score: 0, level: 1 },
    };

    // Combine current user with friends
    const allUsers = [currentUser, ...friends];

    // Sort by total score (descending)
    allUsers.sort((a, b) => (b.stats?.total_score || 0) - (a.stats?.total_score || 0));

    // Add rank
    return allUsers.map((user, index) => ({
      ...user,
      rank: index + 1,
    }));
  } catch (error) {
    console.error('Error getting friends leaderboard:', error);
    throw error;
  }
};

