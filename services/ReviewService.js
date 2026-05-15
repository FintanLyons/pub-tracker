import { supabase } from '../config/supabase';

// ---------------------------------------------------------------------------
// Drinks counter
// ---------------------------------------------------------------------------

export const getDrinkCount = async (userId, pubId) => {
  const { data, error } = await supabase
    .from('pub_drinks')
    .select('count')
    .eq('user_id', userId)
    .eq('pub_id', pubId)
    .maybeSingle();

  if (error) throw error;
  return data?.count ?? 0;
};

export const upsertDrinkCount = async (userId, pubId, count) => {
  const { error } = await supabase
    .from('pub_drinks')
    .upsert(
      { user_id: userId, pub_id: pubId, count, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,pub_id' }
    );

  if (error) throw error;
};

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const getReviews = async (pubId) => {
  const { data, error } = await supabase
    .from('pub_reviews')
    .select('id, user_id, rating, body, created_at, users(username)')
    .eq('pub_id', pubId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map(r => ({
    id: r.id,
    userId: r.user_id,
    username: r.users?.username ?? 'Anonymous',
    rating: r.rating,
    body: r.body || null,
    createdAt: r.created_at,
  }));
};

export const getUserReview = async (userId, pubId) => {
  const { data, error } = await supabase
    .from('pub_reviews')
    .select('id, rating, body, created_at')
    .eq('user_id', userId)
    .eq('pub_id', pubId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

export const upsertReview = async (userId, pubId, rating, body) => {
  const { error } = await supabase
    .from('pub_reviews')
    .upsert(
      {
        user_id: userId,
        pub_id: pubId,
        rating,
        body: body?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,pub_id' }
    );

  if (error) throw error;
};

export const deleteReview = async (userId, pubId) => {
  const { error } = await supabase
    .from('pub_reviews')
    .delete()
    .eq('user_id', userId)
    .eq('pub_id', pubId);

  if (error) throw error;
};

// ---------------------------------------------------------------------------
// Drink stats (for Profile screen)
// ---------------------------------------------------------------------------

export const getDrinkStats = async (userId) => {
  const { data: drinks, error: drinksError } = await supabase
    .from('pub_drinks')
    .select('pub_id, count')
    .eq('user_id', userId)
    .gt('count', 0);

  if (drinksError) throw drinksError;
  if (!drinks?.length) return { total: 0, byDistrict: {}, byPostcodeArea: {} };

  const pubIds = drinks.map((d) => d.pub_id);

  const { data: pubs, error: pubsError } = await supabase
    .from('pub_list')
    .select('id, postcode_district, postcode_area')
    .in('id', pubIds);

  if (pubsError) throw pubsError;

  const spatialMap = {};
  for (const s of pubs || []) {
    spatialMap[s.id] = s;
  }

  let total = 0;
  const byDistrict = {};
  const byPostcodeArea = {};

  for (const d of drinks) {
    total += d.count;
    const s = spatialMap[d.pub_id];
    if (s) {
      const district = s.postcode_district || 'Unknown';
      byDistrict[district] = (byDistrict[district] || 0) + d.count;
      const area = s.postcode_area || 'Unknown';
      byPostcodeArea[area] = (byPostcodeArea[area] || 0) + d.count;
    }
  }

  return { total, byDistrict, byPostcodeArea };
};
