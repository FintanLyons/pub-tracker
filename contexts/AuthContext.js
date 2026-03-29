import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { supabase } from '../config/supabase';
import { logoutUserSecure, deleteAccountSecure } from '../services/SecureAuthService';

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
    .select('*')
    .eq('id', uid)
    .limit(1);
  return users && users.length > 0 ? users[0] : null;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Restore session from AsyncStorage on mount.
    //    Validate with getUser() (server roundtrip) — if the refresh
    //    token is dead we clear the stale local session instead of crashing.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const { error } = await supabase.auth.getUser();
          if (error) {
            await supabase.auth.signOut({ scope: 'local' });
            setUser(null);
            setLoading(false);
            return;
          }
        } catch {
          await supabase.auth.signOut({ scope: 'local' });
          setUser(null);
          setLoading(false);
          return;
        }
        const profile = await loadProfile(session.user.id);
        setUser(profile);
        setLoading(false);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    // 2. React to auth events (sign-in, sign-out, token refresh).
    //    SIGNED_IN fires after signInWithPassword / signUp-with-session.
    //    We load the profile here so the app transitions automatically.
    //    If the profile doesn't exist yet (register race), that's OK —
    //    refreshUser() is called explicitly after register/login to catch it.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setUser(null);
        return;
      }
      const profile = await loadProfile(session.user.id);
      if (profile) setUser(profile);
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = useCallback(async () => {
    await logoutUserSecure();
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountSecure();
    setUser(null);
  }, []);

  // Called by AuthScreen after successful register / login so we can
  // pick up a profile that may not have existed when onAuthStateChange fired.
  const refreshUser = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setUser(null);
      return;
    }
    const profile = await loadProfile(session.user.id);
    setUser(profile);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, logout, deleteAccount, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};
