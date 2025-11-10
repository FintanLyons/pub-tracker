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
 * Create a new league
 */
export const createLeague = async (userId, leagueName) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Create league
    const leagueData = {
      name: leagueName,
      created_by: userId,
      created_at: new Date().toISOString(),
    };

    const response = await fetch(`${supabaseUrl}/leagues`, {
      method: 'POST',
      headers,
      body: JSON.stringify(leagueData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create league: ${errorText}`);
    }

    const league = await response.json();
    const leagueId = Array.isArray(league) ? league[0].id : league.id;

    // Add creator as first member
    await addLeagueMember(leagueId, userId);

    return Array.isArray(league) ? league[0] : league;
  } catch (error) {
    console.error('Error creating league:', error);
    throw error;
  }
};

/**
 * Add a member to a league
 */
export const addLeagueMember = async (leagueId, userId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Check if user is already a member
    const checkResponse = await fetch(
      `${supabaseUrl}/league_members?league_id=eq.${leagueId}&user_id=eq.${userId}`,
      { headers }
    );

    if (!checkResponse.ok) {
      throw new Error('Failed to check league membership');
    }

    const existing = await checkResponse.json();
    if (existing.length > 0) {
      throw new Error('User is already a member of this league');
    }

    // Add member
    const memberData = {
      league_id: leagueId,
      user_id: userId,
      joined_at: new Date().toISOString(),
    };

    const response = await fetch(`${supabaseUrl}/league_members`, {
      method: 'POST',
      headers,
      body: JSON.stringify(memberData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add league member: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error adding league member:', error);
    throw error;
  }
};

/**
 * Remove a member from a league
 */
export const removeLeagueMember = async (leagueId, userId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const response = await fetch(
      `${supabaseUrl}/league_members?league_id=eq.${leagueId}&user_id=eq.${userId}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to remove league member: ${errorText}`);
    }

    return true;
  } catch (error) {
    console.error('Error removing league member:', error);
    throw error;
  }
};

/**
 * Delete a league (only by creator)
 */
export const deleteLeague = async (leagueId, userId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Verify user is the creator
    const leagueResponse = await fetch(
      `${supabaseUrl}/leagues?id=eq.${leagueId}`,
      { headers }
    );

    if (!leagueResponse.ok) {
      throw new Error('Failed to fetch league');
    }

    const leagues = await leagueResponse.json();
    if (leagues.length === 0) {
      throw new Error('League not found');
    }

    if (leagues[0].created_by !== userId) {
      throw new Error('Only the league creator can delete the league');
    }

    // Delete all members first
    await fetch(
      `${supabaseUrl}/league_members?league_id=eq.${leagueId}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    // Delete the league
    const response = await fetch(
      `${supabaseUrl}/leagues?id=eq.${leagueId}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete league: ${errorText}`);
    }

    return true;
  } catch (error) {
    console.error('Error deleting league:', error);
    throw error;
  }
};

/**
 * Get all leagues for a user
 */
export const getUserLeagues = async (userId) => {
  try {
    console.log('=== GETTING USER LEAGUES ===');
    console.log('User ID:', userId);
    
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Get league memberships
    console.log('Fetching league memberships...');
    const membershipsResponse = await fetch(
      `${supabaseUrl}/league_members?user_id=eq.${userId}`,
      { headers }
    );

    console.log('Memberships response status:', membershipsResponse.status);

    if (!membershipsResponse.ok) {
      const errorText = await membershipsResponse.text();
      console.log('❌ Failed to fetch memberships:', errorText);
      throw new Error(`Failed to fetch league memberships: ${membershipsResponse.status}`);
    }

    const memberships = await membershipsResponse.json();
    console.log('Found memberships:', memberships.length);

    if (memberships.length === 0) {
      console.log('✅ User has no leagues');
      return [];
    }

    // Get league details
    const leagueIds = memberships.map(m => m.league_id);
    console.log('Fetching details for leagues:', leagueIds);
    
    const leaguePromises = leagueIds.map(async (leagueId) => {
      const response = await fetch(
        `${supabaseUrl}/leagues?id=eq.${leagueId}`,
        { headers }
      );
      const leagues = await response.json();
      return leagues[0];
    });

    const result = await Promise.all(leaguePromises);
    console.log('✅ Fetched leagues:', result);
    return result;
  } catch (error) {
    console.error('Error getting user leagues:', error);
    throw error;
  }
};

/**
 * Get leaderboard for a specific league
 */
export const getLeagueLeaderboard = async (leagueId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Get all members of the league
    const membersResponse = await fetch(
      `${supabaseUrl}/league_members?league_id=eq.${leagueId}`,
      { headers }
    );

    if (!membersResponse.ok) {
      throw new Error('Failed to fetch league members');
    }

    const members = await membersResponse.json();

    if (members.length === 0) {
      return [];
    }

    // Get user details and stats for each member
    const memberPromises = members.map(async (member) => {
      const userResponse = await fetch(
        `${supabaseUrl}/users?id=eq.${member.user_id}`,
        { headers }
      );
      const statsResponse = await fetch(
        `${supabaseUrl}/user_stats?user_id=eq.${member.user_id}`,
        { headers }
      );

      const users = await userResponse.json();
      const stats = await statsResponse.json();

      return {
        ...users[0],
        stats: stats.length > 0 ? stats[0] : { pubs_visited: 0, total_score: 0, level: 1 },
      };
    });

    const leaderboard = await Promise.all(memberPromises);

    // Sort by total score (descending)
    leaderboard.sort((a, b) => (b.stats?.total_score || 0) - (a.stats?.total_score || 0));

    // Add rank
    return leaderboard.map((user, index) => ({
      ...user,
      rank: index + 1,
    }));
  } catch (error) {
    console.error('Error getting league leaderboard:', error);
    throw error;
  }
};

/**
 * Get league details
 */
export const getLeagueById = async (leagueId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const response = await fetch(
      `${supabaseUrl}/leagues?id=eq.${leagueId}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch league');
    }

    const leagues = await response.json();
    return leagues.length > 0 ? leagues[0] : null;
  } catch (error) {
    console.error('Error getting league:', error);
    throw error;
  }
};

/**
 * Get all members of a league
 */
export const getLeagueMembers = async (leagueId) => {
  try {
    const supabaseUrl = getSupabaseUrl();
    const headers = await getAuthHeaders();

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    const membersResponse = await fetch(
      `${supabaseUrl}/league_members?league_id=eq.${leagueId}`,
      { headers }
    );

    if (!membersResponse.ok) {
      throw new Error('Failed to fetch league members');
    }

    const members = await membersResponse.json();

    // Get user details for each member
    const memberPromises = members.map(async (member) => {
      const userResponse = await fetch(
        `${supabaseUrl}/users?id=eq.${member.user_id}`,
        { headers }
      );
      const users = await userResponse.json();
      return users[0];
    });

    return await Promise.all(memberPromises);
  } catch (error) {
    console.error('Error getting league members:', error);
    throw error;
  }
};

