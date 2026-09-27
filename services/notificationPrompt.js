import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Fallback "Turn on notifications?" explainer, for anyone who skipped the system prompt
 * shown right after the location prompt (App.js askForNotifications): offered after a
 * social action or once the user has friends / leagues / requests (LeaderboardScreen).
 * At most once per device, and only while the OS can still ask; the OS prompt follows
 * only if the user taps "Turn on".
 */

const PROMPT_SHOWN_KEY = 'push:promptShown:v1';

let socialActionPending = false;

/** Call after a friend request is sent/accepted or a league is created/joined. */
export function noteSocialAction() {
  socialActionPending = true;
}

/** True once per social action (resets the flag). */
export function consumeSocialAction() {
  const pending = socialActionPending;
  socialActionPending = false;
  return pending;
}

/** Whether the "Turn on notifications?" explainer should be offered now. */
export async function shouldOfferNotificationPrompt() {
  if (Platform.OS === 'web') return false;
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted' || canAskAgain === false) return false;
    return (await AsyncStorage.getItem(PROMPT_SHOWN_KEY)) !== 'true';
  } catch {
    return false;
  }
}

export function markNotificationPromptShown() {
  AsyncStorage.setItem(PROMPT_SHOWN_KEY, 'true').catch(() => {});
}
