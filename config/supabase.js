import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

const PLACEHOLDER_URL_FRAGMENTS = ['your-project', 'example.com', 'localhost'];
const PLACEHOLDER_KEY_FRAGMENTS = ['your-supabase-anon-key', 'anon-key'];

export const isSupabaseConfigured = Boolean(
  supabaseUrl
    && supabaseAnonKey
    && supabaseUrl.startsWith('https://')
    && !PLACEHOLDER_URL_FRAGMENTS.some((f) => supabaseUrl.includes(f))
    && !PLACEHOLDER_KEY_FRAGMENTS.some((f) => supabaseAnonKey.includes(f)),
);

if (!isSupabaseConfigured) {
  console.error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env and fill in your values.',
  );
}

// Guard: createClient throws synchronously if URL is undefined/invalid.
// Use stub values so the import never crashes — isSupabaseConfigured gates all real usage in App.js.
const safeUrl = isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co';
const safeKey = isSupabaseConfigured ? supabaseAnonKey : 'placeholder-key';

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
