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
    .select('id, user_id, rating, body, created_at, users(username, avatar_url)')
    .eq('pub_id', pubId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map(r => ({
    id: r.id,
    userId: r.user_id,
    username: r.users?.username ?? 'Anonymous',
    avatarUrl: r.users?.avatar_url ?? null,
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
  clearPubRatingSummariesCache();
};

export const deleteReview = async (userId, pubId) => {
  const { error } = await supabase
    .from('pub_reviews')
    .delete()
    .eq('user_id', userId)
    .eq('pub_id', pubId);

  if (error) throw error;
  clearPubRatingSummariesCache();
};

const RATING_SUMMARY_PAGE_SIZE = 1000;

let _ratingSummariesCache = null;
let _ratingSummariesPromise = null;

export const clearPubRatingSummariesCache = () => {
  _ratingSummariesCache = null;
  _ratingSummariesPromise = null;
};

/** pub_id → { avgRating, reviewCount } for map filtering (cached per session) */
export const getPubRatingSummariesCached = async () => {
  if (_ratingSummariesCache) return _ratingSummariesCache;
  if (!_ratingSummariesPromise) {
    _ratingSummariesPromise = getPubRatingSummaries()
      .then((summaries) => {
        _ratingSummariesCache = summaries;
        return summaries;
      })
      .catch((err) => {
        _ratingSummariesPromise = null;
        console.warn('Failed to load pub rating summaries:', err?.message || err);
        return {};
      });
  }
  return _ratingSummariesPromise;
};

/** Relation missing (view not created yet): Postgres 42P01 / PostgREST PGRST205. */
const isMissingRelation = (error) => error?.code === '42P01' || error?.code === 'PGRST205';

/** One row per reviewed pub from the pub_rating_summaries view (paged). Null if the view is missing. */
const fetchRatingSummariesFromView = async () => {
  const summaries = {};
  for (let from = 0; ; from += RATING_SUMMARY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('pub_rating_summaries')
      .select('pub_id, avg_rating, review_count')
      .order('pub_id', { ascending: true })
      .range(from, from + RATING_SUMMARY_PAGE_SIZE - 1);
    if (error) {
      if (isMissingRelation(error)) return null;
      throw error;
    }
    for (const row of data || []) {
      if (!row.pub_id) continue;
      summaries[row.pub_id] = {
        avgRating: Number(row.avg_rating),
        reviewCount: Number(row.review_count) || 0,
      };
    }
    if (!data || data.length < RATING_SUMMARY_PAGE_SIZE) return summaries;
  }
};

/** Fallback: aggregate every review row on the device (before the view existed). */
const aggregateRatingsFromReviews = async () => {
  const byPub = {};
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('pub_reviews')
      .select('pub_id, rating')
      .range(from, from + RATING_SUMMARY_PAGE_SIZE - 1);

    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      const pubId = row.pub_id;
      if (!pubId) continue;
      if (!byPub[pubId]) byPub[pubId] = { sum: 0, count: 0 };
      byPub[pubId].sum += Number(row.rating) || 0;
      byPub[pubId].count += 1;
    }

    if (data.length < RATING_SUMMARY_PAGE_SIZE) break;
    from += data.length;
  }

  const summaries = {};
  for (const [pubId, { sum, count }] of Object.entries(byPub)) {
    summaries[pubId] = { avgRating: sum / count, reviewCount: count };
  }
  return summaries;
};

/** pub_id → { avgRating, reviewCount } for map filtering */
const getPubRatingSummaries = async () =>
  (await fetchRatingSummariesFromView()) ?? aggregateRatingsFromReviews();

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
    .from('Pubs_List')
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
