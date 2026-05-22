import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
} from 'react';
import { supabase } from '../config/supabase';
import {
  logoutUserSecure,
  deleteAccountSecure,
  ensureUserStub,
  PUBLIC_USER_PROFILE_COLUMNS,
} from '../services/SecureAuthService';
import { removeAllPushTokensForUser } from '../services/PushNotificationService';
import { promiseWithTimeout } from '../utils/promiseWithTimeout';

/** Reading persisted Supabase session from AsyncStorage — hang here often needs local sign-out. */
const AUTH_SESSION_READ_TIMEOUT_MS = 10000;
/** Loading public.users after session is valid — allow longer for slow networks. */
const AUTH_PROFILE_TIMEOUT_MS = 15000;

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Load the public.users profile for a given auth user id.
 * Returns null if no profile row exists yet.
 */
const loadProfile = async (uid) => {
  if (!uid) return null;
  const { data: users } = await supabase
    .from('users')
    .select(PUBLIC_USER_PROFILE_COLUMNS)
    .eq('id', uid)
    .limit(1);
  return users && users.length > 0 ? users[0] : null;
};

/**
 * Merge auth user_metadata into the public.users row for gating (ChooseUsername).
 * appUsernameChosen: false = must complete in-app username; true/undefined handled in App.
 */
const mergeAuthIntoProfile = (authUser, profile) => {
  if (!profile) return null;
  const meta = authUser?.user_metadata || {};
  return {
    ...profile,
    appUsernameChosen: meta.app_username_chosen,
  };
};

const resolveProfileForSession = async (session, authUserHint) => {
  if (!session?.user?.id) return null;
  const { id, email } = session.user;

  let authUser = authUserHint;
  if (!authUser) {
    const { data } = await supabase.auth.getUser();
    authUser = data?.user;
  }

  let profile = await loadProfile(id);
  if (!profile) {
    await ensureUserStub(id, email);
    profile = await loadProfile(id);
  }
  if (!profile) return null;
  return mergeAuthIntoProfile(authUser || session.user, profile);
};

/** Restore session + public profile; throws on hard failures (caller handles timeout). */
async function bootstrapAuthSession() {
  const { data: { session }, error: sessionError } = await promiseWithTimeout(
    supabase.auth.getSession(),
    AUTH_SESSION_READ_TIMEOUT_MS,
    'getSession',
  );
  if (sessionError) {
    const msg = String(sessionError.message || '');
    if (/refresh token|invalid.*token|jwt|session expired/i.test(msg)) {
      await supabase.auth.signOut({ scope: 'local' });
    }
    return null;
  }

  if (!session?.user) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    await supabase.auth.signOut({ scope: 'local' });
    return null;
  }

  return promiseWithTimeout(
    resolveProfileForSession(session, data?.user),
    AUTH_PROFILE_TIMEOUT_MS,
    'profile load',
  );
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  /** Ignore auth-driven profile refresh briefly after local profile apply (avoids stale overwrite). */
  const skipAuthProfileRefreshUntilRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const finishBootstrap = async (profile) => {
      if (cancelled) return;
      setUser(profile);
      setLoading(false);
    };

    const failBootstrap = async (err) => {
      if (cancelled) return;
      const msg = String(err?.message ?? err);
      console.warn('AuthContext: bootstrap failed', msg);
      if (/getSession timed out/i.test(msg)) {
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          // best-effort — clear corrupt persisted session (same effect as "clear cache")
        }
      }
      setUser(null);
      setLoading(false);
    };

    bootstrapAuthSession()
      .then((profile) => finishBootstrap(profile))
      .catch((err) => failBootstrap(err));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setUser(null);
        return;
      }
      // Defer: calling getUser()/resolve inside this callback can deadlock the auth
      // client (e.g. right after updateUser from ChooseUsername).
      setTimeout(() => {
        if (Date.now() < skipAuthProfileRefreshUntilRef.current) {
          return;
        }
        void resolveProfileForSession(session, null)
          .then((profile) => {
            if (Date.now() < skipAuthProfileRefreshUntilRef.current) {
              return;
            }
            setUser(profile);
          })
          .catch((err) => {
            console.warn('AuthContext: auth state profile refresh failed', err?.message ?? err);
          });
      }, 0);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const logout = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      await removeAllPushTokensForUser(uid);
    }
    await logoutUserSecure();
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountSecure();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setUser(null);
      return;
    }
    const profile = await resolveProfileForSession(session, null);
    setUser(profile);
  }, []);

  /** After public.users UPDATE — no auth HTTP calls; merges row into state for instant UI. */
  const applyUserProfileRow = useCallback((row) => {
    if (!row?.id) return;
    skipAuthProfileRefreshUntilRef.current = Date.now() + 2500;
    setUser((prev) => ({
      ...row,
      appUsernameChosen: prev?.appUsernameChosen,
    }));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        logout,
        deleteAccount,
        refreshUser,
        applyUserProfileRow,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
