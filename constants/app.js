/** Shown on device home screen, in-app branding, and OS permission rationale (via app.config). */
export const APP_DISPLAY_NAME = 'Pub?';

const ANDROID_PACKAGE_ID =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.fintanlyons.pubtracker';

/** Google Play listing for “get the app” share text (league invites, friend invites). */
export const PLAY_STORE_LISTING_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_ID}`;

/**
 * Message for inviting someone who is not on the app yet / does not have an account.
 * @param {string | null | undefined} username — if set, friend can search this after signing up
 */
export function buildFriendInviteMessage(username) {
  const trimmed = typeof username === 'string' ? username.trim() : '';
  const lines = [
    `Join me on ${APP_DISPLAY_NAME} - An app to track pub visits in London and compete against friends`,
  ];
  if (trimmed) {
    lines.push(`Once you join, search for ${trimmed} on the leaderboard tab`);
  } else {
    lines.push('Once you join, open the leaderboard tab and use add friends to find people.');
  }
  lines.push('');
  lines.push(`Google Play: ${PLAY_STORE_LISTING_URL}`);
  return lines.join('\n');
}
