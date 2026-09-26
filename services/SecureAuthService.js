import { Platform } from 'react-native';
import { supabase } from '../config/supabase';
import { clearVisitedFavoriteCache } from './PubService';
import { CONNECTION_ERROR_MESSAGE, isNetworkError } from './authErrors';

import { isValidUsernameFormat } from '../utils/usernameValidation';

export { isValidUsernameFormat };

/** public.users columns clients may read (column grants hide `email` — see schema baseline §6). */
export const PUBLIC_USER_PROFILE_COLUMNS =
  'id, username, avatar_url, created_at, updated_at';

/** Where the email confirmation link opens (must match Supabase Dashboard → Auth → Redirect URLs). */
const EMAIL_CONFIRM_REDIRECT_TO =
  process.env.EXPO_PUBLIC_EMAIL_CONFIRM_REDIRECT_URL ?? 'https://fintanlyons.com/pub';

/**
 * Ensure a public.users row exists for this auth user (username NULL until chosen).
 * Normally the on_auth_user_created trigger creates it; this is the fallback.
 */
export const ensureUserStub = async (userId, email) => {
  if (!userId) return;

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .limit(1);

  if (existing && existing.length > 0) return;

  const { error: insertError } = await supabase.from('users').insert({
    id: userId,
    email: email || '',
    username: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (insertError && insertError.code !== '23505') {
    console.warn('ensureUserStub insert:', insertError.message);
  }
  // user_stats is seeded by the trg_seed_user_stats DB trigger.
};

/**
 * Email sign-up. Returns { needsEmailVerification } — true when Supabase requires the
 * confirmation link before a session exists. The caller loads the profile (refreshUser).
 */
export const registerUserSecure = async (email, password) => {
  await supabase.auth.signOut({ scope: 'local' });
  clearVisitedFavoriteCache();

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: EMAIL_CONFIRM_REDIRECT_TO,
    },
  });

  if (signUpError) {
    const msg = (signUpError.message || '').toLowerCase();
    if (isNetworkError(signUpError)) throw new Error(CONNECTION_ERROR_MESSAGE);
    if (msg.includes('seconds') || msg.includes('rate limit')) {
      throw new Error('Too many attempts. Please wait a minute and try again.');
    }
    if (msg.includes('already') || msg.includes('exist') || msg.includes('duplicate')) {
      throw new Error('This email is already registered. Please use the login tab instead.');
    }
    if (msg.includes('password')) {
      throw new Error(signUpError.message);
    }
    throw new Error('Registration failed. Please check your email and password and try again.');
  }

  const userData = authData.user;
  if (!userData?.id) throw new Error('Registration failed. Please try again.');

  // With email confirmation on, Supabase answers a sign-up for an existing confirmed
  // email with an obfuscated user that has no identities (no error, no email sent).
  if (!userData.identities || userData.identities.length === 0) {
    throw new Error('This email is already registered. Please use the login tab instead.');
  }

  // No session yet = new (or still unconfirmed) account; Supabase sent the confirmation link.
  // New accounts have no username, so ChooseUsernameScreen runs after first sign-in.
  return { needsEmailVerification: !authData.session };
};

const isValidEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((text || '').trim());

/** Email + password sign-in. The caller loads the profile (refreshUser). */
export const loginUserSecure = async (email, password) => {
  if (!isValidEmail(email)) {
    throw new Error('Please enter a valid email address.');
  }

  await supabase.auth.signOut({ scope: 'local' });
  clearVisitedFavoriteCache();

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (signInError) {
    if (isNetworkError(signInError)) throw new Error(CONNECTION_ERROR_MESSAGE);
    const m = (signInError.message || '').toLowerCase();
    if (m.includes('not confirmed')) {
      throw new Error('Email not confirmed. Please verify your email before logging in.');
    }
    if (m.includes('rate limit') || m.includes('too many')) {
      throw new Error('Too many attempts. Please wait a minute and try again.');
    }
    throw new Error('Invalid email or password.');
  }
};

/** Resend the sign-up confirmation email (for accounts that haven't confirmed yet). */
export const resendConfirmationEmail = async (email) => {
  const trimmed = (email || '').trim();
  if (!isValidEmail(trimmed)) {
    throw new Error('Please enter a valid email address.');
  }
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: trimmed,
    options: { emailRedirectTo: EMAIL_CONFIRM_REDIRECT_TO },
  });
  if (error) {
    if (isNetworkError(error)) throw new Error(CONNECTION_ERROR_MESSAGE);
    const m = (error.message || '').toLowerCase();
    if (m.includes('rate limit') || m.includes('seconds')) {
      // e.g. "you can only request this after 45 seconds"
      const seconds = Number((m.match(/after (\d+) seconds?/) || [])[1]) || 60;
      const err = new Error(`You can request another email in ${seconds} seconds.`);
      err.retryAfterSeconds = seconds;
      throw err;
    }
    throw new Error("Couldn't resend the email. Please try again.");
  }
};

/** Supabase allows one confirmation email per address per minute. */
export const CONFIRMATION_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Send a password-reset email containing a one-time code ({{ .Token }} in the
 * Supabase "Reset Password" email template). Succeeds even for unknown emails.
 */
export const requestPasswordReset = async (email) => {
  const trimmed = (email || '').trim();
  if (!isValidEmail(trimmed)) {
    throw new Error('Please enter a valid email address.');
  }
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
  if (error) {
    if (isNetworkError(error)) throw new Error(CONNECTION_ERROR_MESSAGE);
    const m = (error.message || '').toLowerCase();
    if (m.includes('rate limit') || m.includes('seconds')) {
      throw new Error('Please wait a minute before requesting another code.');
    }
    throw new Error("Couldn't send the reset email. Please try again.");
  }
};

