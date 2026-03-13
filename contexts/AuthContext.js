import React, { createContext, useState, useEffect, useContext } from 'react';
import { supabase } from '../config/supabase';
import { logoutUserSecure } from '../services/SecureAuthService';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .limit(1)
          .then(({ data: users }) => {
            setUser(users && users.length > 0 ? users[0] : null);
            setLoading(false);
          });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          setUser(null);
          return;
        }

        if (session?.user) {
          const { data: users } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .limit(1);

          setUser(users && users.length > 0 ? users[0] : null);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await logoutUserSecure();
    setUser(null);
  };

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setUser(null);
      return;
    }
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .limit(1);
    setUser(users && users.length > 0 ? users[0] : null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
