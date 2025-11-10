import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseUrl, getSupabaseHeaders } from '../config/supabase';
import { fetchLondonPubs } from './PubService';
import { getLevelProgress } from '../utils/levelSystem';

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
 * Get current authenticated user from local storage
 */
export const getCurrentUser = async () => {
  try {
    const userJson = await AsyncStorage.getItem('currentUser');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};

/**
 * Save current user to local storage
 */
const saveCurrentUser = async (user) => {
  try {
    await AsyncStorage.setItem('currentUser', JSON.stringify(user));
  } catch (error) {
    console.error('Error saving current user:', error);
    throw error;
  }
};

/**
 * Register a new user
 */
export const registerUser = async (email, username, password) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = getSupabaseHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Check if username is already taken
    const checkResponse = await fetch(
      `${supabaseUrl}/users?username=eq.${username}&select=username`,
      { headers }
    );

    if (!checkResponse.ok) {
      throw new Error('Failed to check username availability');
    }

    const existingUsers = await checkResponse.json();
    if (existingUsers.length > 0) {
      throw new Error('Username already taken');
    }

    // Create user in Supabase
    const userData = {
      email,
      username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const response = await fetch(`${supabaseUrl}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create user: ${errorText}`);
    }

    const newUser = await response.json();
    const user = Array.isArray(newUser) ? newUser[0] : newUser;

    // Initialize user stats
    await syncUserStats(user.id);

    // Save to local storage
    await saveCurrentUser(user);

    return user;
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

/**
 * Login user
 */
export const loginUser = async (username, password) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = getSupabaseHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Find user by username
    const response = await fetch(
      `${supabaseUrl}/users?username=eq.${username}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const users = await response.json();
    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];

    // Save to local storage
    await saveCurrentUser(user);

    // Sync stats
    await syncUserStats(user.id);

    return user;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

/**
 * Logout user
 */
export const logoutUser = async () => {
  try {
    await AsyncStorage.removeItem('currentUser');
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

/**
 * Calculate user stats from local pub data
 */
const calculateUserStats = async () => {
  const allPubs = await fetchLondonPubs();
  const visitedPubs = allPubs.filter(p => p.isVisited);
  const pointsFromPubs = visitedPubs.reduce((sum, pub) => sum + (pub.points || 0), 0);

  // Calculate area completion bonuses
  const areaMap = {};
  allPubs.forEach(pub => {
    const area = pub.area || 'Unknown';
    if (!areaMap[area]) {
      areaMap[area] = { total: 0, visited: 0 };
    }
    areaMap[area].total++;
    if (pub.isVisited) {
      areaMap[area].visited++;
    }
  });

  const completedAreas = Object.entries(areaMap)
    .filter(([_, counts]) => counts.visited === counts.total && counts.total > 0);
  
  const areaBonusPoints = completedAreas.length * 50;
  const totalScore = pointsFromPubs + areaBonusPoints;
  const levelProgress = getLevelProgress(totalScore);

  return {
    pubs_visited: visitedPubs.length,
    total_score: totalScore,
    level: levelProgress.level,
  };
};

/**
 * Sync user stats to Supabase
 */
export const syncUserStats = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    console.log('=== SYNCING USER STATS ===');
    console.log('User ID:', userId);

    const supabaseUrl = getSupabaseUrl();
    
    // Get user's access token for authenticated requests
    const sessionJson = await AsyncStorage.getItem('supabase_session');
    const session = sessionJson ? JSON.parse(sessionJson) : null;
    const accessToken = session?.access_token;
    
    console.log('Has access token:', !!accessToken);
    
    const headers = getSupabaseHeaders(accessToken);

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    console.log('Calculating stats...');
    const stats = await calculateUserStats();
    console.log('Stats calculated:', stats);

    // Check if stats exist
    console.log('Checking if stats exist for user:', userId);
    const checkResponse = await fetch(
      `${supabaseUrl}/user_stats?user_id=eq.${userId}`,
      { headers }
    );

    console.log('Check response status:', checkResponse.status);

    if (!checkResponse.ok) {
      const errorText = await checkResponse.text();
      console.log('❌ Check failed:', errorText);
      throw new Error(`Failed to check user stats: ${checkResponse.status} - ${errorText}`);
    }

    const existingStats = await checkResponse.json();
    console.log('Existing stats:', existingStats);

    const statsData = {
      user_id: userId,
      ...stats,
      last_synced_at: new Date().toISOString(),
    };

    let response;
    if (existingStats.length > 0) {
      // Update existing stats
      console.log('Updating existing stats...');
      response = await fetch(
        `${supabaseUrl}/user_stats?user_id=eq.${userId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify(statsData),
        }
      );
    } else {
      // Create new stats
      console.log('Creating new stats...');
      response = await fetch(`${supabaseUrl}/user_stats`, {
        method: 'POST',
        headers,
        body: JSON.stringify(statsData),
      });
    }

    console.log('Sync response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('❌ Sync failed:', errorText);
      throw new Error(`Failed to sync user stats: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Stats synced successfully:', result);
    return result;
  } catch (error) {
    console.error('Error syncing user stats:', error);
    throw error;
  }
};

/**
 * Get user stats by user ID
 */
export const getUserStats = async (userId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const response = await fetch(
      `${supabaseUrl}/user_stats?user_id=eq.${userId}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch user stats');
    }

    const stats = await response.json();
    return stats.length > 0 ? stats[0] : null;
  } catch (error) {
    console.error('Error getting user stats:', error);
    throw error;
  }
};

/**
 * Search users by username
 */
export const searchUsers = async (query) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Search for users whose username contains the query (case-insensitive)
    const response = await fetch(
      `${supabaseUrl}/users?username=ilike.*${query}*&select=id,username,created_at`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Failed to search users');
    }

    return await response.json();
  } catch (error) {
    console.error('Error searching users:', error);
    throw error;
  }
};

/**
 * Get user by ID
 */
export const getUserById = async (userId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const response = await fetch(
      `${supabaseUrl}/users?id=eq.${userId}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch user');
    }

    const users = await response.json();
    return users.length > 0 ? users[0] : null;
  } catch (error) {
    console.error('Error getting user:', error);
    throw error;
  }
};

