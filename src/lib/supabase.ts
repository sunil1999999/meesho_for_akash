import { createClient, SupabaseClient } from '@supabase/supabase-js';

const LIVE_URL = 'https://qdidweacorjptazicyjy.supabase.co';
const LIVE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaWR3ZWFjb3JqcHRhemljeWp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MDY5NDIsImV4cCI6MjEwNzM4Mjk0Mn0.k53HcrfNNb85O0GMM5cyZ7PVOFzDubQtqXEc3wxslzw';

// Environment variables or local storage configuration
const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Stored config fallback from Settings UI
const storedUrl = typeof window !== 'undefined' ? localStorage.getItem('meesho_supabase_url') || '' : '';
const storedKey = typeof window !== 'undefined' ? localStorage.getItem('meesho_supabase_key') || '' : '';

export const supabaseUrl = envUrl || storedUrl || LIVE_URL;
export const supabaseAnonKey = envKey || storedKey || LIVE_ANON_KEY;

export const isSupabaseConfigured = true;

export let supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export function reconfigureSupabase(url: string, key: string): SupabaseClient {
  if (typeof window !== 'undefined') {
    localStorage.setItem('meesho_supabase_url', url);
    localStorage.setItem('meesho_supabase_key', key);
  }
  supabase = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return supabase;
}
