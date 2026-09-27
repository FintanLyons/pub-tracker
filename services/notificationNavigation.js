import { createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const navigationRef = createNavigationContainerRef();

let pendingTarget = null;
/** Notification ids already acted on (the launch response is re-read on every mount). */
const handledIds = new Set();

function readNotificationData(response) {
  const raw =
    response?.notification?.request?.content?.data
    ?? response?.notification?.request?.trigger?.payload;
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function nonEmptyString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Where a tapped notification should take the user, or null.
 * `nonce` makes repeat taps re-trigger screens that clear their params.
 * Kinds come from supabase/functions/_shared/notification-messages.ts.
 */
export function notificationTarget(data, nonce = String(Date.now())) {
  switch (data?.kind) {
    case 'pub_summon': {
      const pubId = nonEmptyString(data.pub_id ?? data.pubId);
      return pubId ? { screen: 'Map', params: { summonPubId: pubId } } : null;
    }
    case 'friend_request':
      return { screen: 'Leaderboard', params: { openFriendRequests: nonce } };
    case 'league_added': {
      const leagueId = nonEmptyString(data.league_id);
      return leagueId
        ? { screen: 'Leaderboard', params: { showLeagueId: leagueId, showLeagueNonce: nonce } }
        : { screen: 'Leaderboard', params: { showLeagues: nonce } };
    }
    case 'monthly_digest':
      return { screen: 'Leaderboard', params: { showFriends: nonce } };
    default:
      return null;
  }
}

function navigateTo(target) {
  if (!target) return;
  if (!navigationRef.isReady()) {
    pendingTarget = target;
    return;
  }
  pendingTarget = null;
  navigationRef.navigate(target.screen, target.params);
}

function handleNotificationResponse(response) {
  const id = response?.notification?.request?.identifier;
  if (id) {
    if (handledIds.has(id)) return false;
    handledIds.add(id);
  }
  const target = notificationTarget(readNotificationData(response), id || undefined);
  if (!target) return false;
  navigateTo(target);
  return true;
}

function flushPendingNavigation() {
  if (!pendingTarget || !navigationRef.isReady()) return;
  const target = pendingTarget;
  pendingTarget = null;
  navigationRef.navigate(target.screen, target.params);
}

/**
 * Wire tap handlers for push notifications (summon → Map + pub card; friend
 * request / league / monthly digest → Leaderboard).
 * Call once when the main tab navigator is mounted.
 */
export function setupPushNotificationNavigation() {
  if (Platform.OS === 'web') {
    return () => {};
  }

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) handleNotificationResponse(response);
    flushPendingNavigation();
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    handleNotificationResponse(response);
    flushPendingNavigation();
  });

  const stateSub = navigationRef.addListener('state', flushPendingNavigation);

  return () => {
    responseSub.remove();
    stateSub();
  };
}
