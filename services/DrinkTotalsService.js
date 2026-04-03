import { supabase } from '../config/supabase';

/**
 * Sum of pub_drinks.count per user. Requires `get_user_drink_totals` RPC on Supabase
 * (see scripts/get_user_drink_totals_rpc.sql). Returns zeros if the RPC is missing.
 */
export async function getDrinkTotalsByUserIds(userIds) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (unique.length === 0) return {};

  const { data, error } = await supabase.rpc('get_user_drink_totals', {
    p_user_ids: unique,
  });

  const map = {};
  unique.forEach((id) => {
    map[id] = 0;
  });

  if (error) {
    console.warn('get_user_drink_totals RPC:', error.message);
    return map;
  }

  (data || []).forEach((row) => {
    map[row.user_id] = Number(row.total_drinks) || 0;
  });

  return map;
}
