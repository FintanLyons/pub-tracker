import { supabase } from '../config/supabase';

/** Must match the Edge Function slug in Supabase (default: presign-r2-upload). */
const PRESIGN_FUNCTION =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SUPABASE_PRESIGN_FUNCTION) ||
  'presign-r2-upload';

/**
 * Presigned R2 upload via Supabase Edge Function (see PRESIGN_FUNCTION / env).
 * One Cloudflare bucket with prefixes: reports/, avatars/, pubs/
 * (see supabase/functions/presign-r2-upload/index.ts).
 *
 * @param {string} localUri Local file URI from image picker
 * @param {object} options
 * @param {'report'|'avatar'|'pub_gallery'} options.purpose
 * @param {string} [options.pubId] For pub_gallery
 * @param {number} [options.slot] 0–5 for pub_gallery
 * @returns {Promise<string>} Public https URL after successful PUT
 */
export async function presignAndPutImage(localUri, { purpose, pubId, slot }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You must be signed in to upload images.');
  }

  const match = localUri.match(/\.([a-zA-Z0-9]+)(?:\?|%|$)/);
  const extRaw = match ? match[1].toLowerCase() : 'jpg';
  const fileExt = extRaw === 'jpeg' ? 'jpg' : extRaw;
  const contentType =
    fileExt === 'png' ? 'image/png' : fileExt === 'webp' ? 'image/webp' : 'image/jpeg';

  const body = { purpose, contentType, fileExt };
  if (purpose === 'pub_gallery') {
    body.pubId = pubId;
    body.slot = slot;
  }

  const { data, error, response } = await supabase.functions.invoke(PRESIGN_FUNCTION, {
    body,
  });

  if (error) {
    let detail = '';
    const status = response?.status;
    if (response) {
      try {
        const ct = (response.headers?.get?.('Content-Type') || '').split(';')[0].trim();
        if (ct === 'application/json') {
          const j = await response.clone().json();
          if (j && typeof j.error === 'string' && j.error) {
            detail = `: ${j.error}`;
          }
        } else {
          const t = await response.clone().text();
          if (t) detail = `: ${t.slice(0, 200)}`;
        }
      } catch (_) {
        /* ignore parse errors */
      }
    }
    const statusBit = status ? ` [HTTP ${status}]` : '';
    const hint = `${error.message || String(error)}${detail}${statusBit}`;
    throw new Error(
      hint.includes('Failed to send') || hint.includes('fetch')
        ? `Upload service unavailable. Check network and that Edge Function "${PRESIGN_FUNCTION}" exists (404 = wrong name).`
        : hint
    );
  }

  if (!data?.uploadUrl || !data?.publicUrl) {
    throw new Error(data?.error || 'Could not get upload URL.');
  }

  const res = await fetch(localUri);
  if (!res.ok) {
    throw new Error('Could not read photo file.');
  }
  const buf = await res.arrayBuffer();

  const put = await fetch(data.uploadUrl, {
    method: 'PUT',
    body: buf,
    headers: { 'Content-Type': contentType },
  });

  if (!put.ok) {
    const t = await put.text().catch(() => '');
    throw new Error(
      `Upload to storage failed (${put.status}). ${t.slice(0, 120)}`.trim()
    );
  }

  return data.publicUrl;
}
