import { supabase } from '../config/supabase';
import { clearVisitedFavoriteCache } from './PubService';

export const registerUserSecure = async (email, username, password) => {
  try {
    // Sign up first to get an authenticated session -- the users table
    // SELECT policy requires authentication, so we can't check username
    // availability before signing up.
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
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exist') || msg.toLowerCase().includes('duplicate')) {
        throw new Error('EMAIL_ALREADY_EXISTS');
      }
      throw signUpError;
    }

    const userData = authData.user;
    const sessionData = authData.session;
    if (!userData?.id) throw new Error('Registration failed - user ID missing');

    const hasSession = !!sessionData?.access_token;
    const needsEmailVerification = !userData.email_confirmed_at;

    let user = {
      id: userData.id,
      email: userData.email || email,
      username: userData.user_metadata?.username || username,
    };

    if (hasSession) {
      // Now authenticated -- check username availability before creating profile
      const { data: existing } = await supabase
        .from('users')
        .select('username')
        .eq('username', username)
        .limit(1);

      if (existing && existing.length > 0) {
        // Clean up the auth user we just created
        await supabase.auth.signOut();
        throw new Error('Username already taken');
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .upsert({
          id: userData.id,
          email,
          username,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select()
        .single();

      if (profileError) {
        // Unique constraint violation on username = username taken (race condition)
        if (profileError.code === '23505' && profileError.message?.includes('username')) {
          await supabase.auth.signOut();
          throw new Error('Username already taken');
        }
        throw profileError;
      }

      if (profile) user = profile;

      try {
        await syncUserStatsLite(user.id);
      } catch {
        // Stats sync is best-effort during registration
      }
    }

    return { user, session: sessionData, needsEmailVerification };
  } catch (error) {
    const msg = error.message || 'Registration failed';
    if (msg === 'EMAIL_ALREADY_EXISTS') {
      throw new Error('This email is already registered. Please use the login tab instead.');
    }
    if (msg.includes('already registered') || msg.includes('User already registered')) {
      throw new Error('This email is already registered. Please use the login tab instead.');
    }
    if (msg.includes('Username already taken')) throw error;
    if (msg.includes('rate limit') || msg.includes('seconds')) {
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
    let email = usernameOrEmail;

    if (!usernameOrEmail.includes('@')) {
      // Username login: look up email via an RPC or try signing in directly.
      // Since users SELECT requires auth, we use the Supabase Auth admin-safe
      // approach: store the username, attempt sign-in with a helper query.
      // We use a lightweight RPC if available, otherwise fall back to a
      // two-step approach: first try email=username (won't work), then look
      // up after a temporary sign-in.
      //
      // Pragmatic solution: call a DB function that anon can execute.
      const { data: emailResult, error: rpcError } = await supabase
        .rpc('get_email_by_username', { lookup_username: usernameOrEmail });

      if (rpcError || !emailResult) {
        throw new Error('User not found');
      }
      email = emailResult;
    }

    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) throw new Error(signInError.message || 'Login failed');
    if (!authData.user.email_confirmed_at) {
      throw new Error('Email not confirmed. Please verify your email before logging in.');
    }

    // Fetch or create user profile (now authenticated)
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
          username: authData.user.user_metadata?.username || authData.user.email.split('@')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) throw new Error('Unable to set up your account. Please contact support.');
      user = newUser;
    } else {
      user = users[0];
    }

    return { user, session: authData.session };
  } catch (error) {
    const msg = error.message || '';
    if (msg.includes('User not found') || msg.includes('Invalid') || msg.includes('not confirmed') || msg.includes('Unable to')) {
      throw error;
    }
    throw error;
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

export const getCurrentUserSecure = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
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

/**
 * Lightweight stats sync used during registration.
 * Full implementation lives in UserService to avoid circular deps.
 */
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
