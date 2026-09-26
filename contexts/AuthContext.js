import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../config/supabase';
import {
  logoutUserSecure,
  deleteAccountSecure,
  ensureUserStub,
  PUBLIC_USER_PROFILE_COLUMNS,
} from '../services/SecureAuthService';
import { removeAllPushTokensForUser } from '../services/PushNotificationService';
import { isInvalidSessionError } from '../services/authErrors';
import { useNetworkStatus } from './NetworkContext';
import { promiseWithTimeout } from '../utils/promiseWithTimeout';

/** Reading persisted Supabase session from AsyncStorage — hang here often needs local sign-out. */
const AUTH_SESSION_READ_TIMEOUT_MS = 10000;
/** Validating the session with the auth server; slower than this is treated as offline. */
const AUTH_USER_CHECK_TIMEOUT_MS = 8000;
/** Loading public.users after session is valid — allow longer for slow networks. */
const AUTH_PROFILE_TIMEOUT_MS = 15000;

/** Last successfully loaded profile, so a signed-in user can open the app offline. */
const PROFILE_CACHE_KEY = 'auth:lastProfile:v1';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const readCachedProfile = async (uid) => {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    return cached?.id === uid ? cached : null;
  } catch {
    return null;
  }
};

const writeCachedProfile = (profile) => {
  if (!profile?.id) return;
  AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)).catch(() => {});
};

const clearCachedProfile = () => {
  AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {});
};

/**
 * Load the public.users profile for a given auth user id.
 * Returns null only when no row exists; throws on query/network failure.
 */
const loadProfile = async (uid) => {
  const { data, error } = await supabase
    .from('users')
    .select(PUBLIC_USER_PROFILE_COLUMNS)
    .eq('id', uid)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
};

/** Profile for a live session; creates the public.users row if missing. Throws on failure. */
const resolveProfileForSession = async (session) => {
  const { id, email } = session.user;

  let profile = await loadProfile(id);
  if (!profile) {
    await ensureUserStub(id, email);
    profile = await loadProfile(id);
  }
  if (!profile) {
    throw new Error("We couldn't set up your profile. Please try again.");
  }

  writeCachedProfile(profile);
  return profile;
};

/** Signed in locally, but the profile could not be loaded and nothing is cached. */
class OfflineBootstrapError extends Error {
  constructor(cause) {
    super(`Signed in, but the profile could not be loaded: ${cause?.message ?? cause}`);
    this.name = 'OfflineBootstrapError';
    this.cause = cause;
  }
}

/**
 * Restore session + public profile. Resolves to { profile, fromCache }.
 * - No session / server rejected it → profile null (show sign-in).
 * - Any other failure with a local session → cached profile, else OfflineBootstrapError.
 */
async function bootstrapAuthSession() {
  const { data: { session }, error: sessionError } = await promiseWithTimeout(
    supabase.auth.getSession(),
    AUTH_SESSION_READ_TIMEOUT_MS,
    'getSession',
  );
  if (sessionError) {
    if (isInvalidSessionError(sessionError)) {
      await supabase.auth.signOut({ scope: 'local' });
      return { profile: null, fromCache: false };
    }
    throw sessionError;
  }
  if (!session?.user) return { profile: null, fromCache: false };

  // Only a definite rejection from the auth server signs the user out; offline,
  // timeouts and 5xx responses keep the local session.
  try {
    const { error } = await promiseWithTimeout(
      supabase.auth.getUser(),
      AUTH_USER_CHECK_TIMEOUT_MS,
      'getUser',
    );
    if (error) {
      if (isInvalidSessionError(error)) {
        await supabase.auth.signOut({ scope: 'local' });
        clearCachedProfile();
        return { profile: null, fromCache: false };
      }
      console.warn('AuthContext: session check unavailable', error.message);
    }
  } catch (err) {
    console.warn('AuthContext: session check unavailable', err?.message ?? err);
  }

  try {
    const profile = await promiseWithTimeout(
      resolveProfileForSession(session),
      AUTH_PROFILE_TIMEOUT_MS,
      'profile load',
    );
    return { profile, fromCache: false };
  } catch (err) {
    const cached = await readCachedProfile(session.user.id);
    if (cached) return { profile: cached, fromCache: true };
    throw new OfflineBootstrapError(err);
  }
}

export const AuthProvider = ({ children }) => {
  const { isConnected } = useNetworkStatus();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  /** Signed in locally but could not load the profile (offline, no cache). */
  const [connectionError, setConnectionError] = useState(false);
  const mountedRef = useRef(true);
  /** Profile came from the offline cache; reload it once the connection returns. */
  const profileFromCacheRef = useRef(false);

  const runBootstrap = useCallback(async () => {
    try {
      const { profile, fromCache } = await bootstrapAuthSession();
      if (!mountedRef.current) return;
      profileFromCacheRef.current = fromCache;
      setUser(profile);
      setConnectionError(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = String(err?.message ?? err);
      console.warn('AuthContext: bootstrap failed', msg);
      if (err instanceof OfflineBootstrapError) {
        setConnectionError(true);
      } else {
        if (/getSession timed out/i.test(msg)) {
          // Corrupt persisted session (same effect as "clear cache").
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        }
        setUser(null);
        setConnectionError(false);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    runBootstrap();

    // Sign-in flows call refreshUser themselves and bootstrap handles the initial
    // session; token refreshes do not change the profile. Only sign-out matters here.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearCachedProfile();
        setUser(null);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [runBootstrap]);

  // Signed in but offline at launch: finish loading as soon as the connection returns.
  useEffect(() => {
    if (connectionError && isConnected) {
      runBootstrap();
    }
  }, [connectionError, isConnected, runBootstrap]);

  useEffect(() => {
    if (!isConnected || !profileFromCacheRef.current) return;
    profileFromCacheRef.current = false;
    supabase.auth.getSession()
      .then(({ data: { session } }) => (session ? resolveProfileForSession(session) : null))
      .then((profile) => {
        if (profile && mountedRef.current) setUser(profile);
      })
      .catch((err) => {
        profileFromCacheRef.current = true;
        console.warn('AuthContext: profile refresh after reconnect failed', err?.message ?? err);
      });
  }, [isConnected]);

  const retryConnection = useCallback(() => {
    setLoading(true);
    return runBootstrap();
  }, [runBootstrap]);

  const logout = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      await removeAllPushTokensForUser(uid);
    }
    await logoutUserSecure();
    clearCachedProfile();
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountSecure();
    clearCachedProfile();
    setUser(null);
  }, []);

  /** After sign-in: load the profile for the new session. Throws so the caller can show why. */
  const refreshUser = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setUser(null);
      return;
    }
    const profile = await resolveProfileForSession(session);
    setConnectionError(false);
    setUser(profile);
  }, []);

  /** After a public.users UPDATE — apply the returned row without another fetch. */
  const applyUserProfileRow = useCallback((row) => {
    if (!row?.id) return;
    writeCachedProfile(row);
    setUser(row);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        connectionError,
        retryConnection,
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
