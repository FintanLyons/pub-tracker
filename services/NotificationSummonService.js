import { supabase } from '../config/supabase';

/**
 * Queue push notifications summoning accepted friends to a pub.
 * @returns {Promise<number>} rows enqueued
 */
export async function summonFriendsToPub({ pubId, friendIds, pubAreaLabel }) {
  if (!pubId) throw new Error('Pub is required');
  if (!Array.isArray(friendIds) || friendIds.length === 0) {
    throw new Error('Select at least one friend');
  }

  const { data, error } = await supabase.rpc('enqueue_pub_summon_notifications', {
    p_pub_id: pubId,
    p_friend_ids: friendIds,
    p_pub_area_label: pubAreaLabel || null,
  });

  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
