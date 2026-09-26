import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ask for notification permission at a moment it makes sense — right after the user's
 * first social action (friend request, league) — instead of at first launch next to
 * the location prompt. Asked at most once per device; the OS prompt follows only if
 * the user taps "Turn on".
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
