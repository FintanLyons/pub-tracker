import { supabase } from '../config/supabase';

export const searchUsers = async (query) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, created_at')
    .ilike('username', `%${query}%`);

  if (error) throw error;
  return data || [];
};
