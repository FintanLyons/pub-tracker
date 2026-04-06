import { supabase } from '../config/supabase';
import { clearVisitedFavoriteCache } from './PubService';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

/** Auth user_metadata key — false = must complete ChooseUsernameScreen (set on new signup). */
const META_APP_USERNAME_CHOSEN = 'app_username_chosen';

const setAuthUsernamePending = async () => {
  const { error } = await supabase.auth.updateUser({
    data: { [META_APP_USERNAME_CHOSEN]: false },
  });
  if (error) {
    console.warn('setAuthUsernamePending:', error.message);
  }
};

export const isValidUsernameFormat = (username) =>
  typeof username === 'string' && USERNAME_REGEX.test(username.trim());

/**
 * Supabase projects often have a trigger on auth.users that INSERTs public.users
 * with a placeholder username (e.g. email local-part) before the client runs.
 * ensureUserStub then sees an existing row and skips — ChooseUsername never shows.
 * Call after sign-up / brand-new OAuth so the app owns the first username set.
 */
const clearUsernameForInAppChoice = async (userId) => {
  if (!userId) return;
  const { error } = await supabase
    .from('users')
    .update({ username: null, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) {
    console.warn('clearUsernameForInAppChoice:', error.message);
  }
};

/**
 * Ensure a public.users row exists for this auth user (username may be NULL).
 * Call when session exists but SELECT returned no row (cold start / race).
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
    return;
  }

  try {
    await syncUserStatsLite(userId);
  } catch {
    // best-effort
  }
};

export const registerUserSecure = async (email, password) => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
    clearVisitedFavoriteCache();

    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      const msg = signUpError.message || '';
      if (msg.includes('seconds') || msg.includes('rate limit')) {
        throw new Error('Too many registration attempts. Please wait a minute and try again.');
      }
      if (
        msg.toLowerCase().includes('already') ||
        msg.toLowerCase().includes('exist') ||
        msg.toLowerCase().includes('duplicate')
      ) {
        throw new Error('This email is already registered. Please use the login tab instead.');
      }
      throw signUpError;
    }

    const userData = authData.user;
    const sessionData = authData.session;
    if (!userData?.id) throw new Error('Registration failed — please try again.');

    const emptyIdentities = !userData.identities || userData.identities.length === 0;
    const createdSecondsAgo = (Date.now() - new Date(userData.created_at).getTime()) / 1000;
    if (emptyIdentities || (!sessionData && createdSecondsAgo > 5)) {
      throw new Error('This email is already registered. Please use the login tab instead.');
    }

    if (!sessionData) {
      return { user: null, session: null, needsEmailVerification: true };
    }

    await ensureUserStub(userData.id, email);
    await clearUsernameForInAppChoice(userData.id);
    await setAuthUsernamePending();

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userData.id)
      .single();

    if (profileError) throw profileError;

    return { user: profile, session: sessionData, needsEmailVerification: false };
  } catch (error) {
    const msg = error.message || 'Registration failed';
    if (msg.includes('already registered') || msg.includes('User already registered')) {
      throw new Error('This email is already registered. Please use the login tab instead.');
    }
    if (msg.includes('rate limit') || msg.includes('seconds') || msg.includes('wait')) {
      throw new Error('Too many attempts. Please wait a minute and try again.');
    }
    if (msg.includes('invalid')) {
      throw new Error('Please check your email and password format.');
    }
    throw error;
  }
};

const isValidEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((text || '').trim());

export const loginUserSecure = async (email, password) => {
  try {
    if (!isValidEmail(email)) {
      throw new Error('Please enter a valid email address.');
    }

    await supabase.auth.signOut({ scope: 'local' });
    clearVisitedFavoriteCache();

    const trimmedEmail = email.trim();

    const { data: authData, error: signInError } =
      await supabase.auth.signInWithPassword({ email: trimmedEmail, password });

    if (signInError) {
      const m = (signInError.message || '').toLowerCase();
      if (m.includes('email not confirmed') || m.includes('not confirmed')) {
        throw new Error('Email not confirmed. Please verify your email before logging in.');
      }
      throw new Error('Invalid email or password.');
    }

    let { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .limit(1);

    let user;
    if (!users || users.length === 0) {
      await ensureUserStub(authData.user.id, authData.user.email);
      const { data: refetch } = await supabase
        .from('users')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      if (!refetch) {
        throw new Error('Unable to set up your account. Please contact support.');
      }
      user = refetch;
    } else {
      user = users[0];
    }

    return { user, session: authData.session };
  } catch (error) {
    const msg = error.message || '';
    if (
      msg.includes('Invalid email or password') ||
      msg.includes('valid email') ||
      msg.includes('Email not confirmed') ||
      msg.includes('Unable to set up')
    ) {
      throw error;
    }
    throw new Error('Invalid email or password.');
  }
};

/**
 * Persist username to public.users only — no getSession/getUser/updateUser here.
 * Avoids Supabase auth client deadlocks during ChooseUsername submit (see AuthContext).
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

  const { data: taken } = await supabase
    .from('users')
    .select('id')
    .eq('username', trimmed)
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
    .select()
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
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Sync app_username_chosen to auth metadata after a delay — do not await from UI;
 * updateUser can deadlock with onAuthStateChange if called inline with getSession/getUser.
 */
export const scheduleAuthUsernameMetadataSync = () => {
  setTimeout(() => {
    void supabase.auth
      .updateUser({
        data: { [META_APP_USERNAME_CHOSEN]: true },
      })
      .then(({ error }) => {
        if (error) console.warn('scheduleAuthUsernameMetadataSync:', error.message);
      });
  }, 250);
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
 * `delete_my_account` RPC (scripts/tier2_security_hardening.sql).
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

export const googleSignInSecure = async () => {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');

  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  clearVisitedFavoriteCache();

  const response = await GoogleSignin.signIn();

  if (!response.data?.idToken) {
    throw new Error('Google Sign-In failed — no ID token returned.');
  }

  const { data: authData, error: signInError } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: response.data.idToken,
  });

  if (signInError) throw signInError;

  const authUser = authData.user;

  let { data: users } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .limit(1);

  if (!users || users.length === 0) {
    await ensureUserStub(authUser.id, authUser.email);
  }

  const createdMs = Date.now() - new Date(authUser.created_at).getTime();
  const isBrandNewAuthUser = createdMs >= 0 && createdMs < 120_000;
  if (isBrandNewAuthUser) {
    await clearUsernameForInAppChoice(authUser.id);
    await setAuthUsernamePending();
  }

  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();
  if (fetchError || !user) {
    throw new Error('Unable to set up your account. Please contact support.');
  }

  return { user, session: authData.session };
};

export const getCurrentUserSecure = async () => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .limit(1);

    return users && users.length > 0 ? users[0] : null;
  } catch {
    return null;
  }
};

const syncUserStatsLite = async (userId) => {
  const { data: existing } = await supabase
    .from('user_stats')
    .select('user_id')
    .eq('user_id', userId)
    .limit(1);

  if (!existing || existing.length === 0) {
    await supabase.from('user_stats').insert({
      user_id: userId,
      pubs_visited: 0,
      total_score: 0,
      level: 1,
      last_synced_at: new Date().toISOString(),
    });
  }
};
