import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_CONFIG = {
  url: 'https://ddfdwxrnouneqqzactus.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkZmR3eHJub3VuZXFxemFjdHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxODA2ODUsImV4cCI6MjA3Nzc1NjY4NX0.DNi_BOgu4nACv708u3n-p0ZzP0TE4Jqufp1jOsXXro0',
};

export const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Legacy helpers kept during migration -- new code should use `supabase` directly.
export const getSupabaseUrl = () => {
  if (!SUPABASE_CONFIG.url) return null;
  return `${SUPABASE_CONFIG.url}/rest/v1`;
};

export const getSupabaseHeaders = (accessToken = null) => {
  if (!SUPABASE_CONFIG.anonKey) return null;
  const authToken = accessToken || SUPABASE_CONFIG.anonKey;
  return {
    'apikey': SUPABASE_CONFIG.anonKey,
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
};
