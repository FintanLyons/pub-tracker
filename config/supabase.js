// Supabase Configuration
// Replace these values with your actual Supabase project credentials
// Get them from: Supabase Dashboard -> Project Settings -> API

export const SUPABASE_CONFIG = {
  // Your Supabase project URL (e.g., 'https://xxxxx.supabase.co')
  url: 'https://ddfdwxrnouneqqzactus.supabase.co',
  
  // Your Supabase anon/public key
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkZmR3eHJub3VuZXFxemFjdHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxODA2ODUsImV4cCI6MjA3Nzc1NjY4NX0.DNi_BOgu4nACv708u3n-p0ZzP0TE4Jqufp1jOsXXro0',
};

// Helper function to get the Supabase REST API URL
export const getSupabaseUrl = () => {
  if (!SUPABASE_CONFIG.url) {
    console.error('⚠️  Supabase URL not configured!');
    return null;
  }
  return `${SUPABASE_CONFIG.url}/rest/v1`;
};

// Helper function to get headers for Supabase requests
export const getSupabaseHeaders = () => {
  if (!SUPABASE_CONFIG.anonKey) {
    console.error('⚠️  Supabase API key not configured!');
    return null;
  }
  
  return {
    'apikey': SUPABASE_CONFIG.anonKey,
    'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
};

