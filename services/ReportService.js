import { supabase } from '../config/supabase';

/**
 * Report photos: Supabase Storage bucket `report-photos`, object path
 * `{reporter_auth_user_id}/{timestamp}-{n}-{random}.{ext}`.
 * Public URLs are stored in `reports.photo_urls` (see scripts/reports_enriched_migration.sql).
 */
const REPORT_PHOTOS_BUCKET = 'report-photos';

async function fetchReporterUsername(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('username')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  const u = data?.username;
  return typeof u === 'string' && u.trim() ? u.trim() : null;
}

const emptyToNull = (v) => {
  const s = v != null ? String(v).trim() : '';
  return s.length ? s : null;
};

async function uploadReportPhotoUris(imageUris, userId) {
  if (!imageUris?.length) return [];
  const out = [];
  for (let i = 0; i < imageUris.length; i++) {
    const uri = imageUris[i];
    const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|%|$)/);
    const extRaw = match ? match[1].toLowerCase() : 'jpg';
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
    const path = `${userId}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error('Could not read a photo file.');
    }
    const buf = await res.arrayBuffer();
    const contentType =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const { error } = await supabase.storage.from(REPORT_PHOTOS_BUCKET).upload(path, buf, {
      contentType,
      upsert: false,
    });
    if (error) {
      const msg = error.message || '';
      if (/bucket|not found/i.test(msg)) {
        throw new Error(
          'Photo upload is not set up yet. Remove photos and try again, or try later.'
        );
      }
      throw new Error(`Photo upload failed: ${msg}`);
    }
    const { data: pub } = supabase.storage.from(REPORT_PHOTOS_BUCKET).getPublicUrl(path);
    out.push(pub.publicUrl);
  }
  return out;
}

/**
 * @param {object} params
 * @param {'missing_pub'|'pub_correction'} params.reportType
 * @param {string|null|undefined} params.pubId
 * @param {string} params.pubName
 * @param {string} params.pubArea Legacy summary area (e.g. district); also used when address absent
 * @param {string} [params.chainOrIndependent]
 * @param {string} [params.address]
 * @param {string} [params.website]
 * @param {string} [params.phone]
 * @param {string} [params.closingTime]
 * @param {string} [params.founded]
 * @param {string} [params.history] Pub history / long narrative (card history; falls back from description in UI)
 * @param {Record<string, boolean>|null} [params.features]
 * @param {string[]} [params.imageUris] Local file URIs from image picker
 */
export async function submitPubReport({
  reportType,
  pubId,
  pubName,
  pubArea,
  chainOrIndependent,
  address,
  website,
  phone,
  closingTime,
  founded,
  history,
  features,
  imageUris = [],
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('You must be signed in to submit a report.');
  }

  const reporter_username = await fetchReporterUsername(session.user.id);

  const photo_urls =
    imageUris.length > 0 ? await uploadReportPhotoUris(imageUris, session.user.id) : null;

  const areaFallback = emptyToNull(address) || 'Unknown Area';

  const row = {
    pub_id: pubId ?? null,
    pub_name: emptyToNull(pubName) || 'Unknown Pub',
    pub_area: emptyToNull(pubArea) || areaFallback,
    report_text: reportType === 'missing_pub' ? 'Pub Missing' : 'Pub correction',
    report_type: reportType,
    reporter_id: session.user.id,
    reporter_username,
    chain_or_independent: emptyToNull(chainOrIndependent),
    pub_address: emptyToNull(address),
    website: emptyToNull(website),
    phone: emptyToNull(phone),
    closing_time: emptyToNull(closingTime),
    founded: emptyToNull(founded),
    history: emptyToNull(history),
    features_snapshot: features && Object.keys(features).length ? features : null,
    photo_urls: photo_urls?.length ? photo_urls : null,
  };

  const { data, error } = await supabase.from('reports').insert(row).select();
  if (error) throw error;
  return { success: true, report: data };
}
