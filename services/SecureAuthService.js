import { supabase } from '../config/supabase';
import { clearVisitedFavoriteCache } from './PubService';

export const registerUserSecure = async (email, username, password) => {
  try {
    // Clear any stale local session so signUp with "Confirm email" ON
    // doesn't leave old tokens in AsyncStorage. Local scope only —
    // no server call, no risk of network failure aborting registration.
    await supabase.auth.signOut({ scope: 'local' });
    clearVisitedFavoriteCache();

    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
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

    // Session exists — email auto-confirmed. Create profile now.
    const { data: existing } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Username already taken');
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .upsert(
        {
          id: userData.id,
          email,
          username,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select()
      .single();

    if (profileError) {
      if (profileError.code === '23505' && profileError.message?.includes('username')) {
        await supabase.auth.signOut({ scope: 'local' });
        throw new Error('Username already taken');
      }
      throw profileError;
    }

    try {
      await syncUserStatsLite(userData.id);
    } catch {
      // best-effort
    }

    const user = profile || { id: userData.id, email, username };
    return { user, session: sessionData, needsEmailVerification: false };
  } catch (error) {
    const msg = error.message || 'Registration failed';
    if (msg.includes('already registered') || msg.includes('User already registered')) {
      throw new Error('This email is already registered. Please use the login tab instead.');
    }
    if (msg.includes('Username already taken')) throw error;
    if (msg.includes('rate limit') || msg.includes('seconds') || msg.includes('wait')) {
      throw new Error('Too many attempts. Please wait a minute and try again.');
    }
    if (msg.includes('invalid')) {
      throw new Error('Please check your email and password format.');
    }
    throw error;
  }
};

export const loginUserSecure = async (usernameOrEmail, password) => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
    clearVisitedFavoriteCache();

    let email = usernameOrEmail;

    if (!usernameOrEmail.includes('@')) {
      const { data: emailResult, error: rpcError } = await supabase.rpc(
        'get_email_by_username',
        { lookup_username: usernameOrEmail },
      );

      if (rpcError || !emailResult) {
        throw new Error('Invalid username or password.');
      }
      email = emailResult;
    }

    // signInWithPassword replaces whatever session is in AsyncStorage.
    const { data: authData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      const m = (signInError.message || '').toLowerCase();
      if (m.includes('email not confirmed') || m.includes('not confirmed')) {
        throw new Error('Email not confirmed. Please verify your email before logging in.');
      }
      throw new Error('Invalid username or password.');
    }

    // Ensure public.users profile exists (might be missing if user
    // registered with "Confirm email" ON — profile wasn't created then).
    let { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .limit(1);

    let user;
    if (!users || users.length === 0) {
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: authData.user.email,
          username:
            authData.user.user_metadata?.username ||
            authData.user.email.split('@')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) {
        throw new Error('Unable to set up your account. Please contact support.');
      }
      user = newUser;

      try {
        await syncUserStatsLite(user.id);
      } catch {
        // best-effort
      }
    } else {
      user = users[0];
    }

    return { user, session: authData.session };
  } catch (error) {
    const msg = error.message || '';
    if (
      msg.includes('Invalid username or password') ||
      msg.includes('Email not confirmed') ||
      msg.includes('Unable to set up')
    ) {
      throw error;
    }
    throw new Error('Invalid username or password.');
  }
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

  // The auth.users row is already gone, so signOut may return an error —
  // that's expected. We just need to clear local storage.
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

  // Ensure public.users profile exists
  let { data: users } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .limit(1);

  let user;
  if (!users || users.length === 0) {
    // Derive a username from display name, falling back to email prefix
    const displayName =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.email?.split('@')[0] ||
      'user';

    let baseUsername = displayName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/__+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 20);

    if (baseUsername.length < 3) baseUsername = baseUsername.padEnd(3, '0');

    // Ensure uniqueness — if taken, append random digits
    let username = baseUsername;
    const { data: taken } = await supabase
      .from('users')
      .select('username')
      .eq('username', baseUsername)
      .limit(1);

    if (taken && taken.length > 0) {
      username = `${baseUsername.slice(0, 16)}_${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        id: authUser.id,
        email: authUser.email,
        username,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) throw new Error('Unable to set up your account. Please contact support.');
    user = newUser;

    try {
      await syncUserStatsLite(user.id);
    } catch {
      // best-effort
    }
  } else {
    user = users[0];
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
