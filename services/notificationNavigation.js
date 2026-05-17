import { createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const navigationRef = createNavigationContainerRef();

let pendingSummonPubId = null;

function readNotificationData(response) {
  const raw =
    response?.notification?.request?.content?.data
    ?? response?.notification?.request?.trigger?.payload;
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function extractSummonPubId(data) {
  if (data?.kind !== 'pub_summon') return null;
  const pubId = data.pub_id ?? data.pubId;
  if (pubId == null || String(pubId).trim() === '') return null;
  return String(pubId).trim();
}

function navigateToSummonPub(pubId) {
  if (!pubId) return;
  if (!navigationRef.isReady()) {
    pendingSummonPubId = pubId;
    return;
  }
  pendingSummonPubId = null;
  navigationRef.navigate('Map', { summonPubId: pubId });
}

function handleNotificationResponse(response) {
  const pubId = extractSummonPubId(readNotificationData(response));
  if (!pubId) return false;
  navigateToSummonPub(pubId);
  return true;
}

function flushPendingSummonNavigation() {
  if (!pendingSummonPubId || !navigationRef.isReady()) return;
  const pubId = pendingSummonPubId;
  pendingSummonPubId = null;
  navigationRef.navigate('Map', { summonPubId: pubId });
}

/**
 * Wire tap handlers for push notifications (summon → Map + pub card).
 * Call once when the main tab navigator is mounted.
 */
export function setupPushNotificationNavigation() {
  if (Platform.OS === 'web') {
    return () => {};
  }

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) handleNotificationResponse(response);
    flushPendingSummonNavigation();
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    handleNotificationResponse(response);
    flushPendingSummonNavigation();
  });

  const stateSub = navigationRef.addListener('state', flushPendingSummonNavigation);

  return () => {
    responseSub.remove();
    stateSub();
  };
}
