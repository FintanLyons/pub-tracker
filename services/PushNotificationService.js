import { PermissionsAndroid, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { EAS_PROJECT_ID } from '../constants/easProject';
import { supabase } from '../config/supabase';

let handlerInstalled = false;

/** Call once at app startup so foreground pushes can present before signup/location flow. */
export function installNotificationPresentationHandler() {
  if (handlerInstalled || Platform.OS === 'web') return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

function ensureHandler() {
  installNotificationPresentationHandler();
}

/**
 * Registers for Expo push, requests OS permissions, upserts token for user_id.
 * No-op on web or missing EAS projectId. Simulators: token fetch may fail (caught below).
 * Avoids expo-device so native module is not required at import time (fixes Web / stale builds).
 */
/**
 * Dev builds sometimes omit projectId from Constants on first load (Expo #23225, #20276).
 * See: https://docs.expo.dev/push-notifications/push-notifications-setup/
 */
function resolveExpoProjectId() {
  const c = Constants;
  const fromConstants =
    c.expoConfig?.extra?.eas?.projectId ??
    c.easConfig?.projectId ??
    c.manifest2?.extra?.eas?.projectId ??
    c.manifest2?.extra?.expoClient?.extra?.eas?.projectId ??
    c.manifest?.extra?.eas?.projectId ??
    c.manifest?.expoClient?.extra?.eas?.projectId;
  if (fromConstants && String(fromConstants).trim()) {
    return String(fromConstants).trim();
  }
  return EAS_PROJECT_ID;
}

function logPushDiag(stage, detail) {
  const line =
    typeof detail === 'string'
      ? detail
      : detail != null
        ? JSON.stringify(detail, Object.getOwnPropertyNames(detail))
        : '';
  console.warn(`[Push] ${stage}${line ? `: ${line}` : ''}`);
}

export async function registerPushNotificationsForUser(userId) {
  if (!userId || Platform.OS === 'web') return;
  ensureHandler();

  try {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user?.id) {
      logPushDiag('no auth user from getUser(); cannot write user_push_tokens (RLS)', {
        message: authErr?.message,
      });
      return;
    }
    const authUid = String(authData.user.id).toLowerCase();
    const profileUid = String(userId).toLowerCase();
    if (authUid !== profileUid) {
      logPushDiag('profile id does not match auth user id', {
        profileUserId: userId,
        authUserId: authData.user.id,
      });
      return;
    }
    const rowUserId = authData.user.id;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
      });
      if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
        try {
          const post = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
          if (post !== PermissionsAndroid.RESULTS.GRANTED) {
            logPushDiag('Android 13+ POST_NOTIFICATIONS not granted', { post });
          }
        } catch (e) {
          logPushDiag('POST_NOTIFICATIONS request threw', { message: e?.message });
        }
      }
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      logPushDiag('notifications not granted', { finalStatus });
      return;
    }

    const projectId = resolveExpoProjectId();
    logPushDiag('using projectId', { projectId: projectId.slice(0, 8) + '…' });

    let tokenResponse;
    try {
      tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    } catch (e) {
      logPushDiag('getExpoPushTokenAsync threw', {
        message: e?.message,
        name: e?.name,
      });
      return;
    }
    const expoPushToken = tokenResponse.data;
    if (!expoPushToken) {
      logPushDiag('getExpoPushTokenAsync returned empty data');
      return;
    }

    const platform =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : Platform.OS;

    const { error } = await supabase.from('user_push_tokens').upsert(
      {
        user_id: rowUserId,
        expo_push_token: expoPushToken,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    );

    if (error) {
      logPushDiag('token upsert failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return;
    }
    logPushDiag('token saved', {
      userId: rowUserId,
      platform,
      tokenPrefix: expoPushToken.slice(0, 22),
    });
  } catch (e) {
    logPushDiag('register failed', e);
  }
}

/** Remove all device tokens for this account (call on logout). */
export async function removeAllPushTokensForUser(userId) {
  if (!userId) return;
  try {
    const { error } = await supabase.from('user_push_tokens').delete().eq('user_id', userId);
    if (error) {
      console.warn('Push: delete tokens failed', error.message);
    }
  } catch (e) {
    console.warn('Push: delete tokens failed', e?.message ?? e);
  }
}
