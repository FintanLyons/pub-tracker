import { supabase } from '../config/supabase';
import { presignAndPutImage } from './r2Upload';

/**
 * Report photos: Cloudflare R2 via Supabase Edge Function `presign-r2-upload`.
 * Keys: `reports/{userId}/{uuid}.{ext}` in a single bucket (prefix layout).
 * Public URLs are stored in `reports.photo_urls`.
 */

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

async function uploadReportPhotoUris(imageUris) {
  if (!imageUris?.length) return [];
  const out = [];
  for (let i = 0; i < imageUris.length; i++) {
    const publicUrl = await presignAndPutImage(imageUris[i], { purpose: 'report' });
    out.push(publicUrl);
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
 * @param {boolean|null|undefined} [params.stillOperating] pub_correction only: still trading vs permanently closed
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
  stillOperating,
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('You must be signed in to submit a report.');
  }

  const reporter_username = await fetchReporterUsername(session.user.id);

  const photo_urls =
    imageUris.length > 0 ? await uploadReportPhotoUris(imageUris) : null;

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
    still_operating:
      reportType === 'pub_correction' && typeof stillOperating === 'boolean'
        ? stillOperating
        : null,
  };

  const { data, error } = await supabase.from('reports').insert(row).select();
  if (error) throw error;
  return { success: true, report: data };
}
