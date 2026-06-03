import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

function looksConfigured(value: string | undefined, placeholder: string): value is string {
  return Boolean(value && value.length > 10 && !value.includes(placeholder));
}

const configuredUrl = looksConfigured(supabaseUrl, "your-project") ? supabaseUrl : "";
const configuredAnonKey = looksConfigured(supabaseAnonKey, "your-supabase-anon-key") ? supabaseAnonKey : "";

export const isSupabaseConfigured = Boolean(configuredUrl && configuredAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(configuredUrl, configuredAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    })
  : null;
