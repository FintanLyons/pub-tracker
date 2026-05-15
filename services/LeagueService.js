import * as Crypto from 'expo-crypto';
import { supabase } from '../config/supabase';

/** 32 chars: 256 % 32 === 0 so uniform index = byte % 32 */
const LEAGUE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LEAGUE_CODE_LENGTH = 6;
const MAX_CODE_GENERATION_ATTEMPTS = 10;

const generateLeagueCode = async () => {
  const bytes = await Crypto.getRandomBytesAsync(LEAGUE_CODE_LENGTH);
  const base = LEAGUE_CODE_ALPHABET.length;
  let code = '';
  for (let i = 0; i < LEAGUE_CODE_LENGTH; i += 1) {
    code += LEAGUE_CODE_ALPHABET[bytes[i] % base];
  }
  return code;
};

const generateUniqueLeagueCode = async () => {
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const code = await generateLeagueCode();
    const { data } = await supabase
      .from('leagues')
      .select('id')
      .eq('code', code)
      .limit(1);

    if (!data || data.length === 0) return code;
  }
  throw new Error('Unable to generate unique league code');
};

/**
 * Create a new league
 */
export const createLeague = async (userId, leagueName) => {
  const code = await generateUniqueLeagueCode();

  const { data, error } = await supabase
    .from('leagues')
    .insert({
      name: leagueName,
      created_by: userId,
      created_at: new Date().toISOString(),
      code,
    })
    .select()
    .single();

  if (error) throw error;

  await addLeagueMember(data.id, userId);
  return data;
};

/**
 * Add a member to a league
 */
export const addLeagueMember = async (leagueId, userId) => {
  const { data: existing } = await supabase
    .from('league_members')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error('User is already a member of this league');
  }

  const { data, error } = await supabase
    .from('league_members')
    .insert({
      league_id: leagueId,
      user_id: userId,
      joined_at: new Date().toISOString(),
    })
    .select();

  if (error) throw error;
  return data;
};

/**
 * Join a league using its code
 */
export const joinLeagueByCode = async (userId, code) => {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) throw new Error('League code is required');

  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('code', normalizedCode)
    .limit(1);

  if (error) throw error;
  if (!leagues || leagues.length === 0) throw new Error('League not found');

  const league = leagues[0];

  try {
    await addLeagueMember(league.id, userId);
    return { league, alreadyMember: false };
  } catch (err) {
    if (err.message.includes('already a member')) {
      return { league, alreadyMember: true };
    }
    throw err;
  }
};

/**
 * Remove a member from a league
 */
export const removeLeagueMember = async (leagueId, userId) => {
  const { error } = await supabase
    .from('league_members')
    .delete()
    .eq('league_id', leagueId)
    .eq('user_id', userId);

  if (error) throw error;
  return true;
};

/**
 * Get all leagues for a user
 */
export const getUserLeagues = async (userId) => {
  const { data: memberships, error } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', userId);

  if (error) throw error;
  if (!memberships || memberships.length === 0) return [];

  const leagueIds = memberships.map(m => m.league_id);

  const { data: leagues, error: leagueErr } = await supabase
    .from('leagues')
    .select('*')
    .in('id', leagueIds);

  if (leagueErr) throw leagueErr;
  return leagues || [];
};

/**
 * Get leaderboard for a specific league
 */
export const getLeagueLeaderboard = async (leagueId) => {
  const { data: members, error } = await supabase
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId);

  if (error) throw error;
  if (!members || members.length === 0) return [];

  const memberIds = members.map(m => m.user_id);

  const [{ data: users }, { data: stats }] = await Promise.all([
    supabase.from('users').select('id, username, avatar_url').in('id', memberIds),
    supabase
      .from('user_stats')
      .select('user_id, pubs_visited, total_score, level, total_drinks')
      .in('user_id', memberIds),
  ]);

  const statsMap = {};
  (stats || []).forEach(s => { statsMap[s.user_id] = s; });

  const leaderboard = (users || []).map(u => ({
    ...u,
    stats: statsMap[u.id] || { pubs_visited: 0, total_score: 0, level: 1, total_drinks: 0 },
  }));

  leaderboard.sort((a, b) => (b.stats?.total_score || 0) - (a.stats?.total_score || 0));

  return leaderboard.map((user, index) => ({ ...user, rank: index + 1 }));
};
