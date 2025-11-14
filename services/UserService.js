import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseUrl, getSupabaseHeaders } from '../config/supabase';
import { fetchLondonPubs } from './PubService';
import { getLevelProgress } from '../utils/levelSystem';

/**
 * Helper to refresh session - breaks circular dependency with SecureAuthService
 * This is a lightweight version that only does what UserService needs
 */
const refreshSession = async () => {
  try {
    const sessionJson = await AsyncStorage.getItem('supabase_session');
    if (!sessionJson) {
      throw new Error('No session');
    }
    const session = JSON.parse(sessionJson);
    
    if (!session?.refresh_token) {
      throw new Error('No refresh token');
    }

    const { SUPABASE_CONFIG } = require('../config/supabase');
    const SUPABASE_URL = SUPABASE_CONFIG.url;
    const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey;

    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: session.refresh_token,
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to refresh session');
    }

    const newSession = await response.json();
    
    // Get user
    const userJson = await AsyncStorage.getItem('currentUser');
    const user = userJson ? JSON.parse(userJson) : null;
    
    // Save new session
    await AsyncStorage.setItem('supabase_session', JSON.stringify(newSession));
    if (user) {
      await AsyncStorage.setItem('currentUser', JSON.stringify(user));
    }

    return newSession;
  } catch (error) {
    console.error('Refresh session error:', error);
    // If refresh fails, clear session
    await AsyncStorage.multiRemove(['supabase_session', 'currentUser']);
    throw error;
  }
};

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
 * Helper to make authenticated API calls with automatic token refresh
 * Retries once if token is expired
 */
const makeAuthenticatedRequest = async (url, options = {}) => {
  const headers = await getAuthHeaders();
  if (!headers) {
    throw new Error('Supabase not configured');
  }

  let response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  // If we get a 401 (JWT expired), try refreshing the token and retry once
  if (response.status === 401) {
    console.log('Token expired, attempting to refresh...');
    try {
      await refreshSession();
      // Get fresh headers with new token
      const newHeaders = await getAuthHeaders();
      if (newHeaders) {
        // Retry the request with the new token
        response = await fetch(url, {
          ...options,
          headers: {
            ...newHeaders,
            ...options.headers,
          },
        });
        // If retry also fails with 401, the refresh token is likely expired
        if (response.status === 401) {
          throw new Error('Session expired. Please log in again.');
        }
      } else {
        throw new Error('Failed to get authentication headers after refresh');
      }
    } catch (refreshError) {
      console.error('Failed to refresh token:', refreshError);
      // If it's already our custom error, re-throw it
      if (refreshError.message && refreshError.message.includes('Session expired')) {
        throw refreshError;
      }
      throw new Error('Session expired. Please log in again.');
    }
  }

  return response;
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

  // Calculate area & borough completion bonuses
  const areaMap = {};
  const boroughMap = {};
  allPubs.forEach(pub => {
    const area = pub.area || 'Unknown';
    if (!areaMap[area]) {
      areaMap[area] = { total: 0, visited: 0 };
    }
    areaMap[area].total++;
    if (pub.isVisited) {
      areaMap[area].visited++;
    }

    const borough =
      typeof pub.borough === 'string' && pub.borough.trim().length > 0
        ? pub.borough.trim()
        : 'Unknown';
    if (!boroughMap[borough]) {
      boroughMap[borough] = {
        total: 0,
        visited: 0,
        areas: new Set(),
      };
    }
    boroughMap[borough].total++;
    if (pub.isVisited) {
      boroughMap[borough].visited++;
    }
    if (area && area !== 'Unknown') {
      boroughMap[borough].areas.add(area);
    }
  });

  const completedAreaEntries = Object.entries(areaMap)
    .filter(([_, counts]) => counts.visited === counts.total && counts.total > 0);
  const completedAreas = completedAreaEntries.map(([area]) => area);
  
  const areaBonusPoints = completedAreas.length * 50;

  const completedBoroughs = Object.entries(boroughMap)
    .filter(([_, counts]) => counts.visited === counts.total && counts.total > 0);
  const boroughBonusPoints = completedBoroughs.length * 200;

  const totalScore = pointsFromPubs + areaBonusPoints + boroughBonusPoints;
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

    if (!supabaseUrl) {
      throw new Error('Supabase not configured');
    }

    console.log('Calculating stats...');
    const stats = await calculateUserStats();
    console.log('Stats calculated:', stats);

    // Check if stats exist (with automatic token refresh)
    console.log('Checking if stats exist for user:', userId);
    const checkResponse = await makeAuthenticatedRequest(
      `${supabaseUrl}/user_stats?user_id=eq.${userId}`
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
      // Update existing stats (with automatic token refresh)
      console.log('Updating existing stats...');
      response = await makeAuthenticatedRequest(
        `${supabaseUrl}/user_stats?user_id=eq.${userId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(statsData),
        }
      );
    } else {
      // Create new stats (with automatic token refresh)
      console.log('Creating new stats...');
      response = await makeAuthenticatedRequest(
        `${supabaseUrl}/user_stats`,
        {
          method: 'POST',
          body: JSON.stringify(statsData),
        }
      );
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

    if (!supabaseUrl) {
      throw new Error('Supabase not configured');
    }

    const response = await makeAuthenticatedRequest(
      `${supabaseUrl}/user_stats?user_id=eq.${userId}`
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

    if (!supabaseUrl) {
      throw new Error('Supabase not configured');
    }

    // Search for users whose username contains the query (case-insensitive)
    const response = await makeAuthenticatedRequest(
      `${supabaseUrl}/users?username=ilike.*${query}*&select=id,username,created_at`
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

    if (!supabaseUrl) {
      throw new Error('Supabase not configured');
    }

    const response = await makeAuthenticatedRequest(
      `${supabaseUrl}/users?id=eq.${userId}`
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

