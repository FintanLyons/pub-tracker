import { supabase } from '../config/supabase';
import { presignAndPutImage } from './r2Upload';
import { parseUkPostcode } from '../utils/ukPostcode';

/**
 * Report photos: Cloudflare R2 via Supabase Edge Function `presign-r2-upload`.
 * Keys: `reports/{userId}/{uuid}.{ext}` in a single bucket (prefix layout).
 * Public URLs are stored in `reports.photo_urls` (max 5; maps to Pubs_List.photo_url1..5 on apply).
 */

const MAX_REPORT_PHOTOS = 5;

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

const buildPubAddress = (housenumber, street, postcode) => {
  const parts = [housenumber, street, postcode].map(emptyToNull).filter(Boolean);
  return parts.length ? parts.join('\n') : null;
};

async function uploadReportPhotoUris(imageUris) {
  const capped = (imageUris || []).slice(0, MAX_REPORT_PHOTOS);
  if (!capped.length) return [];
  const out = [];
  for (let i = 0; i < capped.length; i++) {
    const publicUrl = await presignAndPutImage(capped[i], { purpose: 'report' });
    out.push(publicUrl);
  }
  return out;
}

/**
 * @param {object} params
 * @param {'missing_pub'|'pub_correction'} params.reportType
 * @param {string|null|undefined} params.pubId
 * @param {string} params.pubName
 * @param {string} [params.pubArea] Legacy district label for corrections (e.g. SW1)
 * @param {string} [params.chainOrIndependent]
 * @param {string} [params.housenumber] Maps to addr_housenumber
 * @param {string} [params.street] Maps to addr_street
 * @param {string} [params.postcode] Full UK postcode; parsed to postcode_district / postcode_area
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
  housenumber,
  street,
  postcode,
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

  const addr_housenumber = emptyToNull(housenumber);
  const addr_street = emptyToNull(street);
  const postcodeRaw = emptyToNull(postcode);
  const parsed = postcodeRaw ? parseUkPostcode(postcodeRaw) : {
    postcode: null,
    postcodeDistrict: null,
    postcodeArea: null,
  };

  if (reportType === 'missing_pub') {
    if (!addr_housenumber) {
      throw new Error('House number is required.');
    }
    if (!addr_street) {
      throw new Error('Street is required.');
    }
    if (!postcodeRaw) {
      throw new Error('Postcode is required.');
    }
    if (!parsed.postcode) {
      throw new Error('Enter a valid UK postcode (e.g. SW1A 1AA).');
    }
  } else if (postcodeRaw && !parsed.postcode) {
    throw new Error('Enter a valid UK postcode (e.g. SW1A 1AA), or leave it blank.');
  }

  const reporter_username = await fetchReporterUsername(session.user.id);

  const photo_urls =
    imageUris.length > 0 ? await uploadReportPhotoUris(imageUris) : null;

  const pub_address = buildPubAddress(addr_housenumber, addr_street, parsed.postcode || postcodeRaw);
  const areaFallback =
    parsed.postcodeDistrict || emptyToNull(pubArea) || addr_street || 'Unknown Area';

  const row = {
    pub_id: pubId ?? null,
    pub_name: emptyToNull(pubName) || 'Unknown Pub',
    pub_area: areaFallback,
    report_text: reportType === 'missing_pub' ? 'Pub Missing' : 'Pub correction',
    report_type: reportType,
    reporter_id: session.user.id,
    reporter_username,
    chain_or_independent: emptyToNull(chainOrIndependent),
    addr_housenumber,
    addr_street,
    postcode: parsed.postcode,
    postcode_district: parsed.postcodeDistrict,
    postcode_area: parsed.postcodeArea,
    pub_address,
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
