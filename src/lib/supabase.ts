import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

function looksConfigured(value: string | undefined, placeholder: string): value is string {
  return Boolean(value && value.length > 10 && !value.includes(placeholder));
}

const configuredUrl = looksConfigured(supabaseUrl, "your-project") ? supabaseUrl : "";
const configuredPublishableKey =
  looksConfigured(supabasePublishableKey, "your-supabase-anon-key") &&
  looksConfigured(supabasePublishableKey, "your-supabase-publishable-key")
    ? supabasePublishableKey
    : "";

export const isSupabaseConfigured = Boolean(configuredUrl && configuredPublishableKey);

export const supabaseConfigError = !configuredUrl
  ? "Supabase URL is missing or still set to the placeholder value."
  : !configuredPublishableKey
    ? "Supabase publishable key is missing or still set to the placeholder value."
    : null;

export const supabase = isSupabaseConfigured
  ? createClient(configuredUrl, configuredPublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    })
  : null;
