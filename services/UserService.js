import { supabase } from '../config/supabase';

/** Strip ILIKE wildcards so user input cannot broaden the match. */
const sanitizeUsernameSearch = (raw) => raw.replace(/[%_\\]/g, '').trim();

export const searchUsers = async (query) => {
  const safe = sanitizeUsernameSearch(query || '');
  if (!safe) return [];

  const { data, error } = await supabase
    .from('users')
    .select('id, username, created_at, avatar_url')
    .ilike('username', `%${safe}%`);

  if (error) throw error;
  return data || [];
};
