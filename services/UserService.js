import { supabase } from '../config/supabase';

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 20;

/** Escape LIKE wildcards so `_` / `%` in a username match literally (usernames may contain `_`). */
const escapeLikePattern = (raw) => raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Username search for adding friends: case-insensitive "contains", at most 20 results. */
export const searchUsers = async (query) => {
  const trimmed = (query || '').trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const { data, error } = await supabase
    .from('users')
    .select('id, username, created_at, avatar_url')
    .ilike('username', `%${escapeLikePattern(trimmed)}%`)
    .order('username', { ascending: true })
    .limit(MAX_RESULTS);

  if (error) throw error;
  return data || [];
};
