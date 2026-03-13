import { supabase } from '../config/supabase';
import { fetchLondonPubs } from './PubService';
import { getLevelProgress } from '../utils/levelSystem';

/**
 * Get current authenticated user from Supabase session
 */
export const getCurrentUser = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .limit(1);

    return users && users.length > 0 ? users[0] : null;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};

/**
 * Calculate user stats from pub data
 */
const calculateUserStats = async () => {
  const allPubs = await fetchLondonPubs();
  const visitedPubs = allPubs.filter(p => p.isVisited);
  const pointsFromPubs = visitedPubs.reduce((sum, pub) => sum + (pub.points || 0), 0);

  const areaMap = {};
  const boroughMap = {};
  allPubs.forEach(pub => {
    const area = pub.area || 'Unknown';
    if (!areaMap[area]) areaMap[area] = { total: 0, visited: 0 };
    areaMap[area].total++;
    if (pub.isVisited) areaMap[area].visited++;

    const borough =
      typeof pub.borough === 'string' && pub.borough.trim().length > 0
        ? pub.borough.trim()
        : 'Unknown';
    if (!boroughMap[borough]) boroughMap[borough] = { total: 0, visited: 0, areas: new Set() };
    boroughMap[borough].total++;
    if (pub.isVisited) boroughMap[borough].visited++;
    if (area && area !== 'Unknown') boroughMap[borough].areas.add(area);
  });

  const completedAreas = Object.entries(areaMap)
    .filter(([_, c]) => c.visited === c.total && c.total > 0)
    .map(([area]) => area);
  const areaBonusPoints = completedAreas.length * 50;

  const completedBoroughs = Object.entries(boroughMap)
    .filter(([_, c]) => c.visited === c.total && c.total > 0);
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
  if (!userId) throw new Error('User ID is required');

  const stats = await calculateUserStats();

  const statsData = {
    user_id: userId,
    ...stats,
    last_synced_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('user_stats')
    .select('user_id')
    .eq('user_id', userId)
    .limit(1);

  if (existing && existing.length > 0) {
    const { data, error } = await supabase
      .from('user_stats')
      .update(statsData)
      .eq('user_id', userId)
      .select();

    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from('user_stats')
      .insert(statsData)
      .select();

    if (error) throw error;
    return data;
  }
};

/**
 * Get user stats by user ID
 */
export const getUserStats = async (userId) => {
  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', userId)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
};

/**
 * Search users by username
 */
export const searchUsers = async (query) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, created_at')
    .ilike('username', `%${query}%`);

  if (error) throw error;
  return data || [];
};

/**
 * Get user by ID
 */
export const getUserById = async (userId) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
};

// Legacy exports - kept so existing callers don't break at import time.
// These should be removed once SecureAuthService is the sole auth path.
export const registerUser = async () => { throw new Error('Use SecureAuthService.registerUserSecure instead'); };
export const loginUser = async () => { throw new Error('Use SecureAuthService.loginUserSecure instead'); };
export const logoutUser = async () => { throw new Error('Use SecureAuthService.logoutUserSecure instead'); };