/** Verify the emailed code, then set the new password. Leaves the user signed in. */
export const resetPasswordWithCode = async (email, code, newPassword) => {
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email: (email || '').trim(),
    token: (code || '').trim(),
    type: 'recovery',
  });
  if (verifyError) {
    if (isNetworkError(verifyError)) throw new Error(CONNECTION_ERROR_MESSAGE);
    throw new Error('That code is invalid or has expired. Request a new one.');
  }

  clearVisitedFavoriteCache();

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    if (isNetworkError(updateError)) throw new Error(CONNECTION_ERROR_MESSAGE);
    const m = (updateError.message || '').toLowerCase();
    if (m.includes('different from the old')) {
      throw new Error('Choose a password different from your old one.');
    }
    if (m.includes('password')) throw new Error(updateError.message);
    throw new Error("Couldn't update your password. Please try again.");
  }
};

/**
 * Persist the chosen username (and optional avatar) to public.users.
 *
 * @param {string} userId
 * @param {string} username
 * @param {{ avatarUrl?: string }} [options] If avatarUrl is set, stored on users.avatar_url (e.g. R2 public URL).
 */
export const updatePublicUsername = async (userId, username, options = {}) => {
  const { avatarUrl } = options;
  const trimmed = (username || '').trim();
  if (!userId) throw new Error('Not signed in');
  if (!isValidUsernameFormat(trimmed)) {
    throw new Error(
      'Username must be 3–20 characters and contain only letters, numbers, and underscores.',
    );
  }

  // Usernames are unique regardless of capitals (users_username_lower_key);
  // ilike with escaped wildcards = case-insensitive exact match.
  const { data: taken } = await supabase
    .from('users')
    .select('id')
    .ilike('username', trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`))
    .neq('id', userId)
    .limit(1);

  if (taken && taken.length > 0) {
    throw new Error('Username already taken');
  }

  const patch = {
    username: trimmed,
    updated_at: new Date().toISOString(),
  };
  if (typeof avatarUrl === 'string' && avatarUrl.length > 0) {
    patch.avatar_url = avatarUrl;
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select(PUBLIC_USER_PROFILE_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Username already taken');
    }
    throw error;
  }

  return data;
};

/**
 * Update or clear public.users.avatar_url (R2 public URL, or null to use default outline).
 */
export const updatePublicAvatarUrl = async (userId, avatarUrl) => {
  if (!userId) throw new Error('Not signed in');

  const patch = {
    updated_at: new Date().toISOString(),
  };
  if (avatarUrl === null || avatarUrl === '') {
    patch.avatar_url = null;
  } else if (typeof avatarUrl === 'string') {
    patch.avatar_url = avatarUrl;
  } else {
    throw new Error('Invalid avatar URL');
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select(PUBLIC_USER_PROFILE_COLUMNS)
    .single();

  if (error) throw error;
  return data;
};

export const logoutUserSecure = async () => {
  try {
    await supabase.auth.signOut();
    clearVisitedFavoriteCache();
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

/**
 * Deletes the current user's app data and auth record via the
 * `delete_my_account` RPC (scripts/schema_baseline_2026_09.sql).
 */
export const deleteAccountSecure = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;

  clearVisitedFavoriteCache();

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Expected: JWT user no longer exists.
  }
};

/**
 * Exchange an Apple/Google ID token for a Supabase session.
 * The caller loads the profile (refreshUser).
 */
const completeIdTokenSignIn = async (provider, token) => {
  const { error: signInError } = await supabase.auth.signInWithIdToken({ provider, token });
  if (signInError) {
    if (isNetworkError(signInError)) throw new Error(CONNECTION_ERROR_MESSAGE);
    throw signInError;
  }
};

/**
 * Native Sign in with Apple (iOS only). Requires Supabase Apple provider + bundle ID in dashboard.
 */
export const appleSignInSecure = async () => {
  if (Platform.OS !== 'ios') {
    throw new Error('Sign in with Apple is only available on iOS.');
  }

  const AppleAuthentication = require('expo-apple-authentication');

  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error('Sign in with Apple is not available on this device.');
  }

  clearVisitedFavoriteCache();

  let credential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    if (e?.code === 'ERR_REQUEST_CANCELED') {
      const err = new Error('ERR_REQUEST_CANCELED');
      err.code = 'ERR_REQUEST_CANCELED';
      throw err;
    }
    throw e;
  }

  if (!credential?.identityToken) {
    throw new Error('Apple Sign-In failed — no identity token returned.');
  }

  await completeIdTokenSignIn('apple', credential.identityToken);
};

export const googleSignInSecure = async () => {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  if (!webClientId || !webClientId.includes('.apps.googleusercontent.com')) {
    throw new Error(
      'Google Sign-In is not configured in this build (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID). ' +
        'Set it in expo.dev → Environment variables for this EAS profile, then rebuild.',
    );
  }

  // Drop stale Supabase refresh tokens so startup/sign-in does not log AuthApiError noise.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // best-effort
  }
  clearVisitedFavoriteCache();

  GoogleSignin.configure({
    webClientId,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();

  // v16: signIn() resolves with { type: 'cancelled' } instead of throwing on cancel.
  if (response.type === 'cancelled' || response.type === 'noSavedCredentialFound') {
    const err = new Error('SIGN_IN_CANCELLED');
    err.code = 'SIGN_IN_CANCELLED';
    throw err;
  }

  if (!response.data?.idToken) {
    throw new Error('Google Sign-In failed — no ID token returned.');
  }

  await completeIdTokenSignIn('google', response.data.idToken);
};
