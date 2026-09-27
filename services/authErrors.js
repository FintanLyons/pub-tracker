import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export const CONNECTION_ERROR_MESSAGE =
  "Couldn't reach the server. Check your connection and try again.";

/** Auth API error codes meaning the stored session can never work again. */
const INVALID_SESSION_CODES = new Set([
  'bad_jwt',
  'session_expired',
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_not_found',
  'user_banned',
]);

/** No response from the server (offline, DNS, timeout) — the session may still be valid. */
export function isNetworkError(error) {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  const msg = String(error.message ?? error);
  return /network request failed|failed to fetch|network error|fetch failed|timed out/i.test(msg);
}

/**
 * The server rejected the session (revoked, expired refresh token, deleted user).
 * Only these errors justify signing the user out locally.
 */
export function isInvalidSessionError(error) {
  if (!isAuthApiError(error)) return false;
  if (error.status === 401 || error.status === 403) return true;
  return INVALID_SESSION_CODES.has(error.code);
}
